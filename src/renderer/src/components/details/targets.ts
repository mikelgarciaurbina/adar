// Pure helpers about diff targets, commit ordering and change statistics used by
// the right panel.

import type { Commit, DiffTarget, FileChange } from '@shared/types'

/** True when both targets point into the same file list (same kind & revision), ignoring the path. */
export function sameScope(a: DiffTarget, b: DiffTarget): boolean {
  switch (a.kind) {
    case 'unstaged':
    case 'staged':
      return b.kind === a.kind
    case 'commit':
      return b.kind === 'commit' && b.sha === a.sha
    case 'compare':
      return b.kind === 'compare' && b.from === a.from && b.to === a.to
    case 'stash':
      return b.kind === 'stash' && b.index === a.index
  }
}

export function sameTarget(a: DiffTarget | null | undefined, b: DiffTarget | null | undefined): boolean {
  if (!a || !b) return false
  return a.path === b.path && sameScope(a, b)
}

/**
 * Path of the file whose diff is open in `current` when it belongs to the list
 * described by `sample` (any target of that list), else null.
 */
export function activePathIn(current: DiffTarget | null | undefined, sample: DiffTarget): string | null {
  if (!current) return null
  return sameScope(current, sample) ? current.path : null
}

/** Build the targets of a whole list of files (for diff prev/next navigation). */
export function targetsFor(files: readonly FileChange[], make: (f: FileChange) => DiffTarget): DiffTarget[] {
  return files.map(make)
}

/**
 * Order two selected commits as [older, newer] using their position in the
 * graph list (newest first): the one appearing later is the older one.
 * Commits missing from the list are considered older than loaded ones.
 */
export function orderPair(commits: readonly Pick<Commit, 'sha'>[], a: string, b: string): [string, string] {
  const ia = commits.findIndex((c) => c.sha === a)
  const ib = commits.findIndex((c) => c.sha === b)
  const pa = ia < 0 ? Number.POSITIVE_INFINITY : ia
  const pb = ib < 0 ? Number.POSITIVE_INFINITY : ib
  if (pa === pb) return [a, b]
  return pa > pb ? [a, b] : [b, a]
}

/** Sort shas oldest-first (reverse graph order) — the order cherry-pick needs. */
export function oldestFirst(commits: readonly Pick<Commit, 'sha'>[], shas: readonly string[]): string[] {
  const pos = new Map<string, number>()
  commits.forEach((c, i) => pos.set(c.sha, i))
  return [...shas].sort((x, y) => {
    const px = pos.get(x) ?? Number.POSITIVE_INFINITY
    const py = pos.get(y) ?? Number.POSITIVE_INFINITY
    if (px === py) return 0
    return px > py ? -1 : 1
  })
}

export interface StatBlocks {
  add: number
  del: number
  neutral: number
}

/** GitHub-style 5-block bar: how many blocks are green / red / grey for the given counts. */
export function statBlocks(additions: number, deletions: number, blocks = 5): StatBlocks {
  const a = Math.max(0, additions || 0)
  const d = Math.max(0, deletions || 0)
  const total = a + d
  if (total === 0) return { add: 0, del: 0, neutral: blocks }
  // Fewer filled blocks for tiny changes so the bar conveys size as well as ratio.
  const filled = Math.min(blocks, Math.max(1, Math.ceil(Math.log10(total + 1) * (blocks / 3))))
  let add = Math.round((a / total) * filled)
  if (a > 0 && add === 0) add = 1
  if (d > 0 && add === filled) add = filled - 1
  if (add > filled) add = filled
  const del = filled - add
  return { add, del, neutral: blocks - filled }
}

/** Sum of additions/deletions over files (missing counts are treated as 0). */
export function sumStats(files: readonly FileChange[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions ?? 0
    deletions += f.deletions ?? 0
  }
  return { additions, deletions }
}

/**
 * `paths` plus the original path of every renamed entry among them, so
 * staging or unstaging a rename moves both of its index entries.
 */
export function withRenameSources(paths: readonly string[], files: readonly Pick<FileChange, 'path' | 'oldPath' | 'status'>[]): string[] {
  const wanted = new Set(paths)
  const out = [...paths]
  for (const f of files) {
    if (f.status === 'renamed' && f.oldPath && wanted.has(f.path) && !wanted.has(f.oldPath)) {
      wanted.add(f.oldPath)
      out.push(f.oldPath)
    }
  }
  return out
}

/** Unique file count across several lists (a partially staged file counts once). */
export function uniquePathCount(...lists: ReadonlyArray<ReadonlyArray<{ path: string }>>): number {
  const set = new Set<string>()
  for (const list of lists) for (const f of list) set.add(f.path)
  return set.size
}

/** A read-only file list's origin: a commit, a comparison between two revisions, or a stash. */
export type ChangeScope =
  | { kind: 'commit'; sha: string }
  | { kind: 'compare'; from: string; to: string }
  | { kind: 'stash'; index: number; sha: string; baseSha: string }

/** Diff target of `file` within a read-only list. */
export function makeTarget(scope: ChangeScope, file: Pick<FileChange, 'path' | 'oldPath'>): DiffTarget {
  switch (scope.kind) {
    case 'commit':
      return file.oldPath ? { kind: 'commit', sha: scope.sha, path: file.path, oldPath: file.oldPath } : { kind: 'commit', sha: scope.sha, path: file.path }
    case 'compare':
      return file.oldPath
        ? { kind: 'compare', from: scope.from, to: scope.to, path: file.path, oldPath: file.oldPath }
        : { kind: 'compare', from: scope.from, to: scope.to, path: file.path }
    case 'stash':
      return { kind: 'stash', index: scope.index, path: file.path }
  }
}

/** Revision to blame `file` at: the revision containing it (its parent side when the file was deleted). */
export function blameRev(scope: ChangeScope, file: Pick<FileChange, 'status'>): string {
  const deleted = file.status === 'deleted'
  switch (scope.kind) {
    case 'commit':
      return deleted ? `${scope.sha}^` : scope.sha
    case 'compare':
      return deleted ? scope.from : scope.to
    case 'stash':
      return deleted ? scope.baseSha : scope.sha
  }
}
