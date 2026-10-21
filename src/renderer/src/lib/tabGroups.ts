// Tab groups (Chrome style): named, coloured sets of repositories shown together in the tab bar, e.g. a
// project's api, app and landing. Groups are saved in settings.tabGroups and outlive their tabs, so a
// whole project can be reopened at once. Pure helpers (no store or DOM) so they can be unit-tested.

import { TAB_GROUP_COLORS, type TabGroup, type TabGroupColor } from '@shared/types'

export interface PathLike {
  path: string
}

export function groupOf(groups: readonly TabGroup[], path: string): TabGroup | undefined {
  return groups.find((g) => g.repos.includes(path))
}

/**
 * Tabs reordered so that each group's open tabs are contiguous, at the position of the group's first
 * tab (stable otherwise). Returns the same array when nothing moves.
 */
export function arrangeTabs<T extends PathLike>(tabs: readonly T[], groups: readonly TabGroup[]): T[] {
  const out: T[] = []
  const placed = new Set<string>()
  for (const t of tabs) {
    if (placed.has(t.path)) continue
    const g = groupOf(groups, t.path)
    const run = g ? tabs.filter((x) => groupOf(groups, x.path) === g) : [t]
    for (const x of run) {
      out.push(x)
      placed.add(x.path)
    }
  }
  return out.every((t, i) => t === tabs[i]) ? (tabs as T[]) : out
}

/** Each group's repositories reordered to follow the tab order (closed ones keep their place after them). */
export function syncGroupOrder(groups: readonly TabGroup[], tabs: readonly PathLike[]): TabGroup[] {
  return groups.map((g) => {
    const open = tabs.map((t) => t.path).filter((p) => g.repos.includes(p))
    const repos = [...open, ...g.repos.filter((p) => !open.includes(p))]
    return repos.every((p, i) => p === g.repos[i]) ? g : { ...g, repos }
  })
}

export type TabSegment<T> = { kind: 'tab'; tab: T; index: number } | { kind: 'group'; group: TabGroup; tabs: { tab: T; index: number }[] }

/** Render plan for the tab bar: ungrouped tabs and group runs, in order (tabs must be arranged). */
export function tabSegments<T extends PathLike>(tabs: readonly T[], groups: readonly TabGroup[]): TabSegment<T>[] {
  const out: TabSegment<T>[] = []
  tabs.forEach((tab, index) => {
    const g = groupOf(groups, tab.path)
    const last = out[out.length - 1]
    if (!g) out.push({ kind: 'tab', tab, index })
    else if (last?.kind === 'group' && last.group.id === g.id) last.tabs.push({ tab, index })
    else out.push({ kind: 'group', group: g, tabs: [{ tab, index }] })
  })
  return out
}

/**
 * Where a dragged tab lands when dropped on the left (`after` false) or right half of tab `over`, and
 * which group it ends up in. Dropping inside a group joins it; on a group's outer edge it lands just
 * outside the group (unless the tab already belongs to it: then it is only reordered); next to an
 * ungrouped tab it leaves any group. A collapsed group shows only its active tab, whose edges are then
 * the group's edges. `to` uses splice semantics (remove `from`, insert at `to`).
 */
export function dropPlacement(
  tabs: readonly PathLike[],
  groups: readonly TabGroup[],
  from: number,
  over: number,
  after: boolean,
  activePath: string | null = null
): { to: number; groupId: string | null } {
  const splice = (insertion: number) => (insertion > from ? insertion - 1 : insertion)
  const to = splice(over + (after ? 1 : 0))
  const dragged = tabs[from]
  const target = tabs[over]
  const g = target ? groupOf(groups, target.path) : undefined
  if (!dragged || !g) return { to, groupId: null }
  if (groupOf(groups, dragged.path)?.id === g.id) return { to, groupId: g.id }
  const members = tabs.map((t, i) => (groupOf(groups, t.path)?.id === g.id ? i : -1)).filter((i) => i >= 0)
  const visible = g.collapsed ? members.filter((i) => tabs[i].path === activePath) : members
  const onEdge = (!after && over === visible[0]) || (after && over === visible[visible.length - 1])
  if (!onEdge) return { to, groupId: g.id }
  // Outside the whole run, hidden members included.
  return { to: splice(after ? members[members.length - 1] + 1 : members[0]), groupId: null }
}

/** Groups with `path` moved into group `groupId` (null: out of any group); groups left empty are dropped. */
export function withMembership(groups: readonly TabGroup[], path: string, groupId: string | null): TabGroup[] {
  return groups
    .map((g) => {
      const has = g.repos.includes(path)
      if (g.id === groupId) return has ? g : { ...g, repos: [...g.repos, path] }
      return has ? { ...g, repos: g.repos.filter((p) => p !== path) } : g
    })
    .filter((g) => g.repos.length > 0)
}

/** Colour for a new group: the first one not in use (then cycling). */
export function nextGroupColor(groups: readonly TabGroup[]): TabGroupColor {
  const used = new Set(groups.map((g) => g.color))
  return TAB_GROUP_COLORS.find((c) => c !== 'mist' && !used.has(c)) ?? TAB_GROUP_COLORS[groups.length % (TAB_GROUP_COLORS.length - 1)]
}

export function newGroupId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Parent folder of a path ('' for a root-level path). */
export function parentFolder(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return i > 0 ? trimmed.slice(0, i) : ''
}

export function folderName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
}

/**
 * Open, ungrouped repositories that share `path`'s parent folder (path included): a candidate group
 * named after that folder, or null when fewer than two (or the folder is the home or root folder).
 */
export function groupSuggestion(
  tabs: readonly PathLike[],
  groups: readonly TabGroup[],
  path: string,
  homeDir: string | null
): { folder: string; name: string; paths: string[] } | null {
  const folder = parentFolder(path)
  if (!folder || folder === homeDir?.replace(/[\\/]+$/, '') || groupOf(groups, path)) return null
  const paths = tabs.map((t) => t.path).filter((p) => parentFolder(p) === folder && !groupOf(groups, p))
  if (paths.length < 2 || !paths.includes(path)) return null
  return { folder, name: folderName(folder), paths }
}

/** The saved group whose repositories all live directly in `folder` (e.g. opening that folder again). */
export function groupForFolder(groups: readonly TabGroup[], folder: string): TabGroup | undefined {
  const f = folder.replace(/[\\/]+$/, '')
  return groups.find((g) => g.repos.length > 0 && g.repos.every((p) => parentFolder(p) === f))
}
