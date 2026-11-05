// Reviewing Bitbucket pull requests in Adar (Cloud and Data Center): what their answers become, and the review's
// calls against fake APIs (inline comments, Data Center's anchors and pending reviews, approvals, take-backs).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cloudActivity, cloudReview, serverActivity, serverReview } from '@shared/bitbucket'
import type { PlatformAdapter } from '../platform'
import { createGitContext } from '../git/context'
import { cleanupTmp, commitFile, git, initRepo, isolateGitConfig, tmpDir, write } from '../git/write/__tests__/helpers'
import { SettingsStore } from '../system/settings'
import type { SecretBox } from './auth'
import { createHostingOps } from './index'

const sha = (c: string) => c.repeat(40)
const box: SecretBox = {
  available: () => true,
  encrypt: (t) => Buffer.from([...Buffer.from(t)].reverse()),
  decrypt: (b) => Buffer.from([...b].reverse()).toString()
}
const BB_TOKEN = 'ATATT' + 'x'.repeat(60)

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n'

/** base: src/a.ts l1…l10 and old.txt; head: line 3 changed, two lines added after line 6, old.txt renamed with a change. */
function reviewRepo(): { repo: string; base: string; head: string } {
  const repo = initRepo()
  write(repo, 'old.txt', lines(5, (i) => `o${i}`))
  git(repo, ['add', 'old.txt'])
  const base = commitFile(repo, 'src/a.ts', lines(10, (i) => `l${i}`), 'first')
  git(repo, ['mv', 'old.txt', 'new.txt'])
  write(repo, 'new.txt', lines(5, (i) => (i === 2 ? 'O2' : `o${i}`)))
  git(repo, ['add', '-A'])
  const head = commitFile(repo, 'src/a.ts', ['l1', 'l2', 'L3', 'l4', 'l5', 'l6', 'n1', 'n2', 'l7', 'l8', 'l9', 'l10'].join('\n') + '\n', 'change a')
  return { repo, base, head }
}

interface Call {
  method: string
  url: string
  auth: string | null
  body: Record<string, unknown> | undefined
}

type Answer = { status?: number; json: unknown; headers?: Record<string, string> } | undefined

function setup(answer: (call: Call) => Answer) {
  const userData = tmpDir('adar-bbreview-ud-')
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const a = answer(call)
    if (a === undefined) return Response.json({ errors: [{ message: `No route for ${call.method} ${url}` }] }, { status: 404 })
    return a.status === 204 ? new Response(null, { status: 204 }) : Response.json(a.json, { status: a.status ?? 200, headers: a.headers })
  }
  const platform: PlatformAdapter = {
    isElectron: false,
    appVersion: 'test',
    userDataDir: userData,
    pickDirectory: async () => null,
    openExternal: async () => undefined,
    showInFolder: async () => undefined,
    fetch: fetchFn,
    secrets: box
  }
  const settings = new SettingsStore(userData)
  const ghCli = { token: async () => null, login: async () => null, forget: () => undefined }
  const ops = createHostingOps(createGitContext(platform, () => undefined), { ready: Promise.resolve(), settings }, { gh: ghCli })
  return { ops, calls }
}

// ── Bitbucket Cloud ───────────────────────────────────────────────────────────

const me = { display_name: 'Mikel Garcia', uuid: '{me}', account_id: 'acc-me' }
const ane = { display_name: 'Ane', uuid: '{ane}', account_id: 'acc-ane' }
const jon = { display_name: 'Jon', uuid: '{jon}', account_id: 'acc-jon' }
const code = (hash: string) => ({ code: { href: `https://api.bitbucket.org/2.0/repositories/acme/widgets/diff/acme/widgets:${hash.slice(0, 12)}%0D${sha('a').slice(0, 12)}?path=src%2Fa.ts` } })

const cloudComments = [
  { id: 1, user: jon, created_on: '2026-11-02T10:00:00Z', content: { raw: 'Ask git once' }, inline: { path: 'src/a.ts', to: 12, start_to: 10, from: null }, links: code(sha('c')) },
  { id: 2, user: ane, created_on: '2026-11-02T11:00:00Z', content: { raw: 'Done' }, parent: { id: 1 }, inline: { path: 'src/a.ts', to: 12 } },
  { id: 3, user: me, created_on: '2026-11-02T12:00:00Z', content: { raw: 'Thanks' }, parent: { id: 2 } },
  { id: 4, user: jon, created_on: '2026-11-01T09:00:00Z', content: { raw: 'Old' }, inline: { path: 'src/b.ts', from: 4, to: null, outdated: true }, resolution: { type: 'resolved', user: ane } },
  { id: 5, user: ane, created_on: '2026-11-01T08:00:00Z', content: { raw: 'Ready for review' } },
  { id: 6, user: me, created_on: '2026-11-03T08:00:00Z', content: { raw: 'my draft' }, inline: { path: 'src/a.ts', to: 3 }, pending: true },
  { id: 7, user: jon, created_on: '2026-11-03T09:00:00Z', content: { raw: 'gone' }, deleted: true },
  { id: 8, user: jon, created_on: '2026-11-03T09:30:00Z', content: { raw: 'Escape it' }, inline: { path: '../etc/passwd', to: 1 } }
]
const cloudPr = {
  id: 128,
  title: 'Saved cards',
  description: 'Cards kept for next time',
  author: ane,
  source: { branch: { name: 'feat/cards' }, commit: { hash: sha('b').slice(0, 12) } },
  destination: { branch: { name: 'main' }, commit: { hash: sha('a').slice(0, 12) } },
  reviewers: [jon, me],
  participants: [
    { user: jon, role: 'REVIEWER', approved: true, state: 'approved' },
    { user: ane, role: 'PARTICIPANT', approved: false, state: null }
  ]
}
const cloudCommits = [
  { hash: sha('b'), message: 'Third\n\nbody', date: '2026-11-03T07:30:00Z', author: { user: ane }, parents: [{ hash: sha('d') }] },
  { hash: sha('d'), message: 'Second', date: '2026-11-03T07:00:00Z', author: { user: ane }, parents: [{ hash: sha('c') }] },
  { hash: sha('c'), message: 'First', date: '2026-11-01T08:00:00Z', author: { raw: 'Ane <ane@example.com>' }, parents: [{ hash: sha('a') }] }
]

describe('What Bitbucket Cloud says about a review', () => {
  it('maps threads, the conversation, approvals and reviewers', () => {
    const r = cloudReview({
      pr: cloudPr,
      comments: cloudComments,
      activity: [{ approval: { date: '2026-11-02T09:00:00Z', user: jon } }, { changes_requested: { date: '2026-11-02T08:00:00Z', user: jon } }, { comment: {} }],
      commits: cloudCommits,
      viewer: { uuid: '{me}', accountId: 'acc-me', name: 'Mikel Garcia' }
    })!
    expect(r.features).toMatchObject({ viewed: 'adar', multiLine: true, suggestions: null })
    expect([r.headSha, r.baseSha, r.author, r.viewer]).toEqual([sha('b'), '', 'Ane', 'Mikel Garcia'])
    expect(r.threads.map((t) => [t.id, t.path, t.side, t.line, t.startLine, t.outdated, t.resolved, t.writtenOn, t.comments.map((c) => c.id)])).toEqual([
      ['1', 'src/a.ts', 'RIGHT', 12, 10, false, false, sha('c'), [1, 2, 3]],
      ['4', 'src/b.ts', 'LEFT', null, null, true, true, null, [4]]
    ])
    expect(r.threads[0].comments[2]).toMatchObject({ author: 'Mikel Garcia', viewerDidAuthor: true })
    expect(r.comments.map((c) => c.id)).toEqual([5])
    expect(r.reviews.map((x) => [x.author, x.verdict])).toEqual([
      ['Jon', 'changes-requested'],
      ['Jon', 'approved']
    ])
    expect(r.reviewers).toEqual([
      { login: 'Jon', verdict: 'approved' },
      { login: 'Mikel Garcia', verdict: 'requested' }
    ])
    expect(r.timeline).toMatchObject([
      { kind: 'commits', author: 'Ane', commits: [{ sha: sha('c'), subject: 'First' }] },
      { kind: 'commits', author: 'Ane', commits: [{ subject: 'Second' }, { subject: 'Third' }] }
    ])
    expect(r.pendingOnService).toBeNull()
    expect(cloudReview({ pr: null, comments: [], activity: [], commits: [], viewer: null })).toBeNull()
  })

  it('reads the signed-in user’s part for the dots', () => {
    const viewer = { uuid: '{me}', accountId: 'acc-me', name: 'Mikel Garcia' }
    const act = cloudActivity(
      [
        { update: { date: '2026-11-01T08:05:00Z', source: { commit: { hash: sha('c').slice(0, 12) } } } },
        { update: { date: '2026-11-03T07:35:00Z', source: { commit: { hash: sha('b').slice(0, 12) } } } },
        { approval: { date: '2026-11-02T09:00:00Z', user: me } },
        { comment: { id: 9, user: me, created_on: '2026-11-02T10:00:00Z', inline: { path: 'a', to: 1 }, links: code(sha('c')) } },
        { comment: { id: 10, user: me, created_on: '2026-11-02T11:00:00Z' } },
        { comment: { id: 11, user: ane, created_on: '2026-11-03T08:00:00Z' } },
        { changes_requested: { date: '2026-11-03T09:00:00Z', user: jon } }
      ],
      cloudCommits,
      viewer,
      'main',
      30
    )
    // The approval was of the head Bitbucket had then; the inline comment came later, on the same commit.
    expect(act.viewerReview).toEqual({ commit: sha('c'), at: '2026-11-02T10:00:00Z', verdict: 'commented' })
    expect(act.viewerCommentAt).toBe('2026-11-02T11:00:00Z')
    expect(act.commits.map((c) => c.sha[0])).toEqual(['c', 'd', 'b'])
    expect(act.others).toEqual([
      { who: 'Ane', at: '2026-11-03T08:00:00Z', kind: 'comment' },
      { who: 'Jon', at: '2026-11-03T09:00:00Z', kind: 'review', verdict: 'changes-requested' }
    ])
  })
})

describe('Reviewing on Bitbucket Cloud', () => {
  const API = 'https://api.bitbucket.org/2.0'
  const PR = `${API}/repositories/acme/widgets/pullrequests/128`

  it('reads the review, comments on lines, replies, resolves and submits, taking back what a failure left', async () => {
    let failAt: string | null = null
    let nextId = 100
    const { ops, calls } = setup((c) => {
      const key = `${c.method} ${c.url}`
      if (key === `GET ${API}/user`) return { json: me }
      if (key === `GET ${PR}`) return { json: { ...cloudPr, links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/128' } } } }
      if (key === `GET ${PR}/comments?pagelen=100`) return { json: { values: cloudComments.slice(0, 3), next: `${PR}/comments?pagelen=100&page=2` } }
      if (key === `GET ${PR}/comments?pagelen=100&page=2`) return { json: { values: cloudComments.slice(3) } }
      if (key === `GET ${PR}/activity?pagelen=50`) return { json: { values: [] } }
      if (key === `GET ${PR}/commits?pagelen=100`) return { json: { values: cloudCommits } }
      if (failAt && key === failAt) return { status: 400, json: { type: 'error', error: { message: 'You can not approve your own pull request' } } }
      if (key === `POST ${PR}/comments`) return { status: 201, json: { id: nextId++ } }
      if (c.method === 'DELETE' || c.method === 'POST') return { status: c.method === 'DELETE' ? 204 : 200, json: {} }
      return undefined
    })
    const repo = initRepo()
    commitFile(repo, 'a.txt', 'a\n', 'first')
    git(repo, ['remote', 'add', 'origin', 'git@bitbucket.org:acme/widgets.git'])
    await ops.connectBitbucket({ kind: 'cloud', email: 'mikel@example.com', token: BB_TOKEN })
    calls.length = 0

    const review = await ops.getPullReview(repo, 128)
    expect(review.threads.map((t) => t.id)).toEqual(['1', '4'])
    expect(review.headSha).toBe(sha('b'))

    await ops.pullReviewAction(repo, 128, { kind: 'comment', commit: sha('b'), comment: { path: 'src/a.ts', side: 'RIGHT', line: 12, startLine: 10, body: 'Why?' } })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `${PR}/comments`, body: { content: { raw: 'Why?' }, inline: { path: 'src/a.ts', to: 12, start_to: 10 } } })
    await ops.pullReviewAction(repo, 128, { kind: 'comment', commit: sha('b'), comment: { path: 'src/a.ts', side: 'LEFT', line: 4, body: 'Gone?' } })
    expect(calls.at(-1)?.body).toEqual({ content: { raw: 'Gone?' }, inline: { path: 'src/a.ts', from: 4 } })
    await expect(ops.pullReviewAction(repo, 128, { kind: 'comment', commit: sha('e'), comment: { path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'x' } })).rejects.toThrow(/changed on Bitbucket/)
    await ops.pullReviewAction(repo, 128, { kind: 'reply', threadId: '1', commentId: 3, body: 'Thanks' })
    expect(calls.at(-1)?.body).toEqual({ content: { raw: 'Thanks' }, parent: { id: 3 } })
    await ops.pullReviewAction(repo, 128, { kind: 'resolve', threadId: '1', resolved: true })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `${PR}/comments/1/resolve` })
    await ops.pullReviewAction(repo, 128, { kind: 'resolve', threadId: '4', resolved: false })
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `${PR}/comments/4/resolve` })
    await ops.pullReviewAction(repo, 128, { kind: 'conversation', body: 'Looks good' })
    expect(calls.at(-1)?.body).toEqual({ content: { raw: 'Looks good' } })

    // Comments, the summary, then the request for changes.
    calls.length = 0
    const comment = { path: 'src/a.ts', side: 'RIGHT' as const, line: 3, body: 'Rename it' }
    await ops.pullReviewAction(repo, 128, { kind: 'submit', commit: sha('b'), event: 'request-changes', body: 'Two things', comments: [comment] })
    expect(calls.map((c) => `${c.method} ${c.url.replace(PR, '')}`)).toEqual(['GET ', 'POST /comments', 'POST /comments', 'POST /request-changes'])
    expect(calls[2].body).toEqual({ content: { raw: 'Two things' } })

    // Bitbucket refuses the approval: the comments just sent are taken back.
    failAt = `POST ${PR}/approve`
    calls.length = 0
    await expect(ops.pullReviewAction(repo, 128, { kind: 'submit', commit: sha('b'), event: 'approve', body: '', comments: [comment] })).rejects.toThrow(/approve your own/)
    expect(calls.map((c) => `${c.method} ${c.url.replace(PR, '')}`)).toEqual(['GET ', 'POST /comments', 'POST /approve', `DELETE /comments/${nextId - 1}`])
  })
})

// ── Bitbucket Data Center ─────────────────────────────────────────────────────

const ms = (iso: string) => Date.parse(iso)
const dcUser = (name: string) => ({ name, slug: name, displayName: name[0].toUpperCase() + name.slice(1) })

const dcActivities = [
  { id: 30, action: 'APPROVED', createdDate: ms('2026-11-03T09:00:00Z'), user: dcUser('jon') },
  {
    id: 29,
    action: 'COMMENTED',
    commentAction: 'ADDED',
    createdDate: ms('2026-11-03T08:30:00Z'),
    user: dcUser('ane'),
    comment: { id: 12, text: 'Done', author: dcUser('ane'), createdDate: ms('2026-11-03T08:30:00Z'), parent: { id: 11 }, comments: [] }
  },
  {
    id: 28,
    action: 'RESCOPED',
    createdDate: ms('2026-11-03T08:00:00Z'),
    user: dcUser('ane'),
    fromHash: sha('b'),
    previousFromHash: sha('d'),
    added: { commits: [{ id: sha('b'), message: 'Third' }] },
    removed: { commits: [] }
  },
  { id: 27, action: 'REVIEWED', createdDate: ms('2026-11-02T12:00:00Z'), user: dcUser('jon') },
  {
    id: 26,
    action: 'COMMENTED',
    commentAction: 'ADDED',
    createdDate: ms('2026-11-02T11:00:00Z'),
    user: dcUser('jon'),
    comment: {
      id: 11,
      version: 2,
      text: 'Ask git once',
      author: dcUser('jon'),
      createdDate: ms('2026-11-02T11:00:00Z'),
      threadResolved: false,
      comments: [{ id: 12, text: 'Done', author: dcUser('ane'), createdDate: ms('2026-11-03T08:30:00Z'), comments: [] }]
    },
    commentAnchor: { path: 'src/a.ts', line: 12, lineType: 'ADDED', fileType: 'TO', diffType: 'EFFECTIVE', toHash: sha('d') }
  },
  {
    id: 25,
    action: 'COMMENTED',
    commentAction: 'ADDED',
    createdDate: ms('2026-11-02T10:00:00Z'),
    user: dcUser('jon'),
    comment: { id: 10, text: 'Old', author: dcUser('jon'), createdDate: ms('2026-11-02T10:00:00Z'), threadResolved: true, comments: [] },
    commentAnchor: { path: 'src/b.ts', line: 4, lineType: 'REMOVED', fileType: 'FROM', diffType: 'EFFECTIVE', orphaned: true }
  },
  { id: 24, action: 'COMMENTED', commentAction: 'ADDED', createdDate: ms('2026-11-02T09:00:00Z'), user: dcUser('ane'), comment: { id: 9, text: 'Ready', author: dcUser('ane'), createdDate: ms('2026-11-02T09:00:00Z'), comments: [] } },
  { id: 23, action: 'UPDATED', createdDate: ms('2026-11-02T08:30:00Z'), user: dcUser('ane'), addedReviewers: [dcUser('mikel')] },
  { id: 22, action: 'OPENED', createdDate: ms('2026-11-02T08:00:00Z'), user: dcUser('ane'), fromHash: sha('d') }
]
const dcPr = (head = sha('b')) => ({
  id: 57,
  version: 4,
  title: 'Rounding',
  description: 'Round prices',
  state: 'OPEN',
  createdDate: ms('2026-11-02T08:00:00Z'),
  fromRef: { displayId: 'fix/rounding', latestCommit: head, repository: { slug: 'widgets', project: { key: 'WEB' } } },
  toRef: { displayId: 'main', latestCommit: sha('a'), repository: { slug: 'widgets', project: { key: 'WEB' } } },
  author: { user: dcUser('ane') },
  reviewers: [
    { user: dcUser('jon'), status: 'APPROVED' },
    { user: { name: 'mikel', slug: 'mikel.g', displayName: 'Mikel' }, status: 'UNAPPROVED' }
  ]
})

describe('What Bitbucket Data Center says about a review', () => {
  it('maps threads with their replies, the conversation, reviews, rescopes and reviewers', () => {
    const r = serverReview({
      pr: dcPr(),
      activities: dcActivities,
      commits: [{ id: sha('b'), message: 'Third' }, { id: sha('d'), message: 'Second' }, { id: sha('c'), message: 'First' }],
      pending: [{ comment: { id: 40, state: 'PENDING', comments: [{ id: 41, state: 'PENDING' }] } }],
      viewer: 'mikel'
    })!
    expect(r.features).toMatchObject({ multiLine: false, suggestions: 'github' })
    expect([r.headSha, r.baseSha, r.author, r.viewer]).toEqual([sha('b'), sha('a'), 'Ane', 'Mikel'])
    expect(r.threads.map((t) => [t.id, t.side, t.line, t.outdated, t.resolved, t.comments.map((c) => c.id)])).toEqual([
      ['11', 'RIGHT', 12, false, false, [11, 12]],
      ['10', 'LEFT', null, true, true, [10]]
    ])
    expect(r.comments.map((c) => c.id)).toEqual([9])
    expect(r.reviews.map((x) => [x.author, x.verdict])).toEqual([
      ['Jon', 'changes-requested'],
      ['Jon', 'approved']
    ])
    expect(r.timeline.map((e) => e.kind)).toEqual(['commits', 'review-requested', 'commits'])
    expect(r.timeline[0]).toMatchObject({ author: 'Ane', commits: [{ sha: sha('c') }, { sha: sha('d') }] })
    expect(r.timeline[2]).toMatchObject({ commits: [{ sha: sha('b'), subject: 'Third' }] })
    expect(r.reviewers).toEqual([
      { login: 'Jon', verdict: 'approved' },
      { login: 'Mikel', verdict: 'requested' }
    ])
    expect(r.pendingOnService).toEqual({ id: 'review', comments: 2 })
  })

  it('reads the signed-in user’s part for the dots', () => {
    const act = serverActivity(
      [
        { action: 'COMMENTED', commentAction: 'ADDED', createdDate: ms('2026-11-03T10:00:00Z'), user: dcUser('ane'), comment: { id: 1 } },
        { action: 'APPROVED', createdDate: ms('2026-11-03T09:00:00Z'), user: dcUser('mikel') },
        { action: 'RESCOPED', createdDate: ms('2026-11-03T08:00:00Z'), user: dcUser('ane'), fromHash: sha('b') },
        { action: 'COMMENTED', commentAction: 'ADDED', createdDate: ms('2026-11-02T11:00:00Z'), user: dcUser('mikel'), comment: { id: 2 } },
        { action: 'OPENED', createdDate: ms('2026-11-02T08:00:00Z'), user: dcUser('ane'), fromHash: sha('d') }
      ],
      [
        { id: sha('b'), message: "Merge branch 'main' into fix/rounding", parents: [{}, {}], committerTimestamp: ms('2026-11-03T07:59:00Z') },
        { id: sha('d'), message: 'Second', parents: [{}], committerTimestamp: ms('2026-11-02T07:00:00Z') }
      ],
      'mikel',
      'main',
      30
    )
    expect(act.viewerReview).toEqual({ commit: sha('b'), at: '2026-11-03T09:00:00.000Z', verdict: 'approved' })
    expect(act.viewerCommentAt).toBe('2026-11-02T11:00:00.000Z')
    expect(act.commits.map((c) => [c.sha[0], c.baseMerge])).toEqual([
      ['d', false],
      ['b', true]
    ])
    expect(act.others).toEqual([{ who: 'Ane', at: '2026-11-03T10:00:00.000Z', kind: 'comment' }])
  })
})

describe('Reviewing on Bitbucket Data Center', () => {
  const SERVER = 'https://bitbucket.example.com'
  const PR = `${SERVER}/rest/api/1.0/projects/WEB/repos/widgets/pull-requests/57`

  it('anchors comments by line kind, finishes a pending review, falls back without reviews and resolves threads', async () => {
    const { repo, base, head } = reviewRepo()
    git(repo, ['remote', 'add', 'origin', `${SERVER}/scm/web/widgets.git`])
    let reviews = true
    let nextId = 200
    let failReview = false
    const { ops, calls } = setup((c) => {
      const key = `${c.method} ${c.url}`
      if (key === `GET ${SERVER}/rest/api/1.0/application-properties`) return { json: { version: '9.6.0' }, headers: { 'x-ausername': 'mikel' } }
      if (key === `GET ${PR}`) return { json: { ...dcPr(head), toRef: { ...dcPr(head).toRef, latestCommit: base } } }
      if (key === `GET ${PR}/activities?limit=100&start=0`) return { json: { values: dcActivities, isLastPage: true } }
      if (key === `GET ${PR}/commits?limit=100`) return { json: { values: [] } }
      if (c.url.startsWith(`${PR}/review?`)) return reviews ? { json: { values: [], isLastPage: true } } : undefined
      if (key === `PUT ${PR}/review`) return failReview ? { status: 409, json: { errors: [{ message: 'The pull request was updated' }] } } : reviews ? { json: {} } : undefined
      if (key === `POST ${PR}/comments`) return { status: 201, json: { id: nextId++, version: 0 } }
      if (key === `GET ${PR}/comments/11`) return { json: { id: 11, version: 7 } }
      if (c.method === 'PUT' || c.method === 'DELETE') return { status: c.method === 'DELETE' ? 204 : 200, json: {} }
      return undefined
    })
    await ops.connectBitbucket({ kind: 'server', url: SERVER, token: BB_TOKEN, remoteHost: 'bitbucket.example.com' })
    calls.length = 0

    const review = await ops.getPullReview(repo, 57)
    expect([review.headSha, review.baseSha]).toEqual([head, base])

    // Added, kept and removed lines, the last in a renamed file.
    const anchorFor = async (comment: { path: string; side: 'LEFT' | 'RIGHT'; line: number }) => {
      await ops.pullReviewAction(repo, 57, { kind: 'comment', commit: head, comment: { ...comment, body: 'x' } })
      return calls.at(-1)?.body?.anchor
    }
    expect(await anchorFor({ path: 'src/a.ts', side: 'RIGHT', line: 8 })).toEqual({ diffType: 'EFFECTIVE', line: 8, lineType: 'ADDED', fileType: 'TO', path: 'src/a.ts', fromHash: base, toHash: head })
    expect(await anchorFor({ path: 'src/a.ts', side: 'RIGHT', line: 10 })).toMatchObject({ line: 10, lineType: 'CONTEXT', fileType: 'TO' })
    expect(await anchorFor({ path: 'new.txt', side: 'LEFT', line: 2 })).toMatchObject({ line: 2, lineType: 'REMOVED', fileType: 'FROM', path: 'new.txt', srcPath: 'old.txt' })
    await expect(ops.pullReviewAction(repo, 57, { kind: 'comment', commit: sha('e'), comment: { path: 'src/a.ts', side: 'RIGHT', line: 1, body: 'x' } })).rejects.toThrow(/changed on Bitbucket/)

    await ops.pullReviewAction(repo, 57, { kind: 'reply', threadId: '11', commentId: 12, body: 'Thanks' })
    expect(calls.at(-1)?.body).toEqual({ text: 'Thanks', parent: { id: 12 } })
    await ops.pullReviewAction(repo, 57, { kind: 'resolve', threadId: '11', resolved: true })
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', url: `${PR}/comments/11`, body: { version: 7, threadResolved: true } })

    // A review: the comments pending, then finished with the summary and the status.
    calls.length = 0
    const comment = { path: 'src/a.ts', side: 'RIGHT' as const, line: 3, body: 'Rename it' }
    await ops.pullReviewAction(repo, 57, { kind: 'submit', commit: head, event: 'request-changes', body: 'Two things', comments: [comment] })
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace(PR, '')}`)).toEqual(['POST /comments', 'PUT /review'])
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ text: 'Rename it', state: 'PENDING', anchor: { line: 3, lineType: 'ADDED' } })
    expect(calls.at(-1)?.body).toEqual({ commentText: 'Two things', lastReviewedCommit: head, participantStatus: 'NEEDS_WORK' })

    // The review fails: the pending comments are taken back.
    failReview = true
    calls.length = 0
    await expect(ops.pullReviewAction(repo, 57, { kind: 'submit', commit: head, event: 'approve', body: '', comments: [comment] })).rejects.toThrow(/was updated/)
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace(PR, '')}`)).toEqual(['POST /comments', 'PUT /review', `DELETE /comments/${nextId - 1}?version=0`])

    // A server without reviews: comments and the summary one by one, then the status by the user's slug.
    failReview = false
    reviews = false
    calls.length = 0
    await ops.pullReviewAction(repo, 57, { kind: 'submit', commit: head, event: 'approve', body: 'Nice', comments: [comment] })
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.replace(PR, '')}`)).toEqual(['POST /comments', 'POST /comments', 'PUT /participants/mikel.g'])
    expect(calls.find((c) => c.method === 'POST')?.body).not.toHaveProperty('state')
    expect(calls.at(-1)?.body).toEqual({ status: 'APPROVED', lastReviewedCommit: head })
  })
})
