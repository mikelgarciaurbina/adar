// What changed in a pull request since the user looked (pure): which ones they follow (reviewed or commented on,
// followed with the bell, or theirs), the commit they last reviewed or looked at, the commits and the words of others
// since, and the one line that says it ("2 commits since your review", "Marta replied · 1 commit"). The blue dot,
// the inbox, the left panel, the branch chip and the notifications all read it from here.

import { sameCommit, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import type { ReviewVerdict } from '@shared/review'
import type { AppSettings, PullSeen } from '@shared/types'
import { pluralize } from './format'

/** A pull request wherever it is opened: "github.com/acme/widgets#42". */
export const pullKey = (data: Pick<RepoPullRequests, 'host' | 'owner' | 'name'>, number: number) => `${data.host}/${data.owner}/${data.name}#${number}`

/** Why a pull request is the user's business. */
export type PullRelation = 'requested' | 'following' | 'yours'

export interface PullNews {
  relation: PullRelation | null
  /** The commit the user last reviewed or looked at (null: not known), when, and how. */
  anchor: { sha: string | null; at: string; how: 'review' | 'comment' | 'seen' } | null
  /** Commits after it, merges of the base branch left out; null when not known (rewritten, or too many to list). */
  newCommits: number | null
  /** The branch was rewritten since (a force push). */
  rewritten: boolean
  /** Only the base branch was merged in since. */
  baseMerged: boolean
  /** Others' comments and reviews since the user's last word or look: the last one's author and verdict, and how many. */
  talk: { who: string; count: number; verdict?: ReviewVerdict } | null
  /** Something changed since the user looked: the blue dot. */
  updated: boolean
  /** One line that says what ("2 commits since your review"), or null. */
  label: string | null
}

export interface FollowMarks {
  seen: PullSeen | undefined
  followed: boolean
  unfollowed: boolean
  followParticipated: boolean
}

/** The user's marks for one pull request, from the settings. */
export function marksOf(s: Pick<AppSettings, 'pullsSeen' | 'pullsFollowed' | 'pullsUnfollowed' | 'followParticipated'>, key: string): FollowMarks {
  return { seen: s.pullsSeen[key], followed: s.pullsFollowed.includes(key), unfollowed: s.pullsUnfollowed.includes(key), followParticipated: s.followParticipated }
}

const later = (a: string | null | undefined, b: string | null | undefined) => ((a ?? '') > (b ?? '') ? a : b) || null

const isOpen = (pr: PullRequest) => pr.state === 'open' || pr.state === 'draft'

/** The user took part: reviewed it, or commented on its conversation (as the service reports it). */
export const participated = (pr: PullRequest) => !!pr.activity?.viewerReview || !!pr.activity?.viewerCommentAt

export function relationOf(pr: PullRequest, marks: FollowMarks): PullRelation | null {
  if (!isOpen(pr)) return null
  if (pr.viewerIsAuthor) return 'yours'
  if (pr.reviewRequested) return 'requested'
  if (marks.unfollowed) return null
  if (marks.followed || (marks.followParticipated && participated(pr))) return 'following'
  return null
}

/** Whether the user follows it (the bell): on when followed by hand, or by taking part, and not stopped. */
export const isFollowing = (pr: PullRequest, marks: FollowMarks) => !pr.viewerIsAuthor && !marks.unfollowed && (marks.followed || (marks.followParticipated && participated(pr)))

export function pullNews(pr: PullRequest, marks: FollowMarks): PullNews {
  const relation = relationOf(pr, marks)
  const none: PullNews = { relation, anchor: null, newCommits: null, rewritten: false, baseMerged: false, talk: null, updated: false, label: null }
  if (!relation) return none
  const act = pr.activity ?? null
  const commits = act?.commits ?? []

  // The latest of: the user's last review, their last comment, their last look in Adar.
  const candidates: NonNullable<PullNews['anchor']>[] = []
  if (act?.viewerReview?.at) candidates.push({ sha: act.viewerReview.commit, at: act.viewerReview.at, how: 'review' })
  if (act?.viewerCommentAt) candidates.push({ sha: null, at: act.viewerCommentAt, how: 'comment' })
  if (marks.seen) candidates.push({ sha: marks.seen.head, at: marks.seen.at, how: 'seen' })
  let anchor = candidates.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0] ?? null
  // A comment says when, not on which commit: the last one committed before it.
  if (anchor && !anchor.sha) {
    const before = commits.filter((c) => c.at && c.at <= anchor!.at).at(-1)
    anchor = { ...anchor, sha: before?.sha ?? null }
  }

  let newCommits: number | null = null
  let rewritten = false
  let baseMerged = false
  if (relation !== 'yours' && anchor) {
    if (anchor.sha && sameCommit(anchor.sha, pr.headSha)) newCommits = 0
    else if (anchor.sha) {
      const i = commits.findIndex((c) => sameCommit(c.sha, anchor!.sha))
      if (i >= 0) {
        const after = commits.slice(i + 1)
        newCommits = after.filter((c) => !c.baseMerge).length
        baseMerged = after.length > 0 && newCommits === 0
      } else if (act && !act.moreCommits) rewritten = true
    } else if (act) {
      // Every listed commit is newer than the comment.
      newCommits = commits.filter((c) => !c.baseMerge).length
    }
  }

  // Others' words since the user's own last word, look or (on theirs) push.
  const lastCommitAt = commits.at(-1)?.at ?? null
  const since = later(later(anchor?.at, marks.seen?.at), relation === 'yours' ? later(act?.viewerCommentAt, lastCommitAt) : null)
  const newer = (act?.others ?? []).filter((o) => !since || o.at > since)
  // On a pull request waiting for the user's first review, everything is new: no dot for talk.
  const talk = newer.length && (anchor || relation === 'yours') ? { who: newer.at(-1)!.who, count: newer.length, verdict: newer.filter((o) => o.kind === 'review').at(-1)?.verdict } : null

  // Without the service's activity (GitLab, Bitbucket, Azure DevOps): only Adar's own look.
  const changedHead = !act && !!marks.seen && !sameCommit(marks.seen.head, pr.headSha) && relation !== 'yours'
  const updated = (newCommits ?? 0) > 0 || rewritten || !!talk || changedHead
  return { relation, anchor, newCommits, rewritten, baseMerged, talk, updated, label: newsLabel(pr, relation, anchor, newCommits, rewritten, baseMerged, talk, changedHead) }
}

function newsLabel(
  pr: PullRequest,
  relation: PullRelation,
  anchor: PullNews['anchor'],
  newCommits: number | null,
  rewritten: boolean,
  baseMerged: boolean,
  talk: PullNews['talk'],
  changedHead: boolean
): string | null {
  const since = anchor?.how === 'review' ? 'since your review' : anchor?.how === 'comment' ? 'since your comment' : 'since you looked'
  const commits = newCommits ? pluralize(newCommits, 'commit') : null
  let said: string | null = null
  if (talk) {
    const who = talk.who
    if (talk.verdict === 'changes-requested') said = `${who} requested changes`
    else if (talk.verdict === 'approved') said = `${who} approved`
    // The author answering the user's review or comment.
    else if (relation !== 'yours' && who === pr.author) said = `${who} replied`
    else said = talk.count > 1 ? `${pluralize(talk.count, 'new comment')}` : `${who} commented`
  }
  if (said && commits) return `${said} · ${commits}`
  if (said) return said
  if (commits) return `${commits} ${since}`
  if (rewritten) return `Rewritten ${since}`
  if (changedHead) return 'Changed since you looked'
  if (baseMerged) return `${pr.baseRef} merged in ${since}`
  return null
}
