// Pure model for the left panel: turns RefsResult into a section tree (with
// branch names grouped into folders on '/'), then flattens it into the rows
// the virtualised list renders, applying the filter and expand/collapse state.
// No React / DOM here so it can be unit-tested and memoised cheaply.

import { pullRef } from '@renderer/lib/pulls'
import type { PullRequest } from '@shared/hosting'
import type { Ref, RefsResult, RemoteInfo, Stash, Submodule } from '@shared/types'

export type SectionId = 'local' | 'remote' | 'pulls' | 'tags' | 'stashes' | 'submodules'

export const SECTION_ORDER: readonly SectionId[] = ['local', 'remote', 'pulls', 'tags', 'stashes', 'submodules']

export const SECTION_TITLES: Record<SectionId, string> = {
  local: 'Local',
  remote: 'Remote',
  pulls: 'Pull requests',
  tags: 'Tags',
  stashes: 'Stashes',
  submodules: 'Submodules'
}

export const EMPTY_HINTS: Record<SectionId, string> = {
  local: 'No local branches',
  remote: 'No remotes',
  pulls: 'No open pull requests',
  tags: 'No tags',
  stashes: 'No stashes',
  submodules: 'No submodules'
}

// ── Tree nodes ─────────────────────────────────────────────────────────────

export interface RefLeaf {
  kind: 'ref'
  /** Full ref name, unique across the tree. */
  key: string
  /** Last path segment ("x" for "feature/x"). */
  label: string
  ref: Ref
  /** Lower-cased text the filter matches against. */
  search: string
}

/** Pseudo-row at the top of LOCAL for a detached HEAD or an unborn branch. */
export interface HeadLeaf {
  kind: 'head'
  key: string
  label: string
  sha: string | null
  detached: boolean
  search: string
}

export interface StashLeaf {
  kind: 'stash'
  key: string
  label: string
  stash: Stash
  search: string
}

export interface SubmoduleLeaf {
  kind: 'submodule'
  key: string
  label: string
  submodule: Submodule
  search: string
}

/** An open pull request (GitHub). */
export interface PullLeaf {
  kind: 'pull'
  key: string
  label: string
  pull: PullRequest
  search: string
}

/** The row that turns pull requests on (shown while they are off). */
export interface PullPromptLeaf {
  kind: 'pull-prompt'
  key: string
  label: string
  search: string
}

/** What the Pull requests section shows: absent for repositories without a supported remote. */
export type PullsInput = (
  | /** `provider`: who to show them from ("GitHub", "GitLab", "Bitbucket"). */
  { state: 'off'; provider: string }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'on'; pulls: PullRequest[] }
) & {
  /** What the provider calls them ("Merge requests" on GitLab); default "Pull requests". */
  title?: string
}

export interface FolderNode {
  kind: 'folder'
  key: string
  label: string
  /** Folder path inside its namespace ("feature/ui"). */
  path: string
  section: SectionId
  children: TreeNode[]
  /** Number of ref leaves below this folder. */
  leafCount: number
  /** True when the checked-out branch lives below this folder (expanded by default). */
  containsHead: boolean
}

export interface RemoteNode {
  kind: 'remote'
  key: string
  label: string
  name: string
  /** Fetch URL when known (from RepoInfo.remotes). */
  url: string | null
  children: TreeNode[]
  leafCount: number
}

export type LeafNode = RefLeaf | HeadLeaf | StashLeaf | SubmoduleLeaf | PullLeaf | PullPromptLeaf
export type ContainerNode = FolderNode | RemoteNode
export type TreeNode = LeafNode | ContainerNode

export interface Section {
  id: SectionId
  key: string
  title: string
  children: TreeNode[]
  /** Count shown in the header (branches, remote branches, tags...). */
  total: number
  /** Text shown when the section is empty (default: EMPTY_HINTS). */
  hint?: string
}

export const sectionKey = (id: SectionId): string => `s:${id}`
export const remoteKey = (name: string): string => `r:${name}`
export const folderKey = (section: SectionId, path: string): string => `f:${section}:${path}`

// ── Sorting ────────────────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Natural, case-insensitive comparison ("v1.9" < "v1.10"). */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

function sortNodes(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const fa = a.kind === 'folder' ? 0 : 1
    const fb = b.kind === 'folder' ? 0 : 1
    if (fa !== fb) return fa - fb
    return naturalCompare(a.label, b.label)
  })
  for (const n of nodes) if (n.kind === 'folder') sortNodes(n.children)
}

// ── Building ───────────────────────────────────────────────────────────────

function lastSegment(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/**
 * Group refs into folders by '/' in `pathOf(ref)`.
 * `folderPrefix` namespaces folder keys (e.g. "origin/" for remote branches).
 */
export function groupRefs(refs: Ref[], pathOf: (r: Ref) => string, section: SectionId, folderPrefix = ''): TreeNode[] {
  const root: TreeNode[] = []
  const folders = new Map<string, FolderNode>()

  const folderFor = (path: string): FolderNode => {
    let f = folders.get(path)
    if (f) return f
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    f = {
      kind: 'folder',
      key: folderKey(section, folderPrefix + path),
      label: lastSegment(path),
      path,
      section,
      children: [],
      leafCount: 0,
      containsHead: false
    }
    folders.set(path, f)
    ;(parentPath ? folderFor(parentPath).children : root).push(f)
    return f
  }

  for (const ref of refs) {
    const path = pathOf(ref)
    const leaf: RefLeaf = { kind: 'ref', key: ref.fullName, label: lastSegment(path), ref, search: ref.name.toLowerCase() }
    const slash = path.lastIndexOf('/')
    if (slash <= 0 || slash === path.length - 1) {
      root.push(leaf)
      continue
    }
    const dir = path.slice(0, slash)
    folderFor(dir).children.push(leaf)
    // Bubble counts up the folder chain.
    let p: string | null = dir
    while (p) {
      const f = folders.get(p)!
      f.leafCount += 1
      if (ref.isHead) f.containsHead = true
      p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null
    }
  }
  sortNodes(root)
  return root
}

/** Remote name of a remote-tracking ref ("origin" for "origin/main"). */
export function remoteOf(ref: Ref): string {
  if (ref.remote) return ref.remote
  const i = ref.name.indexOf('/')
  return i >= 0 ? ref.name.slice(0, i) : ref.name
}

function branchPathInRemote(ref: Ref): string {
  const remote = remoteOf(ref)
  return ref.name.startsWith(remote + '/') ? ref.name.slice(remote.length + 1) : ref.name
}

function compareRemoteNames(a: string, b: string): number {
  if (a === b) return 0
  if (a === 'origin') return -1
  if (b === 'origin') return 1
  return naturalCompare(a, b)
}

function pullsSection(input: PullsInput): Section {
  const title = input.title ?? SECTION_TITLES.pulls
  const base = { id: 'pulls' as const, key: sectionKey('pulls'), title }
  switch (input.state) {
    case 'off':
      return { ...base, children: [{ kind: 'pull-prompt', key: 'pull-prompt', label: `Show ${title.toLowerCase()} from ${input.provider}…`, search: '' }], total: 0 }
    case 'loading':
      return { ...base, children: [], total: 0, hint: 'Loading…' }
    case 'error':
      return { ...base, children: [], total: 0, hint: input.message }
    case 'on': {
      const children: PullLeaf[] = input.pulls.map((pr) => ({
        kind: 'pull',
        key: `pull:${pr.number}`,
        label: pr.title,
        pull: pr,
        search: `${pullRef(pr)} ${pr.title} ${pr.headRef} ${pr.author} ${pr.authorName ?? ''}`.toLowerCase()
      }))
      return { ...base, children, total: children.length, ...(input.title ? { hint: `No open ${title.toLowerCase()}` } : {}) }
    }
  }
}

export function buildTree(refs: RefsResult, remotes: readonly RemoteInfo[] = [], pulls?: PullsInput): Section[] {
  const sections: Section[] = []

  // LOCAL
  const local = groupRefs(refs.branches, (r) => r.name, 'local')
  const head = refs.head
  if (head.detached && head.sha) {
    local.unshift({
      kind: 'head',
      key: 'head',
      label: `HEAD (detached at ${head.sha.slice(0, 7)})`,
      sha: head.sha,
      detached: true,
      search: `head ${head.sha}`.toLowerCase()
    })
  } else if (head.unborn && head.branch && !refs.branches.some((b) => b.name === head.branch)) {
    local.unshift({
      kind: 'head',
      key: 'head',
      label: `${head.branch} (no commits yet)`,
      sha: null,
      detached: false,
      search: head.branch.toLowerCase()
    })
  }
  sections.push({ id: 'local', key: sectionKey('local'), title: SECTION_TITLES.local, children: local, total: refs.branches.length })

  // REMOTE — one node per remote (configured remotes + any remote seen in refs).
  const byRemote = new Map<string, Ref[]>()
  const urls = new Map<string, string>()
  for (const r of remotes) {
    byRemote.set(r.name, [])
    urls.set(r.name, r.fetchUrl || r.pushUrl || '')
  }
  let remoteTotal = 0
  for (const r of refs.remotes) {
    if (r.isSymbolic) continue
    const name = remoteOf(r)
    let list = byRemote.get(name)
    if (!list) byRemote.set(name, (list = []))
    list.push(r)
    remoteTotal += 1
  }
  const remoteNodes: RemoteNode[] = [...byRemote.keys()].sort(compareRemoteNames).map((name) => {
    const list = byRemote.get(name)!
    return {
      kind: 'remote',
      key: remoteKey(name),
      label: name,
      name,
      url: urls.get(name) || null,
      children: groupRefs(list, branchPathInRemote, 'remote', name + '/'),
      leafCount: list.length
    }
  })
  sections.push({ id: 'remote', key: sectionKey('remote'), title: SECTION_TITLES.remote, children: remoteNodes, total: remoteTotal })

  // PULL REQUESTS — open ones, as GitHub lists them (GitHub remotes only).
  if (pulls) sections.push(pullsSection(pulls))

  // TAGS — flat, natural order.
  const tags: RefLeaf[] = refs.tags
    .map((t) => ({ kind: 'ref' as const, key: t.fullName, label: t.name, ref: t, search: t.name.toLowerCase() }))
    .sort((a, b) => naturalCompare(a.label, b.label))
  sections.push({ id: 'tags', key: sectionKey('tags'), title: SECTION_TITLES.tags, children: tags, total: tags.length })

  // STASHES — newest first (index order).
  const stashes: StashLeaf[] = [...refs.stashes]
    .sort((a, b) => a.index - b.index)
    .map((s) => ({
      kind: 'stash' as const,
      key: `stash:${s.sha}`,
      label: s.message || s.ref,
      stash: s,
      search: `${s.message} ${s.ref} ${s.branch ?? ''}`.toLowerCase()
    }))
  sections.push({ id: 'stashes', key: sectionKey('stashes'), title: SECTION_TITLES.stashes, children: stashes, total: stashes.length })

  // SUBMODULES — only when present.
  if (refs.submodules.length) {
    const subs: SubmoduleLeaf[] = refs.submodules
      .map((s) => ({ kind: 'submodule' as const, key: `sub:${s.path}`, label: s.path, submodule: s, search: `${s.path} ${s.url}`.toLowerCase() }))
      .sort((a, b) => naturalCompare(a.label, b.label))
    sections.push({ id: 'submodules', key: sectionKey('submodules'), title: SECTION_TITLES.submodules, children: subs, total: subs.length })
  }

  return sections
}

// ── Flattening ─────────────────────────────────────────────────────────────

export type Row =
  | { kind: 'section'; key: string; id: SectionId; title: string; count: number; expanded: boolean; depth: 0 }
  | { kind: 'folder'; key: string; node: FolderNode; count: number; expanded: boolean; depth: number }
  | { kind: 'remote'; key: string; node: RemoteNode; count: number; expanded: boolean; depth: number }
  | { kind: 'ref'; key: string; node: RefLeaf; section: SectionId; depth: number }
  | { kind: 'head'; key: string; node: HeadLeaf; depth: number }
  | { kind: 'stash'; key: string; node: StashLeaf; depth: number }
  | { kind: 'submodule'; key: string; node: SubmoduleLeaf; depth: number }
  | { kind: 'pull'; key: string; node: PullLeaf; depth: number }
  | { kind: 'pull-prompt'; key: string; node: PullPromptLeaf; depth: number }
  | { kind: 'hint'; key: string; text: string; depth: number }

export interface FlattenOptions {
  /** Raw filter text (trimmed and lower-cased internally). */
  filter?: string
  /** Sections the user collapsed (ignored while filtering). */
  collapsedSections?: ReadonlySet<SectionId>
  /** Folder/remote keys whose expansion differs from their default. */
  toggled?: ReadonlySet<string>
  /** While filtering: container/section keys the user explicitly collapsed. */
  filterCollapsed?: ReadonlySet<string>
}

const EMPTY_SET: ReadonlySet<string> = new Set()

/** Default expansion: remotes open, folders closed unless they contain the checked-out branch. */
export function defaultExpanded(node: ContainerNode): boolean {
  return node.kind === 'remote' ? true : node.containsHead
}

export function isContainerExpanded(node: ContainerNode, toggled: ReadonlySet<string>): boolean {
  return defaultExpanded(node) !== toggled.has(node.key)
}

export function normalizeFilter(filter: string | undefined): string {
  return (filter ?? '').trim().toLowerCase()
}

interface Ctx {
  q: string
  toggled: ReadonlySet<string>
  filterCollapsed: ReadonlySet<string>
  section: SectionId
}

function emit(nodes: TreeNode[], depth: number, ctx: Ctx, out: Row[]): number {
  let count = 0
  for (const node of nodes) {
    switch (node.kind) {
      case 'folder':
      case 'remote': {
        if (ctx.q) {
          const inner: Row[] = []
          const n = emit(node.children, depth + 1, ctx, inner)
          const nameMatch = node.kind === 'remote' && node.name.toLowerCase().includes(ctx.q)
          if (n === 0 && !nameMatch) break
          const expanded = !ctx.filterCollapsed.has(node.key)
          out.push(containerRow(node, n, expanded, depth))
          if (expanded) for (const r of inner) out.push(r)
          count += n
        } else {
          const expanded = isContainerExpanded(node, ctx.toggled)
          out.push(containerRow(node, node.leafCount, expanded, depth))
          if (expanded) {
            if (node.children.length) emit(node.children, depth + 1, ctx, out)
            else if (node.kind === 'remote') out.push({ kind: 'hint', key: `hint:${node.key}`, text: 'No branches', depth: depth + 1 })
          }
          count += node.leafCount
        }
        break
      }
      case 'ref':
        if (ctx.q && !node.search.includes(ctx.q)) break
        out.push({ kind: 'ref', key: node.key, node, section: ctx.section, depth })
        count += 1
        break
      case 'head':
        if (ctx.q && !node.search.includes(ctx.q)) break
        out.push({ kind: 'head', key: node.key, node, depth })
        // Not counted: it is not a branch.
        break
      case 'stash':
        if (ctx.q && !node.search.includes(ctx.q)) break
        out.push({ kind: 'stash', key: node.key, node, depth })
        count += 1
        break
      case 'submodule':
        if (ctx.q && !node.search.includes(ctx.q)) break
        out.push({ kind: 'submodule', key: node.key, node, depth })
        count += 1
        break
      case 'pull':
        if (ctx.q && !node.search.includes(ctx.q)) break
        out.push({ kind: 'pull', key: node.key, node, depth })
        count += 1
        break
      case 'pull-prompt':
        if (ctx.q) break
        out.push({ kind: 'pull-prompt', key: node.key, node, depth })
        break
    }
  }
  return count
}

function containerRow(node: ContainerNode, count: number, expanded: boolean, depth: number): Row {
  return node.kind === 'folder'
    ? { kind: 'folder', key: node.key, node, count, expanded, depth }
    : { kind: 'remote', key: node.key, node, count, expanded, depth }
}

/** Flatten sections into visible rows. While filtering, empty sections are dropped and matches are auto-expanded. */
export function flattenTree(sections: readonly Section[], opts: FlattenOptions = {}): Row[] {
  const q = normalizeFilter(opts.filter)
  const collapsedSections = opts.collapsedSections ?? (EMPTY_SET as ReadonlySet<SectionId>)
  const toggled = opts.toggled ?? EMPTY_SET
  const filterCollapsed = opts.filterCollapsed ?? EMPTY_SET
  const rows: Row[] = []

  for (const s of sections) {
    const ctx: Ctx = { q, toggled, filterCollapsed, section: s.id }
    if (q) {
      const inner: Row[] = []
      const n = emit(s.children, 1, ctx, inner)
      if (inner.length === 0) continue
      const expanded = !filterCollapsed.has(s.key)
      rows.push({ kind: 'section', key: s.key, id: s.id, title: s.title, count: n, expanded, depth: 0 })
      if (expanded) for (const r of inner) rows.push(r)
    } else {
      const expanded = !collapsedSections.has(s.id)
      rows.push({ kind: 'section', key: s.key, id: s.id, title: s.title, count: s.total, expanded, depth: 0 })
      if (!expanded) continue
      if (s.children.length) emit(s.children, 1, ctx, rows)
      else rows.push({ kind: 'hint', key: `hint:${s.key}`, text: s.hint ?? EMPTY_HINTS[s.id], depth: 1 })
    }
  }
  return rows
}

// ── Queries used by the component ──────────────────────────────────────────

/** All ref leaves below a container (for bulk hide/show). */
export function collectRefs(node: ContainerNode | Section): Ref[] {
  const out: Ref[] = []
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'ref') out.push(n.ref)
      else if (n.kind === 'folder' || n.kind === 'remote') walk(n.children)
    }
  }
  walk(node.children)
  return out
}

/** Every folder/remote below `nodes` (depth-first). */
export function collectContainers(nodes: readonly TreeNode[]): ContainerNode[] {
  const out: ContainerNode[] = []
  const walk = (list: readonly TreeNode[]) => {
    for (const n of list) {
      if (n.kind === 'folder' || n.kind === 'remote') {
        out.push(n)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}

/** Every folder/remote in the given sections (optionally only one section). */
export function collectContainerKeys(sections: readonly Section[], only?: SectionId): ContainerNode[] {
  const out: ContainerNode[] = []
  for (const s of sections) if (!only || s.id === only) out.push(...collectContainers(s.children))
  return out
}

/**
 * Next `toggled` set after forcing `nodes` expanded/collapsed (toggled stores
 * only deviations from each node's default expansion).
 */
export function withExpanded(toggled: ReadonlySet<string>, nodes: readonly ContainerNode[], expanded: boolean): Set<string> {
  const next = new Set(toggled)
  for (const n of nodes) {
    if (defaultExpanded(n) === expanded) next.delete(n.key)
    else next.add(n.key)
  }
  return next
}

/** Rows the keyboard cursor can land on (everything except hints). */
export function isNavigable(row: Row | undefined): boolean {
  return !!row && row.kind !== 'hint'
}

/** Next navigable row index from `from` in direction `dir`, or `from` when there is none. */
export function stepIndex(rows: readonly Row[], from: number, dir: 1 | -1, steps = 1): number {
  const start = Math.max(-1, Math.min(rows.length, from))
  let idx = start
  let found = -1
  let remaining = Math.max(1, steps)
  while (remaining > 0) {
    idx += dir
    if (idx < 0 || idx >= rows.length) break
    if (isNavigable(rows[idx])) {
      found = idx
      remaining -= 1
    }
  }
  if (found >= 0) return found
  // Could not move: stay on a valid row, otherwise jump to the nearest end.
  if (start >= 0 && start < rows.length && isNavigable(rows[start])) return start
  return dir === 1 ? lastNavigable(rows) : firstNavigable(rows)
}

export function firstNavigable(rows: readonly Row[]): number {
  return rows.findIndex(isNavigable)
}

export function lastNavigable(rows: readonly Row[]): number {
  for (let i = rows.length - 1; i >= 0; i--) if (isNavigable(rows[i])) return i
  return -1
}

/** Index of the closest preceding row with a smaller depth (the parent), or -1. */
export function parentIndex(rows: readonly Row[], index: number): number {
  const row = rows[index]
  if (!row) return -1
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < row.depth) return i
  return -1
}

/** First row that is a ref/stash/head leaf (used by Enter in the filter box). */
export function firstLeafIndex(rows: readonly Row[]): number {
  return rows.findIndex((r) => r.kind === 'ref' || r.kind === 'stash' || r.kind === 'head' || r.kind === 'submodule')
}

/** Split `text` around case-insensitive occurrences of `q` for highlighting. */
export function splitMatch(text: string, q: string): Array<{ text: string; match: boolean }> {
  const needle = q.trim().toLowerCase()
  if (!needle) return [{ text, match: false }]
  const hay = text.toLowerCase()
  const out: Array<{ text: string; match: boolean }> = []
  let i = 0
  while (i < text.length) {
    const j = hay.indexOf(needle, i)
    if (j < 0) {
      out.push({ text: text.slice(i), match: false })
      break
    }
    if (j > i) out.push({ text: text.slice(i, j), match: false })
    out.push({ text: text.slice(j, j + needle.length), match: true })
    i = j + needle.length
  }
  return out.length ? out : [{ text, match: false }]
}
