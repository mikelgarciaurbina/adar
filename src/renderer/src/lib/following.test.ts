import { describe, expect, it } from 'vitest'
import type { PullRequest } from '@shared/hosting'
import type { PullActivity } from '@shared/review'
import { isFollowing, marksOf, pullKey, pullNews, type FollowMarks } from './following'

const sha = (c: string) => c.repeat(40)

function pr(over: Partial<PullRequest> = {}, activity: PullActivity | null = null): PullRequest {
  return {
    provider: 'github',
    number: 42,
    title: 'Workspaces',
    body: '',
    url: 'https://github.com/acme/widgets/pull/42',
    state: 'open',
    author: 'ane',
    authorName: 'Ane',
    headRef: 'ane/workspaces',
    headSha: sha('d'),
    headFork: null,
    baseRef: 'main',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-03T08:00:00Z',
    closedAt: null,
    additions: 1,
    deletions: 1,
    commitCount: 3,
    checks: 'passed',
    checkRuns: [],
    review: 'none',
    approvedBy: [],
    changesRequestedBy: [],
    reviewRequests: [],
    reviewRequested: false,
    mergeable: 'clean',
    mergeBlocked: false,
    viewerIsAuthor: false,
    openTasks: 0,
    ...(activity ? { activity } : {}),
    ...over
  }
}

const commits = [
  { sha: sha('a'), at: '2026-11-01T08:00:00Z', baseMerge: false },
  { sha: sha('b'), at: '2026-11-02T08:00:00Z', baseMerge: false },
  { sha: sha('c'), at: '2026-11-03T07:00:00Z', baseMerge: false },
  { sha: sha('d'), at: '2026-11-03T07:30:00Z', baseMerge: false }
]
const activity = (over: Partial<PullActivity> = {}): PullActivity => ({ viewerReview: null, viewerCommentAt: null, commits, moreCommits: false, others: [], ...over })
const marks = (over: Partial<FollowMarks> = {}): FollowMarks => ({ seen: undefined, followed: false, unfollowed: false, followParticipated: true, ...over })

describe('What changed since the user looked', () => {
  it('counts the commits since their review', () => {
    const n = pullNews(pr({}, activity({ viewerReview: { commit: sha('b'), at: '2026-11-02T09:00:00Z', verdict: 'changes-requested' } })), marks())
    expect(n).toMatchObject({ relation: 'following', newCommits: 2, updated: true, label: '2 commits since your review' })
    expect(n.anchor).toEqual({ sha: sha('b'), at: '2026-11-02T09:00:00Z', how: 'review' })
  })

  it('takes the last commit before a comment, and leaves merges of the base branch out', () => {
    const merged = commits.map((c, i) => (i === 3 ? { ...c, baseMerge: true } : c))
    const n = pullNews(pr({}, activity({ commits: merged, viewerCommentAt: '2026-11-02T10:00:00Z' })), marks())
    expect(n).toMatchObject({ newCommits: 1, label: '1 commit since your comment' })
    const onlyMerge = pullNews(pr({}, activity({ commits: merged, viewerCommentAt: '2026-11-03T07:10:00Z' })), marks())
    expect(onlyMerge).toMatchObject({ newCommits: 0, baseMerged: true, updated: false, label: 'main merged in since your comment' })
  })

  it('says when the branch was rewritten, and who spoke since', () => {
    const rewritten = pullNews(pr({}, activity({ viewerReview: { commit: sha('e'), at: '2026-11-02T09:00:00Z', verdict: 'approved' } })), marks())
    expect(rewritten).toMatchObject({ rewritten: true, updated: true, label: 'Rewritten since your review' })
    const replied = pullNews(
      pr({}, activity({ viewerReview: { commit: sha('c'), at: '2026-11-03T07:05:00Z', verdict: 'commented' }, others: [{ who: 'ane', at: '2026-11-03T08:00:00Z', kind: 'comment' }] })),
      marks()
    )
    expect(replied).toMatchObject({ newCommits: 1, talk: { who: 'ane', count: 1 }, label: 'ane replied · 1 commit' })
  })

  it('looking in Adar counts, and newer looks win', () => {
    const n = pullNews(
      pr({}, activity({ viewerReview: { commit: sha('a'), at: '2026-11-01T09:00:00Z', verdict: 'approved' } })),
      marks({ seen: { head: sha('c'), at: '2026-11-03T07:20:00Z' } })
    )
    expect(n).toMatchObject({ anchor: { how: 'seen', sha: sha('c') }, newCommits: 1, label: '1 commit since you looked' })
    expect(pullNews(pr({}, activity()), marks({ seen: { head: sha('d'), at: '2026-11-03T08:00:00Z' }, followed: true }))).toMatchObject({ updated: false, label: null })
  })

  it('follows only what the user took part in or followed, and never after they stop', () => {
    expect(pullNews(pr({}, activity()), marks()).relation).toBeNull()
    expect(pullNews(pr({}, activity()), marks({ followed: true })).relation).toBe('following')
    const took = pr({}, activity({ viewerCommentAt: '2026-11-02T10:00:00Z' }))
    expect(pullNews(took, marks({ unfollowed: true })).relation).toBeNull()
    expect(pullNews(took, marks({ followParticipated: false })).relation).toBeNull()
    expect(isFollowing(took, marks())).toBe(true)
    expect(pullNews(pr({ state: 'merged' }, activity({ viewerCommentAt: '2026-11-02T10:00:00Z' })), marks()).relation).toBeNull()
  })

  it('waiting for the first review: no dot; theirs: the reviews and comments of others', () => {
    const asked = pullNews(pr({ reviewRequested: true }, activity({ others: [{ who: 'jon', at: '2026-11-03T08:00:00Z', kind: 'comment' }] })), marks())
    expect(asked).toMatchObject({ relation: 'requested', updated: false, label: null })
    const mine = pullNews(
      pr({ viewerIsAuthor: true }, activity({ others: [{ who: 'ane', at: '2026-11-03T08:00:00Z', kind: 'review', verdict: 'changes-requested' }] })),
      marks()
    )
    expect(mine).toMatchObject({ relation: 'yours', updated: true, label: 'ane requested changes' })
    // Before their last push it is old news.
    const old = pullNews(pr({ viewerIsAuthor: true }, activity({ others: [{ who: 'ane', at: '2026-11-03T07:00:00Z', kind: 'comment' }] })), marks())
    expect(old.updated).toBe(false)
  })

  it('elsewhere (no activity from the service): the head moved since Adar showed it', () => {
    const gitlab = pr({ provider: 'gitlab' })
    expect(pullNews(gitlab, marks({ followed: true, seen: { head: sha('c'), at: '2026-11-03T07:00:00Z' } }))).toMatchObject({ updated: true, label: 'Changed since you looked' })
    expect(pullNews(gitlab, marks({ followed: true, seen: { head: sha('d'), at: '2026-11-03T07:00:00Z' } })).updated).toBe(false)
  })

  it('keys and marks', () => {
    expect(pullKey({ host: 'github.com', owner: 'acme', name: 'widgets' }, 42)).toBe('github.com/acme/widgets#42')
    const s = { pullsSeen: { 'github.com/acme/widgets#42': { head: sha('d'), at: 'x' } }, pullsFollowed: ['github.com/acme/widgets#42'], pullsUnfollowed: [], followParticipated: false }
    expect(marksOf(s, 'github.com/acme/widgets#42')).toEqual({ seen: { head: sha('d'), at: 'x' }, followed: true, unfollowed: false, followParticipated: false })
  })
})
