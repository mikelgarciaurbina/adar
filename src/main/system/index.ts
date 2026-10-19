// Startup / long-lived system services used by the read side of the backend:
// shell PATH fix, git version, settings + recents store, askpass bridge, watchers.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AdarEvent } from '@shared/types'
import type { GitContext } from '../git/context'
import { parseStatusV2 } from '../git/parsers/status'
import { runGit } from '../git/runner'
import type { PlatformAdapter } from '../platform'
import { AskpassService } from './askpass'
import { SettingsStore } from './settings'
import { fixShellPath } from './shellEnv'
import { WatcherManager } from './watcher'

export interface SystemOptions {
  /** Resolve the login-shell PATH at startup (default true). */
  fixShellPath: boolean
  /** Start the askpass bridge (default true). */
  askpass: boolean
  /** Max time spent resolving the shell PATH (default 3000 ms). */
  shellPathTimeoutMs: number
}

export interface SystemServices {
  /** Resolves once the PATH fix and askpass setup finished (never rejects, bounded by ~3 s). */
  ready: Promise<void>
  settings: SettingsStore
  watcher: WatcherManager
  askpass: AskpassService | null
  /** "2.54.0 (Apple Git-157)", or '' when git is not installed. */
  gitVersion(): Promise<string>
  dispose(): Promise<void>
}

/** Read-only git used by the watcher fallbacks: never take index.lock. */
const READ_ENV = { GIT_OPTIONAL_LOCKS: '0' }

/**
 * Fingerprint of the worktree state for the watcher's polling fallback: `git status` plus the
 * size / mtime of every dirty file (status lines do not change when an already-modified file
 * is edited again). Null when git fails.
 */
export async function worktreeSignature(repoPath: string): Promise<string | null> {
  const r = await runGit(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignore-submodules=dirty'], {
    cwd: repoPath,
    env: READ_ENV,
    allowFailure: true,
    timeoutMs: 30_000
  }).catch(() => null)
  if (!r || r.code !== 0) return null
  const hash = createHash('sha1').update(r.stdout)
  const st = parseStatusV2(r.stdout)
  const dirty = [...new Set([...st.unstaged.map((f) => f.path), ...st.conflicted.map((f) => f.path)])].slice(0, 2000)
  const stamps = await Promise.all(
    dirty.map((p) =>
      fs.stat(path.join(repoPath, p)).then(
        (s) => `${p}\0${s.mtimeMs}\0${s.size}`,
        () => `${p}\0-`
      )
    )
  )
  for (const s of stamps) hash.update(s)
  return hash.digest('hex')
}

/** Subset of worktree-relative `paths` that git ignores (tracked files never count as ignored). */
export async function ignoredPaths(repoPath: string, paths: string[]): Promise<Set<string>> {
  const r = await runGit(['check-ignore', '-z', '--stdin'], {
    cwd: repoPath,
    env: READ_ENV,
    input: paths.join('\0'),
    allowFailure: true,
    timeoutMs: 10_000
  }).catch(() => null)
  return new Set(r?.code === 0 ? r.stdout.split('\0').filter(Boolean) : [])
}

export function parseGitVersion(out: string): string {
  const m = /git version\s+(.+)/i.exec(out.trim())
  return m ? m[1].trim() : ''
}

export function createSystemServices(
  ctx: GitContext,
  platform: PlatformAdapter,
  emit: (e: AdarEvent) => void,
  options: Partial<SystemOptions> = {}
): SystemServices {
  const opts: SystemOptions = { fixShellPath: true, askpass: true, shellPathTimeoutMs: 3000, ...options }
  const settings = new SettingsStore(platform.userDataDir)
  const watcher = new WatcherManager(emit, {
    worktreeSignature: (target) => worktreeSignature(target.repoPath),
    ignoredPaths
  })
  const askpass = opts.askpass ? new AskpassService(path.join(platform.userDataDir, 'askpass'), emit) : null

  const pathReady = opts.fixShellPath ? fixShellPath(opts.shellPathTimeoutMs) : Promise.resolve()
  const askpassReady = askpass
    ? askpass
        .start()
        .then((env) => {
          if (Object.keys(env).length) {
            ctx.setNetworkEnv(env)
            ctx.setCredentialProbe(askpass)
          }
        })
        .catch(() => undefined)
    : Promise.resolve()
  const ready = Promise.all([pathReady, askpassReady]).then(
    () => undefined,
    () => undefined
  )

  let versionPromise: Promise<string> | null = null
  const gitVersion = (): Promise<string> => {
    if (!versionPromise) {
      versionPromise = pathReady
        .then(() => runGit(['--version'], { timeoutMs: 10_000, allowFailure: true }))
        .then((r) => (r.code === 0 ? parseGitVersion(r.stdout) : ''))
        .catch(() => '')
      // Retry next time when git was missing (the user may install it while Adar runs).
      void versionPromise.then((v) => {
        if (!v) versionPromise = null
      })
    }
    return versionPromise
  }
  void gitVersion()

  return {
    ready,
    settings,
    watcher,
    askpass,
    gitVersion,
    async dispose() {
      watcher.stopAll()
      await Promise.allSettled([askpass?.dispose(), settings.flush()])
    }
  }
}
