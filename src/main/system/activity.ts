// The commit tracker: notices commits and pushes Adar did not make itself, in the folders and worktrees of the
// repositories open in it (an agent's in one of Adar's terminals or in a worktree of its own, or the user's from
// another app), and tells the UI with 'agents' events so it can notify. It keeps where each folder's HEAD and
// upstream were, and looks again whenever the tabs' watcher reports that refs changed (a commit or a push moves
// one); it has no watcher of its own. `own` marks what happened during or just after an operation Adar ran there
// (src/main/backend.ts wraps `exclusive` and `gitNetwork`), which is never news.

import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { agentOf, parseAgentNotice, type AgentEvent, type AgentNotice } from '@shared/agents'
import type { AdarApi } from '@shared/api'
import type { AdarEvent, AppSettings } from '@shared/types'
import type { GitContext } from '../git/context'
import { baseBranch, commitsBetween, countBetween, filesBetween, isAncestor, lookAtHead, subjectOf, type HeadLook } from '../git/read/activity'
import { invalidArgument as invalid } from '../git/read/common'
import { listWorktrees } from '../git/read/worktrees'

/** How often the worktree lists are read again (new worktrees an agent made, removed ones). */
const RELIST_MS = 20_000
/** Looks at one folder are at least this far apart. */
const MIN_LOOK_GAP_MS = 800
/** A commit or push this soon after an operation Adar ran in that folder is Adar's own. */
const OWN_GRACE_MS = 6000
/** Folders followed at most. */
const MAX_WATCHED = 60

interface Tracked {
  path: string
  /** The repository's main folder. */
  repo: string
  isMain: boolean
  base: string | null
  /** Where things were at the last look; null before the first one. */
  look: HeadLook | null
  looking: Promise<void> | null
  again: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastLookAt: number
}

export interface ActivityDeps {
  ctx: GitContext
  emit(event: AdarEvent): void
  settings(): Promise<Pick<AppSettings, 'notifyAgentCommits'>>
  /** Tests: how long after an operation of Adar's a change is still its own (default OWN_GRACE_MS). */
  ownGraceMs?: number
}

const real = (p: string) => fs.realpath(p).catch(() => path.resolve(p))

export class ActivityTracker {
  private readonly tracked = new Map<string, Tracked>()
  /** The open tabs: their folders are what the tabs' watcher reports about. */
  private repos: string[] = []
  /** A tab's folder → its repository's main folder (refs are shared by every worktree of it). */
  private readonly mainOf = new Map<string, string>()
  private relistTimer: ReturnType<typeof setInterval> | null = null
  private relisting: Promise<void> | null = null
  /** Folder → operations Adar is running there, and until when a change there is still Adar's. */
  private readonly running = new Map<string, number>()
  private readonly ownUntil = new Map<string, number>()
  /** Real path → the path git lists (Adar's operations name a folder the way its tab does: /tmp vs /private/tmp). */
  private readonly aliases = new Map<string, string>()
  private disposed = false

  constructor(private readonly deps: ActivityDeps) {}

  /** Follow the folders and worktrees of these repositories (the open tabs); an empty list stops everything. */
  async watch(repos: string[]): Promise<void> {
    this.repos = [...new Set(repos.filter((r) => typeof r === 'string' && path.isAbsolute(r)))]
    if (!this.repos.length) {
      this.stopTimer()
      for (const p of [...this.tracked.keys()]) this.untrack(p)
      return
    }
    if (!this.relistTimer) {
      this.relistTimer = setInterval(() => void this.relist(), RELIST_MS)
      this.relistTimer.unref?.()
    }
    await this.relist()
  }

  /** The folders followed now (tests). */
  list(): Array<{ path: string; repo: string; isMain: boolean; branch: string | null }> {
    return [...this.tracked.values()].map((t) => ({ path: t.path, repo: t.repo, isMain: t.isMain, branch: t.look?.branch ?? null }))
  }

  /** The tabs' watcher saw a repository change: when its refs did, a commit or a push may have happened there. */
  repoChanged(e: AdarEvent): void {
    if (e.type !== 'repo-changed' || !e.scopes.includes('refs') || !this.tracked.size) return
    const main = this.mainOf.get(e.repoPath) ?? this.mainOf.get(this.keyOf(e.repoPath))
    for (const t of this.tracked.values()) {
      // Refs are shared: a commit in any worktree of the repository shows as a change of them all.
      if (t.path === e.repoPath || (main && t.repo === main)) this.schedule(t, Math.max(0, t.lastLookAt + MIN_LOOK_GAP_MS - Date.now()))
    }
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
    // Look right away so the change is seen while it still counts as Adar's.
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
    this.stopTimer()
    for (const p of [...this.tracked.keys()]) this.untrack(p)
  }

  private stopTimer(): void {
    if (this.relistTimer) clearInterval(this.relistTimer)
    this.relistTimer = null
  }

  // ── which folders ───────────────────────────────────────────────────────

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
    const wanted = new Map<string, { repo: string; isMain: boolean }>()
    const mains = new Map<string, string>()
    if (settings.notifyAgentCommits) {
      const seenRepos = new Set<string>()
      for (const repo of this.repos) {
        const list = await listWorktrees(this.deps.ctx, repo).catch(() => [])
        if (!list.length) continue
        const main = list[0].path
        mains.set(repo, main)
        const mainReal = await real(main)
        if (seenRepos.has(mainReal)) continue
        seenRepos.add(mainReal)
        for (let i = 0; i < list.length && wanted.size < MAX_WATCHED; i++) {
          const w = list[i]
          if (w.bare || w.prunable) continue
          if (!(await fs.stat(w.path).then((s) => s.isDirectory(), () => false))) continue
          wanted.set(w.path, { repo: main, isMain: i === 0 })
        }
      }
    }
    if (this.disposed) return
    this.mainOf.clear()
    for (const [repo, main] of mains) this.mainOf.set(repo, main)
    for (const p of [...this.tracked.keys()]) if (!wanted.has(p)) this.untrack(p)
    for (const [p, info] of wanted) if (!this.tracked.has(p)) await this.track(p, info)
  }

  private async track(dir: string, info: { repo: string; isMain: boolean }): Promise<void> {
    const t: Tracked = {
      path: dir,
      ...info,
      base: await baseBranch(this.deps.ctx, dir).catch(() => null),
      look: null,
      looking: null,
      again: false,
      timer: null,
      lastLookAt: 0
    }
    if (this.disposed || this.tracked.has(dir)) return
    this.tracked.set(dir, t)
    this.aliases.set(await real(dir), dir)
    // The first look only records where things are.
    this.schedule(t, 0)
  }

  private untrack(dir: string): void {
    const t = this.tracked.get(dir)
    if (!t) return
    if (t.timer) clearTimeout(t.timer)
    this.tracked.delete(dir)
  }

  // ── looking ─────────────────────────────────────────────────────────────

  private schedule(t: Tracked, delay: number): void {
    if (t.looking) {
      t.again = true
      return
    }
    if (t.timer) clearTimeout(t.timer)
    t.timer = setTimeout(() => void this.look(t), delay)
    t.timer.unref?.()
  }

  /** Look at every followed folder now and wait for it (tests). */
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
      const look = await lookAtHead(this.deps.ctx, t.path)
      if (!look || this.tracked.get(t.path) !== t) return
      const own = ownBefore || this.isOwn(t.path)
      // A push can come from any tab of the repository (Push on a branch's menu).
      const events = await this.compare(t, look, own, own || ownRepoBefore || this.isOwn(t.repo))
      t.look = look
      if (events.length) this.deps.emit({ type: 'agents', events })
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

  /** The commits and pushes that happened since the previous look. */
  private async compare(t: Tracked, look: HeadLook, own: boolean, ownPush: boolean): Promise<AgentEvent[]> {
    const prev = t.look
    const events: AgentEvent[] = []
    if (!prev) return events
    const { ctx } = this.deps
    const where = { path: t.path, repo: t.repo, branch: look.branch, isMain: t.isMain }

    // Commits: HEAD moved forward on the same branch.
    if (prev.head !== look.head && prev.head && look.head && prev.branch === look.branch && (await isAncestor(ctx, t.path, prev.head, look.head))) {
      const count = await countBetween(ctx, t.path, prev.head, look.head)
      if (count > 0) {
        const { commits, coAuthors } = await commitsBetween(ctx, t.path, prev.head, look.head)
        const files = await filesBetween(ctx, t.path, prev.head, look.head)
        events.push({ kind: 'commit', ...where, commits, files, agent: agentOf(coAuthors, look.branch, t.path), own })
      }
    }

    // Pushes: the upstream moved to commits this folder has.
    if (look.upstream && look.upstreamSha && look.upstreamSha !== prev.upstreamSha && look.head) {
      const fresh = prev.upstream !== look.upstream || !prev.upstreamSha
      const forward = fresh || (await isAncestor(ctx, t.path, prev.upstreamSha!, look.upstreamSha))
      const ours = await isAncestor(ctx, t.path, look.upstreamSha, look.head)
      if (forward && ours) {
        // A branch pushed for the first time is counted from the base it started at.
        const from = fresh ? t.base : prev.upstreamSha
        const count = from ? await countBetween(ctx, t.path, from, look.upstreamSha) : 0
        if (count > 0 || fresh) {
          const pushed = from ? await commitsBetween(ctx, t.path, from, look.upstreamSha, 20) : { commits: [], coAuthors: [] }
          const subject = pushed.commits[0]?.sha === look.upstreamSha ? pushed.commits[0].subject : await subjectOf(ctx, t.path, look.upstreamSha)
          events.push({ kind: 'push', ...where, count, upstream: look.upstream, subject, agent: agentOf(pushed.coAuthors, look.branch, t.path), own: ownPush })
        }
      }
    }
    return events
  }
}

/** The AdarApi methods of the commit tracker. */
export function createAgentOps(services: { activity: ActivityTracker; notifyAgent(notice: AgentNotice): void }): Pick<AdarApi, 'watchAgents' | 'notifyAgent'> {
  return {
    async watchAgents(repos) {
      if (!Array.isArray(repos) || repos.length > 200) throw invalid('Invalid repository list')
      await services.activity.watch(repos.filter((r): r is string => typeof r === 'string'))
    },
    async notifyAgent(raw) {
      const notice = parseAgentNotice(raw)
      if (!notice) throw invalid('Invalid notification')
      services.notifyAgent(notice)
    }
  }
}
