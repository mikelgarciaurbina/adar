// Reviewing GitLab merge requests in Adar: where a line sits on both sides of a diff (against real repositories),
// what GitLab's answers become, and the review's calls against a fake GitLab (positions, draft notes, approvals).

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitlabActivity, gitlabReview } from '@shared/gitlab'
import { suggestionBlock } from '@shared/review'
import type { PlatformAdapter } from '../platform'
import { createGitContext } from '../git/context'
import { cleanupTmp, commitFile, git, initRepo, isolateGitConfig, tmpDir, write } from '../git/write/__tests__/helpers'
import { SettingsStore } from '../system/settings'
import type { SecretBox } from './auth'
import { createHostingOps } from './index'
import { fileLines, hunksOf, placeLine } from './place'

const sha = (c: string) => c.repeat(40)
const box: SecretBox = {
  available: () => true,
  encrypt: (t) => Buffer.from([...Buffer.from(t)].reverse()),
  decrypt: (b) => Buffer.from([...b].reverse()).toString()
}

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

describe('Where a line sits on both sides', () => {
  it('reads -U0 hunks and places added, removed and kept lines', () => {
    const hunks = hunksOf('diff --git a/x b/x\n@@ -3 +3 @@\n-l3\n+L3\n@@ -6,0 +7,2 @@ l6\n+n1\n+n2\n@@ -9,2 +11,0 @@\n-a\n-b\n')
    expect(hunks).toEqual([
      { oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 },
      { oldStart: 6, oldCount: 0, newStart: 7, newCount: 2 },
      { oldStart: 9, oldCount: 2, newStart: 11, newCount: 0 }
    ])
    const at = (side: 'LEFT' | 'RIGHT', line: number) => {
      const p = placeLine(hunks, side, line, 'x', 'x')
      return [p.oldLine, p.newLine, p.oldPos, p.newPos]
    }
    expect(at('RIGHT', 3)).toEqual([null, 3, 4, 3]) // changed: the new version is an added line
    expect(at('LEFT', 3)).toEqual([3, null, 3, 3])
    expect(at('RIGHT', 8)).toEqual([null, 8, 7, 8]) // added after old line 6
    expect(at('RIGHT', 5)).toEqual([5, 5, 5, 5])
    expect(at('RIGHT', 10)).toEqual([8, 10, 8, 10]) // kept, two lines further down
    expect(at('LEFT', 8)).toEqual([8, 10, 8, 10])
    expect(at('LEFT', 10)).toEqual([10, null, 10, 12]) // removed at the end
    expect(at('LEFT', 12)).toEqual([12, 12, 12, 12])
  })

  it('asks the repository, following a rename', async () => {
    const { repo, base, head } = reviewRepo()
    const ctx = createGitContext({ isElectron: false, appVersion: 'test', userDataDir: tmpDir(), pickDirectory: async () => null, openExternal: async () => undefined, showInFolder: async () => undefined }, () => undefined)
    const a = await fileLines(ctx, repo, base, head, 'src/a.ts')
    expect(a.at('RIGHT', 10)).toMatchObject({ oldPath: 'src/a.ts', newPath: 'src/a.ts', oldLine: 8, newLine: 10 })
    expect(a.at('LEFT', 9)).toMatchObject({ oldLine: 9, newLine: 11 })
    const renamed = await fileLines(ctx, repo, base, head, 'new.txt')
    expect(renamed.oldPath).toBe('old.txt')
    expect(renamed.at('RIGHT', 2)).toMatchObject({ oldPath: 'old.txt', newPath: 'new.txt', oldLine: null, newLine: 2 })
    expect(renamed.at('RIGHT', 4)).toMatchObject({ oldLine: 4, newLine: 4 })
    await expect(fileLines(ctx, repo, '-x', head, 'new.txt')).rejects.toThrow(/Invalid commit/)
  })
})

// ── What GitLab says ──────────────────────────────────────────────────────────

const HEAD = sha('b')
const user = (username: string) => ({ username, name: username[0].toUpperCase() + username.slice(1) })
const diffNote = (id: number, who: string, body: string, position: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'DiffNote',
  body,
  author: user(who),
  created_at: `2026-11-0${(id % 9) + 1}T10:00:00Z`,
  system: false,
  resolvable: true,
  resolved: false,
  position: { position_type: 'text', base_sha: sha('a'), start_sha: sha('a'), head_sha: HEAD, old_path: 'src/a.ts', new_path: 'src/a.ts', ...position },
  ...extra
})
const system = (id: number, who: string, body: string, at: string) => ({ id: `s${id}`, individual_note: true, notes: [{ id, body, author: user(who), created_at: at, system: true }] })

const discussions = [
  {
    id: 'd'.repeat(40),
    individual_note: false,
    notes: [
      diffNote(101, 'mikel', 'Ask git once', { new_line: 3, old_line: null, line_range: { start: { new_line: 2, type: null }, end: { new_line: 3, type: 'new' } } }),
      diffNote(102, 'ane', 'Done', { new_line: 3, old_line: null })
    ]
  },
  { id: 'e'.repeat(40), individual_note: false, notes: [diffNote(103, 'jon', 'Old', { head_sha: sha('f'), old_line: 4, new_line: null }, { resolved: true })] },
  { id: 'x1', individual_note: false, notes: [diffNote(104, 'jon', 'An image', { position_type: 'image' })] },
  system(201, 'jon', 'approved this merge request', '2026-11-03T09:00:00Z'),
  system(202, 'ane', `added 1 commit\n\n<ul><li>${HEAD.slice(0, 8)} - Change a</li></ul>\n\n[Compare with previous version](/acme/widgets/-/merge_requests/7/diffs?diff_id=2)`, '2026-11-03T07:00:00Z'),
  system(203, 'ane', 'requested review from @mikel and @jon', '2026-11-02T08:00:00Z'),
  system(204, 'ane', 'marked this merge request as **ready**', '2026-11-02T07:59:00Z'),
  system(205, 'ane', 'changed the description', '2026-11-02T07:58:00Z'),
  { id: 's206', individual_note: true, notes: [{ id: 206, type: null, body: 'Ready for review', author: user('ane'), created_at: '2026-11-02T08:01:00Z', system: false }] },
  {
    id: 'g'.repeat(40),
    individual_note: false,
    notes: [
      { id: 207, type: 'DiscussionNote', body: 'Why a new table?', author: user('jon'), created_at: '2026-11-02T09:00:00Z', system: false, resolvable: true },
      { id: 208, type: 'DiscussionNote', body: 'Speed', author: user('ane'), created_at: '2026-11-02T09:30:00Z', system: false, resolvable: true }
    ]
  }
]

const mrAnswer = {
  id: 9007,
  iid: 7,
  title: 'Workspaces',
  description: 'A dashboard per tab group',
  state: 'opened',
  author: user('ane'),
  sha: HEAD,
  created_at: '2026-11-01T08:00:00Z',
  source_branch: 'feat/workspaces',
  target_branch: 'main',
  diff_refs: { base_sha: sha('a'), start_sha: sha('c'), head_sha: HEAD }
}
const commitsAnswer = [
  { id: HEAD, title: 'Change a', author_name: 'Ane', created_at: '2026-11-03T06:00:00Z', parent_ids: [sha('9')] },
  { id: sha('9'), title: 'Start', author_name: 'Ane', created_at: '2026-11-01T07:00:00Z', parent_ids: [sha('a')] }
]

describe('What GitLab says about a review', () => {
  it('maps threads, approvals, reviewers, the conversation and the timeline', () => {
    const r = gitlabReview({
      mr: mrAnswer,
      discussions,
      reviewers: [
        { user: user('mikel'), state: 'unreviewed' },
        { user: user('jon'), state: 'approved' },
        { user: user('ane'), state: 'reviewed' }
      ],
      approvals: { approved_by: [{ user: user('jon') }, { user: user('leire') }] },
      drafts: [{ id: 1 }],
      commits: commitsAnswer,
      viewer: user('mikel')
    })!
    expect(r.features).toMatchObject({ viewed: 'adar', suggestions: 'gitlab' })
    expect([r.number, r.author, r.headSha, r.baseSha, r.viewer]).toEqual([7, 'ane', HEAD, sha('c'), 'mikel'])
    expect(r.threads.map((t) => [t.id.slice(0, 1), t.side, t.line, t.startLine, t.originalLine, t.outdated, t.resolved, t.canResolve, t.comments.map((c) => c.id)])).toEqual([
      ['d', 'RIGHT', 3, 2, 3, false, false, true, [101, 102]],
      ['e', 'LEFT', null, null, 4, true, true, true, [103]]
    ])
    expect(r.threads[0].comments[0]).toMatchObject({ author: 'mikel', viewerDidAuthor: true })
    expect(r.reviews).toEqual([{ id: 'note-201', author: 'jon', verdict: 'approved', body: '', submittedAt: '2026-11-03T09:00:00Z', commit: null, comments: 0 }])
    // The author is no reviewer of their own; an approval counts for someone not asked too.
    expect(r.reviewers).toEqual([
      { login: 'mikel', verdict: 'requested' },
      { login: 'jon', verdict: 'approved' },
      { login: 'leire', verdict: 'approved' }
    ])
    expect(r.comments.map((c) => [c.id, c.author])).toEqual([
      [206, 'ane'],
      [207, 'jon'],
      [208, 'ane']
    ])
    expect(r.timeline.map((e) => e.kind)).toEqual(['commits', 'ready', 'review-requested', 'review-requested', 'commits'])
    expect(r.timeline[0]).toMatchObject({ at: '2026-11-01T08:00:00Z', author: 'ane', commits: [{ sha: sha('9'), subject: 'Start' }] })
    expect(r.timeline[2]).toMatchObject({ actor: 'ane', reviewer: 'mikel' })
    expect(r.timeline[4]).toMatchObject({ author: 'ane', commits: [{ sha: HEAD, subject: 'Change a' }] })
    expect(r.pendingOnService).toEqual({ id: 'drafts', comments: 1 })
    expect(gitlabReview({ mr: null, discussions: [], reviewers: null, approvals: null, drafts: null, commits: null, viewer: null })).toBeNull()
  })

  it('reads the signed-in user’s part and what others did, for the dots', () => {
    const act = gitlabActivity(
      {
        notes: [
          { id: 9, body: 'approved this merge request', system: true, author: user('jon'), created_at: '2026-11-04T09:00:00Z' },
          { id: 8, body: 'Fixed', system: false, author: user('ane'), created_at: '2026-11-04T08:00:00Z' },
          { id: 7, body: 'approved this merge request', system: true, author: user('mikel'), created_at: '2026-11-03T12:00:00Z' },
          { id: 6, type: 'DiffNote', body: 'Hmm', system: false, author: user('mikel'), created_at: '2026-11-02T12:00:00Z', position: { head_sha: sha('9') } },
          { id: 5, type: null, body: 'Thanks', system: false, author: user('mikel'), created_at: '2026-11-02T13:00:00Z' }
        ],
        commits: [
          { id: sha('d'), title: "Merge branch 'main' into feat/workspaces", parent_ids: [HEAD, sha('c')], committed_date: '2026-11-04T07:00:00Z' },
          ...commitsAnswer.map((c) => ({ ...c, committed_date: c.created_at }))
        ],
        versions: [
          { head_commit_sha: sha('d'), created_at: '2026-11-04T07:05:00Z' },
          { head_commit_sha: HEAD, created_at: '2026-11-03T06:05:00Z' },
          { head_commit_sha: sha('9'), created_at: '2026-11-01T07:05:00Z' }
        ]
      },
      user('mikel'),
      'main'
    )
    // The approval was of the head GitLab had then; the line comment was on its own version.
    expect(act.viewerReview).toEqual({ commit: HEAD, at: '2026-11-03T12:00:00Z', verdict: 'approved' })
    expect(act.viewerCommentAt).toBe('2026-11-02T13:00:00Z')
    expect(act.commits.map((c) => [c.sha[0], c.baseMerge])).toEqual([
      ['9', false],
      ['b', false],
      ['d', true]
    ])
    expect(act.moreCommits).toBe(false)
    expect(act.others).toEqual([
      { who: 'ane', at: '2026-11-04T08:00:00Z', kind: 'comment' },
      { who: 'jon', at: '2026-11-04T09:00:00Z', kind: 'review', verdict: 'approved' }
    ])
  })

  it('writes suggested changes the way each service reads them', () => {
    expect(suggestionBlock('github', ['a', 'b'])).toBe('```suggestion\na\nb\n```')
    expect(suggestionBlock('gitlab', ['a', 'b'])).toBe('```suggestion:-1+0\na\nb\n```')
    expect(suggestionBlock('gitlab', ['a'])).toBe('```suggestion:-0+0\na\n```')
  })
})

// ── Against a fake GitLab ─────────────────────────────────────────────────────

const SERVER = 'https://gitlab.example.com'
const API = `${SERVER}/api/v4`
const P = `${API}/projects/${encodeURIComponent('acme/widgets')}`
const MR = `${P}/merge_requests/7`
const GL_TOKEN = 'glpat-' + 'g'.repeat(26)

interface Call {
  method: string
  url: string
  auth: string | null
  body: Record<string, unknown> | undefined
}

type Answer = { status?: number; json: unknown } | undefined

function setup(answer: (call: Call) => Answer) {
  const userData = tmpDir('adar-glreview-ud-')
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    if (call.method === 'GET' && url === `${API}/user`) return Response.json({ username: 'mikel', name: 'Mikel Garcia' })
    const a = answer(call)
    return a === undefined ? Response.json({ message: '404 Not Found' }, { status: 404 }) : Response.json(a.json, { status: a.status ?? 200 })
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

describe('Reviewing on GitLab', () => {
  it('reads the review, places comments by both line numbers, replies, resolves and submits through draft notes', async () => {
    const { repo, base, head } = reviewRepo()
    git(repo, ['remote', 'add', 'origin', 'git@gitlab.example.com:acme/widgets.git'])
    let drafts: Array<{ id: number }> = []
    let nextDraft = 50
    let failDraftAt = 0
    const mr = { ...mrAnswer, sha: head, diff_refs: { base_sha: base, start_sha: base, head_sha: head } }
    const { ops, calls } = setup((c) => {
      const key = `${c.method} ${c.url}`
      if (key === `GET ${MR}`) return { json: mr }
      if (key === `GET ${MR}/discussions?per_page=100&page=1`) return { json: discussions }
      if (key === `GET ${MR}/reviewers`) return { json: [] }
      if (key === `GET ${MR}/approvals`) return { json: { approved_by: [] } }
      if (key === `GET ${MR}/draft_notes?per_page=100`) return { json: drafts }
      if (key === `GET ${MR}/commits?per_page=100`) return { json: [] }
      if (key === `POST ${MR}/draft_notes`) {
        if (failDraftAt && nextDraft === failDraftAt) return { status: 400, json: { message: { base: ['Note is invalid'] } } }
        return { status: 201, json: { id: nextDraft++ } }
      }
      if (c.method === 'DELETE' && c.url.startsWith(`${MR}/draft_notes/`)) return { status: 204, json: null }
      if (c.method === 'POST' || c.method === 'PUT') return { status: 201, json: { id: 1 } }
      return undefined
    })
    await ops.connectGitlab({ url: SERVER, token: GL_TOKEN, remoteHost: 'gitlab.example.com' })
    calls.length = 0

    const review = await ops.getPullReview(repo, 7)
    // Both threads were written on other versions than this head: outdated here.
    expect(review.threads.map((t) => t.outdated)).toEqual([true, true])
    expect(review.headSha).toBe(head)

    // A kept line (new 10, old 8), then two lines from a kept one to an added one.
    const fileHash = createHash('sha1').update('src/a.ts').digest('hex')
    await ops.pullReviewAction(repo, 7, { kind: 'comment', commit: head, comment: { path: 'src/a.ts', side: 'RIGHT', line: 10, body: 'Why?' } })
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: `${MR}/discussions`,
      auth: `Bearer ${GL_TOKEN}`,
      body: { body: 'Why?', position: { base_sha: base, start_sha: base, head_sha: head, position_type: 'text', old_path: 'src/a.ts', new_path: 'src/a.ts', old_line: 8, new_line: 10 } }
    })
    await ops.pullReviewAction(repo, 7, { kind: 'comment', commit: head, comment: { path: 'src/a.ts', side: 'RIGHT', line: 8, startLine: 6, body: 'Both' } })
    expect(calls.at(-1)?.body?.position).toEqual({
      base_sha: base,
      start_sha: base,
      head_sha: head,
      position_type: 'text',
      old_path: 'src/a.ts',
      new_path: 'src/a.ts',
      new_line: 8,
      line_range: { start: { line_code: `${fileHash}_6_6`, type: 'old', old_line: 6, new_line: 6 }, end: { line_code: `${fileHash}_7_8`, type: 'new', new_line: 8 } }
    })
    // A removed line, in a renamed file.
    await ops.pullReviewAction(repo, 7, { kind: 'comment', commit: head, comment: { path: 'new.txt', side: 'LEFT', line: 2, body: 'Gone' } })
    expect(calls.at(-1)?.body?.position).toMatchObject({ old_path: 'old.txt', new_path: 'new.txt', old_line: 2 })
    expect(calls.at(-1)?.body?.position).not.toHaveProperty('new_line')
    // Comments written on another version are not placed on this one.
    await expect(ops.pullReviewAction(repo, 7, { kind: 'comment', commit: sha('e'), comment: { path: 'src/a.ts', side: 'RIGHT', line: 3, body: 'x' } })).rejects.toThrow(/changed on GitLab/)

    await ops.pullReviewAction(repo, 7, { kind: 'reply', threadId: 'd'.repeat(40), commentId: 102, body: 'Thanks' })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `${MR}/discussions/${'d'.repeat(40)}/notes`, body: { body: 'Thanks' } })
    await ops.pullReviewAction(repo, 7, { kind: 'resolve', threadId: 'd'.repeat(40), resolved: true })
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', url: `${MR}/discussions/${'d'.repeat(40)}`, body: { resolved: true } })
    await ops.pullReviewAction(repo, 7, { kind: 'conversation', body: 'Looks good' })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `${MR}/notes`, body: { body: 'Looks good' } })
    await expect(ops.pullReviewAction(repo, 7, { kind: 'viewed', path: 'src/a.ts', viewed: true })).rejects.toThrow(/Adar keeps them/)

    // Request changes: the summary and the comments as draft notes, published together with the reviewer state.
    calls.length = 0
    const comment = { path: 'src/a.ts', side: 'RIGHT' as const, line: 3, body: 'Rename it' }
    await ops.pullReviewAction(repo, 7, { kind: 'submit', commit: head, event: 'request-changes', body: 'Two things', comments: [comment] })
    expect(calls.map((c) => `${c.method} ${c.url.replace(MR, '')}`)).toEqual(['GET ', 'GET /draft_notes?per_page=100', 'POST /draft_notes', 'POST /draft_notes', 'POST /draft_notes/bulk_publish'])
    expect(calls[2].body).toEqual({ note: 'Two things' })
    expect(calls[3].body).toMatchObject({ note: 'Rename it', position: { new_line: 3, old_path: 'src/a.ts' } })
    expect(calls[3].body?.position).not.toHaveProperty('old_line')
    expect(calls[4].body).toEqual({ reviewer_state: 'requested_changes' })

    // Approving with nothing to say: only the approval, of the head Adar showed.
    calls.length = 0
    await ops.pullReviewAction(repo, 7, { kind: 'submit', commit: head, event: 'approve', body: '', comments: [] })
    expect(calls.map((c) => `${c.method} ${c.url.replace(MR, '')}`)).toEqual(['GET ', 'GET /draft_notes?per_page=100', 'POST /approve'])
    expect(calls[2].body).toEqual({ sha: head })
    // …with a review started on GitLab's website: it is published first.
    drafts = [{ id: 3 }]
    calls.length = 0
    await ops.pullReviewAction(repo, 7, { kind: 'submit', commit: head, event: 'approve', body: '', comments: [] })
    expect(calls.map((c) => `${c.method} ${c.url.replace(MR, '')}`)).toEqual(['GET ', 'GET /draft_notes?per_page=100', 'POST /draft_notes/bulk_publish', 'POST /approve'])

    // A comment GitLab refuses: the drafts already made are taken back, nothing is published.
    drafts = []
    failDraftAt = nextDraft + 1
    calls.length = 0
    await expect(ops.pullReviewAction(repo, 7, { kind: 'submit', commit: head, event: 'comment', body: 'Summary', comments: [comment] })).rejects.toThrow(/Note is invalid/)
    expect(calls.map((c) => `${c.method} ${c.url.replace(MR, '')}`)).toEqual(['GET ', 'GET /draft_notes?per_page=100', 'POST /draft_notes', 'POST /draft_notes', `DELETE /draft_notes/${failDraftAt - 1}`])
  })

  it('reads each open merge request’s activity once until it changes', async () => {
    const repo = initRepo()
    commitFile(repo, 'a.txt', 'a\n', 'first')
    git(repo, ['remote', 'add', 'origin', 'git@gitlab.example.com:acme/widgets.git'])
    let updated = '2026-11-04T10:00:00Z'
    let myState = 'unreviewed'
    const listed = { ...mrAnswer, updated_at: updated, user_notes_count: 2, detailed_merge_status: 'mergeable', reviewers: [user('mikel')] }
    const { ops, calls } = setup((c) => {
      const key = `${c.method} ${c.url}`
      if (key === `GET ${P}`) return { json: { default_branch: 'main', merge_method: 'merge' } }
      if (key === `GET ${P}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=50`) return { json: [{ ...listed, updated_at: updated }] }
      if (c.url.startsWith(`${P}/merge_requests?state=`)) return { json: [] }
      if (key === `GET ${MR}`) return { json: { ...listed, updated_at: updated } }
      if (key === `GET ${MR}/approvals`) return { json: { approved_by: [] } }
      if (key === `GET ${MR}/notes?sort=desc&order_by=created_at&per_page=100`) return { json: [{ id: 1, body: 'Fixed', system: false, author: user('ane'), created_at: '2026-11-04T09:00:00Z' }] }
      if (key === `GET ${MR}/commits?per_page=31`) return { json: commitsAnswer }
      if (key === `GET ${MR}/versions`) return { json: [{ head_commit_sha: HEAD, created_at: '2026-11-03T06:05:00Z' }] }
      if (key === `GET ${MR}/reviewers`) return { json: [{ user: user('mikel'), state: myState }] }
      return undefined
    })
    await ops.connectGitlab({ url: SERVER, token: GL_TOKEN, remoteHost: 'gitlab.example.com' })
    const first = await ops.getPullRequests(repo)
    expect(first?.pulls[0].activity).toMatchObject({ viewerReview: null, others: [{ who: 'ane', kind: 'comment' }], commits: [{ sha: sha('9') }, { sha: HEAD }] })
    expect(first?.pulls[0].reviewRequested).toBe(true)
    const notesAsked = () => calls.filter((c) => c.url.includes('/notes?')).length
    expect(notesAsked()).toBe(1)
    await ops.getPullRequests(repo)
    expect(notesAsked()).toBe(1)
    // Reviewed: no longer waiting for the user, until GitLab asks them again.
    updated = '2026-11-04T11:00:00Z'
    myState = 'requested_changes'
    expect((await ops.getPullRequests(repo))?.pulls[0].reviewRequested).toBe(false)
    expect(notesAsked()).toBe(2)
  })
})
