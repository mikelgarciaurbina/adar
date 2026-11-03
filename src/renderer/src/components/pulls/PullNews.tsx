// What changed in a pull request since the user looked, where pull requests are listed: the small blue chip of the
// left panel's rows ("● 2" new commits, a reply…) and the hook the chip on branch labels and the details panel use.

import { useMemo } from 'react'
import { GitCommitHorizontal, MessageSquare, Reply } from 'lucide-react'
import { marksOf, pullKey, pullNews, type PullNews } from '@renderer/lib/following'
import { relativeTime } from '@renderer/lib/format'
import { useApp } from '@renderer/store/appStore'
import type { PullRequest } from '@shared/hosting'
import type { Commit } from '@shared/types'
import { usePulls } from './pullStore'

/** What changed in `pr` (a pull request of `repo`) since the user looked; null before the list loads. */
export function usePullNews(repo: string | null, pr: PullRequest | undefined): PullNews | null {
  const data = usePulls((s) => (repo ? (s.repos[repo]?.data ?? null) : null))
  const seen = useApp((s) => s.settings.pullsSeen)
  const followed = useApp((s) => s.settings.pullsFollowed)
  const unfollowed = useApp((s) => s.settings.pullsUnfollowed)
  const followParticipated = useApp((s) => s.settings.followParticipated)
  return useMemo(
    () => (data && pr ? pullNews(pr, marksOf({ pullsSeen: seen, pullsFollowed: followed, pullsUnfollowed: unfollowed, followParticipated }, pullKey(data, pr.number))) : null),
    [data, pr, seen, followed, unfollowed, followParticipated]
  )
}

/** The blue chip of a changed pull request (of `repo`, else the active repository): what is new, counted. */
export function NewsChip({ repo, pr }: { repo?: string; pr: PullRequest }) {
  const active = useApp((s) => s.activePath)
  const news = usePullNews(repo ?? active, pr)
  if (!news?.updated) return null
  const icon = news.newCommits ? (
    <GitCommitHorizontal size={10} strokeWidth={2.5} />
  ) : news.talk ? (
    news.relation !== 'yours' && news.talk.who === pr.author ? (
      <Reply size={10} strokeWidth={2.5} />
    ) : (
      <MessageSquare size={10} strokeWidth={2.5} />
    )
  ) : (
    <GitCommitHorizontal size={10} strokeWidth={2.5} />
  )
  const count = news.newCommits || news.talk?.count || ''
  return (
    <span className="pr-new" title={news.label ?? 'Changed since you looked'} aria-label={news.label ?? 'Changed since you looked'}>
      {icon}
      {count}
    </span>
  )
}

/** A graph row's part in a followed pull request: a commit added since the user looked, or the one they last saw. */
export type ReviewMark = { kind: 'new'; title: string } | { kind: 'seen'; label: string; title: string }

const NO_MARKS: ReadonlyMap<string, ReviewMark> = new Map()

/** The commits of followed pull requests added since the user looked (along the head's first parents), and the one they saw. */
export function useReviewMarks(repo: string, commits: readonly Commit[]): ReadonlyMap<string, ReviewMark> {
  const data = usePulls((s) => s.repos[repo]?.data ?? null)
  const seen = useApp((s) => s.settings.pullsSeen)
  const followed = useApp((s) => s.settings.pullsFollowed)
  const unfollowed = useApp((s) => s.settings.pullsUnfollowed)
  const followParticipated = useApp((s) => s.settings.followParticipated)
  return useMemo(() => {
    if (!data || !commits.length) return NO_MARKS
    const marks = { pullsSeen: seen, pullsFollowed: followed, pullsUnfollowed: unfollowed, followParticipated }
    const bySha = new Map(commits.map((c) => [c.sha, c]))
    const out = new Map<string, ReviewMark>()
    for (const pr of data.pulls) {
      if (pr.state !== 'open' && pr.state !== 'draft') continue
      const news = pullNews(pr, marksOf(marks, pullKey(data, pr.number)))
      const anchor = news.anchor?.sha
      if (!news.relation || news.relation === 'yours' || !anchor || !bySha.has(anchor) || anchor === pr.headSha) continue
      const when = relativeTime(Math.floor(Date.parse(news.anchor!.at) / 1000))
      const what = news.anchor!.how === 'review' ? 'You reviewed' : news.anchor!.how === 'comment' ? 'You commented' : 'You looked'
      out.set(anchor, { kind: 'seen', label: `${what} · ${when}`, title: `#${pr.number} · ${what} at this commit, ${when}` })
      if (!news.updated) continue
      // New since: from the head back along first parents to the commit seen.
      let cur = bySha.get(pr.headSha)
      for (let n = 0; cur && cur.sha !== anchor && n < 500; n++) {
        if (!out.has(cur.sha)) out.set(cur.sha, { kind: 'new', title: `New in #${pr.number} since ${news.label ? news.label.replace(/^\d+ commits? /, '') : 'you looked'}` })
        cur = bySha.get(cur.parents[0])
      }
    }
    return out
  }, [data, commits, seen, followed, unfollowed, followParticipated])
}
