// Pure helpers of the menu bar panel (src/renderer/menubar.html): which project it shows, the projects its
// switcher lists, and which of the loaded commits are incoming (on the upstream, not yet on HEAD).

import { basename } from '@renderer/lib/format'
import type { AppSettings, Commit, GroupColor, RecentRepo, WorkingStatus } from '@shared/types'

/** The project the panel shows: the one picked in its switcher, else Adar's active tab, its first tab or the latest recent repository. */
export function pickProject(pinned: string | null, settings: Pick<AppSettings, 'activeTab' | 'openTabs'>, recent: readonly RecentRepo[]): string | null {
  return pinned || settings.activeTab || settings.openTabs[0] || recent[0]?.path || null
}

export interface ProjectEntry {
  path: string
  name: string
}

export interface ProjectSection {
  /** Group id, or 'other'. */
  id: string
  title: string
  /** Group colour (null for the other repositories). */
  color: GroupColor | null
  projects: ProjectEntry[]
}

/**
 * The switcher's list: one section per tab group with its repositories in tab order, then the other open tabs and
 * the recent repositories. `query` keeps the projects whose name (or group name) contains it.
 */
export function projectSections(settings: Pick<AppSettings, 'openTabs' | 'tabGroups'>, recent: readonly RecentRepo[], query = ''): ProjectSection[] {
  const q = query.trim().toLowerCase()
  const seen = new Set<string>()
  const entry = (p: string): ProjectEntry => ({ path: p, name: basename(p) || p })
  const sections: ProjectSection[] = []
  for (const g of settings.tabGroups) {
    const groupMatches = !!q && g.name.toLowerCase().includes(q)
    const projects = g.repos.filter((p) => !seen.has(p)).map(entry)
    projects.forEach((e) => seen.add(e.path))
    const shown = groupMatches ? projects : projects.filter((e) => e.name.toLowerCase().includes(q))
    if (shown.length) sections.push({ id: g.id, title: g.name, color: g.color, projects: shown })
  }
  const others: ProjectEntry[] = []
  for (const p of [...settings.openTabs, ...recent.map((r) => r.path)]) {
    if (seen.has(p)) continue
    seen.add(p)
    const e = entry(p)
    if (e.name.toLowerCase().includes(q)) others.push(e)
  }
  if (others.length) sections.push({ id: 'other', title: sections.length ? 'Other repositories' : 'Repositories', color: null, projects: others })
  return sections
}

/** The group a repository belongs to, if any. */
export function groupOf(settings: Pick<AppSettings, 'tabGroups'>, repo: string): { name: string; color: GroupColor } | null {
  const g = settings.tabGroups.find((x) => x.repos.includes(repo))
  return g ? { name: g.name, color: g.color } : null
}

/** Commits reachable from `upstream` but not from `head`, among the loaded ones (the log of both, newest first). */
export function incomingShas(commits: readonly Commit[], head: string | null, upstream: string | null): Set<string> {
  if (!upstream || upstream === head) return new Set()
  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const reach = (start: string | null): Set<string> => {
    const out = new Set<string>()
    const stack = start ? [start] : []
    while (stack.length) {
      const sha = stack.pop()!
      if (out.has(sha)) continue
      out.add(sha)
      for (const p of bySha.get(sha)?.parents ?? []) if (bySha.has(p)) stack.push(p)
    }
    return out
  }
  const local = reach(head)
  const incoming = new Set<string>()
  for (const sha of reach(upstream)) if (!local.has(sha) && bySha.has(sha)) incoming.add(sha)
  return incoming
}

/** The badges of a project in the switcher: behind/ahead, uncommitted changes, conflicts. */
export interface ProjectBadges {
  behind: number
  ahead: number
  changes: number
  conflicts: number
}

export function badgesOf(status: WorkingStatus): ProjectBadges {
  return { behind: status.behind, ahead: status.ahead, changes: status.staged.length + status.unstaged.length, conflicts: status.conflicted.length }
}

/** Short age for the graph's date column: "now", "5 min", "3 h", "yesterday", "4 d", "3 w", "Oct 2025". */
export function shortAge(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor(now / 1000) - ts)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  const days = Math.floor(s / 86400)
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} d`
  if (days < 60) return `${Math.floor(days / 7)} w`
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

/** "fetched 2 min ago" for the footer. */
export function fetchedLabel(at: number | undefined, now = Date.now()): string {
  if (!at) return 'not fetched yet'
  const age = shortAge(Math.floor(at / 1000), now)
  return age === 'now' ? 'fetched just now' : age === 'yesterday' ? 'fetched yesterday' : `fetched ${age} ago`
}
