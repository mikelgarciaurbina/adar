// Agents at work, pure UI helpers: each worktree's state and the words for it ("7 files · now", "quiet 6 min",
// "10:40"), the dot a tab carries, the Agents view's columns and the notifications for what happened. The rules
// themselves (working / quiet / idle, which agent) are shared with the main process: @shared/agents.

import {
  agentOf,
  agentState,
  FOLD_MS,
  newSince,
  unpushedOf,
  type AgentCommit,
  type AgentEvent,
  type AgentNotice,
  type AgentsScope,
  type AgentState,
  type AgentWorktree,
  type WorktreeSeen
} from '@shared/agents'
import type { AppSettings, TabGroup } from '@shared/types'
import { pluralize } from '@renderer/lib/format'
import { groupOf } from '@renderer/lib/tabGroups'

export type AgentSettings = Pick<AppSettings, 'agentQuietMinutes' | 'agentPrefixes' | 'worktreesSeen'>

/** "now", "12 s", "6 min", "2 h", "3 d". */
export function shortAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 10) return 'now'
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h`
  return `${Math.round(h / 24)} d`
}

/** "4 s ago", "6 minutes ago", "just now". */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 3) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${pluralize(m, 'minute')} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${pluralize(h, 'hour')} ago`
  return `${pluralize(Math.round(h / 24), 'day')} ago`
}

/** A clock time today ("10:40"), else the weekday ("Monday") within a week, else the date. */
export function whenText(t: number, now: number): string {
  const d = new Date(t)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (now - t < 6 * 24 * 3600_000) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function stateOf(w: AgentWorktree, now: number, s: Pick<AppSettings, 'agentQuietMinutes'>): AgentState {
  return agentState(w, now, s.agentQuietMinutes)
}

/** The short label beside a worktree: what it is doing and since when. */
export function stateLabel(w: AgentWorktree, state: AgentState, now: number): string {
  if (state === 'working') return w.fileCount ? `${pluralize(w.fileCount, 'file')} · ${shortAgo(now - (w.lastChange ?? now))}` : shortAgo(now - (w.lastChange ?? now))
  if (state === 'quiet') return `quiet ${shortAgo(now - (w.lastChange ?? now))}`
  return w.lastChange ? whenText(w.lastChange, now) : ''
}

/** Where the work stands: "3 commits ahead of main · not pushed", "nothing committed yet". */
export function aheadText(w: AgentWorktree): { ahead: string; push: string | null } {
  const unpushed = unpushedOf(w)
  const ahead = w.ahead ? `${pluralize(w.ahead, 'commit')} ahead of ${w.base ?? 'the base'}` : 'nothing committed yet'
  const push = !w.ahead ? null : w.upstream === null ? 'not pushed' : unpushed ? `${unpushed} not pushed` : 'pushed'
  return { ahead, push }
}

/** The worktree's details, for its tooltip. */
export function stateTitle(w: AgentWorktree, state: AgentState, now: number, agent: string | null): string {
  const what =
    state === 'working'
      ? `working, last change ${agoText(now - (w.lastChange ?? now))}`
      : state === 'quiet'
        ? `quiet for ${agoText(now - (w.lastChange ?? now)).replace(/ ago$/, '')}, with work left: it may be waiting for you`
        : w.lastChange
          ? `idle since ${whenText(w.lastChange, now)}`
          : 'idle'
  const { ahead, push } = aheadText(w)
  return [
    `${w.name} · ${what}`,
    w.fileCount ? `${pluralize(w.fileCount, 'file')} changed, +${w.added} −${w.removed}` : 'No changes left to commit',
    `${w.branch ?? 'detached HEAD'}: ${ahead}${push ? `, ${push}` : ''}`,
    agent ? `${agent} works here` : null
  ]
    .filter(Boolean)
    .join('\n')
}

export function agentName(w: AgentWorktree, s: Pick<AppSettings, 'agentPrefixes'>): string | null {
  return agentOf(w, s.agentPrefixes)
}

export function newCommits(w: AgentWorktree, seen: Record<string, WorktreeSeen>): AgentCommit[] {
  return newSince(w, seen[w.path])
}

/** The dot a tab carries: its own worktree's state, or "working" when one of the repository's worktrees works. */
export function tabDot(tab: { path: string; mainWorktree: string | null }, list: readonly AgentWorktree[], now: number, s: Pick<AppSettings, 'agentQuietMinutes'>): AgentState | null {
  const own = list.find((w) => w.path === tab.path)
  if (own) {
    const st = stateOf(own, now, s)
    if (st !== 'idle') return st
  }
  if (tab.mainWorktree) return null
  return list.some((w) => w.repo === tab.path && w.path !== tab.path && stateOf(w, now, s) === 'working') ? 'working' : null
}

export interface AgentScope {
  list: AgentWorktree[]
  /** The scope in effect: 'group' is 'repo' for a tab outside any group. */
  scope: AgentsScope
  /** The repository whose worktrees 'repo' shows: the tab's main worktree. */
  repo: string
  /** The tab's group, when it is in one. */
  group: TabGroup | null
}

/**
 * The worktrees a tab's Agents view shows: its repository's (every worktree of it, the main folder included, as in
 * the left panel), its tab group's or every open tab's. mainOf gives an open tab's main worktree.
 */
export function scopeOf(
  all: readonly AgentWorktree[],
  tab: { path: string; mainWorktree: string | null },
  scope: AgentsScope,
  groups: readonly TabGroup[],
  mainOf: (path: string) => string
): AgentScope {
  const group = groupOf(groups, tab.path) ?? null
  const repo = tab.mainWorktree ?? tab.path
  if (scope === 'all') return { list: [...all], scope, repo, group }
  if (scope === 'group' && group) {
    const mains = new Set(group.repos.map(mainOf))
    return { list: all.filter((w) => mains.has(w.repo) || group.repos.includes(w.path)), scope, repo, group }
  }
  return { list: all.filter((w) => w.repo === repo || w.path === tab.path), scope: 'repo', repo, group }
}

export interface Board {
  working: AgentWorktree[]
  quiet: AgentWorktree[]
  idle: AgentWorktree[]
  /** Idle for a day or more: folded. */
  folded: AgentWorktree[]
}

/** The Agents view's columns: the latest change first in each. */
export function boardOf(list: readonly AgentWorktree[], now: number, s: Pick<AppSettings, 'agentQuietMinutes'>): Board {
  const board: Board = { working: [], quiet: [], idle: [], folded: [] }
  const byLatest = [...list].sort((a, b) => (b.lastChange ?? 0) - (a.lastChange ?? 0) || a.name.localeCompare(b.name))
  for (const w of byLatest) {
    const st = stateOf(w, now, s)
    if (st === 'idle') (w.lastChange === null || now - w.lastChange >= FOLD_MS ? board.folded : board.idle).push(w)
    else board[st].push(w)
  }
  return board
}

/** A worktree's name in a notification: its branch when it has one. */
const who = (w: AgentWorktree | undefined, path: string) => w?.branch ?? w?.name ?? path.split(/[\\/]/).pop() ?? path

/**
 * The notifications a batch of events calls for: nothing for Adar's own commits and pushes, for a worktree whose
 * tab is in front while Adar is, or for quiet worktrees the user muted; more than three become one.
 */
export function noticesFor(
  events: readonly AgentEvent[],
  worktrees: Record<string, AgentWorktree>,
  s: Pick<AppSettings, 'notifyAgentCommits' | 'notifyAgentQuiet' | 'agentsQuietMuted' | 'agentPrefixes'>,
  front: string | null,
  repoName: (repo: string) => string
): AgentNotice[] {
  const out: AgentNotice[] = []
  const kinds: string[] = []
  for (const e of events) {
    if (e.path === front) continue
    const w = worktrees[e.path]
    const name = who(w, e.path)
    const where = `${repoName(e.repo)} · ${w?.name ?? name}`
    const agent = w ? agentOf(w, s.agentPrefixes) : null
    if (e.kind === 'commit') {
      if (e.own || !s.notifyAgentCommits || !e.commits.length) continue
      const [first] = e.commits
      const more = e.commits.length > 1 ? ` and ${pluralize(e.commits.length - 1, 'more')}` : ''
      out.push({
        title: `${name} committed`,
        subtitle: `${where}${agent ? ` · with ${agent}` : ''}`,
        body: `${first.subject}${more} · ${pluralize(e.files, 'file')}`,
        open: { path: e.path, repo: e.repo, view: 'commit', sha: first.sha }
      })
      kinds.push('committed')
    } else if (e.kind === 'push') {
      if (e.own || !s.notifyAgentCommits) continue
      out.push({
        title: `${name} pushed${e.count ? ` ${pluralize(e.count, 'commit')}` : ''}`,
        subtitle: `${where} · to ${e.upstream.split('/')[0]}`,
        body: e.subject || `Now on ${e.upstream}`,
        open: { path: e.path, repo: e.repo, view: 'changes' }
      })
      kinds.push('pushed')
    } else {
      if (!s.notifyAgentQuiet || s.agentsQuietMuted.includes(e.path)) continue
      const files = w?.fileCount ? `${pluralize(w.fileCount, 'file')} not committed` : w && unpushedOf(w) ? `${pluralize(unpushedOf(w), 'commit')} not pushed` : 'work left'
      out.push({
        title: `${w?.name ?? name} went quiet`,
        subtitle: `${repoName(e.repo)} · ${name}`,
        body: `No changes for a while, ${files}. It may be waiting for you.`,
        open: { path: e.path, repo: e.repo, view: 'changes' }
      })
      kinds.push('went quiet')
    }
  }
  if (out.length <= 3) return out
  const counts = new Map<string, number>()
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1)
  const repos = [...new Set(out.map((n) => n.subtitle.split(' · ')[0]))]
  return [
    {
      title: `${out.length} agents need a look`,
      subtitle: repos.length > 2 ? `${repos.slice(0, 2).join(', ')} and ${pluralize(repos.length - 2, 'more')}` : repos.join(' and '),
      body: [...counts].map(([k, n]) => `${n} ${k}`).join(', '),
      open: { path: null, repo: out[0].open.repo, view: 'agents' }
    }
  ]
}
