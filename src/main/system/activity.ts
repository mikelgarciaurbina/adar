// Agents at work, main side: watches the worktrees of the repositories open in Adar (their linked worktrees, and
// each repository's own folder when the settings ask for it) with a WatcherManager of its own, looks at a worktree
// when its files or refs change (git status, numstat, its own commits: src/main/git/read/activity.ts) and tells the
// UI what each one is doing through 'agents' events: changes not committed with when each file last changed, files
// changed per minute, commits and pushes (`own` when Adar made them) and going quiet. Working / quiet / idle follow
// the shared rules in src/shared/agents.ts. Ignored files never count: git status does not list them.

import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import {
  agentState,
  IDLE_MS,
  MAX_AGENT_FILES,
  minuteOf,
  STRIP_MINUTES,
  type AgentCommit,
  type AgentEvent,
  type AgentState,
  type AgentNotice,
  type AgentWorktree,
  parseAgentNotice
} from '@shared/agents'
import type { AdarApi } from '@shared/api'
import { invalidArgument as invalid } from '../git/read/common'
import type { AdarEvent, AppSettings } from '@shared/types'
import type { GitContext } from '../git/context'
import { baseBranch, baseName, countBetween, filesBetween, isAncestor, lookAtWorktree, parseAgentLog, type WorktreeLook } from '../git/read/activity'
import { listWorktrees } from '../git/read/worktrees'
import { WatcherManager, type WatcherOptions, type WatchTarget } from './watcher'

/** How often the worktree lists are read again (new worktrees an agent made, removed ones). */
const RELIST_MS = 20_000
/** How often states are checked (working → quiet → idle happen with time, not with changes). */
const TICK_MS = 10_000
/** Looks at one worktree are at least this far apart. */
const MIN_LOOK_GAP_MS = 1500
/** A commit or push this soon after an operation Adar ran in that folder is Adar's own. */
const OWN_GRACE_MS = 6000
/** Worktrees watched at most (the rest are listed by the worktrees section as before). */
const MAX_WATCHED = 40

interface Tracked {
  path: string
  repo: string
  name: string
  isMain: boolean
  base: string | null
  /** The commit the upstream pointed at, after the last look. */
  upstreamSha: string | null
  look: WorktreeLook | null
  /** Minute → files changed in it. */
  minutes: Map<number, Set<string>>
  /** File → the time it was last seen changing. */
  stamps: Map<string, number>
  lastChange: number | null
  since: number | null
  state: AgentState | null
  quietSaid: boolean
  looking: Promise<void> | null
  again: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastLookAt: number
}

export interface ActivityDeps {
  ctx: GitContext
  emit(event: AdarEvent): void
  settings(): Promise<AppSettings>
  /** The fallbacks of the tabs' watcher (status polling when file events are missing, the ignore filter); tests turn fs.watch off. */
  watcher?: Partial<Pick<WatcherOptions, 'fsWatch' | 'pollMs' | 'worktreeSignature' | 'ignoredPaths'>>
  /** Tests: how long after an operation of Adar's a change is still its own (default OWN_GRACE_MS). */
  ownGraceMs?: number
}

const real = (p: string) => fs.realpath(p).catch(() => path.resolve(p))

export class ActivityTracker {
  private readonly tracked = new Map<string, Tracked>()
  private readonly watcher: WatcherManager
  private repos: string[] = []
  private relistTimer: ReturnType<typeof setInterval> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private relisting: Promise<void> | null = null
  /** Folder → operations Adar is running there, and until when a change there is still Adar's. */
  private readonly running = new Map<string, number>()
  private readonly ownUntil = new Map<string, number>()
  /** Real path → the path git lists (Adar's operations name a folder the way its tab does: /tmp vs /private/tmp). */
  private readonly aliases = new Map<string, string>()
  private disposed = false

  constructor(private readonly deps: ActivityDeps) {
    this.watcher = new WatcherManager((e) => this.onChange(e), {
      debounceMs: 400,
      maxWaitMs: 2000,
      pollMs: 2000,
      ...deps.watcher
    })
  }

  /** Watch the worktrees of these repositories (the open tabs); an empty list stops everything. */
  async watch(repos: string[]): Promise<void> {
    this.repos = [...new Set(repos.filter((r) => typeof r === 'string' && path.isAbsolute(r)))]
    if (!this.repos.length) {
      this.stopTimers()
      for (const p of [...this.tracked.keys()]) this.untrack(p)
      return
    }
    if (!this.relistTimer) {
      this.relistTimer = setInterval(() => void this.relist(), RELIST_MS)
      this.relistTimer.unref?.()
      this.tickTimer = setInterval(() => void this.tick(), TICK_MS)
      this.tickTimer.unref?.()
    }
    await this.relist()
  }

  /** What every watched worktree is doing now. */
  list(): AgentWorktree[] {
    return [...this.tracked.values()].filter((t) => t.look).map((t) => this.snapshot(t))
  }

  /** Adar starts an operation that may commit or push in `folder` (its own: no notification). */
  ownStart(folder: string): void {
    const key = this.keyOf(folder)
    this.running.set(key, (this.running.get(key) ?? 0) + 1)
  }

  ownEnd(folder: string): void {
    const key = this.keyOf(folder)
    const n = (this.running.get(key) ?? 1) - 1
    if (n > 0) this.running.set(key, n)
    else this.running.delete(key)
    this.ownUntil.set(key, Date.now() + (this.deps.ownGraceMs ?? OWN_GRACE_MS))
    // Look right away so the change is dated while it still counts as Adar's.
    const t = this.tracked.get(key)
    if (t) this.schedule(t, 0)
  }

  private keyOf(folder: string): string {
    let resolved = path.resolve(folder)
    try {
      resolved = realpathSync.native(resolved)
    } catch {
      /* gone */
    }
    return this.aliases.get(resolved) ?? path.resolve(folder)
  }

  private isOwn(folder: string): boolean {
    return (this.running.get(folder) ?? 0) > 0 || Date.now() < (this.ownUntil.get(folder) ?? 0)
  }

  dispose(): void {
    this.disposed = true
    this.stopTimers()
    for (const p of [...this.tracked.keys()]) this.untrack(p)
    this.watcher.stopAll()
  }

  private stopTimers(): void {
    if (this.relistTimer) clearInterval(this.relistTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.relistTimer = null
    this.tickTimer = null
  }

  // ── which worktrees ─────────────────────────────────────────────────────

  private relist(): Promise<void> {
    if (!this.relisting) {
      this.relisting = this.doRelist().finally(() => {
        this.relisting = null
      })
    }
    return this.relisting
  }

  private async doRelist(): Promise<void> {
    const settings = await this.deps.settings()
    const wanted = new Map<string, { repo: string; name: string; isMain: boolean }>()
    if (settings.agentsOn) {
      const seenRepos = new Set<string>()
      for (const repo of this.repos) {
        const list = await listWorktrees(this.deps.ctx, repo).catch(() => [])
        if (!list.length) continue
        const main = list[0].path
        const mainReal = await real(main)
        if (seenRepos.has(mainReal)) continue
        seenRepos.add(mainReal)
        for (let i = 0; i < list.length && wanted.size < MAX_WATCHED; i++) {
          const w = list[i]
          if (w.bare || w.prunable || (i === 0 && !settings.agentsWatchMain)) continue
          if (!(await fs.stat(w.path).then((s) => s.isDirectory(), () => false))) continue
          wanted.set(w.path, { repo: main, name: path.basename(w.path) || w.path, isMain: i === 0 })
        }
      }
    }
    if (this.disposed) return
    const removed: string[] = []
    for (const p of [...this.tracked.keys()]) {
      if (!wanted.has(p)) {
        this.untrack(p)
        removed.push(p)
      }
    }
    for (const [p, info] of wanted) if (!this.tracked.has(p)) await this.track(p, info)
    if (removed.length) this.deps.emit({ type: 'agents', worktrees: [], removed, events: [] })
  }

  private async track(dir: string, info: { repo: string; name: string; isMain: boolean }): Promise<void> {
    const t: Tracked = {
      path: dir,
      ...info,
      base: await baseBranch(this.deps.ctx, dir).catch(() => null),
      upstreamSha: null,
      look: null,
      minutes: new Map(),
      stamps: new Map(),
      lastChange: null,
      since: null,
      state: null,
      quietSaid: false,
      looking: null,
      again: false,
      timer: null,
      lastLookAt: 0
    }
    if (this.disposed || this.tracked.has(dir)) return
    this.tracked.set(dir, t)
    this.aliases.set(await real(dir), dir)
    const target = await this.targetOf(dir)
    if (target && this.tracked.get(dir) === t) this.watcher.start(target)
    this.schedule(t, 0)
  }

  private untrack(dir: string): void {
    const t = this.tracked.get(dir)
    if (!t) return
    if (t.timer) clearTimeout(t.timer)
    this.tracked.delete(dir)
    this.watcher.stop(dir)
  }

  private async targetOf(dir: string): Promise<WatchTarget | null> {
    const res = await this.deps.ctx.git(dir, ['rev-parse', '--absolute-git-dir', '--git-common-dir'], { allowFailure: true })
    if (res.code !== 0) return null
    const [gitDir, common] = res.stdout.trim().split('\n')
    if (!gitDir) return null
    const commonDir = common ? path.resolve(dir, common) : gitDir
    return { repoPath: dir, gitDir, commonDir, isBare: false }
  }

  // ── looking ─────────────────────────────────────────────────────────────

  private onChange(e: AdarEvent): void {
    if (e.type !== 'repo-changed') return
    const t = this.tracked.get(e.repoPath)
    if (t) this.schedule(t, Math.max(0, t.lastLookAt + MIN_LOOK_GAP_MS - Date.now()))
  }

  private schedule(t: Tracked, delay: number): void {
    if (t.looking) {
      t.again = true
      return
    }
    if (t.timer) clearTimeout(t.timer)
    t.timer = setTimeout(() => void this.look(t), delay)
    t.timer.unref?.()
  }

  /** Look at every watched worktree now and wait for it (after a settings change; tests). */
  async lookNow(): Promise<void> {
    await this.relisting
    for (const t of [...this.tracked.values()]) {
      if (t.timer) clearTimeout(t.timer)
      t.timer = null
      await t.looking
      t.again = false
      await this.look(t)
    }
  }

  private look(t: Tracked): Promise<void> {
    t.timer = null
    if (this.tracked.get(t.path) !== t) return Promise.resolve()
    t.looking = this.doLook(t)
    return t.looking
  }

  private async doLook(t: Tracked): Promise<void> {
    t.lastLookAt = Date.now()
    try {
      const ownBefore = this.isOwn(t.path)
      const ownRepoBefore = this.isOwn(t.repo)
      const look = await lookAtWorktree(this.deps.ctx, t.path, t.base)
      if (!look || this.tracked.get(t.path) !== t) return
      const upstreamSha = look.upstream ? await this.revParse(t.path, '@{upstream}') : null
      const own = ownBefore || this.isOwn(t.path)
      // A push can come from any tab of the repository (Push on a branch's menu).
      const events = await this.compare(t, look, upstreamSha, own, own || ownRepoBefore || this.isOwn(t.repo))
      t.look = look
      t.upstreamSha = upstreamSha
      const settings = await this.deps.settings()
      events.push(...this.updateState(t, Date.now(), settings.agentQuietMinutes))
      this.deps.emit({ type: 'agents', worktrees: [this.snapshot(t)], removed: [], events })
    } catch {
      /* the next change looks again */
    } finally {
      t.looking = null
      if (t.again && this.tracked.get(t.path) === t) {
        t.again = false
        this.schedule(t, MIN_LOOK_GAP_MS)
      }
    }
  }

  private async revParse(dir: string, rev: string): Promise<string | null> {
    const res = await this.deps.ctx.git(dir, ['rev-parse', '--verify', '--quiet', rev], { allowFailure: true, env: { GIT_OPTIONAL_LOCKS: '0' } })
    const sha = res.code === 0 ? res.stdout.trim() : ''
    return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null
  }

  /** Date what changed since the previous look, and the commits and pushes it shows. */
  private async compare(t: Tracked, look: WorktreeLook, upstreamSha: string | null, own: boolean, ownPush: boolean): Promise<AgentEvent[]> {
    const now = Date.now()
    const prev = t.look
    const events: AgentEvent[] = []
    const changed: Array<[string, number]> = []

    // Files: a new or newer modification time is a change; a file that is gone is dated now.
    const present = new Set<string>()
    for (const f of look.files) {
      present.add(f.path)
      const before = t.stamps.get(f.path)
      if (f.at === 0) f.at = before ?? now
      if (before === undefined || f.at !== before) {
        t.stamps.set(f.path, f.at)
        // On the first look only what changed within the strip is history; older changes only date the worktree.
        changed.push([f.path, f.at])
      }
    }
    const headMoved = !!prev && prev.head !== look.head
    for (const p of [...t.stamps.keys()]) {
      if (present.has(p)) continue
      t.stamps.delete(p)
      // Gone from the changes without a commit: undone (a commit dates itself).
      if (prev && !headMoved) changed.push([p, now])
    }

    // Commits: HEAD moved forward on the same branch.
    if (prev && headMoved && prev.head && look.head && prev.branch === look.branch && (await isAncestor(this.deps.ctx, t.path, prev.head, look.head))) {
      const count = await countBetween(this.deps.ctx, t.path, prev.head, look.head)
      if (count > 0) {
        const commits = await this.commitsBetween(t.path, prev.head, look.head)
        const files = await filesBetween(this.deps.ctx, t.path, prev.head, look.head)
        events.push({ kind: 'commit', path: t.path, repo: t.repo, commits, files, own })
        changed.push(['', now])
      }
    }

    // Pushes: the upstream moved to commits this worktree has.
    if (prev && look.upstream && upstreamSha && upstreamSha !== t.upstreamSha && look.head) {
      const fresh = prev.upstream !== look.upstream || !t.upstreamSha
      const forward = fresh || (await isAncestor(this.deps.ctx, t.path, t.upstreamSha!, upstreamSha))
      const ours = await isAncestor(this.deps.ctx, t.path, upstreamSha, look.head)
      if (forward && ours) {
        const from = fresh ? (t.base ?? null) : t.upstreamSha
        const count = from ? await countBetween(this.deps.ctx, t.path, from, upstreamSha) : 0
        if (count > 0 || fresh) {
          const subject = look.commits.find((c) => c.sha === upstreamSha)?.subject ?? look.commits[0]?.subject ?? ''
          events.push({ kind: 'push', path: t.path, repo: t.repo, count, upstream: look.upstream, subject, own: ownPush })
          changed.push(['', now])
        }
      }
    }

    const newest = look.commits[0]
    if (!prev && newest) changed.push(['', newest.at])
    for (const [file, at] of changed) this.record(t, file, at, now)
    return events
  }

  private async commitsBetween(dir: string, from: string, to: string): Promise<AgentCommit[]> {
    const res = await this.deps.ctx.git(dir, ['log', '-n5', '--format=%H%x1f%ct%x1f%s%x1f%x1e', `${from}..${to}`, '--'], {
      allowFailure: true,
      env: { GIT_OPTIONAL_LOCKS: '0' }
    })
    return res.code === 0 ? parseAgentLog(res.stdout).commits : []
  }

  /** One change at `at`: the strip (files only), the last change and the stretch of work. */
  private record(t: Tracked, file: string, at: number, now: number): void {
    if (!at || at > now + 60_000) return
    if (file && now - at < STRIP_MINUTES * 60_000) {
      const m = minuteOf(at)
      let set = t.minutes.get(m)
      if (!set) t.minutes.set(m, (set = new Set()))
      set.add(file)
    }
    if (t.lastChange === null || at > t.lastChange) {
      if (t.lastChange === null || at - t.lastChange >= IDLE_MS) t.since = at
      t.lastChange = at
    } else if (t.since === null || (at < t.since && t.since - at < IDLE_MS)) {
      t.since = at
    }
  }

  // ── time ────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (!this.tracked.size) return
    const settings = await this.deps.settings()
    const now = Date.now()
    const changed: AgentWorktree[] = []
    const events: AgentEvent[] = []
    for (const t of this.tracked.values()) {
      if (!t.look) continue
      for (const m of [...t.minutes.keys()]) if (now - m > STRIP_MINUTES * 60_000) t.minutes.delete(m)
      const before = t.state
      const said = this.updateState(t, now, settings.agentQuietMinutes)
      events.push(...said)
      if (t.state !== before) changed.push(this.snapshot(t))
    }
    if (changed.length || events.length) this.deps.emit({ type: 'agents', worktrees: changed, removed: [], events })
  }

  /** Working → quiet says so once per stop; the first state seen says nothing. */
  private updateState(t: Tracked, now: number, quietMinutes: number): AgentEvent[] {
    if (!t.look) return []
    const state = agentState(this.snapshotCounts(t), now, quietMinutes)
    const before = t.state
    t.state = state
    if (state === 'working') t.quietSaid = false
    if (before === 'working' && state === 'quiet' && !t.quietSaid) {
      t.quietSaid = true
      return [{ kind: 'quiet', path: t.path, repo: t.repo }]
    }
    return []
  }

  private snapshotCounts(t: Tracked) {
    const look = t.look!
    return { lastChange: t.lastChange, fileCount: look.files.length, unpushed: look.unpushed, ahead: look.ahead }
  }

  private snapshot(t: Tracked): AgentWorktree {
    const look = t.look!
    const now = Date.now()
    const activity: Array<[number, number]> = [...t.minutes.entries()]
      .filter(([m]) => now - m <= STRIP_MINUTES * 60_000)
      .sort((a, b) => a[0] - b[0])
      .map(([m, set]) => [m, set.size])
    return {
      path: t.path,
      repo: t.repo,
      name: t.name,
      isMain: t.isMain,
      branch: look.branch,
      head: look.head,
      files: look.files.slice(0, MAX_AGENT_FILES),
      fileCount: look.files.length,
      added: look.added,
      removed: look.removed,
      base: t.base ? baseName(t.base) : null,
      ahead: look.ahead,
      unpushed: look.unpushed,
      upstream: look.upstream,
      commits: look.commits,
      coAuthors: look.coAuthors,
      activity,
      lastChange: t.lastChange,
      since: t.since
    }
  }
}

/** The AdarApi methods of Agents at work. */
export function createAgentOps(services: { activity: ActivityTracker; notifyAgent(notice: AgentNotice): void }): Pick<AdarApi, 'watchAgents' | 'getAgentWorktrees' | 'notifyAgent'> {
  return {
    async watchAgents(repos) {
      if (!Array.isArray(repos) || repos.length > 200) throw invalid('Invalid repository list')
      await services.activity.watch(repos.filter((r): r is string => typeof r === 'string'))
    },
    async getAgentWorktrees() {
      return services.activity.list()
    },
    async notifyAgent(raw) {
      const notice = parseAgentNotice(raw)
      if (!notice) throw invalid('Invalid notification')
      services.notifyAgent(notice)
    }
  }
}
