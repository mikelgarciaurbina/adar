// Pure helpers about diff targets: labels, identity, which revisions hold the
// old / new side of a file (for image diffs and blame), and image MIME types.

import type { ContentRev, DiffTarget, FileDiff, WorkingStatus } from '@shared/types'

/** Context requested in full-file mode: enough for git to emit the whole file as one hunk. */
export const FULL_FILE_CONTEXT = 1_000_000

/** "File mode changed from 100644 to 100755" or null. */
export function modeChangeText(diff: Pick<FileDiff, 'oldMode' | 'newMode'>): string | null {
  if (diff.oldMode && diff.newMode && diff.oldMode !== diff.newMode) return `File mode changed from ${diff.oldMode} to ${diff.newMode}`
  return null
}

const isSha = (s: string) => /^[0-9a-f]{7,64}$/i.test(s)

/** Short form of a revision: abbreviated sha, or the ref name as-is. */
export function shortRev(rev: string): string {
  return isSha(rev) ? rev.slice(0, 7) : rev
}

/** "Unstaged changes", "commit abc1234", "abc1234 ↔ def5678", "stash@{0}". */
export function describeTarget(target: DiffTarget): string {
  switch (target.kind) {
    case 'unstaged':
      return 'Unstaged changes'
    case 'staged':
      return 'Staged changes'
    case 'commit':
      return `commit ${shortRev(target.sha)}`
    case 'compare':
      return `${shortRev(target.from)} ↔ ${shortRev(target.to)}`
    case 'stash':
      return `stash@{${target.index}}`
  }
}

/** Same file in the same comparison. */
export function sameTarget(a: DiffTarget, b: DiffTarget): boolean {
  if (a.kind !== b.kind || a.path !== b.path) return false
  switch (a.kind) {
    case 'commit':
      return a.sha === (b as typeof a).sha
    case 'compare':
      return a.from === (b as typeof a).from && a.to === (b as typeof a).to
    case 'stash':
      return a.index === (b as typeof a).index
    default:
      return true
  }
}

/**
 * Whether a centre view (the store's `tab.center`) is still showing `target`.
 * Async work started by a diff view must not navigate once the user has moved on.
 */
export function viewShowsTarget(view: { kind: string; target?: DiffTarget } | null | undefined, target: DiffTarget): boolean {
  return !!view && view.kind === 'diff' && !!view.target && sameTarget(view.target, target)
}

/** Whether a staged / unstaged target still has changes according to `status` (other targets: always). */
export function stillChanged(status: WorkingStatus | null | undefined, t: DiffTarget): boolean {
  if (!status) return true
  if (t.kind === 'unstaged') return status.unstaged.some((f) => f.path === t.path)
  if (t.kind === 'staged') return status.staged.some((f) => f.path === t.path)
  return true
}

/**
 * Where to go once `current` ran out of changes: the next sibling that still has
 * changes, else the closest previous one, else null (back to the graph).
 */
export function nextChangedSibling(
  siblings: readonly DiffTarget[] | undefined,
  current: DiffTarget,
  status: WorkingStatus | null | undefined
): DiffTarget | null {
  const list = siblings ?? []
  const idx = list.findIndex((s) => sameTarget(s, current))
  const ok = (s: DiffTarget) => !sameTarget(s, current) && stillChanged(status, s)
  return list.slice(idx + 1).find(ok) ?? list.slice(0, Math.max(0, idx)).reverse().find(ok) ?? null
}

export interface ContentSource {
  path: string
  rev: ContentRev
  /** Alternative revision tried when the file does not exist at `rev` (untracked files in stashes). */
  fallbackRev?: ContentRev
}

/** Where the old / new versions of the diffed file live. */
export function contentSources(
  target: DiffTarget,
  diff: Pick<FileDiff, 'status' | 'oldPath'>
): { old: ContentSource | null; new: ContentSource | null } {
  const path = target.path
  const oldPath = diff.oldPath ?? ('oldPath' in target && target.oldPath ? target.oldPath : path)
  const isNew = diff.status === 'added' || diff.status === 'untracked'
  const isGone = diff.status === 'deleted'
  let oldRev: ContentRev
  let newRev: ContentRev
  let fallback: ContentRev | undefined
  switch (target.kind) {
    case 'unstaged':
      oldRev = 'INDEX'
      newRev = 'WORKTREE'
      break
    case 'staged':
      oldRev = 'HEAD'
      newRev = 'INDEX'
      break
    case 'commit':
      oldRev = `${target.sha}^`
      newRev = target.sha
      break
    case 'compare':
      oldRev = target.from
      newRev = target.to
      break
    case 'stash':
      oldRev = `stash@{${target.index}}^1`
      newRev = `stash@{${target.index}}`
      // Untracked files of a stash live in its third parent.
      fallback = `stash@{${target.index}}^3`
      break
  }
  return {
    old: isNew ? null : { path: oldPath, rev: oldRev },
    new: isGone ? null : { path, rev: newRev, fallbackRev: fallback }
  }
}

/** Revision for "Blame" from a diff target (undefined = working tree). */
export function blameRev(target: DiffTarget): string | undefined {
  switch (target.kind) {
    case 'commit':
      return target.sha
    case 'compare':
      return target.to
    case 'stash':
      return `stash@{${target.index}}`
    default:
      return undefined
  }
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  apng: 'image/apng',
  heic: 'image/heic'
}

export function imageMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

/** Human file size: "812 B", "14.2 KB", "3.1 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
