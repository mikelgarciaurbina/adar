// Pull request notifications: each refresh of a repository's pull requests is compared with the last one of this
// run, and what changed while Adar was not in front becomes a system notification (review asked, commits or a reply
// on one the user follows, a review, a failed check or "ready to merge" on theirs). More than three at once: one.

import { api } from '@renderer/api/client'
import { marksOf, pullKey, pullNews } from '@renderer/lib/following'
import { pullRef } from '@renderer/lib/pulls'
import { useApp } from '@renderer/store/appStore'
import type { PullRequest, RepoPullRequests } from '@shared/hosting'
import type { PullNotice } from '@shared/review'
import { pluralize } from '@renderer/lib/format'

interface Snapshot {
  head: string
  requested: boolean
  talk: number
  failed: boolean
  ready: boolean
}

/** What each pull request looked like at the last refresh of this run. */
const last = new Map<string, Snapshot>()

const readyToMerge = (pr: PullRequest) => pr.review === 'approved' && pr.checks !== 'failed' && pr.checks !== 'running' && pr.mergeable !== 'conflicts' && !pr.mergeBlocked

export interface PendingNotice {
  repo: string
  notice: PullNotice
}

/** The notices one refresh calls for (pure apart from `last`); the first refresh of a repository only records. */
export function noticesFor(repo: string, name: string, data: RepoPullRequests, first: boolean, s = useApp.getState().settings): PendingNotice[] {
  const out: PendingNotice[] = []
  for (const pr of data.pulls) {
    if (pr.state !== 'open' && pr.state !== 'draft') continue
    const key = pullKey(data, pr.number)
    const news = pullNews(pr, marksOf(s, key))
    const now: Snapshot = { head: pr.headSha, requested: pr.reviewRequested, talk: news.talk?.count ?? 0, failed: pr.checks === 'failed', ready: readyToMerge(pr) }
    const before = last.get(key)
    last.set(key, now)
    if (first || !before) continue
    const subtitle = `${name} · ${pr.title}`
    const who = pr.authorName ?? pr.author
    const say = (title: string, body: string, open: PullNotice['open'] = 'review') =>
      out.push({ repo, notice: { number: pr.number, title: `${pullRef(pr)} · ${title}`, subtitle, body, open } })
    if (news.relation === 'requested' && !before.requested && s.notifyReviewRequests) {
      say(news.anchor ? 'your review asked again' : 'review requested', `${who} asked for your review${news.label ? ` · ${news.label}` : ''}`)
    } else if (news.relation === 'following' && s.notifyFollowedPulls && news.updated && (now.head !== before.head || now.talk > before.talk)) {
      const replied = now.talk > before.talk && now.head === before.head
      say(news.label ?? 'changed since you looked', `${who} · ${pr.headRef}`, replied ? 'conversation' : 'review')
    } else if (news.relation === 'yours' && s.notifyOwnPulls) {
      if (now.talk > before.talk && news.label) say(news.label, `On ${pr.headRef}`, 'conversation')
      else if (now.failed && !before.failed) say(`${pr.checkRuns.find((c) => c.state === 'failed')?.name ?? 'a check'} failed`, `On ${pr.headRef}`)
      else if (now.ready && !before.ready) say('ready to merge', `Approved, checks passed · ${pr.headRef} → ${pr.baseRef}`)
    }
  }
  return out
}

/** Several at once become one, which opens the inbox. */
export function bundle(notices: PendingNotice[]): PendingNotice[] {
  if (notices.length <= 3) return notices
  const names = notices.map((n) => `${n.notice.subtitle.split(' · ')[0]} ${n.notice.title.split(' · ')[0]}`)
  return [
    {
      repo: notices[0].repo,
      notice: {
        number: notices[0].notice.number,
        title: `${pluralize(notices.length, 'pull request')} changed`,
        subtitle: 'Pull requests you follow, and yours',
        body: `${names.slice(0, 3).join(', ')} and ${pluralize(notices.length - 3, 'more')}`,
        open: 'inbox'
      }
    }
  ]
}

/** After a refresh of `repo`'s pull requests: notify what changed, while Adar is not in front. */
export function noticePulls(repo: string, data: RepoPullRequests, first: boolean): void {
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  const found = noticesFor(repo, tab?.name ?? data.name, data, first)
  if (!found.length || document.hasFocus()) return
  for (const n of bundle(found)) void api.notifyPullRequest(n.repo, n.notice).catch(() => undefined)
}

/** Tests: forget what was seen. */
export function resetNotices(): void {
  last.clear()
}
