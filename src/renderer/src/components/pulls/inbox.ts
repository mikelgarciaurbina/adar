// The inbox of pull requests across every open repository (pure): which ones wait for the user's review, which they
// follow and which are theirs, what to say about each, and how many need them (the toolbar's Reviews badge).

import { marksOf, pullKey, pullNews, type PullNews } from '@renderer/lib/following'
import { pluralize } from '@renderer/lib/format'
import { reviewLabel } from '@renderer/lib/pulls'
import type { PullRequest, RepoPullRequests } from '@shared/hosting'
import type { AppSettings } from '@shared/types'

/** One open repository's pull requests, as a tab has them. */
export interface InboxSource {
  repo: string
  name: string
  data: RepoPullRequests
}

export interface InboxRow {
  repo: string
  name: string
  data: RepoPullRequests
  pr: PullRequest
  key: string
  news: PullNews
}

export interface Inbox {
  requested: InboxRow[]
  following: InboxRow[]
  yours: InboxRow[]
  /** Merged in the last week: the user's, or one they followed or looked at. */
  merged: InboxRow[]
  /** Open pull requests of these repositories that are none of the user's business. */
  others: number
}

const WEEK_MS = 7 * 24 * 3600_000

type Marks = Pick<AppSettings, 'pullsSeen' | 'pullsFollowed' | 'pullsUnfollowed' | 'followParticipated'>

/** Changed ones first, then the most recently updated. */
const order = (a: InboxRow, b: InboxRow) => Number(b.news.updated) - Number(a.news.updated) || (a.pr.updatedAt < b.pr.updatedAt ? 1 : a.pr.updatedAt > b.pr.updatedAt ? -1 : 0)

export function buildInbox(sources: readonly InboxSource[], marks: Marks, now = Date.now()): Inbox {
  const inbox: Inbox = { requested: [], following: [], yours: [], merged: [], others: 0 }
  // The same repository open twice (worktrees): once.
  const done = new Set<string>()
  for (const s of sources) {
    const id = `${s.data.host}/${s.data.owner}/${s.data.name}`
    if (done.has(id)) continue
    done.add(id)
    for (const pr of s.data.pulls) {
      const key = pullKey(s.data, pr.number)
      const m = marksOf(marks, key)
      const news = pullNews(pr, m)
      const row: InboxRow = { repo: s.repo, name: s.name, data: s.data, pr, key, news }
      if (pr.state === 'merged') {
        const recent = pr.closedAt && now - Date.parse(pr.closedAt) < WEEK_MS
        if (recent && (pr.viewerIsAuthor || m.followed || !!m.seen)) inbox.merged.push(row)
        continue
      }
      if (pr.state === 'closed') continue
      if (news.relation === 'requested') inbox.requested.push(row)
      else if (news.relation === 'following') inbox.following.push(row)
      else if (news.relation === 'yours') inbox.yours.push(row)
      else inbox.others++
    }
  }
  inbox.requested.sort(order)
  inbox.following.sort(order)
  inbox.yours.sort(order)
  inbox.merged.sort((a, b) => ((a.pr.closedAt ?? '') < (b.pr.closedAt ?? '') ? 1 : -1))
  return inbox
}

/** Pull requests that need the user: waiting for their review, or changed since they looked. */
export function needsYou(inbox: Inbox): number {
  return inbox.requested.length + inbox.following.filter((r) => r.news.updated).length + inbox.yours.filter((r) => r.news.updated).length
}

export type PillTone = 'new' | 'ok' | 'bad' | 'wait' | 'mut'

/** The one thing to know about a row, and its tone. */
export function rowPill(row: InboxRow): { text: string; tone: PillTone } {
  const { pr, news } = row
  if (news.label) return { text: news.label, tone: news.updated ? 'new' : 'mut' }
  if (pr.state === 'draft') return { text: 'Draft', tone: 'mut' }
  if (news.relation === 'requested') return { text: `New · ${pr.commitCount ? pluralize(pr.commitCount, 'commit') : `+${pr.additions} −${pr.deletions}`}`, tone: 'mut' }
  if (news.relation === 'following') {
    const mine = pr.activity?.viewerReview?.verdict
    return { text: mine === 'approved' ? 'You approved · nothing new' : mine === 'changes-requested' ? 'You requested changes · nothing new' : 'Nothing new', tone: 'mut' }
  }
  // Theirs.
  if (pr.checks === 'failed') {
    const failed = pr.checkRuns.find((c) => c.state === 'failed')
    return { text: failed ? `${failed.name} failed` : 'A check failed', tone: 'bad' }
  }
  if (pr.mergeable === 'conflicts') return { text: `Conflicts with ${pr.baseRef}`, tone: 'wait' }
  if (pr.changesRequestedBy.length) return { text: reviewLabel(pr) ?? 'Changes requested', tone: 'wait' }
  if (pr.review === 'approved' && pr.checks !== 'running' && !pr.mergeBlocked) return { text: 'Approved · ready to merge', tone: 'ok' }
  if (pr.reviewRequests.length) return { text: `Waiting for ${pr.reviewRequests.length === 1 ? pr.reviewRequests[0] : pluralize(pr.reviewRequests.length, 'reviewer')}`, tone: 'mut' }
  return { text: reviewLabel(pr) ?? 'Open', tone: 'mut' }
}

/** What the row's button does. */
export function rowAction(row: InboxRow, canMerge: boolean): 'review' | 'merge' | 'open' {
  if (row.news.relation === 'requested' || row.news.relation === 'following') return 'review'
  return canMerge && rowPill(row).tone === 'ok' ? 'merge' : 'open'
}
