// Low-level git process runner. Always spawns `git` with an argument array
// (never a shell), with a deterministic environment suitable for parsing.

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { AdarErrorCode } from '@shared/types'
import { windowsToWsl, wslFailure, wslGitCommand, wslLoginEnv, wslTarget, wslToWindows, type WslLocation } from './wsl'

export interface GitRunOptions {
  /** Working directory. Required unless running a repo-less command (clone, version). */
  cwd?: string
  /** Data written to stdin (then closed). */
  input?: string | Buffer
  /** Extra environment variables (merged over the base env). */
  env?: Record<string, string | undefined>
  /** Exit codes treated as success (default [0]). */
  okCodes?: number[]
  /** Never throw on non-zero exit; caller inspects result.code. */
  allowFailure?: boolean
  /** Kill after this many ms (default 120s; network ops should pass a larger value or 0 for none). */
  timeoutMs?: number
  /** Called with each progress line git writes to stderr (\r or \n terminated). */
  onProgress?: (line: string) => void
  /** Max stdout bytes kept (default 256 MB). Beyond that the process is killed and `truncated` set. */
  maxBuffer?: number
  /** Return stdout as Buffer in `stdoutBuffer` as well (for binary content). */
  binary?: boolean
  /** Abort signal to cancel the process. */
  signal?: AbortSignal
}

export interface GitResult {
  stdout: string
  stderr: string
  code: number
  stdoutBuffer?: Buffer
  truncated?: boolean
}

/** Variables Adar sets for every git invocation (also the ones git inside WSL gets). */
const GIT_ENV: Readonly<Record<string, string>> = {
  // Stable, English, non-interactive output.
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  // Never open an editor: messages are always supplied via -m/-F or defaults kept.
  GIT_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
  // Do not hang waiting for a terminal prompt; credentials go through askpass when configured.
  GIT_TERMINAL_PROMPT: '0'
}

/** Environment applied to every git invocation. */
export function baseGitEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...GIT_ENV,
    // Electron sets this for child processes in some cases; git hooks must run with normal node.
    ELECTRON_RUN_AS_NODE: undefined
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
  }
  // Remove undefined keys (spawn rejects them on some platforms).
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
  return env
}

/** Global config flags applied to every invocation. */
const GLOBAL_FLAGS = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-c', 'core.pager=cat', '-c', 'advice.detachedHead=false']

let gitExecutable = 'git'
export function setGitExecutable(path: string): void {
  gitExecutable = path
}
export function getGitExecutable(): string {
  return gitExecutable
}

/**
 * A path git printed when run in `cwd`, in the form Node and the UI use: Git for Windows' C:/x/y
 * as C:\x\y, a Linux path printed inside WSL as \\wsl.localhost\<distro>\… (or C:\… for /mnt/c/…).
 * Relative paths are relative to `cwd`.
 */
export function nativePath(cwd: string | undefined, printed: string): string {
  const wsl = wslTarget(cwd)
  if (wsl) return wslToWindows(wsl, printed)
  return cwd ? path.resolve(cwd, printed) : path.resolve(printed)
}

/**
 * A path as an argument (or in a command line) for git run in `cwd`: unchanged, except when git
 * runs inside WSL, which reaches it as a Linux path. Throws when the distribution cannot reach it.
 */
export function gitPath(cwd: string | undefined, p: string): string {
  const wsl = wslTarget(cwd)
  if (!wsl) return p
  const linux = windowsToWsl(wsl.distro, p)
  if (linux === null) throw new AdarError({ message: `${p} cannot be reached from WSL (${wsl.distro})`, code: 'INVALID_ARGUMENT' })
  return linux
}

/** The process that runs one git command. */
interface GitProcess {
  file: string
  args: string[]
  cwd?: string
  env: NodeJS.ProcessEnv
  /** Set when git runs inside WSL (through wsl.exe). */
  wsl?: WslLocation
}

export function runGit(args: string[], opts: GitRunOptions = {}): Promise<GitResult> {
  const fullArgs = [...GLOBAL_FLAGS, ...args]
  const display = commandDisplay(args)
  const wsl = wslTarget(opts.cwd)
  if (!wsl) return runProcess({ file: gitExecutable, args: fullArgs, cwd: opts.cwd, env: baseGitEnv(opts.env) }, display, opts)
  // A repository inside WSL: git runs there (see wsl.ts), with the login shell's PATH and SSH agent.
  return wslLoginEnv(wsl.distro).then((login) => {
    let cmd: ReturnType<typeof wslGitCommand>
    try {
      cmd = wslGitCommand(wsl, fullArgs, { ...GIT_ENV, ...opts.env }, login)
    } catch (err) {
      throw new AdarError({ message: (err as Error).message, code: 'INVALID_ARGUMENT', command: display })
    }
    return runProcess({ ...cmd, cwd: os.homedir(), wsl }, display, opts)
  })
}

function runProcess(proc: GitProcess, display: string, opts: GitRunOptions): Promise<GitResult> {
  const okCodes = opts.okCodes ?? [0]
  const timeoutMs = opts.timeoutMs ?? 120_000
  const maxBuffer = opts.maxBuffer ?? 256 * 1024 * 1024

  return new Promise<GitResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(proc.file, proc.args, {
        cwd: proc.cwd,
        env: proc.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (err) {
      reject(spawnError(err, display, opts.cwd, proc.wsl))
      return
    }

    const out: Buffer[] = []
    let outLen = 0
    let truncated = false
    let stderr = ''
    let progressBuf = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => {
      child.kill('SIGTERM')
      finish(() => reject(new AdarError({ message: 'Cancelled', code: 'CANCELLED', command: display })))
    }
    if (opts.signal) {
      if (opts.signal.aborted) return onAbort()
      opts.signal.addEventListener('abort', onAbort)
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish(() =>
          reject(new AdarError({ message: `git timed out after ${Math.round(timeoutMs / 1000)}s`, code: 'GIT_FAILED', command: display, stderr }))
        )
      }, timeoutMs)
    }

    child.stdout!.on('data', (chunk: Buffer) => {
      if (truncated) return
      outLen += chunk.length
      if (outLen > maxBuffer) {
        truncated = true
        child.kill('SIGTERM')
        return
      }
      out.push(chunk)
    })

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr += text
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000)
      if (opts.onProgress) {
        progressBuf += text
        const parts = progressBuf.split(/[\r\n]/)
        progressBuf = parts.pop() ?? ''
        for (const p of parts) {
          const line = p.trim()
          if (line) opts.onProgress(line)
        }
      }
    })

    child.on('error', (err) => finish(() => reject(spawnError(err, display, opts.cwd, proc.wsl))))

    child.on('close', (code, signal) => {
      finish(() => {
        const stdoutBuffer = Buffer.concat(out)
        const result: GitResult = {
          stdout: stdoutBuffer.toString('utf8'),
          stderr,
          code: code ?? (signal ? 128 : 0),
          truncated: truncated || undefined
        }
        if (proc.wsl && result.code !== 0) {
          // wsl.exe's own failures (the folder, the distribution, git itself missing) are never git's answer.
          if (opts.cwd && !isDirectory(opts.cwd)) {
            reject(new AdarError({ message: `Repository folder not found: ${opts.cwd}`, code: 'NOT_FOUND', command: display }))
            return
          }
          const failure = wslFailure(proc.wsl.distro, result.code, stderr, result.stdout.slice(0, 4000))
          if (failure) {
            reject(new AdarError({ message: failure.message, code: failure.code, command: display, stderr: stderr.trim() || undefined }))
            return
          }
        }
        if (opts.binary) result.stdoutBuffer = stdoutBuffer
        if (truncated && !opts.allowFailure) {
          // Truncation is reported but not fatal: callers decide (e.g. diff → tooLarge).
          resolve(result)
          return
        }
        if (opts.allowFailure || okCodes.includes(result.code)) resolve(result)
        else reject(gitError(display, result))
      })
    })

    if (opts.input !== undefined) child.stdin!.end(opts.input)
    else child.stdin!.end()
  })
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function spawnError(err: unknown, command: string, cwd?: string, wsl?: WslLocation): AdarError {
  const e = err as NodeJS.ErrnoException
  if (wsl && e?.code === 'ENOENT') {
    return new AdarError({
      message: `WSL is not installed, so Adar cannot run git in ${wsl.distro}. Install WSL (wsl --install) and restart Adar.`,
      code: 'GIT_NOT_INSTALLED',
      command
    })
  }
  // spawn also reports ENOENT (ENOTDIR when a parent is a file) for a missing working directory
  // (repo moved/deleted).
  if ((e?.code === 'ENOENT' || e?.code === 'ENOTDIR') && cwd && !isDirectory(cwd)) {
    return new AdarError({ message: `Repository folder not found: ${cwd}`, code: 'NOT_FOUND', command })
  }
  if (e?.code === 'ENOENT') {
    return new AdarError({
      message: 'Git was not found. Install Git (e.g. `xcode-select --install` or `brew install git`) and restart Adar.',
      code: 'GIT_NOT_INSTALLED',
      command
    })
  }
  return new AdarError({ message: e?.message || String(err), code: 'UNKNOWN', command })
}

export function classifyGitError(stderr: string): AdarErrorCode {
  const s = stderr.toLowerCase()
  if (
    /authentication failed|could not read username|could not read password|permission denied \(publickey|terminal prompts disabled|invalid username or password|access denied|403 forbidden|returned error: 403|host key verification failed|repository not found/.test(
      s
    )
  )
    return 'AUTH_FAILED'
  // (Not a bare "ssl": file names such as src/ssl.ts appear in dirty-worktree refusals.)
  if (
    /could not resolve host|unable to access|connection timed out|connection refused|network is unreachable|failed to connect|operation timed out|ssl certificate|ssl_(?:connect|error|read|write)|ssl routines|ssl protocol|ssl: (?:no|certificate|unable)|gnutls_|schannel:|certificate verification failed/.test(
      s
    )
  )
    return 'NETWORK'
  if (/not a git repository/.test(s)) return 'NOT_A_REPO'
  // Dirty-worktree refusals list file names, which may contain "conflict" — test them first.
  if (/would be overwritten|commit your changes or stash them|please move or remove them|you have unstaged changes|your local changes/.test(s))
    return 'DIRTY_WORKTREE'
  if (/conflict/.test(s)) return 'CONFLICT'
  return 'GIT_FAILED'
}

export function gitError(command: string, result: GitResult): AdarError {
  const stderr = result.stderr.trim()
  const output = stderr + '\n' + result.stdout.slice(0, 2000)
  const code = classifyGitError(output)
  const fallback = summarizeGitOutput(result.stderr) ?? summarizeGitOutput(result.stdout.slice(0, 4000), { preferLast: true }) ?? `git exited with code ${result.code}`
  return new AdarError({
    message: dedupeSentences(friendlyMessage(code, output) ?? fallback),
    code,
    command,
    stderr: stderr || result.stdout.trim().slice(0, 4000),
    exitCode: result.code
  })
}

/** Strip git's "error: " / "fatal: " / "warning: " prefixes (also when repeated). */
export function stripGitPrefix(line: string): string {
  return line.trim().replace(/^(?:(?:fatal|error|warning):\s*)+/i, '').trim()
}

/** "a", "a, b", "a, b, c, d", "a, b, c and 5 more". */
function listFiles(files: string[]): string {
  if (files.length <= 4) return files.join(', ')
  return `${files.slice(0, 3).join(', ')} and ${files.length - 3} more`
}

/**
 * Indented entries git prints below `lines[index]` ("...would be overwritten by merge:"):
 * one tab-indented path per line, or (merge-ort's index check) one space-indented line of
 * space-separated paths.
 */
function itemsBelow(lines: string[], index: number): string[] {
  const items: string[] = []
  for (const l of lines.slice(index + 1)) {
    if (!/^\s/.test(l) || !l.trim()) break
    if (l.startsWith('\t')) items.push(l.trim())
    else items.push(...l.trim().split(/\s+/))
  }
  return items
}

/** Entries listed below the first line of `output` matching `header`. */
function filesAfter(output: string, header: RegExp): string[] {
  const lines = output.split('\n')
  const start = lines.findIndex((l) => header.test(l))
  return start < 0 ? [] : itemsBelow(lines, start)
}

/**
 * git's most relevant line as a clean sentence: the first "error:"/"fatal:" line (else the first —
 * or with preferLast the last, which sums up status-like stdout — unindented line that is not a
 * hint), without the prefix and without a trailing ":" — the entries git lists below such a line
 * are appended instead. Null when there is no text.
 */
export function summarizeGitOutput(text: string, opts: { preferLast?: boolean } = {}): string | null {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  const candidates = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.trim() && !/^\s*hint:/i.test(l))
  if (!candidates.length) return null
  const plain = candidates.filter(({ l }) => !/^\s/.test(l))
  const main =
    candidates.find(({ l }) => /^\s*(fatal|error):/i.test(l)) ??
    (opts.preferLast ? plain[plain.length - 1] : plain[0]) ??
    candidates[0]
  let message = stripGitPrefix(main.l)
  if (message.endsWith(':')) {
    const items = itemsBelow(lines, main.i)
    message = message.replace(/\s*:$/, '')
    if (items.length) message = `${message}: ${listFiles(items)}`
  }
  return message || null
}

/** Drop sentences that repeat an earlier one (ignoring git prefixes, case and final punctuation). */
export function dedupeSentences(text: string): string {
  const parts = text.split(/(?<=[.!?])(\s+)/)
  const seen = new Set<string>()
  let out = ''
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i]
    const key = stripGitPrefix(sentence).replace(/[\s.:!?]+$/, '').toLowerCase()
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    out += (out ? (parts[i - 1] ?? ' ') : '') + sentence
  }
  return out.trim()
}

/**
 * Plain-language message for the failures users hit most often (the raw git text stays in
 * `stderr`). Returns null when git's own first error line is already the best message.
 */
export function friendlyMessage(code: AdarErrorCode, output: string): string | null {
  const s = output
  switch (code) {
    case 'DIRTY_WORKTREE': {
      const local = /your local changes (?:to the following files )?would be overwritten by (\w[\w-]*)/i.exec(s)
      if (local) {
        const files = filesAfter(s, /your local changes to the following files would be overwritten/i)
        const what = files.length ? `Your local changes to ${listFiles(files)}` : 'Your local changes'
        return `${what} would be overwritten by ${local[1]}. Commit, stash or discard them first.`
      }
      const untracked = /the following untracked working tree files would be (overwritten|removed) by (\w[\w-]*)/i.exec(s)
      if (untracked) {
        const files = filesAfter(s, /untracked working tree files would be/i)
        const what = files.length ? `Untracked file${files.length === 1 ? '' : 's'} ${listFiles(files)}` : 'Untracked files'
        return `${what} would be ${untracked[1].toLowerCase()} by ${untracked[2]}. Move or remove ${files.length === 1 ? 'it' : 'them'} first.`
      }
      if (/you have unstaged changes|commit your changes or stash them/i.test(s)) {
        return 'You have uncommitted changes. Commit or stash them first.'
      }
      return null
    }
    case 'AUTH_FAILED': {
      if (/permission denied \(publickey/i.test(s)) {
        return 'SSH authentication failed (publickey). Check that your SSH key is added to your account and loaded in ssh-agent.'
      }
      if (/host key verification failed/i.test(s)) {
        return 'SSH host key verification failed. Connect to this host once from a terminal to trust its key.'
      }
      if (/repository not found/i.test(s)) return 'Repository not found, or you do not have access to it.'
      const host = /for '(?:https?:\/\/)?(?:[^@'/]+@)?([^/']+)/i.exec(s)?.[1]
      if (/could not read (username|password)|terminal prompts disabled/i.test(s)) {
        return `Authentication required${host ? ` for ${host}` : ''}: no credentials were provided.`
      }
      if (/authentication failed|invalid username or password/i.test(s)) {
        return `Authentication failed${host ? ` for ${host}` : ''}. Check your username and password or access token.`
      }
      if (/403|access denied/i.test(s)) return `Access denied${host ? ` by ${host}` : ''}: you do not have permission for this repository.`
      return null
    }
    case 'NETWORK': {
      const host = /could not resolve host:?\s*([^\s'"]+)/i.exec(s)?.[1]
      if (host) return `Could not reach ${host.replace(/[.:]$/, '')}. Check your network connection.`
      if (/connection refused|failed to connect|network is unreachable|timed out/i.test(s)) {
        const where = /unable to access '([^']+)'/i.exec(s)?.[1]
        return `Could not connect to ${where ? where.replace(/\/$/, '') : 'the remote'}. Check your network connection.`
      }
      return null
    }
    case 'GIT_FAILED': {
      const lock = /unable to create '([^']+\.lock)': file exists/i.exec(s)
      if (lock) {
        return `Another Git process seems to be running in this repository (${lock[1].split(/[\\/]/).slice(-2).join('/')} exists). If none is running, delete that file and try again.`
      }
      if (/please tell me who you are|unable to auto-detect email address|empty ident name/i.test(s)) {
        return 'Git needs your name and email to commit: set your identity (user.name and user.email) first.'
      }
      if (/gpg failed to sign|error: cannot run gpg|failed to write commit object.*sign|ssh-keygen.*sign/i.test(s)) {
        return 'Signing the commit failed. Check your GPG / SSH signing setup, or disable commit.gpgsign for this repository.'
      }
      if (/no such ref was fetched/i.test(s)) {
        return 'The upstream branch no longer exists on the remote. Choose another upstream or push the branch again.'
      }
      if (/\[rejected\]|\(fetch first\)|non-fast-forward/i.test(s) && /failed to push/i.test(s)) {
        return 'Push rejected: the remote branch has commits you do not have. Pull first, or force push.'
      }
      if (/\[remote rejected\]|pre-receive hook declined|protected branch/i.test(s)) {
        const why = /\[remote rejected\][^(]*\(([^)]+)\)/i.exec(s)?.[1]
        return `The remote rejected the push${why ? `: ${why}` : ''}.`
      }
      return null
    }
    default:
      return null
  }
}

/** "git <args>" for error messages, with credentials embedded in URLs hidden. */
export function commandDisplay(args: string[]): string {
  return `git ${args.map(redactArg).join(' ')}`
}

/** Hide credentials embedded in URLs (https://user:token@host). */
function redactArg(arg: string): string {
  return arg.replace(/(https?:\/\/)([^/@\s]+)@/gi, '$1***@')
}

/** Parse "Receiving objects:  45% (450/1000)" → 45. */
export function parseProgressPercent(line: string): number | undefined {
  const m = /(\d{1,3})%/.exec(line)
  return m ? Math.min(100, Number(m[1])) : undefined
}
