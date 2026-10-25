// GitHub pull requests: sign-in, reading, creating and merging against a fake api.github.com,
// and the local branch for a pull request against real repositories ("github.com" is rewritten
// to a bare repository on disk with url.<path>.insteadOf).

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AdarError } from '@shared/errors'
import type { PlatformAdapter } from '../platform'
import { createGitContext } from '../git/context'
import { cleanupTmp, commitFile, git, head, initRepo, isolateGitConfig, tmpDir } from '../git/write/__tests__/helpers'
import { SettingsStore, normalizeServerUrl, sanitizeBitbucketServers } from '../system/settings'
import { ghConfigDir, ghUserFromHosts, isPlausibleToken, TokenStore, type SecretBox } from './auth'
import { cloudForkUrl } from './bitbucketCloud'
import { pickHostingRemote } from '@shared/remoteUrl'
import { createHostingOps, parseRemoteUrls } from './index'

const TOKEN = 'ghp_' + 'a'.repeat(36)
const GH_TOKEN = 'gho_' + 'b'.repeat(36)

/** Reversible stand-in for safeStorage: the file must never hold the token as written. */
const box: SecretBox = {
  available: () => true,
  encrypt: (t) => Buffer.from([...Buffer.from(t)].reverse()),
  decrypt: (b) => Buffer.from([...b].reverse()).toString()
}

interface Call {
  method: string
  url: string
  auth: string | null
  body: unknown
}

function fakeGithub(routes: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, auth: new Headers(init?.headers).get('authorization'), body })
    const route = routes[`${method} ${url.replace('https://api.github.com', '')}`]
    if (!route) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    const { status = 200, json } = route(body)
    return new Response(JSON.stringify(json), { status })
  }
  return { calls, fetchFn }
}

function setup(routes: Parameters<typeof fakeGithub>[0], opts: { ghToken?: string | null } = {}) {
  const userData = tmpDir('adar-hosting-ud-')
  const gh = fakeGithub(routes)
  const platform: PlatformAdapter = {
    isElectron: false,
    appVersion: 'test',
    userDataDir: userData,
    pickDirectory: async () => null,
    openExternal: async () => undefined,
    showInFolder: async () => undefined,
    fetch: gh.fetchFn,
    secrets: box
  }
  const ctx = createGitContext(platform, () => undefined)
  const settings = new SettingsStore(userData)
  const ghCli = { token: async () => opts.ghToken ?? null, login: async () => (opts.ghToken ? 'mikel' : null), forget: () => undefined }
  const ops = createHostingOps(ctx, { ready: Promise.resolve(), settings }, { gh: ghCli })
  return { ops, calls: gh.calls, userData, settings }
}

const userRoute = { 'GET /user': () => ({ json: { login: 'mikel' } }) }

function githubRepo(url = 'git@github.com:acme/widgets.git'): string {
  const repo = initRepo()
  commitFile(repo, 'a.txt', 'a\n', 'first')
  git(repo, ['remote', 'add', 'origin', url])
  return repo
}

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

describe('GitHub sign-in helpers', () => {
  it('reads gh’s github.com user from hosts.yml', () => {
    const yaml = 'gitlab.com:\n    user: other\ngithub.com:\n    users:\n        mikel:\n    git_protocol: ssh\n    user: mikel\n'
    expect(ghUserFromHosts(yaml)).toBe('mikel')
    expect(ghUserFromHosts('gitlab.com:\n    user: other\n')).toBeNull()
    expect(ghUserFromHosts('')).toBeNull()
    expect(ghConfigDir({ GH_CONFIG_DIR: '/x' }, 'darwin', '/home/me')).toBe('/x')
    expect(ghConfigDir({}, 'linux', '/home/me')).toBe(path.join('/home/me', '.config', 'gh'))
    expect(isPlausibleToken(TOKEN)).toBe(true)
    expect(isPlausibleToken('ghp_short')).toBe(false)
    expect(isPlausibleToken(`${TOKEN} x`)).toBe(false)
  })

  it('keeps the token encrypted, and refuses to store it without protected storage', async () => {
    const dir = tmpDir('adar-token-')
    const store = new TokenStore(dir, box)
    await store.write(TOKEN)
    expect(fs.readFileSync(path.join(dir, 'github-token.json'), 'utf8')).not.toContain(TOKEN)
    expect(await store.read()).toBe(TOKEN)
    await store.clear()
    expect(await store.read()).toBeNull()
    const none = new TokenStore(dir, { ...box, available: () => false })
    await expect(none.write(TOKEN)).rejects.toThrow(/protected storage/)
    expect(new TokenStore(dir, undefined).available()).toBe(false)
  })

  it('picks the remote pull requests live on', () => {
    const pick = (lines: string, preferred?: string) => pickHostingRemote(parseRemoteUrls(lines), [], preferred)
    const lines = 'remote.fork.url git@github.com:me/widgets.git\nremote.origin.url https://github.com/acme/widgets.git\nremote.lab.url git@gitlab.com:x/y.git'
    expect(pick(lines)).toMatchObject({ remote: 'origin', provider: 'github', owner: 'acme', name: 'widgets' })
    expect(pick(lines, 'fork')).toMatchObject({ remote: 'fork', owner: 'me', name: 'widgets' })
    expect(pick('remote.up.stream.url git@github.com-work:acme/widgets')).toMatchObject({ remote: 'up.stream', owner: 'acme', name: 'widgets' })
    expect(pick('remote.origin.url git@gitlab.com:x/y.git')).toBeNull()
    expect(pick('remote.-x.url git@github.com:a/b.git')).toBeNull()
  })
})

describe('GitHub pull requests', () => {
  it('stays off, and silent, until turned on', async () => {
    const { ops, calls } = setup({})
    const repo = githubRepo()
    expect(await ops.getPullRequests(repo)).toBeNull()
    expect(await ops.getGithubConnection()).toMatchObject({ method: null, login: null, ghLogin: null, canStoreToken: true })
    expect(await ops.getGithubConnection({ detectGh: true })).toMatchObject({ method: null, ghLogin: null })
    await expect(ops.createPullRequest(repo, { head: 'x', base: 'main', title: 'T', body: '', draft: false })).rejects.toThrow(/off/)
    expect(calls).toEqual([])
  })

  it('signs in with a token (checked, then stored encrypted) or with gh, and signs out', async () => {
    const { ops, calls, userData, settings } = setup(userRoute, { ghToken: GH_TOKEN })
    await expect(ops.connectGithub('token', 'nope')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    // gh is only asked when the sign-in dialog wants to know, or when it is the sign-in.
    expect((await ops.getGithubConnection()).ghLogin).toBeNull()
    expect((await ops.getGithubConnection({ detectGh: true })).ghLogin).toBe('mikel')
    const conn = await ops.connectGithub('token', TOKEN)
    expect(conn).toMatchObject({ method: 'token', login: 'mikel', error: null, ghLogin: null })
    expect(calls.at(-1)).toMatchObject({ method: 'GET', url: 'https://api.github.com/user', auth: `Bearer ${TOKEN}` })
    expect((await settings.getSettings()).githubAuth).toBe('token')
    expect(fs.readFileSync(path.join(userData, 'github-token.json'), 'utf8')).not.toContain(TOKEN)

    expect(await ops.connectGithub('gh')).toMatchObject({ method: 'gh', login: 'mikel' })
    expect(calls.at(-1)?.auth).toBe(`Bearer ${GH_TOKEN}`)
    // Switching to gh forgets the stored token.
    expect(fs.existsSync(path.join(userData, 'github-token.json'))).toBe(false)

    expect(await ops.disconnectGithub()).toMatchObject({ method: null, login: null })
    expect((await settings.getSettings()).githubAuth).toBe('')
  })

  it('reports a revoked sign-in instead of failing silently', async () => {
    let revoked = false
    const answer = (json: unknown) => () => (revoked ? { status: 401, json: { message: 'Bad credentials' } } : { json })
    const { ops } = setup({ 'GET /user': answer({ login: 'mikel' }), 'POST /graphql': answer({ data: null }) })
    const repo = githubRepo()
    await ops.connectGithub('token', TOKEN)
    revoked = true
    await expect(ops.getPullRequests(repo)).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(await ops.getGithubConnection()).toMatchObject({ method: 'token', login: null, error: expect.stringMatching(/did not accept/) })
  })

  it('reads the pull requests of the GitHub remote', async () => {
    const node = {
      number: 42,
      title: 'Workspaces',
      url: 'https://github.com/acme/widgets/pull/42',
      state: 'OPEN',
      isDraft: false,
      headRefName: 'feat/workspaces',
      headRefOid: 'a'.repeat(40),
      isCrossRepository: false,
      baseRefName: 'main',
      author: { login: 'mikel' },
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      commits: { totalCount: 3, nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [] } } } }] }
    }
    const { ops, calls } = setup({
      ...userRoute,
      'POST /graphql': () => ({
        json: {
          data: {
            viewer: { login: 'mikel' },
            repository: {
              url: 'https://github.com/acme/widgets',
              viewerPermission: 'WRITE',
              squashMergeAllowed: true,
              mergeCommitAllowed: false,
              rebaseMergeAllowed: true,
              defaultBranchRef: { name: 'main' },
              open: { nodes: [node] },
              done: { nodes: [] }
            }
          }
        }
      })
    })
    const repo = githubRepo()
    await ops.connectGithub('token', TOKEN)
    const res = await ops.getPullRequests(repo)
    expect(calls.at(-1)?.body).toMatchObject({ variables: { owner: 'acme', name: 'widgets' } })
    expect(res).toMatchObject({ owner: 'acme', name: 'widgets', remote: 'origin', canMerge: true, mergeMethods: ['squash', 'rebase'] })
    expect(res?.pulls).toEqual([expect.objectContaining({ number: 42, state: 'open', checks: 'passed', review: 'approved', mergeable: 'clean', commitCount: 3, viewerIsAuthor: true })])
    // Not a GitHub repository: nothing to ask.
    const plain = initRepo()
    expect(await ops.getPullRequests(plain)).toBeNull()
  })

  it('creates and merges pull requests with validated input', async () => {
    const created = {
      number: 43,
      html_url: 'https://github.com/acme/widgets/pull/43',
      state: 'open',
      draft: true,
      title: 'Dashboard',
      user: { login: 'mikel' },
      head: { ref: 'feat/dash', sha: 'c'.repeat(40), repo: { full_name: 'acme/widgets' } },
      base: { ref: 'main', repo: { full_name: 'acme/widgets' } }
    }
    const { ops, calls } = setup({
      ...userRoute,
      'POST /repos/acme/widgets/pulls': () => ({ status: 201, json: created }),
      'GET /repos/acme/widgets/pulls/43/commits?per_page=100': () => ({ json: [{ sha: 'c'.repeat(40), commit: { message: 'Dashboard\n\nMore', author: { name: 'Ana' } } }] }),
      'PUT /repos/acme/widgets/pulls/43/merge': (body) =>
        (body as { sha: string }).sha === 'c'.repeat(40) ? { json: { merged: true } } : { status: 409, json: { message: 'Head branch was modified. Review and try the merge again.' } }
    })
    const repo = githubRepo('https://github.com/acme/widgets')
    await ops.connectGithub('token', TOKEN)
    const base = { head: 'feat/dash', base: 'main', title: '  Dashboard ', body: 'Body', draft: true }
    await expect(ops.createPullRequest(repo, { ...base, title: ' ' })).rejects.toThrow(/title/)
    await expect(ops.createPullRequest(repo, { ...base, head: '--upload-pack=x' })).rejects.toThrow(/branch/)
    await expect(ops.createPullRequest(repo, { ...base, head: 'main' })).rejects.toThrow(/different/)
    const pr = await ops.createPullRequest(repo, base)
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { title: 'Dashboard', head: 'feat/dash', base: 'main', body: 'Body', draft: true } })
    expect(pr).toMatchObject({ number: 43, state: 'draft', headRef: 'feat/dash', headFork: null })

    expect(await ops.getPullRequestCommits(repo, 43)).toEqual([{ sha: 'c'.repeat(40), subject: 'Dashboard', author: 'Ana' }])
    await ops.mergePullRequest(repo, 43, { method: 'squash', headSha: 'c'.repeat(40) })
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { merge_method: 'squash', sha: 'c'.repeat(40) } })
    await expect(ops.mergePullRequest(repo, 43, { method: 'squash', headSha: 'd'.repeat(40) })).rejects.toThrow(/changed on GitHub/)
    await expect(ops.mergePullRequest(repo, 43, { method: 'octopus' as never, headSha: 'c'.repeat(40) })).rejects.toThrow(/method/)
  })

  it('makes the local branch of a pull request, from the same repository or from a fork', async () => {
    // "GitHub": a bare repository with feat/x and a fork's pull request at refs/pull/7/head.
    const work = initRepo()
    const base = commitFile(work, 'a.txt', 'a\n', 'first')
    git(work, ['checkout', '-q', '-b', 'feat/x'])
    const featSha = commitFile(work, 'b.txt', 'b\n', 'feature')
    git(work, ['checkout', '-q', '-b', 'fork-work', base])
    const forkSha = commitFile(work, 'c.txt', 'c\n', 'from a fork')
    const bare = path.join(tmpDir('adar-hosting-gh-'), 'widgets.git')
    git(work, ['init', '-q', '--bare', bare])
    git(work, ['push', '-q', bare, 'main', 'feat/x'])
    git(work, ['push', '-q', bare, `${forkSha}:refs/pull/7/head`])

    const pull = (number: number, ref: string, sha: string, fork: string) => ({
      json: {
        number,
        html_url: `https://github.com/acme/widgets/pull/${number}`,
        state: 'open',
        user: { login: 'ane' },
        head: { ref, sha, repo: { full_name: fork } },
        base: { ref: 'main', repo: { full_name: 'acme/widgets' } }
      }
    })
    const { ops } = setup({
      ...userRoute,
      'GET /repos/acme/widgets/pulls/5': () => pull(5, 'feat/x', featSha, 'acme/widgets'),
      'GET /repos/acme/widgets/pulls/7': () => pull(7, 'fix', forkSha, 'ane/widgets')
    })
    const repo = tmpDir('adar-hosting-clone-')
    git(repo, ['clone', '-q', bare, '.'])
    git(repo, ['remote', 'set-url', 'origin', 'https://github.com/acme/widgets.git'])
    git(repo, ['config', `url.${bare}.insteadOf`, 'https://github.com/acme/widgets.git'])
    await ops.connectGithub('token', TOKEN)

    expect(await ops.pullRequestBranch(repo, 5)).toBe('feat/x')
    expect(head(repo, 'feat/x')).toBe(featSha)
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'feat/x@{upstream}']).trim()).toBe('origin/feat/x')
    // Again: the branch is there already.
    expect(await ops.pullRequestBranch(repo, 5)).toBe('feat/x')

    expect(await ops.pullRequestBranch(repo, 7)).toBe('pr/7')
    expect(head(repo, 'pr/7')).toBe(forkSha)
    // Checked out and behind the pull request: fast-forwarded.
    git(repo, ['checkout', '-q', 'pr/7'])
    git(repo, ['reset', '-q', '--hard', base])
    expect(await ops.pullRequestBranch(repo, 7)).toBe('pr/7')
    expect(head(repo)).toBe(forkSha)
    // Local commits that are not in the pull request are never overwritten.
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['branch', '-f', 'pr/7', base])
    git(repo, ['config', 'user.name', 'T'])
    await expect(ops.pullRequestBranch(repo, 7)).resolves.toBe('pr/7') // fast-forward from base is fine
    git(repo, ['checkout', '-q', 'pr/7'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'mine'])
    git(repo, ['checkout', '-q', 'main'])
    await expect(ops.pullRequestBranch(repo, 7)).rejects.toThrow(AdarError)
  })
})

// ── Bitbucket ──────────────────────────────────────────────────────────────

type Route = (body: unknown) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }

function fakeHttp(routes: Record<string, Route>) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, auth: new Headers(init?.headers).get('authorization'), body })
    const route = routes[`${method} ${url}`]
    if (!route) return new Response(JSON.stringify({ errors: [{ message: `No route for ${method} ${url}` }] }), { status: 404 })
    const { status = 200, json, text, headers } = route(body)
    return new Response(text ?? JSON.stringify(json ?? null), { status, headers })
  }
  return { calls, fetchFn }
}

function setupBitbucket(routes: Record<string, Route>) {
  const userData = tmpDir('adar-bb-ud-')
  const http = fakeHttp(routes)
  const platform: PlatformAdapter = {
    isElectron: false,
    appVersion: 'test',
    userDataDir: userData,
    pickDirectory: async () => null,
    openExternal: async () => undefined,
    showInFolder: async () => undefined,
    fetch: http.fetchFn,
    secrets: box
  }
  const ctx = createGitContext(platform, () => undefined)
  const settings = new SettingsStore(userData)
  const ghCli = { token: async () => null, login: async () => null, forget: () => undefined }
  return { ops: createHostingOps(ctx, { ready: Promise.resolve(), settings }, { gh: ghCli }), calls: http.calls, settings, userData }
}

const API = 'https://api.bitbucket.org/2.0'
const REPO_API = `${API}/repositories/acme/widgets`
const BB_TOKEN = 'ATATT' + 'x'.repeat(60)
const sha40 = (c: string) => c.repeat(40)

describe('Bitbucket server addresses', () => {
  it('keeps https addresses without credentials, and well-formed servers only', () => {
    expect(normalizeServerUrl('https://Bitbucket.Example.com/context/')).toBe('https://bitbucket.example.com/context')
    expect(normalizeServerUrl('http://bitbucket.example.com')).toBeNull()
    expect(normalizeServerUrl('https://user:pw@bitbucket.example.com')).toBeNull()
    expect(normalizeServerUrl('https://bitbucket.example.com/?x=1')).toBeNull()
    expect(normalizeServerUrl('http://127.0.0.1:7990')).toBeNull()
    expect(normalizeServerUrl('http://127.0.0.1:7990', true)).toBe('http://127.0.0.1:7990')
    expect(
      sanitizeBitbucketServers([
        { url: 'https://a.example.com/', hosts: ['A.example.com', 'ssh.example.com:7999', 'bad host'] },
        { url: 'https://a.example.com' },
        { url: 'ftp://b.example.com', hosts: [] },
        'junk'
      ])
    ).toEqual([{ url: 'https://a.example.com', hosts: ['a.example.com', 'ssh.example.com:7999'] }])
    expect(cloudForkUrl('git@bitbucket.org:acme/widgets.git', 'ane/widgets')).toBe('git@bitbucket.org:ane/widgets.git')
    expect(cloudForkUrl('https://bitbucket.org/acme/widgets.git', 'ane/widgets')).toBe('https://bitbucket.org/ane/widgets.git')
    expect(cloudForkUrl('https://bitbucket.org/acme/widgets.git', '../x')).toBeNull()
  })
})

describe('Bitbucket Cloud pull requests', () => {
  const prJson = (state = 'OPEN', hash = 'abcdef123456') => ({
    id: 128,
    title: 'Saved cards',
    state,
    author: { display_name: 'Ane', uuid: '{ane}' },
    source: { branch: { name: 'feat/cards' }, commit: { hash }, repository: { full_name: 'acme/widgets' } },
    destination: { branch: { name: 'main', merge_strategies: ['merge_commit', 'squash'], default_merge_strategy: 'merge_commit' }, repository: { full_name: 'acme/widgets' } },
    links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/128' } },
    updated_on: '2026-10-25T10:00:00Z',
    task_count: 1,
    participants: [{ user: { display_name: 'Jon', uuid: '{jon}' }, approved: true, state: 'approved' }],
    reviewers: [{ display_name: 'Jon', uuid: '{jon}' }]
  })
  let merges = 0
  const routes: Record<string, Route> = {
    [`GET ${API}/user`]: () => ({ json: { display_name: 'Mikel Garcia', uuid: '{me}', account_id: 'acc-me' } }),
    [`GET ${REPO_API}`]: () => ({ json: { mainbranch: { name: 'main' } } }),
    [`GET ${REPO_API}/pullrequests?state=OPEN&pagelen=50`]: () => ({ json: { values: [{ ...prJson(), participants: undefined, reviewers: undefined }] } }),
    [`GET ${REPO_API}/pullrequests?state=MERGED&state=DECLINED&state=SUPERSEDED&sort=-updated_on&pagelen=30`]: () => ({ json: { values: [{ ...prJson('DECLINED'), id: 120 }] } }),
    [`GET ${API}/user/permissions/repositories?q=${encodeURIComponent('repository.full_name="acme/widgets"')}`]: () => ({ json: { values: [{ permission: 'write' }] } }),
    [`GET ${REPO_API}/pullrequests/128`]: () => ({ json: prJson() }),
    [`GET ${REPO_API}/pullrequests/128/statuses?pagelen=50`]: () => ({ json: { values: [{ name: 'test', state: 'SUCCESSFUL' }] } }),
    [`GET ${REPO_API}/pullrequests/128/commits?pagelen=100`]: () => ({ json: { values: [{ hash: sha40('c'), message: 'Saved cards' }] } }),
    [`POST ${REPO_API}/pullrequests`]: () => ({ status: 201, json: { ...prJson(), id: 129, title: 'Search' } }),
    [`POST ${REPO_API}/pullrequests/128/merge`]: () => {
      merges++
      return { status: 202, json: {}, headers: { location: `${REPO_API}/pullrequests/128/merge/task-status/t1` } }
    },
    [`GET ${REPO_API}/pullrequests/128/merge/task-status/t1`]: () => ({ json: { task_status: 'SUCCESS' } })
  }

  it('signs in with the email and an API token, then reads, creates and merges', async () => {
    const { ops, calls, settings, userData } = setupBitbucket(routes)
    const repo = githubRepo('git@bitbucket.org:acme/widgets.git')
    expect(await ops.getPullRequests(repo)).toBeNull()
    expect(calls).toEqual([])
    await expect(ops.connectBitbucket({ kind: 'cloud', email: 'nope', token: BB_TOKEN })).rejects.toThrow(/email/)
    const conn = await ops.connectBitbucket({ kind: 'cloud', email: 'mikel@example.com', token: BB_TOKEN })
    expect(conn.cloud).toEqual({ email: 'mikel@example.com', login: 'Mikel Garcia', error: null })
    expect(calls.at(-1)?.auth).toBe(`Basic ${Buffer.from(`mikel@example.com:${BB_TOKEN}`).toString('base64')}`)
    expect((await settings.getSettings()).bitbucketAuth).toBe('token')
    expect(fs.readFileSync(path.join(userData, 'bitbucket-token.json'), 'utf8')).not.toContain(BB_TOKEN)

    const res = await ops.getPullRequests(repo)
    expect(res).toMatchObject({ provider: 'bitbucket-cloud', host: 'bitbucket.org', defaultBranch: 'main', canMerge: true, reportsConflicts: false, mergeMethods: ['merge', 'squash'] })
    expect(res?.pulls.map((p) => [p.number, p.state, p.checks, p.openTasks, p.approvedBy.join()])).toEqual([
      [128, 'open', 'passed', 1, 'Jon'],
      [120, 'closed', 'none', 1, 'Jon']
    ])
    expect(await ops.getPullRequestCommits(repo, 128)).toEqual([{ sha: sha40('c'), subject: 'Saved cards', author: '' }])
    expect(await ops.getPullRequestMergeChecks(repo, 128)).toBeNull()

    const created = await ops.createPullRequest(repo, { head: 'feat/search', base: 'main', title: 'Search', body: 'B', draft: true })
    expect(created.number).toBe(129)
    expect(calls.find((c) => c.method === 'POST' && c.url === `${REPO_API}/pullrequests`)?.body).toEqual({
      title: 'Search',
      description: 'B',
      source: { branch: { name: 'feat/search' } },
      destination: { branch: { name: 'main' } },
      draft: true,
      close_source_branch: false
    })

    // The full sha of the abbreviated head is accepted; another commit is refused before merging.
    await expect(ops.mergePullRequest(repo, 128, { method: 'squash', headSha: sha40('9') })).rejects.toThrow(/changed on Bitbucket/)
    await expect(ops.mergePullRequest(repo, 128, { method: 'rebase', headSha: 'abcdef123456' + '0'.repeat(28) })).rejects.toThrow(/does not allow/)
    await ops.mergePullRequest(repo, 128, { method: 'squash', headSha: 'abcdef123456' + '0'.repeat(28) })
    expect(merges).toBe(1)
    expect(calls.find((c) => c.url.endsWith('/pullrequests/128/merge'))?.body).toEqual({ merge_strategy: 'squash', close_source_branch: false })

    expect((await ops.disconnectBitbucket({ kind: 'cloud' })).cloud).toBeNull()
    expect(await ops.getPullRequests(repo)).toBeNull()
  })
})

describe('Bitbucket Data Center pull requests', () => {
  const SERVER = 'https://bitbucket.example.com'
  const R = `${SERVER}/rest/api/1.0/projects/WEB/repos/widgets`
  const pr = (id: number, from: string, project = 'WEB', state = 'OPEN') => ({
    id,
    version: 4,
    title: `PR ${id}`,
    state,
    fromRef: { displayId: id === 57 ? 'fix/rounding' : 'fix', latestCommit: from, repository: { slug: 'widgets', project: { key: project } } },
    toRef: { displayId: 'main', latestCommit: sha40('b'), repository: { slug: 'widgets', project: { key: 'WEB' } } },
    author: { user: { name: 'ane', displayName: 'Ane' } },
    reviewers: [{ user: { name: 'mikel', displayName: 'Mikel' }, status: 'UNAPPROVED' }],
    properties: { openTaskCount: 1, mergeResult: { outcome: 'CLEAN' } }
  })

  it('signs in with an HTTP access token, reads, checks and merges, and checks out a fork’s pull request', async () => {
    // "The server": a bare repository with the pull request refs Bitbucket keeps.
    const work = initRepo()
    const base = commitFile(work, 'a.txt', 'a\n', 'first')
    git(work, ['checkout', '-q', '-b', 'fork'])
    const forkSha = commitFile(work, 'f.txt', 'f\n', 'from a fork')
    const bare = path.join(tmpDir('adar-bb-server-'), 'widgets.git')
    git(work, ['init', '-q', '--bare', bare])
    git(work, ['push', '-q', bare, `${base}:refs/heads/main`, `${forkSha}:refs/pull-requests/58/from`])
    const repo = tmpDir('adar-bb-clone-')
    git(repo, ['clone', '-q', bare, '.'])
    git(repo, ['remote', 'set-url', 'origin', `${SERVER}/scm/web/widgets.git`])
    git(repo, ['config', `url.${bare}.insteadOf`, `${SERVER}/scm/web/widgets.git`])

    let version = 4
    const { ops, calls, settings } = setupBitbucket({
      [`GET ${SERVER}/rest/api/1.0/application-properties`]: () => ({ json: { version: '8.19.0' }, headers: { 'x-ausername': 'mikel' } }),
      [`GET ${R}/pull-requests?state=OPEN&limit=50`]: () => ({ json: { values: [pr(57, sha40('a')), pr(58, forkSha, '~ANE')] } }),
      [`GET ${R}/pull-requests?state=MERGED&order=NEWEST&limit=20`]: () => ({ json: { values: [] } }),
      [`GET ${R}/pull-requests?state=DECLINED&order=NEWEST&limit=10`]: () => ({ json: { values: [] } }),
      [`GET ${R}/settings/pull-requests`]: () => ({ json: { mergeConfig: { defaultStrategy: { id: 'no-ff' }, strategies: [{ id: 'no-ff' }, { id: 'squash' }] } } }),
      [`GET ${R}/default-branch`]: () => ({ json: { displayId: 'main' } }),
      [`GET ${SERVER}/rest/build-status/1.0/commits/${sha40('a')}`]: () => ({ json: { values: [{ name: 'ci', state: 'FAILED' }] } }),
      [`GET ${SERVER}/rest/build-status/1.0/commits/${forkSha}`]: () => ({ json: { values: [] } }),
      [`GET ${R}/pull-requests/57/merge`]: () => ({ json: { canMerge: false, conflicted: false, vetoes: [{ summaryMessage: 'Requires 2 approvals' }] } }),
      [`GET ${R}/pull-requests/57`]: () => ({ json: { ...pr(57, sha40('a')), version } }),
      [`POST ${R}/pull-requests/57/merge?version=4`]: () => ({ json: { state: 'MERGED' } }),
      [`GET ${R}/pull-requests/58`]: () => ({ json: pr(58, forkSha, '~ANE') })
    })
    await expect(ops.connectBitbucket({ kind: 'server', url: 'http://bitbucket.example.com', token: BB_TOKEN })).rejects.toThrow(/https/)
    const conn = await ops.connectBitbucket({ kind: 'server', url: `${SERVER}/`, token: BB_TOKEN, remoteHost: 'bitbucket.example.com' })
    expect(conn.servers).toEqual([{ url: SERVER, host: 'bitbucket.example.com', login: 'mikel', error: null }])
    expect(calls.at(-1)?.auth).toBe(`Bearer ${BB_TOKEN}`)
    expect((await settings.getSettings()).bitbucketServers).toEqual([{ url: SERVER, hosts: ['bitbucket.example.com'] }])

    const res = await ops.getPullRequests(repo)
    expect(res).toMatchObject({ provider: 'bitbucket-server', host: 'bitbucket.example.com', viewer: 'mikel', mergeMethods: ['merge', 'squash'], mergeChecks: true, reportsConflicts: true })
    expect(res?.pulls.map((p) => [p.number, p.checks, p.reviewRequested, p.headFork, p.url])).toEqual([
      [57, 'failed', true, null, `${SERVER}/projects/WEB/repos/widgets/pull-requests/57`],
      [58, 'none', true, '~ane/widgets', `${SERVER}/projects/WEB/repos/widgets/pull-requests/58`]
    ])
    expect(await ops.getPullRequestMergeChecks(repo, 57)).toEqual({ blocked: true, reasons: ['Requires 2 approvals'], conflicts: false })

    await ops.mergePullRequest(repo, 57, { method: 'merge', headSha: sha40('a') })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `${R}/pull-requests/57/merge?version=4`, body: { strategyId: 'no-ff' } })
    await expect(ops.mergePullRequest(repo, 57, { method: 'merge', headSha: sha40('e') })).rejects.toThrow(/changed on Bitbucket/)

    expect(await ops.pullRequestBranch(repo, 58)).toBe('pr/58')
    expect(head(repo, 'pr/58')).toBe(forkSha)

    expect((await ops.disconnectBitbucket({ kind: 'server', url: SERVER })).servers).toEqual([])
    expect(await ops.getPullRequests(repo)).toBeNull()
  })
})
