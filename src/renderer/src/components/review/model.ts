// Pure helpers for the review view: which files are generated (folded away), which agents co-wrote the commits,
// how the file list groups (changed since the review, already reviewed, generated), where each comment thread
// sits in a diff, what the "since your review" banner says, the conversation's timeline in order, the review as
// the repository says it is at its head (Adar's own Viewed marks, threads left on lines that changed), and for an
// agent's work: the files changed since the last review, its banner, and the notes as a message for the agent.

import type { ConversationComment, DraftComment, FileViewed, PullReviewData, ReviewRange, ReviewSummary, ReviewThread, TimelineEvent, WorkReviewRange } from '@shared/review'
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

/**
 * The review as the repository says it is at `head`. `changedSince(sha)` gives the files changed between a commit
 * and head (null when that commit is gone: everything may have changed); each commit is asked once.
 * - Adar's own Viewed marks (path → the head it was viewed at), for services that keep none it can read: a file is
 *   "changed" when it changed since.
 * - Threads a service keeps on the lines of the version they were written on (Bitbucket Cloud): outdated once their
 *   file changed since.
 */
export async function settleReview(
  data: PullReviewData,
  head: string,
  marks: Readonly<Record<string, string>>,
  changedSince: (sha: string) => Promise<Set<string> | null>
): Promise<PullReviewData> {
  const asks = new Map<string, Promise<Set<string> | null>>()
  const changed = (sha: string) => {
    if (head.startsWith(sha)) return Promise.resolve(new Set<string>())
    let ask = asks.get(sha)
    if (!ask) asks.set(sha, (ask = changedSince(sha)))
    return ask
  }
  let out = data
  if (data.features.viewed === 'adar') {
    const viewed: Record<string, FileViewed> = {}
    await Promise.all(
      Object.entries(marks).map(async ([path, sha]) => {
        const files = await changed(sha)
        viewed[path] = files && !files.has(path) ? 'viewed' : 'changed'
      })
    )
    out = { ...out, viewed }
  }
  const moved = (t: ReviewThread) => !!t.writtenOn && !t.outdated && !head.startsWith(t.writtenOn)
  if (data.threads.some(moved)) {
    const threads = await Promise.all(
      data.threads.map(async (t) => {
        if (!moved(t)) return t
        const files = await changed(t.writtenOn!)
        return files && !files.has(t.path) ? t : { ...t, outdated: true, line: null, startLine: null }
      })
    )
    out = { ...out, threads }
  }
  return out
}

// ── An agent's work ───────────────────────────────────────────────────────────

/** The files changed since the version reviewed that belong to the work (what the base branch brought in is left out). */
export function workSinceFiles(since: readonly FileChange[], work: readonly FileChange[]): FileChange[] {
  const mine = new Set(work.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))
  return since.filter((f) => mine.has(f.path) || (!!f.oldPath && mine.has(f.oldPath)))
}

/** What the banner above an agent's work says in "since" mode (`changed`: files changed since, in the work). */
export function workSinceBanner(range: WorkReviewRange, changed: number, when: string, base: string): { text: string; tone: 'new' | 'calm' } {
  const since = `your review${when ? ` ${when}` : ''}`
  switch (range.sinceState) {
    case 'missing':
      return { text: `What you reviewed ${when || 'last'} is no longer in the repository: showing all the changes.`, tone: 'calm' }
    case 'rewritten':
      return { text: `The branch was rewritten since ${since} (rebased or amended): this compares the files as you saw them with the files now.`, tone: 'new' }
    case 'ancestor': {
      if (!changed) return { text: `Nothing changed since ${since}.`, tone: 'calm' }
      if (range.onlyMerges) return { text: `Only ${base} was merged in since ${since}.`, tone: 'calm' }
      const how = range.sinceCommits ? ` in ${pluralize(range.sinceCommits, 'commit')}${range.uncommitted ? ' and changes not committed' : ''}` : range.uncommitted ? ', not committed yet' : ''
      return { text: `${pluralize(changed, 'file')} changed since ${since}${how}.`, tone: 'new' }
    }
    default:
      return { text: '', tone: 'calm' }
  }
}

/** Lines of code a note for an agent quotes (the lines it is on); longer selections are cut. */
export const MAX_QUOTE_LINES = 8

export function noteQuote(lines: readonly string[]): string[] {
  return lines.length > MAX_QUOTE_LINES ? [...lines.slice(0, MAX_QUOTE_LINES), '…'] : [...lines]
}

/** A Markdown fence longer than any run of backticks in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/** "line 12", "lines 10–12"; a removed line is numbered as before the changes. */
function noteWhere(n: DraftComment): string {
  const lines = n.startLine && n.startLine < n.line ? `lines ${n.startLine}–${n.line}` : `line ${n.line}`
  return n.side === 'LEFT' ? `removed ${lines} (numbered as before your changes)` : lines
}

/** A note's text with its suggested changes written out for an agent. */
function noteText(body: string): string {
  return body
    .trim()
    .replace(/^```suggestion[^\n]*\n([\s\S]*?)^```[ \t]*$/gm, (_m, code: string) => {
      const fence = fenceFor(code)
      return `Replace those lines with:\n${fence}\n${code}${fence}`
    })
}

/**
 * The notes of a review of an agent's work as one message to paste into the agent's chat: what was reviewed, the
 * summary, then each note in file and line order with the lines it is on.
 */
export function agentPrompt(o: { branch: string | null; baseRef: string | null; notes: readonly DraftComment[]; summary: string }): string {
  const what = `${o.branch ? `your work on ${o.branch}` : 'your changes'}${o.baseRef ? ` (compared with ${o.baseRef.replace(/^origin\//, '')})` : ''}`
  const notes = [...o.notes].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  const out: string[] = [`I reviewed ${what}.`]
  const summary = o.summary.trim()
  if (summary) out.push('', summary)
  if (notes.length) out.push('', notes.length === 1 ? 'Please address this note:' : 'Please address these notes:')
  notes.forEach((n, i) => {
    const head = `${i + 1}. `
    const pad = ' '.repeat(head.length)
    const lines = [`${head}${n.path}, ${noteWhere(n)}:`]
    if (n.quote?.length) {
      const code = n.quote.join('\n')
      const fence = fenceFor(code)
      lines.push(`${pad}${fence}`, ...n.quote.map((l) => `${pad}${l}`), `${pad}${fence}`)
    }
    lines.push(...noteText(n.body).split('\n').map((l) => (l ? `${pad}${l}` : '')))
    out.push('', ...lines)
  })
  return `${out.join('\n')}\n`
}
