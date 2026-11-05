// Reviewing pull requests in Adar: what GitHub's answers become, what the renderer may ask for, the review's
// calls against a fake GitHub (the token only goes to its API), and preparePullReview against real repositories
// ("github.com" rewritten to a bare repository on disk with url.<path>.insteadOf).

import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isBaseMerge, activityOf, parsePullNotice, parseReviewAction, rangeDiffChanged, rangeDiffSame, reviewFromQuery } from '@shared/review'
import { pullsFromQuery } from '@shared/hosting'
import type { PlatformAdapter } from '../platform'
import { createGitContext } from '../git/context'
import { cleanupTmp, commitFile, git, head, initRepo, isolateGitConfig, tmpDir, write } from '../git/write/__tests__/helpers'
import { SettingsStore } from '../system/settings'
import type { SecretBox } from './auth'
import { createHostingOps } from './index'

const TOKEN = 'ghp_' + 'a'.repeat(36)
const sha = (c: string) => c.repeat(40)
const box: SecretBox = {
  available: () => true,
  encrypt: (t) => Buffer.from([...Buffer.from(t)].reverse()),
  decrypt: (b) => Buffer.from([...b].reverse()).toString()
}

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

const reviewAnswer = {
  viewer: { login: 'mikel' },
  repository: {
    pullRequest: {
      id: 'PR_42',
      number: 42,
      title: 'Workspaces',
      body: 'A dashboard per tab group',
      headRefOid: sha('b'),
      baseRefOid: sha('a'),
      author: { login: 'ane' },
      files: {
        nodes: [
          { path: 'src/a.ts', viewerViewedState: 'VIEWED' },
          { path: 'src/b.ts', viewerViewedState: 'DISMISSED' },
          { path: 'README.md', viewerViewedState: 'UNVIEWED' },
          { path: '../etc/passwd', viewerViewedState: 'VIEWED' }
        ]
      },
      reviewThreads: {
        nodes: [
          {
            id: 'T1',
            path: 'src/a.ts',
            line: 12,
            startLine: 10,
            originalLine: 9,
            diffSide: 'RIGHT',
            isResolved: false,
            isOutdated: false,
            viewerCanResolve: true,
            viewerCanUnresolve: false,
            viewerCanReply: true,
            comments: {
              nodes: [
                { databaseId: 101, author: { login: 'mikel' }, body: 'Ask git once', createdAt: '2026-11-02T10:00:00Z', viewerDidAuthor: true, state: 'SUBMITTED' },
                { databaseId: 102, author: { login: 'ane' }, body: 'Done in 3f2a91c', createdAt: '2026-11-03T08:00:00Z', viewerDidAuthor: false, state: 'SUBMITTED' }
              ]
            }
          },
          {
            id: 'T2',
            path: 'src/b.ts',
            line: null,
            originalLine: 4,
            diffSide: 'LEFT',
            isResolved: true,
            isOutdated: true,
            viewerCanResolve: false,
            viewerCanUnresolve: true,
            comments: { nodes: [{ databaseId: 103, author: { login: 'jon' }, body: 'Old', createdAt: '2026-11-01T08:00:00Z', state: 'SUBMITTED' }] }
          },
          // Only a pending comment of a review started on the website: not shown.
          { id: 'T3', path: 'src/a.ts', line: 3, diffSide: 'RIGHT', comments: { nodes: [{ databaseId: 104, author: { login: 'mikel' }, body: 'draft', state: 'PENDING' }] } }
        ]
      },
      reviews: {
        nodes: [
          { id: 'R1', author: { login: 'jon' }, state: 'APPROVED', body: '', submittedAt: '2026-11-02T09:00:00Z', commit: { oid: sha('c') }, comments: { totalCount: 0 } },
          { id: 'R2', author: { login: 'mikel' }, state: 'CHANGES_REQUESTED', body: 'Two things', submittedAt: '2026-11-02T10:00:00Z', commit: { oid: sha('c') }, comments: { totalCount: 1 } },
          { id: 'R3', author: { login: 'jon' }, state: 'COMMENTED', body: 'nit', submittedAt: '2026-11-02T11:00:00Z', commit: { oid: sha('c') }, comments: { totalCount: 1 } },
          { id: 'R4', author: { login: 'mikel' }, state: 'PENDING', body: '', commit: { oid: sha('b') } }
        ]
      },
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'mikel' } }, { requestedReviewer: { __typename: 'Team', name: 'web' } }] },
      comments: { nodes: [{ databaseId: 201, author: { login: 'ane' }, body: 'Ready again', createdAt: '2026-11-03T08:05:00Z', viewerDidAuthor: false }] },
      timelineItems: {
        nodes: [
          { __typename: 'PullRequestCommit', commit: { oid: sha('c'), messageHeadline: 'First', committedDate: '2026-11-01T08:00:00Z', author: { name: 'Ane', user: { login: 'ane' } } } },
          { __typename: 'PullRequestCommit', commit: { oid: sha('d'), messageHeadline: 'Second', committedDate: '2026-11-03T07:00:00Z', author: { name: 'Ane', user: { login: 'ane' } } } },
          { __typename: 'PullRequestCommit', commit: { oid: sha('b'), messageHeadline: 'Third', committedDate: '2026-11-03T07:30:00Z', author: { name: 'Ane', user: { login: 'ane' } } } },
          { __typename: 'HeadRefForcePushedEvent', createdAt: '2026-11-03T07:40:00Z', actor: { login: 'ane' }, beforeCommit: { oid: sha('d') }, afterCommit: { oid: sha('b') } },
          { __typename: 'ReviewRequestedEvent', createdAt: '2026-11-03T08:00:00Z', actor: { login: 'ane' }, requestedReviewer: { __typename: 'User', login: 'mikel' } },
          { __typename: 'PullRequestCommit', commit: { oid: 'not-a-sha' } }
        ]
      }
    }
  }
}

describe('What GitHub says about a review', () => {
  it('maps threads, reviews, reviewers, the conversation and the timeline', () => {
    const r = reviewFromQuery(reviewAnswer)!
    expect(r.nodeId).toBe('PR_42')
    expect(r.viewed).toEqual({ 'src/a.ts': 'viewed', 'src/b.ts': 'changed', 'README.md': 'unviewed' })
    expect(r.threads.map((t) => [t.id, t.side, t.line, t.startLine, t.outdated, t.resolved, t.canResolve, t.comments.length])).toEqual([
      ['T1', 'RIGHT', 12, 10, false, false, true, 2],
      ['T2', 'LEFT', null, null, true, true, true, 1]
    ])
    expect(r.pendingOnService).toEqual({ id: 'R4', comments: 1 })
    expect(r.reviews.map((x) => [x.id, x.verdict])).toEqual([
      ['R1', 'approved'],
      ['R2', 'changes-requested'],
      ['R3', 'commented']
    ])
    // A comment does not undo Jon's approval; asked again, Mikel is "requested".
    expect(r.reviewers).toEqual([
      { login: 'jon', verdict: 'approved' },
      { login: 'mikel', verdict: 'requested' },
      { login: 'web', verdict: 'requested' }
    ])
    expect(r.comments).toEqual([{ id: 201, author: 'ane', body: 'Ready again', createdAt: '2026-11-03T08:05:00Z', viewerDidAuthor: false }])
    // Commits made close together read as one push; days apart, as two.
    expect(r.timeline.map((e) => e.kind)).toEqual(['commits', 'commits', 'force-push', 'review-requested'])
    expect(r.timeline[0]).toMatchObject({ kind: 'commits', author: 'ane', commits: [{ subject: 'First' }] })
    expect(r.timeline[1]).toMatchObject({ kind: 'commits', author: 'ane', at: '2026-11-03T07:30:00Z', commits: [{ subject: 'Second' }, { subject: 'Third' }] })
    expect(reviewFromQuery({ repository: { pullRequest: null } })).toBeNull()
  })

  it('tells the base branch merged in from other merges', () => {
    expect(isBaseMerge("Merge branch 'main' into feat/x", 'main')).toBe(true)
    expect(isBaseMerge("Merge remote-tracking branch 'origin/main' into feat/x", 'main')).toBe(true)
    expect(isBaseMerge("Merge branch 'main' of github.com:acme/widgets into feat/x", 'main')).toBe(true)
    expect(isBaseMerge("Merge branch 'feat/y' into feat/x", 'main')).toBe(false)
    expect(isBaseMerge("Merge branch 'maintenance'", 'main')).toBe(false)
  })

  it('reads the signed-in user’s part from the list', () => {
    const node = {
      viewerLatestReview: { state: 'CHANGES_REQUESTED', submittedAt: '2026-11-02T10:00:00Z', commit: { oid: sha('c') } },
      recent: {
        totalCount: 3,
        nodes: [
          { commit: { oid: sha('c'), committedDate: '2026-11-01T08:00:00Z', messageHeadline: 'First', parents: { totalCount: 1 } } },
          { commit: { oid: sha('d'), committedDate: '2026-11-03T07:00:00Z', messageHeadline: "Merge branch 'main' into feat/x", parents: { totalCount: 2 } } },
          { commit: { oid: sha('b'), committedDate: '2026-11-03T07:30:00Z', messageHeadline: 'Count only visible tabs', parents: { totalCount: 1 } } }
        ]
      },
      talk: { nodes: [{ author: { login: 'Mikel' }, createdAt: '2026-11-02T10:05:00Z' }, { author: { login: 'ane' }, createdAt: '2026-11-03T08:00:00Z' }] },
      said: { nodes: [{ author: { login: 'jon' }, state: 'APPROVED', submittedAt: '2026-11-02T09:00:00Z' }, { author: { login: 'mikel' }, state: 'COMMENTED', submittedAt: '2026-11-02T10:00:00Z' }] }
    }
    const a = activityOf(node, 'mikel', 'main')
    expect(a.viewerReview).toEqual({ commit: sha('c'), at: '2026-11-02T10:00:00Z', verdict: 'changes-requested' })
    expect(a.viewerCommentAt).toBe('2026-11-02T10:05:00Z')
    expect(a.commits.map((c) => c.baseMerge)).toEqual([false, true, false])
    expect(a.moreCommits).toBe(false)
    expect(a.others).toEqual([
      { who: 'jon', at: '2026-11-02T09:00:00Z', kind: 'review', verdict: 'approved' },
      { who: 'ane', at: '2026-11-03T08:00:00Z', kind: 'comment' }
    ])
    // The list query carries it for open pull requests only.
    const list = pullsFromQuery(
      {
        viewer: { login: 'mikel' },
        repository: {
          url: 'https://github.com/acme/widgets',
          open: { nodes: [{ number: 1, url: 'https://github.com/acme/widgets/pull/1', state: 'OPEN', headRefName: 'feat/x', baseRefName: 'main', ...node }] },
          done: { nodes: [{ number: 2, url: 'https://github.com/acme/widgets/pull/2', state: 'MERGED', headRefName: 'feat/y', baseRefName: 'main' }] }
        }
      },
      { owner: 'acme', name: 'widgets', remote: 'origin' }
    )!
    expect(list.pulls[0].activity?.viewerReview?.verdict).toBe('changes-requested')
    expect(list.pulls[1].activity).toBeUndefined()
  })
})

describe('What the renderer may ask for', () => {
  const draft = { path: 'src/a.ts', side: 'RIGHT', line: 12, body: 'Why?' }
  it('takes well-formed actions only', () => {
    expect(parseReviewAction({ kind: 'comment', commit: sha('B'), comment: { ...draft, startLine: 10 } })).toEqual({
      kind: 'comment',
      commit: sha('b'),
      comment: { path: 'src/a.ts', side: 'RIGHT', line: 12, startLine: 10, body: 'Why?' }
    })
    expect(parseReviewAction({ kind: 'submit', commit: sha('b'), event: 'approve', body: '', comments: [] })).not.toBeNull()
    expect(parseReviewAction({ kind: 'reply', threadId: 'PRRT_1', commentId: 101, body: 'ok' })).not.toBeNull()
    expect(parseReviewAction({ kind: 'reply', threadId: 'd'.repeat(40), commentId: 101, body: 'ok' })).not.toBeNull()
    expect(parseReviewAction({ kind: 'resolve', threadId: 'PRRT_kwDOAbc-12', resolved: true })).not.toBeNull()
    for (const bad of [
      null,
      { kind: 'comment', commit: 'HEAD', comment: draft },
      { kind: 'comment', commit: sha('b'), comment: { ...draft, path: '../x' } },
      { kind: 'comment', commit: sha('b'), comment: { ...draft, path: '/etc/passwd' } },
      { kind: 'comment', commit: sha('b'), comment: { ...draft, side: 'MIDDLE' } },
      { kind: 'comment', commit: sha('b'), comment: { ...draft, line: 0 } },
      { kind: 'comment', commit: sha('b'), comment: { ...draft, startLine: 20 } },
      { kind: 'comment', commit: sha('b'), comment: { ...draft, body: '   ' } },
      { kind: 'reply', threadId: 'T1', commentId: -1, body: 'x' },
      { kind: 'reply', commentId: 101, body: 'x' },
      { kind: 'reply', threadId: '../x', commentId: 101, body: 'x' },
      { kind: 'resolve', threadId: 'a b', resolved: true },
      { kind: 'viewed', path: 'a', viewed: 'yes' },
      // Asking for changes needs something said.
      { kind: 'submit', commit: sha('b'), event: 'request-changes', body: ' ', comments: [] },
      { kind: 'submit', commit: sha('b'), event: 'approve', body: '', comments: [{ ...draft, line: -2 }] },
      { kind: 'delete-everything' }
    ]) {
      expect(parseReviewAction(bad)).toBeNull()
    }
  })

  it('cleans notifications', () => {
    expect(parsePullNotice({ number: 42, title: '#42 · 2 new commits', subtitle: 'booking-web\n· Workspaces', body: 'x'.repeat(500), open: 'review' })).toEqual({
      number: 42,
      title: '#42 · 2 new commits',
      subtitle: 'booking-web · Workspaces',
      body: 'x'.repeat(300),
      open: 'review'
    })
    expect(parsePullNotice({ number: 42, title: 'x', open: 'shell' })).toBeNull()
  })

  it('reads git range-diff', () => {
    const same = '1:  6a3ad8e = 1:  1b8a3c9 First\n2:  0d8f1e2 = 2:  9c1e2aa Second\n'
    const changed = '1:  6a3ad8e = 1:  1b8a3c9 First\n2:  0d8f1e2 ! 2:  9c1e2aa Second\n-:  ------- > 3:  77aa001 Third\n'
    expect(rangeDiffSame(same)).toBe(true)
    expect(rangeDiffSame(changed)).toBe(false)
    expect(rangeDiffSame('')).toBe(false)
    expect(rangeDiffChanged(changed)).toBe(2)
  })
})

interface Call {
  method: string
  url: string
  auth: string | null
  body: { query?: string; variables?: Record<string, unknown> } & Record<string, unknown>
}

function setup(answer: (call: Call) => unknown) {
  const userData = tmpDir('adar-review-ud-')
  const calls: Call[] = []
  const notices: unknown[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : {} }
    calls.push(call)
    if (call.method === 'GET' && url === 'https://api.github.com/user') return Response.json({ login: 'mikel' })
    const json = answer(call)
    return json === undefined ? Response.json({ message: 'Not Found' }, { status: 404 }) : Response.json(json)
  }
  const platform: PlatformAdapter = {
    isElectron: false,
    appVersion: 'test',
    userDataDir: userData,
    pickDirectory: async () => null,
    openExternal: async () => undefined,
    showInFolder: async () => undefined,
    notify: (repo, notice) => void notices.push({ repo, notice }),
    fetch: fetchFn,
    secrets: box
  }
  const settings = new SettingsStore(userData)
  const ghCli = { token: async () => null, login: async () => null, forget: () => undefined }
  const ops = createHostingOps(createGitContext(platform, () => undefined), { ready: Promise.resolve(), settings }, { gh: ghCli })
  return { ops, calls, notices }
}

describe('Reviewing on GitHub', () => {
  it('reads the review, posts comments, replies, resolves, marks viewed and submits', async () => {
    let pendingReview: string | null = null
    const { ops, calls, notices } = setup((c) => {
      const q = c.body.query ?? ''
      if (q.includes('AdarReview(')) return { data: reviewAnswer }
      if (q.includes('AdarPending')) return { data: { repository: { pullRequest: { id: 'PR_42', reviews: { nodes: pendingReview ? [{ id: pendingReview }] : [] } } } } }
      if (q.includes('mutation')) return { data: { ok: true } }
      if (c.method === 'POST' && c.url.startsWith('https://api.github.com/repos/acme/widgets/')) return { id: 1 }
      return undefined
    })
    const repo = initRepo()
    commitFile(repo, 'a.txt', 'a\n', 'first')
    git(repo, ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git'])

    await expect(ops.getPullReview(repo, 42)).rejects.toThrow(/off for this repository/)
    await ops.connectGithub('token', TOKEN)
    calls.length = 0

    const review = await ops.getPullReview(repo, 42)
    expect(review.threads).toHaveLength(2)
    expect(calls[0].body.variables).toEqual({ owner: 'acme', name: 'widgets', number: 42 })

    const draft = { path: 'src/a.ts', side: 'RIGHT' as const, line: 12, body: 'Why?' }
    await ops.pullReviewAction(repo, 42, { kind: 'comment', commit: sha('b'), comment: { ...draft, startLine: 10 } })
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/widgets/pulls/42/comments',
      body: { body: 'Why?', commit_id: sha('b'), path: 'src/a.ts', line: 12, side: 'RIGHT', start_line: 10, start_side: 'RIGHT' }
    })
    await ops.pullReviewAction(repo, 42, { kind: 'reply', threadId: 'T1', commentId: 102, body: 'Thanks' })
    expect(calls.at(-1)?.url).toBe('https://api.github.com/repos/acme/widgets/pulls/42/comments/102/replies')
    await ops.pullReviewAction(repo, 42, { kind: 'conversation', body: 'Looks good' })
    expect(calls.at(-1)?.url).toBe('https://api.github.com/repos/acme/widgets/issues/42/comments')
    await ops.pullReviewAction(repo, 42, { kind: 'resolve', threadId: 'T1', resolved: true })
    expect(calls.at(-1)?.body).toMatchObject({ variables: { input: { threadId: 'T1' } } })
    expect(calls.at(-1)?.body.query).toContain('resolveReviewThread')
    await ops.pullReviewAction(repo, 42, { kind: 'viewed', path: 'src/a.ts', viewed: false })
    expect(calls.at(-1)?.body.query).toContain('unmarkFileAsViewed')
    expect(calls.at(-1)?.body.variables).toEqual({ input: { pullRequestId: 'PR_42', path: 'src/a.ts' } })

    // No review started on the website: one review with its comments.
    calls.length = 0
    await ops.pullReviewAction(repo, 42, { kind: 'submit', commit: sha('b'), event: 'request-changes', body: 'Two things', comments: [draft, { ...draft, line: 20 }] })
    expect(calls.map((c) => (c.body.query ?? '').match(/mutation (\w+)|query (\w+)/)?.slice(1).find(Boolean))).toEqual(['AdarPending', 'AdarAddReview'])
    expect(calls[1].body.variables).toEqual({
      input: {
        pullRequestId: 'PR_42',
        commitOID: sha('b'),
        event: 'REQUEST_CHANGES',
        body: 'Two things',
        threads: [
          { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'Why?' },
          { path: 'src/a.ts', line: 20, side: 'RIGHT', body: 'Why?' }
        ]
      }
    })
    // One started there: Adar's comments join it, then it is submitted.
    pendingReview = 'R4'
    calls.length = 0
    await ops.pullReviewAction(repo, 42, { kind: 'submit', commit: sha('b'), event: 'approve', body: '', comments: [draft] })
    expect(calls.map((c) => (c.body.query ?? '').match(/mutation (\w+)|query (\w+)/)?.slice(1).find(Boolean))).toEqual(['AdarPending', 'AdarAddThread', 'AdarSubmitReview'])
    expect(calls[2].body.variables).toEqual({ input: { pullRequestReviewId: 'R4', event: 'APPROVE' } })

    // Nothing is sent for a malformed action; the token only ever went to GitHub's API.
    calls.length = 0
    await expect(ops.pullReviewAction(repo, 42, { kind: 'comment', commit: sha('b'), comment: { ...draft, path: '../../x' } })).rejects.toThrow(/Invalid review action/)
    expect(calls).toEqual([])

    await ops.notifyPullRequest(repo, { number: 42, title: '#42 · 2 new commits', subtitle: 'widgets', body: 'Ane pushed', open: 'review' })
    expect(notices).toEqual([{ repo, notice: { number: 42, title: '#42 · 2 new commits', subtitle: 'widgets', body: 'Ane pushed', open: 'review' } }])
  })

  it('fails a change GitHub refuses', async () => {
    const { ops } = setup((c) => (c.body.query?.includes('AdarPending') ? { data: { repository: { pullRequest: { id: 'PR_42', reviews: { nodes: [] } } } } } : { data: null, errors: [{ message: 'Can not request changes on your own pull request' }] }))
    const repo = initRepo()
    commitFile(repo, 'a.txt', 'a\n', 'first')
    git(repo, ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git'])
    await ops.connectGithub('token', TOKEN)
    await expect(ops.pullReviewAction(repo, 42, { kind: 'submit', commit: sha('b'), event: 'request-changes', body: 'x', comments: [] })).rejects.toThrow(
      /Can not request changes on your own pull request/
    )
  })
})

describe('preparePullReview', () => {
  it('fetches what is missing and says how the pull request moved on since the review', async () => {
    const work = initRepo()
    const base = commitFile(work, 'a.txt', 'a\n', 'first')
    git(work, ['checkout', '-q', '-b', 'feat/x'])
    const reviewed = commitFile(work, 'b.txt', 'b\n', 'Add b')
    const bare = path.join(tmpDir('adar-review-gh-'), 'widgets.git')
    git(work, ['init', '-q', '--bare', bare])
    git(work, ['push', '-q', bare, 'main', 'feat/x'])

    const repo = tmpDir('adar-review-clone-')
    git(repo, ['clone', '-q', bare, '.'])
    git(repo, ['remote', 'set-url', 'origin', 'https://github.com/acme/widgets.git'])
    git(repo, ['config', `url.${bare}.insteadOf`, 'https://github.com/acme/widgets.git'])

    // Two commits pushed after the review: one of them brings main in.
    git(work, ['checkout', '-q', 'main'])
    const mainMoved = commitFile(work, 'm.txt', 'm\n', 'Main moves on')
    git(work, ['checkout', '-q', 'feat/x'])
    git(work, ['merge', '-q', '--no-edit', 'main'])
    const after = commitFile(work, 'b.txt', 'b2\n', 'Change b')
    git(work, ['push', '-q', bare, 'main', 'feat/x'])

    const pull = { number: 5, html_url: 'https://github.com/acme/widgets/pull/5', state: 'open', user: { login: 'ane' }, head: { ref: 'feat/x', sha: after, repo: { full_name: 'acme/widgets' } }, base: { ref: 'main', repo: { full_name: 'acme/widgets' } } }
    const { ops } = setup((c) => (c.method === 'GET' && c.url === 'https://api.github.com/repos/acme/widgets/pulls/5' ? pull : undefined))
    await ops.connectGithub('token', TOKEN)

    const range = await ops.preparePullReview(repo, 5, { head: after, baseRef: 'main', baseSha: mainMoved, since: reviewed })
    // The local main was behind: fetched, so the changes start at main as merged in.
    expect(range).toEqual({ base: mainMoved, head: after, since: reviewed, sinceState: 'ancestor', sinceCommits: 2, onlyMerges: false })
    expect(range.base).not.toBe(base)
    expect(head(repo, 'origin/feat/x')).toBe(after)

    // Only main merged in since.
    git(work, ['checkout', '-q', 'main'])
    commitFile(work, 'm.txt', 'm2\n', 'Main again')
    git(work, ['checkout', '-q', 'feat/x'])
    git(work, ['merge', '-q', '--no-edit', 'main'])
    const merged = head(work)
    git(work, ['push', '-q', bare, 'main', 'feat/x'])
    expect(await ops.preparePullReview(repo, 5, { head: merged, baseRef: 'main', since: after })).toMatchObject({ sinceState: 'ancestor', sinceCommits: 1, onlyMerges: true })

    // Rebased onto the new main with the same changes, then with a change.
    git(work, ['checkout', '-q', '-b', 'rebased', 'main'])
    git(work, ['cherry-pick', reviewed])
    const same = head(work)
    git(work, ['push', '-q', '-f', bare, 'rebased:feat/x'])
    expect(await ops.preparePullReview(repo, 5, { head: same, baseRef: 'main', baseSha: head(work, 'main'), since: reviewed })).toMatchObject({ since: reviewed, sinceState: 'same-changes' })
    write(work, 'b.txt', 'b3\n')
    git(work, ['commit', '-q', '-a', '--amend', '--no-edit'])
    const changed = head(work)
    git(work, ['push', '-q', '-f', bare, 'rebased:feat/x'])
    expect(await ops.preparePullReview(repo, 5, { head: changed, baseRef: 'main', baseSha: head(work, 'main'), since: reviewed })).toMatchObject({ sinceState: 'rewritten', sinceCommits: 1 })

    // A commit nobody has.
    expect(await ops.preparePullReview(repo, 5, { head: changed, baseRef: 'main', since: sha('e') })).toMatchObject({ since: null, sinceState: 'missing' })
    await expect(ops.preparePullReview(repo, 5, { head: 'HEAD', baseRef: 'main' })).rejects.toThrow(/Invalid commit/)
    await expect(ops.preparePullReview(repo, 5, { head: changed, baseRef: '--upload-pack=x' })).rejects.toThrow(/Invalid branch name/)
  })
})
