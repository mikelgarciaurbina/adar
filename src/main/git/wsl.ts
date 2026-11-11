// Repositories inside WSL (Windows Subsystem for Linux), opened from Windows as
// \\wsl.localhost\<distro>\home\me\repo (or \\wsl$\<distro>\…).
//
// Git for Windows reaches those folders through the 9P file share: slowly, as another owner
// ("dubious ownership"), with Windows line endings and file modes, and without the user's Linux
// SSH keys, credential helpers and hooks. So, as VS Code's WSL mode does, git runs inside the
// distribution instead:
//
//   wsl.exe -d <distro> --cd <linux dir> --exec [env PATH=<login PATH>] git <args>
//
// --exec runs git directly (no shell in between). Only the variables Adar sets cross over (named
// in WSLENV, their values stay in wsl.exe's environment), plus PATH and SSH_AUTH_SOCK as the
// user's login shell in the distribution sets them (read once per distribution). Paths change form
// on the way: arguments and path-valued variables become Linux paths (`windowsToWsl`), paths git
// prints become Windows paths again (`wslToWindows`). Node itself reads and writes the files
// through the share.

import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

export interface WslLocation {
  /** UNC host: 'wsl.localhost' (Windows 11, recent WSL) or 'wsl$' (older), as the path gave it. */
  host: 'wsl.localhost' | 'wsl$'
  /** Distribution name ("Ubuntu", "Ubuntu-22.04", "Debian"…). */
  distro: string
  /** Absolute Linux path ("/home/me/repo"). */
  linux: string
}

const WSL_UNC = /^(?:\\\\|\/\/)(wsl\.localhost|wsl\$)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/i
/** Distribution names WSL accepts (letters, digits, '.', '_', '-'); never an option for wsl.exe. */
const DISTRO = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

/** The distribution and Linux path of a \\wsl.localhost\… or \\wsl$\… path; null for any other path. */
export function parseWslPath(p: unknown): WslLocation | null {
  if (typeof p !== 'string') return null
  const m = WSL_UNC.exec(p.trim())
  if (!m || !DISTRO.test(m[2])) return null
  const parts: string[] = []
  for (const s of (m[3] ?? '').split(/[\\/]+/)) {
    if (!s || s === '.') continue
    if (s === '..') parts.pop()
    else parts.push(s)
  }
  return { host: m[1].toLowerCase() === 'wsl$' ? 'wsl$' : 'wsl.localhost', distro: m[2], linux: '/' + parts.join('/') }
}

/** The UNC path of a Linux path in `loc`'s distribution (`\\wsl.localhost\Ubuntu\home\me`). */
export function wslUncPath(loc: Pick<WslLocation, 'host' | 'distro'>, linux: string): string {
  const parts = linux.split('/').filter(Boolean)
  return `\\\\${loc.host}\\${loc.distro}\\${parts.join('\\')}`
}

/**
 * A path git printed inside `loc`'s distribution, as Windows reaches it: /mnt/c/x is C:\x, anything
 * else goes through the share. Relative paths are relative to `loc.linux` (git's working directory).
 */
export function wslToWindows(loc: WslLocation, printed: string): string {
  const linux = path.posix.resolve(loc.linux, printed)
  const drive = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(linux)
  if (drive) return path.win32.join(`${drive[1].toUpperCase()}:\\`, (drive[2] ?? '').replace(/\//g, '\\'))
  return wslUncPath(loc, linux)
}

/**
 * A Windows path as git inside `distro` reaches it: its own share's paths become Linux paths and
 * drive paths their /mnt/<drive> form. Null when it cannot (another distribution, a network share).
 */
export function windowsToWsl(distro: string, p: string): string | null {
  const inside = parseWslPath(p)
  if (inside) return inside.distro.toLowerCase() === distro.toLowerCase() ? inside.linux : null
  const drive = /^([a-z]):(?:[\\/](.*))?$/i.exec(p)
  if (!drive) return null
  const rest = (drive[2] ?? '').split(/[\\/]+/).filter(Boolean)
  return path.posix.normalize('/' + ['mnt', drive[1].toLowerCase(), ...rest].join('/'))
}

/** Where wsl.exe is: System32's, never one found first in a repository folder or on PATH. */
export function wslExecutable(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'wsl.exe')
}

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** What the user's login shell in a distribution sets that git and its helpers need. */
export interface WslLoginEnv {
  /** PATH (credential helpers such as `gh`, git-lfs, a newer git in ~/.local/bin). */
  path: string | null
  /** The SSH agent started by the shell's profile (keychain, ssh-agent in ~/.bashrc). */
  sshAuthSock: string | null
}

export interface WslCommand {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
}

/** Variable (set with the askpass environment) naming the askpass helper git inside WSL runs. */
export const ASKPASS_WSL_ENV = 'ADAR_ASKPASS_WSL'

/** Variables never sent to git inside WSL (they describe the Windows side). */
const WINDOWS_ONLY = new Set(['DISPLAY', 'ELECTRON_RUN_AS_NODE', ASKPASS_WSL_ENV])

/** Variables whose value is a path: translated to the Linux form. */
const PATH_VARS = new Set(['GIT_INDEX_FILE'])

/**
 * The wsl.exe command that runs `git <gitArgs>` in `loc`. `vars` are the variables Adar sets for
 * this git (they cross over through WSLENV; undefined ones are simply not sent); `base` is the
 * environment wsl.exe itself runs with (Adar's own). Throws when a path-valued variable cannot be
 * reached from the distribution.
 */
export function wslGitCommand(
  loc: WslLocation,
  gitArgs: string[],
  vars: Record<string, string | undefined>,
  login: WslLoginEnv | null,
  base: NodeJS.ProcessEnv = process.env
): WslCommand {
  const send: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined || !VAR_NAME.test(k) || WINDOWS_ONLY.has(k) || k.toUpperCase() === 'PATH' || k === 'WSLENV') continue
    if (PATH_VARS.has(k)) {
      const linux = windowsToWsl(loc.distro, v)
      if (linux === null) throw new Error(`${v} cannot be reached from WSL (${loc.distro})`)
      send[k] = linux
    } else {
      send[k] = v
    }
  }
  // Credential prompts: the helper written for WSL, or none (the Windows one cannot run there).
  if (send.GIT_ASKPASS !== undefined || send.SSH_ASKPASS !== undefined) {
    const helper = vars[ASKPASS_WSL_ENV] ? windowsToWsl(loc.distro, vars[ASKPASS_WSL_ENV]!) : null
    for (const k of ['GIT_ASKPASS', 'SSH_ASKPASS']) {
      if (send[k] === undefined) continue
      if (helper) send[k] = helper
      else delete send[k]
    }
    if (!helper) delete send.SSH_ASKPASS_REQUIRE
  }
  if (login?.sshAuthSock && !('SSH_AUTH_SOCK' in vars)) send.SSH_AUTH_SOCK = login.sshAuthSock

  // PATH cannot cross through WSLENV (wsl.exe itself is found through the Windows one): `env` sets it.
  const exec = login?.path ? ['env', `PATH=${login.path}`, 'git'] : ['git']
  return {
    file: wslExecutable(base),
    args: ['-d', loc.distro, '--cd', loc.linux, '--exec', ...exec, ...gitArgs],
    env: { ...base, ...send, WSLENV: Object.keys(send).join(':'), WSL_UTF8: '1' }
  }
}

/** wsl.exe's exit code for its own failures (no such distribution, WSL not installed…). */
const WSL_FAILED = new Set([-1, 4294967295])
/** WSL could not start git (`--exec git`), or `env` could not find it (`--exec env PATH=… git`). */
const GIT_MISSING = /execvpe?\(?\s*(?:git|env)\)?\s[^\n]*failed|env: .?git.?: No such file or directory/i

/**
 * wsl.exe's own failure, in words for the UI (null when the exit code is git's): no such
 * distribution, WSL not set up, git not installed in the distribution.
 */
export function wslFailure(
  distro: string,
  code: number,
  stderr: string,
  stdout: string
): { code: 'GIT_NOT_INSTALLED' | 'NOT_FOUND'; message: string } | null {
  const text = `${stderr}\n${stdout}`
  if (code !== 0 && GIT_MISSING.test(stderr)) {
    return {
      code: 'GIT_NOT_INSTALLED',
      message: `Git is not installed in ${distro} (WSL). Install it there (for example: sudo apt install git) and try again.`
    }
  }
  if (!WSL_FAILED.has(code)) return null
  const detail = text.replace(/\0/g, '').split('\n').map((l) => l.trim()).filter(Boolean)[0]
  return { code: 'NOT_FOUND', message: `WSL could not run git in ${distro}${detail ? `: ${detail}` : ''}` }
}

const ENV_MARK = '__ADAR_WSL_ENV_5c1e__'

/** Script the distribution's login shell runs: a marker line (rc files may print banners), then `env -0`. */
export const WSL_LOGIN_SCRIPT = `echo ${ENV_MARK}; exec env -0`

/** PATH and SSH_AUTH_SOCK from WSL_LOGIN_SCRIPT's output; null when the marker is missing. */
export function parseWslLoginEnv(out: string): WslLoginEnv | null {
  const at = out.indexOf(`${ENV_MARK}\n`)
  if (at < 0) return null
  const vars = new Map<string, string>()
  for (const rec of out.slice(at + ENV_MARK.length + 1).split('\0')) {
    const eq = rec.indexOf('=')
    if (eq > 0) vars.set(rec.slice(0, eq), rec.slice(eq + 1))
  }
  const value = (k: string) => {
    const v = vars.get(k)?.trim()
    return v ? v : null
  }
  return { path: value('PATH'), sshAuthSock: value('SSH_AUTH_SOCK') }
}

const loginEnvs = new Map<string, Promise<WslLoginEnv | null>>()

/**
 * The login shell's PATH and SSH agent in `distro` (once per distribution; null when it cannot be
 * read in time — git then runs with WSL's default PATH). The first call may start the WSL VM.
 */
export function wslLoginEnv(distro: string, timeoutMs = 10_000): Promise<WslLoginEnv | null> {
  const key = distro.toLowerCase()
  let pending = loginEnvs.get(key)
  if (!pending) {
    pending = readLoginEnv(distro, timeoutMs)
    loginEnvs.set(key, pending)
    // A failure (WSL still starting, a slow profile) is tried again on a later command.
    void pending.then((env) => {
      if (env === null) setTimeout(() => loginEnvs.get(key) === pending && loginEnvs.delete(key), 60_000).unref?.()
    })
  }
  return pending
}

function readLoginEnv(distro: string, timeoutMs: number): Promise<WslLoginEnv | null> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const done = (v: WslLoginEnv | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    let child: ReturnType<typeof spawn>
    try {
      // `sh -c 'exec "$SHELL" -ilc "$1"' sh <script>`: the script is an argument, never quoted into another.
      child = spawn(
        wslExecutable(),
        ['-d', distro, '--cd', '~', '--exec', 'sh', '-c', 'exec "${SHELL:-/bin/sh}" -ilc "$1"', 'sh', WSL_LOGIN_SCRIPT],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
          env: {
            ...process.env,
            // Keep rc files from doing interactive things (oh-my-zsh updates, tmux autostart).
            DISABLE_AUTO_UPDATE: 'true',
            ZSH_TMUX_AUTOSTART: 'false',
            ZSH_TMUX_AUTOSTARTED: 'true',
            ADAR_RESOLVING_ENVIRONMENT: '1',
            WSLENV: 'DISABLE_AUTO_UPDATE:ZSH_TMUX_AUTOSTART:ZSH_TMUX_AUTOSTARTED:ADAR_RESOLVING_ENVIRONMENT',
            WSL_UTF8: '1'
          },
          cwd: os.homedir(),
          windowsHide: true
        }
      )
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      done(null)
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8')
      if (out.length > 1_000_000) out = out.slice(-200_000)
    })
    child.on('error', () => done(null))
    child.on('close', () => done(parseWslLoginEnv(out)))
  })
}

/** True for a \\wsl.localhost\… / \\wsl$\… path on Windows (where git runs inside WSL for it). */
export function isWslPath(p: unknown, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && parseWslPath(p) !== null
}

/** The WSL location git runs in for working directory `cwd` (Windows only), or null. */
export function wslTarget(cwd: string | undefined, platform: NodeJS.Platform = process.platform): WslLocation | null {
  return platform === 'win32' && cwd ? parseWslPath(cwd) : null
}

/**
 * The default distribution and its user's home folder, as Windows reaches it
 * (`\\wsl.localhost\Ubuntu\home\me`); null when WSL is not installed or has no distribution.
 */
export function wslHomeFolder(timeoutMs = 15_000): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    let out = ''
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(wslExecutable(), ['--exec', 'printenv', 'WSL_DISTRO_NAME', 'HOME'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, WSL_UTF8: '1' },
        cwd: os.homedir(),
        windowsHide: true
      })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve(null)
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => (out += c.toString('utf8')))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? homeFromPrintenv(out) : null)
    })
  })
}

/** `printenv WSL_DISTRO_NAME HOME` output → the home folder's UNC path (null when either is missing). */
export function homeFromPrintenv(out: string): string | null {
  const [distro = '', home = ''] = out.replace(/\0/g, '').split(/\r?\n/).map((l) => l.trim())
  if (!DISTRO.test(distro) || !home.startsWith('/')) return null
  return wslUncPath({ host: 'wsl.localhost', distro }, home)
}
