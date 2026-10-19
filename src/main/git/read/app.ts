// App / system integration: info, settings, recents, credentials, terminal/editor,
// identity and the git console escape hatch.

import { execFile, spawn, type SpawnOptions } from 'node:child_process'
import { existsSync, promises as fs, type Stats } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { GitCommandResult, Identity } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import { summarizeGitOutput } from '../runner'
import type { PlatformAdapter } from '../../platform'
import type { SystemServices } from '../../system'
import { assertRepo, expandHome, invalidArgument, notFound } from './common'

type AppOps = Pick<
  ReadOps,
  | 'getAppInfo'
  | 'pickDirectory'
  | 'openExternal'
  | 'showInFolder'
  | 'openInTerminal'
  | 'openInEditor'
  | 'getSettings'
  | 'updateSettings'
  | 'getRecentRepos'
  | 'removeRecentRepo'
  | 'answerCredentialRequest'
  | 'getIdentity'
  | 'runGit'
>

/** Max stdout kept for git console commands (the UI cannot render more anyway). */
const CONSOLE_MAX_OUTPUT = 10 * 1024 * 1024

/** Split a command line into argv, honouring single/double quotes and backslash escapes. */
export function tokenizeCommand(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length && /["\\$`]/.test(cmd[i + 1])) cur += cmd[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else if (c === '\\' && i + 1 < cmd.length && process.platform !== 'win32') {
      cur += cmd[++i]
      has = true
    } else {
      cur += c
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

/** Spawn a detached GUI process; resolves once it started, rejects if it could not be spawned. */
export function spawnDetached(command: string, args: string[], opts: SpawnOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: false, ...opts })
    } catch (err) {
      reject(err)
      return
    }
    child.once('error', reject)
    child.once('spawn', () => {
      child.removeListener('error', reject)
      child.on('error', () => undefined)
      child.unref()
      resolve()
    })
  })
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15_000 }, (err, _stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr || '') }))
      else resolve()
    })
  })
}

async function existingPath(p: unknown): Promise<{ abs: string; isDir: boolean }> {
  if (typeof p !== 'string' || !p.trim()) throw invalidArgument('Path is required')
  const abs = path.resolve(expandHome(p.trim()))
  try {
    const st = await fs.stat(abs)
    return { abs, isDir: st.isDirectory() }
  } catch {
    throw notFound(`Not found: ${abs}`)
  }
}

// ── Opening repository files without an editor command ────────────────────
// Repository content is untrusted: handing a checked-out file to the OS "default app" runs it when
// its type is executable (.command / .terminal / extension-less executables on macOS, .bat / .js /
// .lnk on Windows, .desktop on Linux), and git leaves no quarantine flag for Gatekeeper to prompt.
// So the fallback opens FILES in a text editor (macOS `open -t`, Windows Notepad), except a few
// viewer-only types; bundles (Foo.app, also reached through a symlink or as the repo folder itself)
// are revealed instead of opened; Linux refuses executables. Decisions use the symlink's target.

/** Optional host method (Electron shell.openPath: ShellExecute, no cmd.exe), used for viewer types on Windows. */
type HostPlatform = PlatformAdapter & { openPath?(path: string): Promise<string> }

/** Types whose default app only displays them (opened as-is when not executable). */
const VIEWER_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp', '.heic', '.heif', '.ico', '.icns', '.pdf'
])
/** macOS bundle / installer directories (LaunchServices launches or installs them). */
const MAC_BUNDLE = /\.(app|appex|bundle|framework|plugin|workflow|action|pkg|mpkg|prefpane|saver|kext|qlgenerator|mdimporter|xpc|systemextension|dext|component|scptd|wdgt)$/i
/** Files xdg-open may run or install on Linux (besides anything with an executable bit). */
const LINUX_LAUNCHERS: ReadonlySet<string> = new Set([
  '.desktop', '.sh', '.bash', '.zsh', '.csh', '.ksh', '.fish', '.run', '.bin', '.appimage', '.jar',
  '.exe', '.msi', '.bat', '.cmd', '.com', '.flatpakref', '.flatpakrepo', '.snap', '.deb', '.rpm'
])

export type DefaultOpenPlan =
  /** Run and wait (macOS `open`, which returns once LaunchServices accepted the request). */
  | { kind: 'exec'; command: string; args: string[] }
  /** Start a detached GUI process. */
  | { kind: 'spawn'; command: string; args: string[] }
  | { kind: 'openPath'; path: string }
  | { kind: 'reveal'; path: string }
  | { kind: 'refuse'; message: string }

async function isMacBundle(dir: string): Promise<boolean> {
  if (MAC_BUNDLE.test(dir)) return true
  const has = (p: string) => fs.stat(path.join(dir, p)).then(() => true, () => false)
  return (await has('Contents/Info.plist')) || (await has('Contents/MacOS'))
}

/** How the no-editor fallback of openInEditor opens `abs` (an existing path) on `os`. */
export async function planDefaultOpen(abs: string, os: NodeJS.Platform, opts: { canOpenPath?: boolean } = {}): Promise<DefaultOpenPlan> {
  let real: string
  let st: Stats
  try {
    real = await fs.realpath(abs)
    st = await fs.stat(real)
  } catch {
    throw notFound(`Not found: ${abs}`)
  }
  const ext = path.extname(real).toLowerCase()
  const executable = (st.mode & 0o111) !== 0
  const viewer = VIEWER_EXTENSIONS.has(ext) && st.isFile() && !executable
  if (os === 'darwin') {
    if (st.isDirectory()) return (await isMacBundle(real)) ? { kind: 'reveal', path: real } : { kind: 'exec', command: 'open', args: [real] }
    return viewer ? { kind: 'exec', command: 'open', args: [real] } : { kind: 'exec', command: 'open', args: ['-t', real] }
  }
  if (os === 'win32') {
    // Never through `cmd /c start`: cmd.exe would parse & % ^ in the file name.
    if (st.isDirectory()) return { kind: 'reveal', path: real }
    if (VIEWER_EXTENSIONS.has(ext) && st.isFile() && opts.canOpenPath) return { kind: 'openPath', path: real }
    return { kind: 'spawn', command: 'notepad.exe', args: [real] }
  }
  if (st.isFile() && (executable || LINUX_LAUNCHERS.has(ext))) {
    return {
      kind: 'refuse',
      message: `Adar does not hand executable files to the system default app. Set Settings → Editor command to open "${path.basename(real)}".`
    }
  }
  return { kind: 'spawn', command: 'xdg-open', args: [real] }
}

function launchError(what: string, err: unknown): AdarError {
  const e = err as NodeJS.ErrnoException & { stderr?: string }
  // One clean line in the message; the full output stays in stderr for the UI to show.
  const detail = summarizeGitOutput(e?.stderr || '') ?? (e?.message || String(err)).split('\n')[0].trim()
  return new AdarError({
    message: e?.code === 'ENOENT' ? `${what}: command not found` : `${what}: ${detail}`,
    code: e?.code === 'ENOENT' ? 'NOT_FOUND' : 'UNKNOWN',
    stderr: e?.stderr
  })
}

async function openTerminalLinux(dir: string): Promise<void> {
  const candidates: Array<[string, string[]]> = [
    ['x-terminal-emulator', []],
    ['gnome-terminal', [`--working-directory=${dir}`]],
    ['konsole', ['--workdir', dir]],
    ['xfce4-terminal', [`--working-directory=${dir}`]],
    ['kitty', ['--directory', dir]],
    ['alacritty', ['--working-directory', dir]],
    ['xterm', []]
  ]
  let lastErr: unknown
  for (const [cmd, args] of candidates) {
    try {
      await spawnDetached(cmd, args, { cwd: dir })
      return
    } catch (err) {
      lastErr = err
    }
  }
  throw launchError('Could not open a terminal', lastErr)
}

function parseScoped(out: string): { scope: string; value: string } | null {
  const line = out.split('\n').find((l) => l.length > 0)
  if (!line) return null
  const tab = line.indexOf('\t')
  if (tab < 0) return { scope: '', value: line.trim() }
  return { scope: line.slice(0, tab), value: line.slice(tab + 1).trim() }
}

function mapScope(scope: string, fallback: Identity['scope']): Identity['scope'] {
  switch (scope) {
    case 'local':
    case 'worktree':
      return 'local'
    case 'global':
      return 'global'
    case 'system':
      return 'system'
    case '':
      return fallback
    default:
      return fallback // "command" (-c / GIT_CONFIG_PARAMETERS)
  }
}

export function createAppOps(ctx: GitContext, services: SystemServices): AppOps {
  const { platform } = ctx

  const readConfig = async (repo: string | null, key: string): Promise<{ scope: string; value: string } | null> => {
    const args = repo ? ['config', '--show-scope', '--get', key] : ['config', '--global', '--show-scope', '--get', key]
    const res = repo
      ? await ctx.git(repo, args, { allowFailure: true })
      : await ctx.gitGlobal(args, { cwd: os.homedir(), allowFailure: true })
    if (res.code === 0) return parseScoped(res.stdout)
    if (res.code === 129 || /unknown option/i.test(res.stderr)) {
      // git < 2.26: no --show-scope.
      const plain = args.filter((a) => a !== '--show-scope')
      const r2 = repo ? await ctx.git(repo, plain, { allowFailure: true }) : await ctx.gitGlobal(plain, { cwd: os.homedir(), allowFailure: true })
      if (r2.code === 0 && r2.stdout.trim()) return { scope: '', value: r2.stdout.trim() }
    }
    return null
  }

  return {
    async getAppInfo() {
      return {
        version: platform.appVersion,
        platform: process.platform,
        gitVersion: await services.gitVersion(),
        homeDir: os.homedir(),
        isElectron: platform.isElectron
      }
    },

    pickDirectory(opts) {
      return platform.pickDirectory(opts)
    },

    async openExternal(url) {
      if (typeof url !== 'string' || !url) throw invalidArgument('URL is required')
      return platform.openExternal(url)
    },

    async showInFolder(p) {
      const { abs } = await existingPath(p)
      await platform.showInFolder(abs)
    },

    async openInTerminal(p) {
      const { abs, isDir } = await existingPath(p)
      const dir = isDir ? abs : path.dirname(abs)
      if (process.platform === 'darwin') {
        const settings = await services.settings.getSettings()
        const app = settings.terminalApp?.trim() || 'Terminal'
        try {
          await execFileAsync('open', ['-a', app, dir])
        } catch (err) {
          throw launchError(`Could not open ${app}`, err)
        }
        return
      }
      if (process.platform === 'win32') {
        try {
          await spawnDetached('cmd.exe', ['/c', 'start', '', 'cmd.exe'], { cwd: dir })
        } catch (err) {
          throw launchError('Could not open a terminal', err)
        }
        return
      }
      await openTerminalLinux(dir)
    },

    async openInEditor(p) {
      const { abs } = await existingPath(p)
      const settings = await services.settings.getSettings()
      const cmd = settings.editorCommand?.trim() ?? ''
      if (cmd) {
        if (process.platform === 'darwin' && /\.app\/?$/i.test(cmd)) {
          try {
            await execFileAsync('open', ['-a', cmd, abs])
          } catch (err) {
            throw launchError(`Could not open ${path.basename(cmd)}`, err)
          }
          return
        }
        const argv = existsSync(cmd) ? [cmd] : tokenizeCommand(cmd)
        if (!argv.length) throw invalidArgument('The editor command is empty')
        try {
          await spawnDetached(argv[0], [...argv.slice(1), abs], { env: process.env })
        } catch (err) {
          throw launchError(`Could not run editor "${argv[0]}" (check Settings → Editor command)`, err)
        }
        return
      }
      const host = platform as HostPlatform
      const plan = await planDefaultOpen(abs, process.platform, { canOpenPath: typeof host.openPath === 'function' })
      try {
        switch (plan.kind) {
          case 'exec':
            return await execFileAsync(plan.command, plan.args)
          case 'spawn':
            return await spawnDetached(plan.command, plan.args)
          case 'reveal':
            return await platform.showInFolder(plan.path)
          case 'openPath': {
            const error = await host.openPath!(plan.path)
            if (error) throw new Error(error)
            return
          }
          case 'refuse':
            throw invalidArgument(plan.message)
        }
      } catch (err) {
        if (err instanceof AdarError) throw err
        throw launchError('Could not open the file', err)
      }
    },

    getSettings() {
      return services.settings.getSettings()
    },

    updateSettings(patch) {
      return services.settings.updateSettings(patch ?? {})
    },

    getRecentRepos() {
      return services.settings.getRecentRepos()
    },

    async removeRecentRepo(p) {
      if (typeof p !== 'string') throw invalidArgument('Path is required')
      return services.settings.removeRecentRepo(p)
    },

    async answerCredentialRequest(id, value) {
      if (typeof id !== 'string') throw invalidArgument('Credential request id is required')
      services.askpass?.answer(id, typeof value === 'string' ? value : null)
    },

    async getIdentity(repo): Promise<Identity> {
      if (repo !== null && repo !== undefined) await assertRepo(ctx, repo)
      const target = repo ?? null
      const fallback: Identity['scope'] = target ? 'local' : 'global'
      const [name, email] = await Promise.all([readConfig(target, 'user.name'), readConfig(target, 'user.email')])
      const source = name ?? email
      return {
        name: name?.value ?? '',
        email: email?.value ?? '',
        scope: source ? mapScope(source.scope, fallback) : 'none'
      }
    },

    async runGit(repo, args): Promise<GitCommandResult> {
      await assertRepo(ctx, repo)
      if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw invalidArgument('args must be an array of strings')
      const argv = args[0] === 'git' ? args.slice(1) : [...args]
      if (!argv.length) throw invalidArgument('Enter a git command')
      const res = await ctx.gitNetwork(repo, argv, {
        allowFailure: true,
        timeoutMs: 120_000,
        maxBuffer: CONSOLE_MAX_OUTPUT,
        cancelAsError: false
      })
      let stderr = res.stderr
      if (res.truncated) stderr += `\n[output truncated after ${CONSOLE_MAX_OUTPUT / (1024 * 1024)} MB]`
      return { stdout: res.stdout, stderr, code: res.code }
    }
  }
}
