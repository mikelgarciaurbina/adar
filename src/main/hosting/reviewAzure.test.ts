// Reviewing Azure DevOps pull requests in Adar: what its threads, votes and iterations become, and the review's
// calls against a fake Azure DevOps (threads on lines with their tracking ids, replies, status, votes, take-backs).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { azureActivity, azureReview } from '@shared/azure'
import type { PlatformAdapter } from '../platform'
import { createGitContext } from '../git/context'
import { cleanupTmp, commitFile, git, initRepo, isolateGitConfig, tmpDir } from '../git/write/__tests__/helpers'
import { SettingsStore } from '../system/settings'
import type { SecretBox } from './auth'
import { createHostingOps } from './index'

const sha = (c: string) => c.repeat(40)
const box: SecretBox = {
  available: () => true,
  encrypt: (t) => Buffer.from([...Buffer.from(t)].reverse()),
  decrypt: (b) => Buffer.from([...b].reverse()).toString()
}

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

const ane = { id: 'u-ane', displayName: 'Ane', uniqueName: 'ane@contoso.com' }
const jon = { id: 'u-jon', displayName: 'Jon', uniqueName: 'jon@contoso.com' }
const me = { id: 'U-ME', displayName: 'Mikel Garcia', uniqueName: 'mikel@contoso.com' }
const viewer = { id: 'u-me', name: 'Mikel Garcia', login: 'mikel@contoso.com' }
const text = (id: number, author: object, content: string, publishedDate: string, extra: object = {}) => ({ id, parentCommentId: 0, author, content, publishedDate, commentType: 'text', ...extra })
const vote = (id: number, author: object, result: number, at: string) => ({
  id,
  status: 'active',
  properties: { CodeReviewThreadType: { $type: 'System.String', $value: 'VoteUpdate' }, CodeReviewVoteResult: { $type: 'System.String', $value: String(result) } },
  comments: [{ id: 1, author, content: `${author === jon ? 'Jon' : 'Mikel'} voted ${result}`, publishedDate: at, commentType: 'system' }]
})

const threads = {
  value: [
    {
      id: 11,
      status: 'active',
      threadContext: { filePath: '/src/a.ts', rightFileStart: { line: 10, offset: 1 }, rightFileEnd: { line: 12, offset: 30 } },
      pullRequestThreadContext: { iterationContext: { firstComparingIteration: 1, secondComparingIteration: 1 }, changeTrackingId: 3 },
      comments: [text(1, jon, 'Ask git once', '2026-11-02T10:00:00Z'), text(2, ane, 'Done', '2026-11-03T08:30:00Z', { parentCommentId: 1 }), text(3, ane, 'gone', '2026-11-03T08:31:00Z', { isDeleted: true })]
    },
    { id: 12, status: 'fixed', threadContext: { filePath: '/src/b.ts', leftFileStart: { line: 4, offset: 1 }, leftFileEnd: { line: 4, offset: 9 } }, comments: [text(1, jon, 'Old', '2026-11-02T09:00:00Z')] },
    { id: 13, status: 'active', comments: [text(1, ane, 'Ready for review', '2026-11-02T08:00:00Z')] },
    { id: 14, status: 'active', threadContext: { filePath: '/../etc/passwd', rightFileStart: { line: 1, offset: 1 } }, comments: [text(1, jon, 'x', '2026-11-02T08:00:00Z')] },
    { id: 15, isDeleted: true, comments: [text(1, jon, 'deleted', '2026-11-02T08:00:00Z')] },
    vote(16, jon, 10, '2026-11-03T09:00:00Z'),
    vote(17, jon, -5, '2026-11-02T12:00:00Z'),
    vote(18, jon, 0, '2026-11-02T13:00:00Z'),
    { id: 19, status: 'active', properties: { CodeReviewThreadType: { $value: 'RefUpdate' } }, comments: [{ id: 1, author: ane, content: 'Ane updated', publishedDate: '2026-11-03T08:00:00Z', commentType: 'system' }] }
  ]
}
const iterations = {
  value: [
    { id: 2, createdDate: '2026-11-03T08:00:00Z', author: ane, sourceRefCommit: { commitId: sha('b') }, commits: [{ commitId: sha('b'), comment: 'Third' }, { commitId: sha('d'), comment: 'Second\n\nbody' }] },
    { id: 1, createdDate: '2026-11-02T08:00:00Z', author: ane, sourceRefCommit: { commitId: sha('c') }, commits: [{ commitId: sha('c'), comment: 'First' }] }
  ]
}
const prAnswer = (head = sha('b'), target = sha('a')) => ({
  pullRequestId: 12,
  status: 'active',
  title: 'Saved cards',
  description: 'Cards kept for next time',
  createdBy: ane,
  creationDate: '2026-11-02T08:00:00Z',
  sourceRefName: 'refs/heads/feat/cards',
  targetRefName: 'refs/heads/main',
  lastMergeSourceCommit: { commitId: head },
  lastMergeTargetCommit: { commitId: target },
  reviewers: [
    { ...jon, vote: 10 },
    { ...me, vote: 0 },
    { id: 'g-web', displayName: '[Web]\\Reviewers', isContainer: true, vote: 0 }
  ]
})

describe('What Azure DevOps says about a review', () => {
  it('maps threads, the conversation, votes, iterations and reviewers', () => {
    const r = azureReview({ pr: prAnswer(), threads, iterations, viewer })!
    expect(r.features).toMatchObject({ viewed: 'adar', multiLine: true, suggestions: 'github' })
    expect([r.headSha, r.baseSha, r.author, r.viewer]).toEqual([sha('b'), sha('a'), 'Ane', 'Mikel Garcia'])
    expect(r.threads.map((t) => [t.id, t.path, t.side, t.line, t.startLine, t.resolved, t.writtenOn, t.comments.map((c) => c.id)])).toEqual([
      ['11', 'src/a.ts', 'RIGHT', 12, 10, false, sha('c'), [1, 2]],
      ['12', 'src/b.ts', 'LEFT', 4, null, true, null, [1]]
    ])
    expect(r.comments.map((c) => c.body)).toEqual(['Ready for review'])
    expect(r.reviews.map((x) => [x.author, x.verdict])).toEqual([
      ['Jon', 'changes-requested'],
      ['Jon', 'approved']
    ])
    expect(r.timeline).toMatchObject([
      { kind: 'commits', author: 'Ane', commits: [{ sha: sha('c'), subject: 'First' }] },
      { kind: 'commits', author: 'Ane', commits: [{ sha: sha('d'), subject: 'Second' }, { sha: sha('b'), subject: 'Third' }] }
    ])
    expect(r.reviewers).toEqual([
      { login: 'Jon', verdict: 'approved' },
      { login: 'Mikel Garcia', verdict: 'requested' }
    ])
    expect(azureReview({ pr: null, threads: null, iterations: null, viewer: null })).toBeNull()
  })

  it('reads the signed-in user’s part for the dots', () => {
    const act = azureActivity(
      {
        value: [
          vote(1, me, 10, '2026-11-02T12:00:00Z'),
          vote(2, jon, -5, '2026-11-03T09:00:00Z'),
          { id: 3, threadContext: { filePath: '/a.ts' }, pullRequestThreadContext: { iterationContext: { secondComparingIteration: 1 } }, comments: [text(1, me, 'Hmm', '2026-11-02T13:00:00Z')] },
          { id: 4, comments: [text(1, me, 'Thanks', '2026-11-02T14:00:00Z'), text(2, ane, 'Welcome', '2026-11-03T10:00:00Z')] }
        ]
      },
      iterations,
      { value: [{ commitId: sha('b'), comment: "Merge branch 'main' into feat/cards", parents: [sha('d'), sha('a')], committer: { date: '2026-11-03T07:59:00Z' } }, { commitId: sha('d'), comment: 'Second', committer: { date: '2026-11-03T07:00:00Z' } }] },
      viewer,
      'main',
      30
    )
    expect(act.viewerReview).toEqual({ commit: sha('c'), at: '2026-11-02T13:00:00Z', verdict: 'commented' })
    expect(act.viewerCommentAt).toBe('2026-11-02T14:00:00Z')
    expect(act.commits.map((c) => [c.sha[0], c.baseMerge])).toEqual([
      ['d', false],
      ['b', true]
    ])
    expect(act.others).toEqual([
      { who: 'Jon', at: '2026-11-03T09:00:00Z', kind: 'review', verdict: 'changes-requested' },
      { who: 'Ane', at: '2026-11-03T10:00:00Z', kind: 'comment' }
    ])
  })
})

describe('Reviewing on Azure DevOps', () => {
  const ORG = 'https://dev.azure.com/contoso'
  const R = `${ORG}/Web/_apis/git/repositories/widgets`
  const PR = `${R}/pullRequests/12`
  const AZ_TOKEN = 'a'.repeat(52)
  const v = (path: string) => `${path}${path.includes('?') ? '&' : '?'}api-version=7.1`

  interface Call {
    method: string
    url: string
    body: Record<string, unknown> | undefined
  }

  it('places threads on lines, replies, resolves, comments and votes, taking back what a failure left', async () => {
    const repo = initRepo()
    const base = commitFile(repo, 'src/a.ts', 'one\ntwo\n', 'first')
    const head = commitFile(repo, 'src/a.ts', 'one\ntwo\nthree is longer\n', 'second')
    git(repo, ['remote', 'add', 'origin', 'git@ssh.dev.azure.com:v3/contoso/Web/widgets'])
    const calls: Call[] = []
    let nextThread = 30
    let failVote = false
    const fetchFn = async (url: string, init?: RequestInit) => {
      const call: Call = { method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined }
      calls.push(call)
      const key = `${call.method} ${url}`
      const json = (j: unknown, status = 200) => Response.json(j, { status })
      if (key === `GET ${ORG}/_apis/connectionData`) return json({ authenticatedUser: { id: 'u-me', providerDisplayName: 'Mikel Garcia', properties: { Account: { $value: 'mikel@contoso.com' } } } })
      if (key === `GET ${v(PR.replace('pullRequests', 'pullrequests'))}`) return json(prAnswer(head, base))
      if (key === `GET ${v(`${PR}/threads`)}`) return json(threads)
      if (key === `GET ${v(`${PR}/iterations?includeCommits=true`)}`) return json(iterations)
      if (key === `GET ${v(`${PR}/iterations`)}`) return json({ value: [{ id: 1 }, { id: 3 }, { id: 2 }] })
      if (key === `GET ${v(`${PR}/iterations/3/changes?$compareTo=0&$top=2000`)}`) return json({ changeEntries: [{ changeTrackingId: 7, item: { path: '/src/a.ts' } }] })
      if (key === `POST ${v(`${PR}/threads`)}`) return json({ id: nextThread++ })
      if (key === `PUT ${v(`${PR}/reviewers/u-me`)}`) return failVote ? json({ message: 'TF401181: The pull request cannot be edited due to its state.' }, 400) : json({ vote: 10 })
      if (call.method !== 'GET') return json({})
      return json({ message: `No route for ${key}` }, 404)
    }
    const platform: PlatformAdapter = {
      isElectron: false,
      appVersion: 'test',
      userDataDir: tmpDir('adar-azreview-ud-'),
      pickDirectory: async () => null,
      openExternal: async () => undefined,
      showInFolder: async () => undefined,
      fetch: fetchFn,
      secrets: box
    }
    const settings = new SettingsStore(platform.userDataDir)
    const ops = createHostingOps(createGitContext(platform, () => undefined), { ready: Promise.resolve(), settings }, { gh: { token: async () => null, login: async () => null, forget: () => undefined } })
    await ops.connectAzure({ url: ORG, token: AZ_TOKEN })
    calls.length = 0

    const review = await ops.getPullReview(repo, 12)
    expect([review.headSha, review.baseSha, review.threads.length]).toEqual([head, base, 2])

    // Lines 2–3 of the new side, ending after the last line's 15 characters, on the latest push with the file's tracking id.
    await ops.pullReviewAction(repo, 12, { kind: 'comment', commit: head, comment: { path: 'src/a.ts', side: 'RIGHT', line: 3, startLine: 2, body: 'Why?' } })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: v(`${PR}/threads`) })
    expect(calls.at(-1)?.body).toEqual({
      comments: [{ parentCommentId: 0, content: 'Why?', commentType: 1 }],
      status: 1,
      threadContext: { filePath: '/src/a.ts', rightFileStart: { line: 2, offset: 1 }, rightFileEnd: { line: 3, offset: 16 } },
      pullRequestThreadContext: { iterationContext: { firstComparingIteration: 3, secondComparingIteration: 3 }, changeTrackingId: 7 }
    })
    await ops.pullReviewAction(repo, 12, { kind: 'comment', commit: head, comment: { path: 'src/a.ts', side: 'LEFT', line: 1, body: 'Old' } })
    expect(calls.at(-1)?.body?.threadContext).toEqual({ filePath: '/src/a.ts', leftFileStart: { line: 1, offset: 1 }, leftFileEnd: { line: 1, offset: 4 } })
    await expect(ops.pullReviewAction(repo, 12, { kind: 'comment', commit: sha('e'), comment: { path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'x' } })).rejects.toThrow(/changed on Azure DevOps/)

    await ops.pullReviewAction(repo, 12, { kind: 'reply', threadId: '11', commentId: 2, body: 'Thanks' })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: v(`${PR}/threads/11/comments`), body: { content: 'Thanks', parentCommentId: 2, commentType: 1 } })
    await ops.pullReviewAction(repo, 12, { kind: 'resolve', threadId: '11', resolved: true })
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: v(`${PR}/threads/11`), body: { status: 'fixed' } })
    await ops.pullReviewAction(repo, 12, { kind: 'resolve', threadId: '12', resolved: false })
    expect(calls.at(-1)?.body).toEqual({ status: 'active' })
    await expect(ops.pullReviewAction(repo, 12, { kind: 'resolve', threadId: 'T_1', resolved: true })).rejects.toThrow(/Invalid thread/)
    await ops.pullReviewAction(repo, 12, { kind: 'conversation', body: 'Looks good' })
    expect(calls.at(-1)?.body).toEqual({ comments: [{ parentCommentId: 0, content: 'Looks good', commentType: 1 }], status: 1 })

    // Threads, the summary, then the vote: Waiting for author.
    calls.length = 0
    const comment = { path: 'src/a.ts', side: 'RIGHT' as const, line: 3, body: 'Rename it' }
    await ops.pullReviewAction(repo, 12, { kind: 'submit', commit: head, event: 'request-changes', body: 'Two things', comments: [comment] })
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace(PR, '')}`)).toEqual(['POST /threads?api-version=7.1', 'POST /threads?api-version=7.1', 'PUT /reviewers/u-me?api-version=7.1'])
    expect(calls.at(-1)?.body).toEqual({ vote: -5, id: 'u-me' })

    // Azure DevOps refuses the vote: the threads just made are taken back.
    failVote = true
    calls.length = 0
    await expect(ops.pullReviewAction(repo, 12, { kind: 'submit', commit: head, event: 'approve', body: '', comments: [comment] })).rejects.toThrow(/cannot be edited/)
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace(PR, '')}`)).toEqual([
      'POST /threads?api-version=7.1',
      'PUT /reviewers/u-me?api-version=7.1',
      `DELETE /threads/${nextThread - 1}/comments/1?api-version=7.1`
    ])
  })
})
