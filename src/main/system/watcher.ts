// File-system watchers per open repository. Changes are classified into
// 'worktree' / 'index' / 'refs' scopes, debounced per repo and emitted as
// 'repo-changed' events so the renderer refreshes only what changed.
//
// Primary source: recursive fs.watch (FSEvents on macOS) on the git dir and the worktree.
// Safety net, because FSEvents can be late or silent (overloaded fseventsd, network
// volumes, some virtual file systems):
//  - the key git files (index, HEAD, reflogs, packed-refs, FETCH_HEAD...) and every directory
//    below refs/ (nested branch namespaces included) are stat-polled every second. A change the
//    poller sees but fs.watch did not report within a grace period marks the repo "degraded"
//    and is emitted by the poller;
//  - while fs.watch has not proven itself (no event yet) or is degraded, worktree edits are
//    detected by comparing a `git status` signature at an adaptive interval.
// Worktree batches that only touch git-ignored paths (build output...) are dropped.

import { existsSync, promises as fsp } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import type { AdarEvent } from '@shared/types'

export type ChangeScope = 'worktree' | 'index' | 'refs'

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * Classify a path relative to the git dir (or common dir).
 * Returns null for changes the UI does not care about (objects, locks, logs...).
 */
export function classifyGitDirPath(relPath: string): ChangeScope | null {
  const p = norm(relPath)
  if (!p) return null
  if (p.endsWith('.lock')) return null
  const first = p.split('/')[0]
  if (first === 'objects') return null
  if (p === 'index') return 'index'
  if (p === 'logs/refs/stash') return 'refs'
  if (first === 'logs') return null
  if (p === 'COMMIT_EDITMSG' || p === 'FETCH_HEAD') return null
  if (p === 'info/exclude') return 'worktree'
  if (
    p === 'HEAD' ||
    p === 'ORIG_HEAD' ||
    p === 'packed-refs' ||
    p === 'MERGE_HEAD' ||
    p === 'CHERRY_PICK_HEAD' ||
    p === 'REVERT_HEAD' ||
    p === 'BISECT_LOG' ||
    p === 'config' ||
    p === 'shallow' ||
    first === 'refs' ||
    // Repositories using the reftable ref backend keep every ref (HEAD too) in reftable/.
    first === 'reftable' ||
    first === 'rebase-merge' ||
    first === 'rebase-apply' ||
    first === 'sequencer'
  ) {
    return 'refs'
  }
  return null
}

/** Classify a path relative to the worktree root. */
export function classifyWorktreePath(relPath: string): ChangeScope | null {
  const p = norm(relPath)
  if (!p) return 'worktree'
  const segments = p.split('/')
  if (segments[0] === '.git') return null
  if (segments.includes('node_modules')) return null
  return 'worktree'
}

/** Files stat-polled in the (per-worktree) git dir. */
const POLL_GIT_DIR: ReadonlyArray<[string, ChangeScope]> = [
  ['index', 'index'],
  ['HEAD', 'refs'],
  ['logs/HEAD', 'refs'],
  ['MERGE_HEAD', 'refs'],
  ['CHERRY_PICK_HEAD', 'refs'],
  ['REVERT_HEAD', 'refs'],
  ['BISECT_LOG', 'refs'],
  ['rebase-merge', 'refs'],
  ['rebase-apply', 'refs'],
  ['sequencer', 'refs']
]

/**
 * Files / directories stat-polled in the common git dir (shared by linked worktrees). Loose refs
 * are covered by looseRefsSignature() (every directory below refs/, nested ones included).
 */
const POLL_COMMON_DIR: ReadonlyArray<[string, ChangeScope]> = [
  ['packed-refs', 'refs'],
  ['FETCH_HEAD', 'refs'],
  ['logs/refs/stash', 'refs'],
  ['reftable', 'refs'],
  ['config', 'refs']
]

/** Directories visited under refs/ per poll; beyond that the remaining ones are not polled. */
export const MAX_REF_DIRS = 1000

/**
 * Cheap signature of all loose refs below `refsDir`: the mtime of every directory in the tree.
 * git rewrites a loose ref through `<name>.lock` + rename inside the ref's own directory, which
 * bumps that directory's mtime — so nested refs (refs/heads/feature/x, refs/remotes/origin/a/b)
 * are seen, not only the top-level ref directories. Only directories are stat'ed; the walk is
 * breadth-first (one level at a time, in parallel; names sorted) and capped at `maxDirs`.
 */
export async function looseRefsSignature(refsDir: string, maxDirs = MAX_REF_DIRS): Promise<string> {
  const parts: string[] = []
  let level = [refsDir]
  let visited = 0
  while (level.length && visited < maxDirs) {
    const batch = level.slice(0, maxDirs - visited)
    visited += batch.length
    const results = await Promise.all(
      batch.map(async (dir) => {
        const rel = path.relative(refsDir, dir)
        try {
          const [st, entries] = await Promise.all([fsp.stat(dir), fsp.readdir(dir, { withFileTypes: true })])
          const subdirs = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort()
            .map((name) => path.join(dir, name))
          return { sig: `${rel}:${st.mtimeMs}:${st.ino}`, subdirs }
        } catch {
          return { sig: `${rel}:missing`, subdirs: [] }
        }
      })
    )
    level = []
    for (const r of results) {
      parts.push(r.sig)
      level.push(...r.subdirs)
    }
  }
  return parts.join('\n')
}

/** Worktree paths remembered per batch for the ignore filter; more → emit unfiltered. */
const MAX_TRACKED_PATHS = 200

export interface WatchTarget {
  /** Worktree root (also the event's repoPath). */
  repoPath: string
  gitDir: string
  /** Shared git dir for linked worktrees (refs live there). */
  commonDir?: string
  isBare: boolean
}

export interface WatcherOptions {
  /** Quiet period before a batch is emitted (default 150 ms). */
  debounceMs: number
  /** A batch is emitted at most this long after its first change (default 1000 ms). */
  maxWaitMs: number
  /** Stat-poll interval of the key git files (default 1000 ms; 0 disables polling). */
  pollMs: number
  /** How long a polled change waits for fs.watch to report it before the repo is marked degraded (default 1500 ms). */
  graceMs: number
  /** Use recursive fs.watch (default true; tests disable it to exercise the fallback). */
  fsWatch: boolean
  /**
   * Cheap fingerprint of the worktree state (e.g. `git status` output) used while fs.watch is
   * unproven or degraded. Resolves null when it cannot be computed.
   */
  worktreeSignature?: (target: WatchTarget) => Promise<string | null>
  /** Subset of `paths` (worktree-relative) that git ignores. */
  ignoredPaths?: (repoPath: string, paths: string[]) => Promise<Set<string>>
}

const DEFAULTS: WatcherOptions = { debounceMs: 150, maxWaitMs: 1000, pollMs: 1000, graceMs: 1500, fsWatch: true }

type Health = 'unknown' | 'healthy' | 'degraded'

interface RepoWatch {
  target: WatchTarget
  watchers: fs.FSWatcher[]
  pending: Set<ChangeScope>
  /** Worktree paths of the pending batch (null = unknown / too many: do not filter). */
  pendingPaths: Set<string> | null
  timer: ReturnType<typeof setTimeout> | null
  firstAt: number
  /** Time of the last raw fs.watch event (any directory). */
  lastFsAt: number
  /** Time of the last raw fs.watch event inside the git dir (proves fs.watch saw a git operation). */
  lastFsGitAt: number
  health: Health
  pollTimer: ReturnType<typeof setInterval> | null
  polling: boolean
  stamps: Map<string, string> | null
  statusTimer: ReturnType<typeof setTimeout> | null
  statusSig: string | null
  /** Start time of the previous signature check. */
  statusAt: number
  /** Signature checks done while health is unknown (they back off). */
  unknownPolls: number
  stopped: boolean
}

export class WatcherManager {
  private readonly repos = new Map<string, RepoWatch>()
  private readonly opts: WatcherOptions

  constructor(
    private readonly emit: (e: AdarEvent) => void,
    options: Partial<WatcherOptions> = {}
  ) {
    this.opts = { ...DEFAULTS, ...options }
  }

  isWatching(repoPath: string): boolean {
    return this.repos.has(repoPath)
  }

  /** 'healthy' once fs.watch delivered events, 'degraded' (sticky) once it missed a change the poller saw. */
  healthOf(repoPath: string): Health | null {
    return this.repos.get(repoPath)?.health ?? null
  }

  /** Start watching (idempotent). Failures degrade to polling. */
  start(target: WatchTarget): void {
    if (this.repos.has(target.repoPath)) return
    const entry: RepoWatch = {
      target,
      watchers: [],
      pending: new Set(),
      pendingPaths: new Set(),
      timer: null,
      firstAt: 0,
      lastFsAt: 0,
      lastFsGitAt: 0,
      health: 'unknown',
      pollTimer: null,
      polling: false,
      stamps: null,
      statusTimer: null,
      statusSig: null,
      statusAt: 0,
      unknownPolls: 0,
      stopped: false
    }
    this.repos.set(target.repoPath, entry)

    if (this.opts.fsWatch) {
      this.watchDir(entry, target.gitDir, classifyGitDirPath, 'git')
      if (target.commonDir && target.commonDir !== target.gitDir) {
        // Linked worktree: refs and packed-refs live in the common dir; ignore its index/HEAD.
        this.watchDir(
          entry,
          target.commonDir,
          (rel) => {
            const p = norm(rel)
            if (p === 'index' || p === 'HEAD' || p.startsWith('worktrees/')) return null
            return classifyGitDirPath(p)
          },
          'git'
        )
      }
      if (!target.isBare) this.watchDir(entry, target.repoPath, classifyWorktreePath, 'worktree')
    }

    if (this.opts.pollMs > 0) {
      void this.poll(entry) // baseline
      entry.pollTimer = setInterval(() => void this.poll(entry), this.opts.pollMs)
      entry.pollTimer.unref?.()
    }
    this.scheduleStatusPoll(entry, 0)
  }

  /** Feed a raw fs.watch event (exported for tests: simulates FSEvents). */
  notifyFsEvent(repoPath: string, scope: ChangeScope | null, worktreePath?: string): void {
    const entry = this.repos.get(repoPath)
    if (entry) this.onFsEvent(entry, scope, worktreePath, worktreePath === undefined)
  }

  stop(repoPath: string): void {
    const entry = this.repos.get(repoPath)
    if (!entry) return
    this.repos.delete(repoPath)
    entry.stopped = true
    if (entry.timer) clearTimeout(entry.timer)
    if (entry.pollTimer) clearInterval(entry.pollTimer)
    if (entry.statusTimer) clearTimeout(entry.statusTimer)
    for (const w of entry.watchers) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
    }
  }

  stopAll(): void {
    for (const repo of [...this.repos.keys()]) this.stop(repo)
  }

  // ── fs.watch ─────────────────────────────────────────────────────────────

  private watchDir(entry: RepoWatch, dir: string, classify: (rel: string) => ChangeScope | null, kind: 'git' | 'worktree'): void {
    try {
      // persistent must stay true: on macOS an unref'd FSEvents watcher delivers no events.
      // Watchers are closed explicitly by stop()/stopAll() (closeRepo / dispose).
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (filename === null || filename === undefined) return
        const rel = norm(filename.toString())
        const inGitDir = kind === 'git' || rel === '.git' || rel.startsWith('.git/')
        this.onFsEvent(entry, classify(rel), kind === 'worktree' ? rel : undefined, inGitDir)
      })
      w.on('error', () => {
        try {
          w.close()
        } catch {
          /* ignore */
        }
      })
      entry.watchers.push(w)
    } catch {
      // Unsupported FS / too many watchers: the pollers keep the UI fresh.
    }
  }

  private onFsEvent(entry: RepoWatch, scope: ChangeScope | null, worktreePath: string | undefined, inGitDir: boolean): void {
    if (entry.stopped) return
    const now = Date.now()
    entry.lastFsAt = now
    if (inGitDir) entry.lastFsGitAt = now
    // Degraded is sticky: fs.watch that once missed changes may deliver a few late events and
    // then fall silent again, so the polling fallback keeps running for this repo.
    if (entry.health === 'unknown') {
      entry.health = 'healthy'
      this.stopStatusPoll(entry)
    }
    if (scope) this.queue(entry, scope, scope === 'worktree' ? (worktreePath ?? null) : undefined)
  }

  // ── batching ────────────────────────────────────────────────────────────

  /** `worktreePath`: path for the ignore filter; null = unknown path (disables filtering for this batch). */
  private queue(entry: RepoWatch, scope: ChangeScope, worktreePath?: string | null): void {
    if (entry.stopped) return
    const now = Date.now()
    if (!entry.timer) entry.firstAt = now
    entry.pending.add(scope)
    if (worktreePath === null) entry.pendingPaths = null
    else if (worktreePath !== undefined && entry.pendingPaths) {
      entry.pendingPaths.add(worktreePath)
      if (entry.pendingPaths.size > MAX_TRACKED_PATHS) entry.pendingPaths = null
    }
    if (entry.timer) clearTimeout(entry.timer)
    const wait = Math.max(0, Math.min(this.opts.debounceMs, entry.firstAt + this.opts.maxWaitMs - now))
    entry.timer = setTimeout(() => void this.flush(entry), wait)
  }

  private async flush(entry: RepoWatch): Promise<void> {
    entry.timer = null
    const scopes = [...entry.pending]
    const paths = entry.pendingPaths
    entry.pending = new Set()
    entry.pendingPaths = new Set()
    if (!scopes.length || entry.stopped) return
    if (scopes.length === 1 && scopes[0] === 'worktree' && paths && paths.size && this.opts.ignoredPaths) {
      try {
        const ignored = await this.opts.ignoredPaths(entry.target.repoPath, [...paths])
        if ([...paths].every((p) => ignored.has(p))) return
      } catch {
        /* emit unfiltered */
      }
    }
    if (entry.stopped || this.repos.get(entry.target.repoPath) !== entry) return
    this.emit({ type: 'repo-changed', repoPath: entry.target.repoPath, scopes })
  }

  // ── stat poller ─────────────────────────────────────────────────────────

  private async snapshot(entry: RepoWatch): Promise<Map<string, string>> {
    const { gitDir, commonDir = gitDir } = entry.target
    const files: Array<[string, ChangeScope]> = [
      ...POLL_GIT_DIR.map(([rel, scope]): [string, ChangeScope] => [path.join(gitDir, rel), scope]),
      ...POLL_COMMON_DIR.map(([rel, scope]): [string, ChangeScope] => [path.join(commonDir, rel), scope])
    ]
    const stamps = new Map<string, string>()
    await Promise.all([
      ...files.map(async ([file, scope]) => {
        let sig = 'missing'
        try {
          const st = await fsp.stat(file)
          sig = `${st.mtimeMs}:${st.size}:${st.ino}`
        } catch {
          /* missing */
        }
        stamps.set(`${scope}\0${file}`, sig)
      }),
      looseRefsSignature(path.join(commonDir, 'refs')).then((sig) => {
        stamps.set(`refs\0${path.join(commonDir, 'refs')}/**`, sig)
      })
    ])
    return stamps
  }

  private async poll(entry: RepoWatch): Promise<void> {
    if (entry.polling || entry.stopped) return
    entry.polling = true
    try {
      const startedAt = Date.now()
      const next = await this.snapshot(entry)
      if (entry.stopped) return
      const prev = entry.stamps
      entry.stamps = next
      if (!prev) return
      const scopes = new Set<ChangeScope>()
      for (const [key, sig] of next) {
        const before = prev.get(key)
        if (before !== undefined && before !== sig) scopes.add(key.slice(0, key.indexOf('\0')) as ChangeScope)
      }
      if (!scopes.size) return
      // The change happened after the previous poll: fs.watch reported it if it saw git-dir activity since.
      const since = startedAt - this.opts.pollMs
      if (entry.lastFsGitAt >= since) return
      if (entry.health === 'degraded') {
        for (const s of scopes) this.queue(entry, s)
        return
      }
      // Give fs.watch a chance to report it; if it stays silent the poller takes over.
      setTimeout(() => {
        if (entry.stopped || entry.lastFsGitAt >= since) return
        entry.health = 'degraded'
        for (const s of scopes) this.queue(entry, s)
        this.scheduleStatusPoll(entry, 0)
      }, this.opts.graceMs).unref?.()
    } finally {
      entry.polling = false
    }
  }

  // ── worktree status poller (fallback) ───────────────────────────────────

  private stopStatusPoll(entry: RepoWatch): void {
    if (entry.statusTimer) clearTimeout(entry.statusTimer)
    entry.statusTimer = null
    entry.statusSig = null
  }

  private scheduleStatusPoll(entry: RepoWatch, delay: number): void {
    if (!this.opts.worktreeSignature || entry.target.isBare || entry.stopped || entry.health === 'healthy') return
    if (entry.statusTimer) clearTimeout(entry.statusTimer)
    entry.statusTimer = setTimeout(() => void this.statusPoll(entry), delay)
    entry.statusTimer.unref?.()
  }

  private async statusPoll(entry: RepoWatch): Promise<void> {
    entry.statusTimer = null
    if (entry.stopped || entry.health === 'healthy' || !this.opts.worktreeSignature) return
    const t0 = Date.now()
    const prevAt = entry.statusAt
    entry.statusAt = t0
    let sig: string | null = null
    if (existsSync(entry.target.repoPath)) {
      try {
        sig = await this.opts.worktreeSignature(entry.target)
      } catch {
        sig = null
      }
    }
    // (health may have changed while git ran)
    if (entry.stopped || (entry.health as Health) === 'healthy') return
    const value = sig ?? 'unavailable'
    // Skip when fs.watch reported activity since the previous check (it already queued the change).
    if (entry.statusSig !== null && entry.statusSig !== value && entry.lastFsAt < prevAt) this.queue(entry, 'worktree', null)
    entry.statusSig = value
    // Adaptive: cheap repos are checked every second when degraded; expensive ones less often.
    // While fs.watch is merely unproven (usually it works and just had nothing to report yet)
    // the checks back off from 3 s to 30 s.
    const took = Date.now() - t0
    const interval =
      entry.health === 'degraded'
        ? Math.min(20_000, Math.max(1000, took * 3))
        : Math.min(30_000, Math.max(3000 * 2 ** Math.min(4, entry.unknownPolls++), took * 10))
    this.scheduleStatusPoll(entry, interval)
  }
}
