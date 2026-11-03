import { beforeEach, describe, expect, it } from 'vitest'
import type { PullRequest, RepoPullRequests } from '@shared/hosting'
import type { PullActivity } from '@shared/review'
import { DEFAULT_SETTINGS } from '@shared/types'
import { buildInbox, needsYou, rowAction, rowPill } from './inbox'
import { bundle, noticesFor, resetNotices } from './notices'

const sha = (c: string) => c.repeat(40)

function pr(number: number, over: Partial<PullRequest> = {}): PullRequest {
  return {
    provider: 'github',
    number,
    title: `PR ${number}`,
    body: '',
    url: `https://github.com/acme/widgets/pull/${number}`,
    state: 'open',
    author: 'ane',
    authorName: 'Ane',
    headRef: `feat/${number}`,
    headSha: sha('d'),
    headFork: null,
    baseRef: 'main',
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: `2026-11-0${(number % 3) + 1}T08:00:00Z`,
    closedAt: null,
    additions: 1,
    deletions: 1,
    commitCount: 2,
    checks: 'passed',
    checkRuns: [{ name: 'test', state: 'passed', url: null }],
    review: 'none',
    approvedBy: [],
    changesRequestedBy: [],
    reviewRequests: [],
    reviewRequested: false,
    mergeable: 'clean',
    mergeBlocked: false,
    viewerIsAuthor: false,
    openTasks: 0,
    ...over
  }
}

const commits = [
  { sha: sha('c'), at: '2026-11-02T08:00:00Z', baseMerge: false },
  { sha: sha('d'), at: '2026-11-03T08:00:00Z', baseMerge: false }
]
const act = (over: Partial<PullActivity> = {}): PullActivity => ({ viewerReview: null, viewerCommentAt: null, commits, moreCommits: false, others: [], ...over })

function data(pulls: PullRequest[], name = 'widgets'): RepoPullRequests {
  return {
    provider: 'github',
    host: 'github.com',
    owner: 'acme',
    name,
    remote: 'origin',
    webUrl: `https://github.com/acme/${name}`,
    viewer: 'mikel',
    defaultBranch: 'main',
    mergeMethods: ['squash'],
    deleteBranchOnMerge: false,
    canMerge: true,
    reportsConflicts: true,
    mergeChecks: false,
    pulls
  }
}

const marks = { pullsSeen: {}, pullsFollowed: [], pullsUnfollowed: [], followParticipated: true }

describe('The inbox', () => {
  const pulls = [
    pr(1, { reviewRequested: true }),
    pr(2, { activity: act({ viewerReview: { commit: sha('c'), at: '2026-11-02T09:00:00Z', verdict: 'changes-requested' } }) }),
    pr(3, { activity: act({ viewerReview: { commit: sha('d'), at: '2026-11-03T09:00:00Z', verdict: 'approved' } }) }),
    pr(4, { viewerIsAuthor: true, review: 'approved' }),
    pr(5, { viewerIsAuthor: true, checks: 'failed', checkRuns: [{ name: 'test (ubuntu)', state: 'failed', url: null }] }),
    pr(6),
    pr(7, { state: 'merged', viewerIsAuthor: true, closedAt: new Date(Date.now() - 3600_000).toISOString() }),
    pr(8, { state: 'closed' })
  ]

  it('sorts pull requests into waiting, following and yours, changed ones first', () => {
    const inbox = buildInbox([{ repo: '/a', name: 'widgets', data: data(pulls) }, { repo: '/a-wt', name: 'widgets', data: data(pulls) }], marks)
    expect(inbox.requested.map((r) => r.pr.number)).toEqual([1])
    expect(inbox.following.map((r) => r.pr.number)).toEqual([2, 3])
    expect(inbox.following[0].news.label).toBe('1 commit since your review')
    expect(inbox.yours.map((r) => r.pr.number).sort()).toEqual([4, 5])
    expect(inbox.merged.map((r) => r.pr.number)).toEqual([7])
    expect(inbox.others).toBe(1)
    // Waiting for review + changed since looked; the worktree's copy counted once.
    expect(needsYou(inbox)).toBe(2)
  })

  it('says the one thing to know, and the next step', () => {
    const inbox = buildInbox([{ repo: '/a', name: 'widgets', data: data(pulls) }], marks)
    const yours = Object.fromEntries(inbox.yours.map((r) => [r.pr.number, r]))
    expect(rowPill(yours[4])).toEqual({ text: 'Approved · ready to merge', tone: 'ok' })
    expect(rowAction(yours[4], true)).toBe('merge')
    expect(rowAction(yours[4], false)).toBe('open')
    expect(rowPill(yours[5])).toEqual({ text: 'test (ubuntu) failed', tone: 'bad' })
    expect(rowPill(inbox.requested[0])).toEqual({ text: 'New · 2 commits', tone: 'mut' })
    expect(rowPill(inbox.following[1])).toEqual({ text: 'You approved · nothing new', tone: 'mut' })
    expect(rowAction(inbox.following[1], true)).toBe('review')
  })
})

describe('Pull request notifications', () => {
  beforeEach(() => resetNotices())
  const s = { ...DEFAULT_SETTINGS }

  it('says nothing on the first look, then what changed', () => {
    const before = [pr(1), pr(2, { activity: act({ commits: commits.slice(0, 1), viewerReview: { commit: sha('c'), at: '2026-11-02T09:00:00Z', verdict: 'commented' } }), headSha: sha('c') }), pr(4, { viewerIsAuthor: true })]
    expect(noticesFor('/a', 'widgets', data(before), true, s)).toEqual([])
    expect(noticesFor('/a', 'widgets', data(before), false, s)).toEqual([])
    const after = [
      pr(1, { reviewRequested: true }),
      pr(2, { activity: act({ viewerReview: { commit: sha('c'), at: '2026-11-02T09:00:00Z', verdict: 'commented' } }) }),
      pr(4, { viewerIsAuthor: true, checks: 'failed', checkRuns: [{ name: 'lint', state: 'failed', url: null }] })
    ]
    const found = noticesFor('/a', 'widgets', data(after), false, s)
    expect(found.map((n) => [n.notice.title, n.notice.open])).toEqual([
      ['#1 · review requested', 'review'],
      ['#2 · 1 commit since your review', 'review'],
      ['#4 · lint failed', 'review']
    ])
    expect(found[1].notice.subtitle).toBe('widgets · PR 2')
    // Turned off: nothing.
    resetNotices()
    noticesFor('/a', 'widgets', data(before), true, s)
    expect(noticesFor('/a', 'widgets', data(after), false, { ...s, notifyReviewRequests: false, notifyFollowedPulls: false, notifyOwnPulls: false })).toEqual([])
  })

  it('makes one of more than three', () => {
    const n = (i: number) => ({ repo: '/a', notice: { number: i, title: `#${i} · x`, subtitle: `widgets · PR ${i}`, body: '', open: 'review' as const } })
    expect(bundle([n(1), n(2), n(3)])).toHaveLength(3)
    expect(bundle([n(1), n(2), n(3), n(4)])).toEqual([
      { repo: '/a', notice: { number: 1, title: '4 pull requests changed', subtitle: 'Pull requests you follow, and yours', body: 'widgets #1, widgets #2, widgets #3 and 1 more', open: 'inbox' } }
    ])
  })
})
