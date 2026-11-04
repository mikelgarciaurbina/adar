// Pure helpers for the review view: which files are generated (folded away), which agents co-wrote the commits,
// how the file list groups (changed since the review, already reviewed, generated), where each comment thread
// sits in a diff, what the "since your review" banner says and the conversation's timeline in order.

import type { ConversationComment, PullReviewData, ReviewRange, ReviewSummary, ReviewThread, TimelineEvent } from '@shared/review'
import type { FileChange } from '@shared/types'
import { pluralize } from '@renderer/lib/format'

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'Gemfile.lock',
  'composer.lock',
  'Podfile.lock',
  'pubspec.lock',
  'mix.lock',
  'flake.lock',
  'packages.lock.json'
])

/** Lockfiles, minified bundles, snapshots and build output: folded away until opened. */
export function isGenerated(path: string): boolean {
  const name = path.split('/').pop() ?? path
  if (LOCKFILES.has(name)) return true
  if (/\.(min\.(js|css)|map|snap|pb\.go|g\.dart|generated\.\w+)$/.test(name) || /_pb2\.py$/.test(name)) return true
  return /(^|\/)(dist|build|vendor|node_modules|__generated__|generated)\//.test(path)
}

export { coAuthorAgents } from '@shared/agents'

export interface FileGroups {
  /** In "since" mode: the files changed since the review; else every file that is not generated. */
  changed: FileChange[]
  /** In "since" mode: the other files of the pull request (looked at before). */
  reviewed: FileChange[]
  generated: FileChange[]
}

const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path)

export function fileGroups(all: readonly FileChange[], since: readonly FileChange[] | null): FileGroups {
  const generated = all.filter((f) => isGenerated(f.path)).sort(byPath)
  const real = all.filter((f) => !isGenerated(f.path)).sort(byPath)
  if (!since) return { changed: real, reviewed: [], generated }
  const touched = new Set(since.map((f) => f.path))
  // Files changed since (their counts as of since..head), then the rest as they are in the pull request.
  const changed = since.filter((f) => !isGenerated(f.path)).sort(byPath)
  return { changed, reviewed: real.filter((f) => !touched.has(f.path)), generated }
}

/** The files in the order the list shows them (next / previous file). */
export const fileOrder = (g: FileGroups, showGenerated: boolean) => [...g.changed, ...g.reviewed, ...(showGenerated ? g.generated : [])]

/** "src/app/" for "src/app/main.ts"; '' at the root. */
export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')
export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

export interface FileThreads {
  /** "R:12" (new side, line 12) / "L:4" (old side) → its threads. */
  byLine: Map<string, ReviewThread[]>
  /** Threads that no longer sit on a line of this diff (outdated, or on the old side in "since" mode). */
  elsewhere: ReviewThread[]
}

export const lineSlot = (side: 'LEFT' | 'RIGHT', line: number) => `${side === 'LEFT' ? 'L' : 'R'}:${line}`

/** A file's comment threads by the diff line they belong to (the old side only exists against the base). */
export function threadsOf(threads: readonly ReviewThread[], path: string, againstBase: boolean): FileThreads {
  const byLine = new Map<string, ReviewThread[]>()
  const elsewhere: ReviewThread[] = []
  for (const t of threads) {
    if (t.path !== path) continue
    if (t.outdated || t.line === null || (t.side === 'LEFT' && !againstBase)) {
      elsewhere.push(t)
      continue
    }
    const slot = lineSlot(t.side, t.line)
    byLine.set(slot, [...(byLine.get(slot) ?? []), t])
  }
  return { byLine, elsewhere }
}

/** Comment threads per file (unresolved ones), for the counts in the file list. */
export function threadCounts(threads: readonly ReviewThread[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of threads) if (!t.resolved) out.set(t.path, (out.get(t.path) ?? 0) + 1)
  return out
}

/** What the banner above the diff says in "since" mode. */
export function sinceBanner(range: ReviewRange, how: 'review' | 'comment' | 'seen', when: string, base: string): { text: string; tone: 'new' | 'calm' } {
  const since = how === 'review' ? `your review${when ? ` ${when}` : ''}` : how === 'comment' ? `your comment${when ? ` ${when}` : ''}` : `you last looked${when ? ` ${when}` : ''}`
  switch (range.sinceState) {
    case 'ancestor':
      if (range.onlyMerges) return { text: `Only ${base} was merged in since ${since}: the pull request’s own changes are the same.`, tone: 'calm' }
      return range.sinceCommits
        ? { text: `${pluralize(range.sinceCommits, 'commit')} since ${since}.`, tone: 'new' }
        : { text: `Nothing new since ${since}.`, tone: 'calm' }
    case 'same-changes':
      return { text: `Rebased since ${since}, with the same changes commit by commit.`, tone: 'calm' }
    case 'rewritten':
      return { text: `Rewritten since ${since} (a force push): this compares the version you saw with this one.`, tone: 'new' }
    case 'missing':
      return { text: `The commit of ${since} is gone from the repository and the service: showing all the changes.`, tone: 'calm' }
    default:
      return { text: '', tone: 'calm' }
  }
}

export type ConversationEntry =
  | { kind: 'description'; at: string; author: string; body: string }
  | { kind: 'review'; at: string; review: ReviewSummary }
  | { kind: 'comment'; at: string; comment: ConversationComment }
  | { kind: 'event'; at: string; event: TimelineEvent }

/** The description, reviews, comments and events in the order they happened. */
export function conversation(data: PullReviewData, createdAt: string): ConversationEntry[] {
  const out: ConversationEntry[] = [{ kind: 'description', at: createdAt, author: data.author, body: data.body }]
  for (const r of data.reviews) if (r.verdict !== 'commented' || r.body.trim()) out.push({ kind: 'review', at: r.submittedAt, review: r })
  for (const c of data.comments) out.push({ kind: 'comment', at: c.createdAt, comment: c })
  for (const e of data.timeline) out.push({ kind: 'event', at: e.at, event: e })
  const first = out.shift()!
  return [first, ...out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))]
}
