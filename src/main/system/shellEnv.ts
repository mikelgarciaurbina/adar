// GUI apps on macOS/Linux start with a minimal PATH (/usr/bin:/bin:...), so credential
// helpers ("gh auth git-credential"), git-lfs, hooks and Homebrew's git are not found.
// Resolve the user's login-shell PATH once at startup and merge it into process.env.

import { spawn } from 'node:child_process'
import path from 'node:path'

const MARKER = '__ADAR_PATH_7f3a__'
const ALWAYS_INCLUDE = ['/opt/homebrew/bin', '/usr/local/bin']

/** Variables that would redirect every git command to another repository. */
const GIT_REDIRECT_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']

/**
 * Merge PATH lists: entries of `existing` first (original order), then new entries from
 * `extra`, then `ensure` entries that are still missing. Empty entries and duplicates dropped.
 */
export function mergePathLists(existing: string, extra: string, ensure: readonly string[] = [], delimiter = path.delimiter): string {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (p: string) => {
    const v = p.trim()
    if (!v || seen.has(v)) return
    seen.add(v)
    out.push(v)
  }
  for (const p of existing.split(delimiter)) add(p)
  for (const p of extra.split(delimiter)) add(p)
  for (const p of ensure) add(p)
  return out.join(delimiter)
}

/** Extract the PATH printed between markers (ignores banners/motd printed by rc files). */
export function extractMarkedPath(stdout: string): string | null {
  const start = stdout.indexOf(MARKER)
  if (start < 0) return null
  const end = stdout.indexOf(MARKER, start + MARKER.length)
  if (end < 0) return null
  return stdout.slice(start + MARKER.length, end)
}

/** Run the login shell and print its PATH. Resolves null on error or timeout. */
export function readLoginShellPath(timeoutMs = 3000): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    let settled = false
    let out = ''
    const done = (v: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell, ['-ilc', `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          // Keep rc files from doing interactive things (oh-my-zsh updates, tmux autostart).
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
          ZSH_TMUX_AUTOSTARTED: 'true',
          ADAR_RESOLVING_ENVIRONMENT: '1'
        },
        detached: false,
        windowsHide: true
      })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      done(extractMarkedPath(out))
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8')
      if (out.length > 1_000_000) out = out.slice(-100_000)
      const p = extractMarkedPath(out)
      if (p !== null) done(p)
    })
    child.on('error', () => done(null))
    child.on('close', () => done(extractMarkedPath(out)))
  })
}

let fixPromise: Promise<void> | null = null

/** Fix process.env.PATH once (never takes more than ~timeoutMs). No-op on Windows. */
export function fixShellPath(timeoutMs = 3000): Promise<void> {
  if (fixPromise) return fixPromise
  fixPromise = (async () => {
    for (const v of GIT_REDIRECT_VARS) delete process.env[v]
    if (process.platform === 'win32') return
    const shellPath = await readLoginShellPath(timeoutMs)
    process.env.PATH = mergePathLists(process.env.PATH ?? '', shellPath ?? '', ALWAYS_INCLUDE, ':')
  })().catch(() => undefined)
  return fixPromise
}
