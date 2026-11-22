// Pure view-model helpers for the commit graph: display rows (WIP / stash pseudo
// rows layered on top of the lane layout), ref pills, WIP counters, selection keys,
// keyboard navigation and ancestry checks. No React, no store — unit tested.

import { remoteBranchName } from '@renderer/lib/refs'
import type { Selection } from '@renderer/store/appStore'
import type { Commit, Ref, RefsResult, Stash, WorkingStatus } from '@shared/types'
import type { Edge, GraphLayout, LayoutRow } from './layout'

// ── Display rows ───────────────────────────────────────────────────────────

/** Colour index used for stash connectors (rendered neutral). */
export const NEUTRAL_COLOR = -1
export const WIP_KEY = 'wip'

export function stashKey(sha: string): string {
  return `stash:${sha}`
}

interface RowBase {
  /** Stable identity: 'wip', 'stash:<sha>' or the commit sha. */
  key: string
  lane: number
  color: number
  edges: readonly Edge[]
}

export interface WipRow extends RowBase {
  kind: 'wip'
}
export interface StashRow extends RowBase {
  kind: 'stash'
  stash: Stash
}
export interface CommitRow extends RowBase {
  kind: 'commit'
  commit: Commit
  isMerge: boolean
}
export type DisplayRow = WipRow | StashRow | CommitRow

export interface DisplayModel {
  rows: DisplayRow[]
  maxLanes: number
  /** row key → display index */
  index: Map<string, number>
}

export interface DisplayInput {
  commits: readonly Commit[]
  layout: GraphLayout
  /** Commit HEAD points at (null when unborn). */
  headSha: string | null
  /** Show the "// WIP" row at the top. */
  showWip: boolean
  /** Stashes to draw (already filtered by settings). */
  stashes: readonly Stash[]
  /** Cache of untouched commit rows so their identity survives rebuilds (memoised rendering). */
  cache?: WeakMap<LayoutRow, CommitRow>
}

function commitRow(lr: LayoutRow, commit: Commit, edges: readonly Edge[] = lr.edges): CommitRow {
  return { kind: 'commit', key: commit.sha, lane: lr.lane, color: lr.color, edges, commit, isMerge: commit.parents.length > 1 }
}

/** Lanes touched anywhere in a row (node, lines, curve endpoints). */
function touchedLanes(row: { lane: number; edges: readonly Edge[] }, into: Set<number>): void {
  into.add(row.lane)
  for (const e of row.edges) {
    into.add(e.from)
    into.add(e.to)
  }
}

/** Lanes with a line arriving at the top of a layout row. */
function topLanesOf(edges: readonly Edge[]): Set<number> {
  const s = new Set<number>()
  for (const e of edges) if (e.type === 'pass' || e.type === 'in') s.add(e.from)
  return s
}

/**
 * Lane for the WIP connector: HEAD's own lane (GitKraken puts the WIP node right
 * above HEAD) unless a commit row between the top and HEAD already uses it, in
 * which case the first lane that is free all the way down to HEAD.
 */
function wipLaneFor(layout: GraphLayout, headIdx: number): number {
  const busy = new Set<number>()
  for (let r = 0; r < headIdx; r++) touchedLanes(layout.rows[r], busy)
  for (const l of topLanesOf(layout.rows[headIdx].edges)) busy.add(l)
  const headLane = layout.rows[headIdx].lane
  if (!busy.has(headLane)) return headLane
  let lane = 0
  while (busy.has(lane)) lane++
  return lane
}

/**
 * Build the rows the graph renders: an optional WIP row on top, stash pseudo-rows
 * right above their base commit and every commit row. WIP / stash connectors are
 * dashed and routed through lanes that are free in the rows they cross, so adding
 * them never re-flows the commit layout. The WIP lane is chosen first (HEAD's lane
 * when possible); stash rows between the WIP row and HEAD branch off to the side.
 */
export function buildDisplayRows(input: DisplayInput): DisplayModel {
  const { commits, layout, headSha, showWip, cache } = input
  const rows: DisplayRow[] = []
  let maxLanes = layout.maxLanes
  const n = Math.min(commits.length, layout.rows.length)

  const stashByBase = new Map<string, Stash[]>()
  for (const s of input.stashes) {
    const list = stashByBase.get(s.baseSha)
    if (list) list.push(s)
    else stashByBase.set(s.baseSha, [s])
  }
  for (const list of stashByBase.values()) list.sort((a, b) => a.index - b.index)

  // HEAD's position among the commits and the WIP connector lane.
  let headCommitIdx = -1
  if (showWip && headSha) {
    for (let i = 0; i < n; i++) {
      if (commits[i].sha === headSha) {
        headCommitIdx = i
        break
      }
    }
  }
  const wipLane = headCommitIdx >= 0 ? wipLaneFor(layout, headCommitIdx) : 0

  if (showWip) rows.push({ kind: 'wip', key: WIP_KEY, lane: wipLane, color: 0, edges: [] })

  let headIndex = -1
  for (let i = 0; i < n; i++) {
    const commit = commits[i]
    const lr = layout.rows[i]
    const group = stashByBase.size ? stashByBase.get(commit.sha) : undefined
    if (group) {
      // Lines crossing the gap above the base commit pass through the stash rows.
      const gap: Edge[] = []
      const used = new Set<number>()
      for (const e of lr.edges) {
        if (e.type === 'pass' || e.type === 'in') {
          gap.push({ type: 'pass', from: e.from, to: e.from, color: e.color, dashed: e.dashed })
          used.add(e.from)
        }
      }
      // Stash rows above (or right on top of) HEAD sit under the WIP connector.
      if (headCommitIdx >= 0 && i <= headCommitIdx) used.add(wipLane)
      // Stashes always branch off to the side (never inline, where they would read
      // as a newer commit of the branch): first free lanes right of the base commit.
      used.add(lr.lane)
      const stashLanes: number[] = []
      let cand = lr.lane + 1
      for (let j = 0; j < group.length; j++) {
        while (used.has(cand)) cand++
        stashLanes.push(cand)
        used.add(cand)
      }
      for (let j = 0; j < group.length; j++) {
        const lane = stashLanes[j]
        const edges: Edge[] = gap.slice()
        for (let k = 0; k < j; k++) edges.push({ type: 'pass', from: stashLanes[k], to: stashLanes[k], color: NEUTRAL_COLOR, dashed: true })
        edges.push({ type: 'out', from: lane, to: lane, color: NEUTRAL_COLOR, dashed: true })
        rows.push({ kind: 'stash', key: stashKey(group[j].sha), lane, color: NEUTRAL_COLOR, edges, stash: group[j] })
        if (lane + 1 > maxLanes) maxLanes = lane + 1
      }
      const edges: Edge[] = lr.edges.slice()
      for (const lane of stashLanes) edges.push({ type: 'in', from: lane, to: lr.lane, color: NEUTRAL_COLOR, dashed: true })
      rows.push(commitRow(lr, commit, edges))
    } else {
      let row = cache?.get(lr)
      if (!row || row.commit !== commit) {
        row = commitRow(lr, commit)
        cache?.set(lr, row)
      }
      rows.push(row)
    }
    if (i === headCommitIdx) headIndex = rows.length - 1
  }

  if (showWip && headIndex > 0) {
    const head = rows[headIndex]
    const lane = wipLane
    const dash = (e: Omit<Edge, 'color' | 'dashed'>): Edge => ({ ...e, color: head.color, dashed: true })
    rows[0] = { kind: 'wip', key: WIP_KEY, lane, color: head.color, edges: [dash({ type: 'out', from: lane, to: lane })] }
    for (let r = 1; r < headIndex; r++) {
      const row = rows[r]
      rows[r] = { ...row, edges: [...row.edges, dash({ type: 'pass', from: lane, to: lane })] } as DisplayRow
    }
    rows[headIndex] = { ...head, edges: [...head.edges, dash({ type: 'in', from: lane, to: head.lane })] } as DisplayRow
    if (lane + 1 > maxLanes) maxLanes = lane + 1
  }

  const index = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) index.set(rows[i].key, i)
  return { rows, maxLanes: Math.max(maxLanes, rows.length ? 1 : 0), index }
}

/**
 * Lanes needed to draw rows `from`..`to` (inclusive, clamped): highest lane any of
 * them touches (node, lines, curve ends) + 1; 0 for an empty range.
 */
/**
 * Colour index of the commit each branch (local or remote) points at, for the branches whose tip is in
 * the graph: the left panel draws its branch dots in these colours.
 */
export function branchTipColors(rows: readonly DisplayRow[], refs: RefsResult | null): Map<string, number> {
  const out = new Map<string, number>()
  if (!refs) return out
  const tips = new Set<string>()
  for (const r of refs.branches) tips.add(r.sha)
  for (const r of refs.remotes) tips.add(r.sha)
  for (const row of rows) if (row.kind === 'commit' && tips.has(row.commit.sha)) out.set(row.commit.sha, row.color)
  return out
}

export function lanesInRange(rows: readonly DisplayRow[], from: number, to: number): number {
  let max = -1
  const end = Math.min(to, rows.length - 1)
  for (let i = Math.max(0, from); i <= end; i++) {
    const r = rows[i]
    if (r.lane > max) max = r.lane
    for (const e of r.edges) {
      if (e.from > max) max = e.from
      if (e.to > max) max = e.to
    }
  }
  return max + 1
}

// ── Selection & navigation ─────────────────────────────────────────────────

export function selectionKey(sel: Selection): string | null {
  switch (sel.kind) {
    case 'wip':
      return WIP_KEY
    case 'commit':
      return sel.sha
    case 'stash':
      return stashKey(sel.sha)
    default:
      return null
  }
}

export function rowSelection(row: DisplayRow): Selection {
  switch (row.kind) {
    case 'wip':
      return { kind: 'wip' }
    case 'stash':
      return { kind: 'stash', index: row.stash.index, sha: row.stash.sha }
    default:
      return { kind: 'commit', sha: row.commit.sha }
  }
}

/** Display index of a selection; falls back to a sha-prefix scan for abbreviated shas. */
export function findSelectionIndex(model: DisplayModel, sel: Selection): number {
  const key = selectionKey(sel)
  if (!key) return -1
  const idx = model.index.get(key)
  if (idx !== undefined) return idx
  if (sel.kind === 'commit' && sel.sha.length >= 4 && sel.sha.length < 40) {
    for (let i = 0; i < model.rows.length; i++) {
      const r = model.rows[i]
      if (r.kind === 'commit' && r.commit.sha.startsWith(sel.sha)) return i
    }
  }
  return -1
}

export type NavKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp'

/** New row index after a navigation key, or null when the key is not a navigation key / nothing to do. */
export function navigate(current: number, key: string, count: number, pageRows: number): number | null {
  if (count <= 0) return null
  const last = count - 1
  const page = Math.max(1, pageRows)
  let next: number
  switch (key) {
    case 'ArrowDown':
      next = current < 0 ? 0 : current + 1
      break
    case 'ArrowUp':
      next = current < 0 ? 0 : current - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = last
      break
    case 'PageDown':
      next = current < 0 ? 0 : current + page
      break
    case 'PageUp':
      next = current < 0 ? 0 : current - page
      break
    default:
      return null
  }
  return Math.max(0, Math.min(last, next))
}

/** First commit row at or after `from` walking in `dir` (±1); -1 when there is none. */
export function nearestCommitRow(rows: readonly DisplayRow[], from: number, dir: 1 | -1): number {
  for (let i = from; i >= 0 && i < rows.length; i += dir) if (rows[i].kind === 'commit') return i
  return -1
}

/** True when `ancestor` is reachable from `descendant` through loaded commits (inclusive). */
export function isAncestor(commits: readonly Commit[], ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true
  const bySha = new Map<string, Commit>()
  for (const c of commits) bySha.set(c.sha, c)
  if (!bySha.has(ancestor)) return false
  const seen = new Set<string>([descendant])
  const stack = [descendant]
  while (stack.length) {
    const sha = stack.pop()!
    const c = bySha.get(sha)
    if (!c) continue
    for (const p of c.parents) {
      if (p === ancestor) return true
      if (!seen.has(p)) {
        seen.add(p)
        stack.push(p)
      }
    }
  }
  return false
}

/** Commits of a multi-selection ordered oldest first (the order to cherry-pick them). */
export function oldestFirst(commits: readonly Commit[], shas: readonly string[]): Commit[] {
  const wanted = new Set(shas)
  const out: Commit[] = []
  for (let i = commits.length - 1; i >= 0; i--) if (wanted.has(commits[i].sha)) out.push(commits[i])
  return out
}

// ── WIP ────────────────────────────────────────────────────────────────────

export interface WipCounts {
  modified: number
  added: number
  deleted: number
  conflicts: number
}

export function hasWorkingChanges(status: WorkingStatus | null | undefined): boolean {
  return !!status && (status.staged.length > 0 || status.unstaged.length > 0 || status.conflicted.length > 0)
}

/** Per-file counters for the WIP row (a file staged and modified again counts once). */
export function wipCounts(status: WorkingStatus | null | undefined): WipCounts {
  const out: WipCounts = { modified: 0, added: 0, deleted: 0, conflicts: 0 }
  if (!status) return out
  const conflicted = new Set(status.conflicted.map((c) => c.path))
  const kinds = new Map<string, 'added' | 'deleted' | 'modified'>()
  const visit = (path: string, st: string) => {
    if (conflicted.has(path) || st === 'conflicted') return
    const kind = st === 'added' || st === 'untracked' ? 'added' : st === 'deleted' ? 'deleted' : 'modified'
    const prev = kinds.get(path)
    if (!prev || prev === 'modified') kinds.set(path, kind)
  }
  for (const f of status.staged) visit(f.path, f.status)
  for (const f of status.unstaged) visit(f.path, f.status)
  for (const k of kinds.values()) out[k] += 1
  out.conflicts = conflicted.size
  return out
}

// ── Ref pills ──────────────────────────────────────────────────────────────

export interface Pill {
  key: string
  kind: 'branch' | 'remote' | 'tag' | 'detached'
  /** Primary ref (the local branch for merged local+remote pills). Synthetic for 'detached'. */
  ref: Ref
  /** Remote branches with the same name at the same commit, merged into a local pill. */
  remotes: Ref[]
  label: string
  isHead: boolean
}

export interface PillOptions {
  hidden: ReadonlySet<string>
  showRemotes: boolean
  showTags: boolean
}

/**
 * Pills per commit sha: checked-out branch first, then local branches (merged with
 * same-named remote branches at the same commit), remote-only branches, then tags.
 */
export function buildPillMap(refs: RefsResult | null, opts: PillOptions): Map<string, Pill[]> {
  const map = new Map<string, Pill[]>()
  if (!refs) return map
  const push = (sha: string, pill: Pill) => {
    const list = map.get(sha)
    if (list) list.push(pill)
    else map.set(sha, [pill])
  }
  const visibleRemotes = opts.showRemotes ? refs.remotes.filter((r) => !r.isSymbolic && !opts.hidden.has(r.fullName)) : []
  const remotesBySha = new Map<string, Ref[]>()
  for (const r of visibleRemotes) {
    const list = remotesBySha.get(r.sha)
    if (list) list.push(r)
    else remotesBySha.set(r.sha, [r])
  }
  const consumed = new Set<string>()

  const locals = refs.branches.filter((b) => !opts.hidden.has(b.fullName))
  locals.sort((a, b) => (a.isHead === b.isHead ? 0 : a.isHead ? -1 : 1))
  if (refs.head.detached && refs.head.sha) {
    const sha = refs.head.sha
    push(sha, {
      key: 'HEAD',
      kind: 'detached',
      ref: { name: 'HEAD', fullName: 'HEAD', type: 'branch', sha, isHead: true },
      remotes: [],
      label: 'HEAD',
      isHead: true
    })
  }
  for (const b of locals) {
    const remotes = (remotesBySha.get(b.sha) ?? []).filter((r) => !consumed.has(r.fullName) && remoteBranchName(r) === b.name)
    // Prefer the configured upstream first in the merged list.
    remotes.sort((x, y) => (x.name === b.upstream ? -1 : y.name === b.upstream ? 1 : 0))
    for (const r of remotes) consumed.add(r.fullName)
    push(b.sha, { key: b.fullName, kind: 'branch', ref: b, remotes, label: b.name, isHead: !!b.isHead })
  }
  for (const r of visibleRemotes) {
    if (consumed.has(r.fullName)) continue
    push(r.sha, { key: r.fullName, kind: 'remote', ref: r, remotes: [], label: r.name, isHead: false })
  }
  if (opts.showTags) {
    for (const t of refs.tags) {
      if (opts.hidden.has(t.fullName)) continue
      push(t.sha, { key: t.fullName, kind: 'tag', ref: t, remotes: [], label: t.name, isHead: false })
    }
  }
  return map
}

/** Tooltip text for a pill. */
export function pillTitle(p: Pill): string {
  switch (p.kind) {
    case 'detached':
      return `HEAD (detached) at ${p.ref.sha.slice(0, 7)}`
    case 'tag':
      return `Tag ${p.ref.name}${p.ref.tagMessage ? ` — ${p.ref.tagMessage}` : ''}`
    case 'remote':
      return `Remote branch ${p.ref.name}`
    default: {
      const parts = [`${p.isHead ? 'Checked out: ' : 'Local branch '}${p.ref.name}`]
      if (p.ref.worktree) parts.push(`checked out in the worktree ${p.ref.worktree}`)
      if (p.remotes.length) parts.push(`also ${p.remotes.map((r) => r.name).join(', ')}`)
      if (p.ref.upstream && !p.remotes.some((r) => r.name === p.ref.upstream)) {
        const ab = [p.ref.ahead ? `${p.ref.ahead} ahead` : '', p.ref.behind ? `${p.ref.behind} behind` : ''].filter(Boolean).join(', ')
        parts.push(`tracking ${p.ref.upstream}${p.ref.upstreamGone ? ' (gone)' : ab ? ` (${ab})` : ''}`)
      }
      return parts.join(' · ')
    }
  }
}

/** Local branches at a commit that are visible (used for double-click checkout). */
export function localBranchesIn(pills: readonly Pill[] | undefined): Ref[] {
  return (pills ?? []).filter((p) => p.kind === 'branch').map((p) => p.ref)
}

/** Literal, case-insensitive highlight ranges of `query` inside `text`. */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const t = text.toLowerCase()
  const out: Array<[number, number]> = []
  let from = 0
  while (from <= t.length - q.length) {
    const i = t.indexOf(q, from)
    if (i < 0) break
    out.push([i, i + q.length])
    from = i + q.length
  }
  return out
}
