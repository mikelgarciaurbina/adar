import { describe, expect, it } from 'vitest'
import { GITHUB_FEATURES, type PullReviewData, type ReviewRange, type ReviewThread } from '@shared/review'
import { coAuthorAgents, conversation, fileGroups, isGenerated, settleReview, sinceBanner, threadCounts, threadsOf } from './model'

const sha = (c: string) => c.repeat(40)

describe('Review view helpers', () => {
  it('folds generated files away', () => {
    for (const p of ['package-lock.json', 'web/yarn.lock', 'go.sum', 'dist/app.js', 'src/api_pb2.py', 'app.min.js', '__snapshots__/a.test.ts.snap']) expect(isGenerated(p)).toBe(true)
    for (const p of ['src/main.ts', 'package.json', 'docs/build.md', 'distance.ts']) expect(isGenerated(p)).toBe(false)
  })

  it('finds the coding agents of Co-Authored-By trailers', () => {
    expect(
      coAuthorAgents([
        'Fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
        'More\n\nCo-authored-by: Copilot <175728472+Copilot@users.noreply.github.com>\nCo-authored-by: Ane <ane@example.com>',
        'Claude wrote no trailer here'
      ])
    ).toEqual(['Claude', 'Copilot'])
    expect(coAuthorAgents(['Plain\n\nCo-authored-by: Jon <jon@example.com>'])).toEqual([])
  })

  it('groups files: changed since the review, already reviewed, generated', () => {
    const all = [
      { path: 'src/b.ts', status: 'modified' as const },
      { path: 'src/a.ts', status: 'modified' as const },
      { path: 'package-lock.json', status: 'modified' as const },
      { path: 'README.md', status: 'added' as const }
    ]
    expect(fileGroups(all, null)).toEqual({ changed: [all[3], all[1], all[0]], reviewed: [], generated: [all[2]] })
    const since = [{ path: 'src/b.ts', status: 'modified' as const, additions: 2 }]
    expect(fileGroups(all, since)).toEqual({ changed: since, reviewed: [all[3], all[1]], generated: [all[2]] })
  })

  const thread = (over: Partial<ReviewThread>): ReviewThread => ({
    id: 'T',
    path: 'a.ts',
    side: 'RIGHT',
    line: 3,
    startLine: null,
    originalLine: 3,
    resolved: false,
    outdated: false,
    canResolve: true,
    canReply: true,
    comments: [{ id: 1, author: 'ane', body: 'x', createdAt: '', viewerDidAuthor: false }],
    ...over
  })

  it('puts threads on their lines, the rest aside', () => {
    const threads = [thread({ id: 'R3' }), thread({ id: 'L4', side: 'LEFT', line: 4 }), thread({ id: 'old', outdated: true, line: null }), thread({ id: 'other', path: 'b.ts' })]
    const all = threadsOf(threads, 'a.ts', true)
    expect([...all.byLine.keys()]).toEqual(['R:3', 'L:4'])
    expect(all.elsewhere.map((t) => t.id)).toEqual(['old'])
    // Since the review, the old side is not the base: its threads go aside.
    expect(threadsOf(threads, 'a.ts', false).elsewhere.map((t) => t.id)).toEqual(['L4', 'old'])
    expect(threadCounts([...threads, thread({ id: 'done', resolved: true })])).toEqual(new Map([['a.ts', 3], ['b.ts', 1]]))
  })

  it('says how the pull request moved on since the review', () => {
    const r = (p: Partial<ReviewRange>): ReviewRange => ({ base: sha('a'), head: sha('b'), since: sha('c'), sinceState: 'ancestor', sinceCommits: 2, onlyMerges: false, ...p })
    expect(sinceBanner(r({}), 'review', 'yesterday', 'main')).toEqual({ text: '2 commits since your review yesterday.', tone: 'new' })
    expect(sinceBanner(r({ onlyMerges: true, sinceCommits: 1 }), 'review', '', 'main').text).toBe('Only main was merged in since your review: the pull request’s own changes are the same.')
    expect(sinceBanner(r({ sinceState: 'same-changes' }), 'comment', '', 'main').tone).toBe('calm')
    expect(sinceBanner(r({ sinceState: 'rewritten' }), 'seen', '2 h ago', 'main').text).toContain('Rewritten since you last looked 2 h ago')
  })

  it('orders the conversation', () => {
    const data = {
      author: 'ane',
      body: 'Desc',
      reviews: [
        { id: 'R1', author: 'jon', verdict: 'approved', body: '', submittedAt: '2026-11-02T09:00:00Z', commit: null, comments: 0 },
        { id: 'R2', author: 'jon', verdict: 'commented', body: '', submittedAt: '2026-11-02T09:30:00Z', commit: null, comments: 1 }
      ],
      comments: [{ id: 1, author: 'ane', body: 'hi', createdAt: '2026-11-01T10:00:00Z', viewerDidAuthor: false }],
      timeline: [{ kind: 'ready', at: '2026-11-01T09:00:00Z', actor: 'ane' }]
    } as unknown as PullReviewData
    // A bare line-comment review is left to its threads.
    expect(conversation(data, '2026-11-01T08:00:00Z').map((e) => e.kind)).toEqual(['description', 'event', 'comment', 'review'])
  })
})

describe('The review at its head', () => {
  const thread = (id: string, path: string, writtenOn: string | null, outdated = false): ReviewThread => ({
    id,
    path,
    side: 'RIGHT',
    line: outdated ? null : 12,
    startLine: outdated ? null : 10,
    originalLine: 12,
    resolved: false,
    outdated,
    canResolve: true,
    canReply: true,
    comments: [],
    writtenOn
  })
  const data = (viewed: 'service' | 'adar', threads: ReviewThread[]): PullReviewData => ({
    number: 7,
    nodeId: '7',
    features: { ...GITHUB_FEATURES, viewed },
    viewer: 'mikel',
    title: '',
    body: '',
    author: 'ane',
    headSha: sha('h'),
    baseSha: '',
    viewed: viewed === 'service' ? { 'a.ts': 'viewed' } : {},
    threads,
    reviews: [],
    comments: [],
    timeline: [],
    reviewers: [],
    pendingOnService: null
  })

  it('keeps Adar’s Viewed marks while their file stays the same, asking git once per commit', async () => {
    const asked: string[] = []
    const changed = async (from: string) => {
      asked.push(from)
      return from === sha('g') ? null : new Set(['b.ts', 'old/c.ts'])
    }
    const r = await settleReview(data('adar', []), sha('h'), { 'a.ts': sha('h'), 'b.ts': sha('e'), 'd.ts': sha('e'), 'old/c.ts': sha('e'), 'e.ts': sha('g') }, changed)
    expect(r.viewed).toEqual({ 'a.ts': 'viewed', 'b.ts': 'changed', 'd.ts': 'viewed', 'old/c.ts': 'changed', 'e.ts': 'changed' })
    expect(asked.sort()).toEqual([sha('e'), sha('g')])
    // The service's own marks are left alone.
    expect((await settleReview(data('service', []), sha('h'), { 'b.ts': sha('e') }, changed)).viewed).toEqual({ 'a.ts': 'viewed' })
  })

  it('shows a thread written on an earlier version as outdated once its file changed', async () => {
    const threads = [thread('1', 'a.ts', sha('h').slice(0, 12)), thread('2', 'a.ts', sha('e').slice(0, 12)), thread('3', 'b.ts', sha('e').slice(0, 12)), thread('4', 'c.ts', null), thread('5', 'd.ts', sha('g'))]
    const r = await settleReview(data('service', threads), sha('h'), {}, async (from) => (from === sha('g') ? null : new Set(['b.ts'])))
    expect(r.threads.map((t) => [t.id, t.outdated, t.line])).toEqual([
      ['1', false, 12],
      ['2', false, 12],
      ['3', true, null],
      ['4', false, 12],
      ['5', true, null]
    ])
    const same = data('service', [thread('4', 'c.ts', null)])
    expect(await settleReview(same, sha('h'), {}, async () => null)).toBe(same)
  })
})
