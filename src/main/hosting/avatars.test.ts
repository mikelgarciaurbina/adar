// Authors' pictures from the hosting services: what each answer gives, and getAuthorAvatars against fake GitHub and
// GitLab APIs (only while pull requests are on, cached, pictures only, the sign-in only sent to the service's host).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlatformAdapter } from '../platform'
import { createGitContext } from '../git/context'
import { cleanupTmp, commitFile, git, initRepo, isolateGitConfig, tmpDir } from '../git/write/__tests__/helpers'
import { SettingsStore } from '../system/settings'
import type { SecretBox } from './auth'
import { cloudCommitAvatar, githubAvatarQuery, githubAvatars, githubNoreplyAvatar, gitlabAvatar, serverCommitAvatar } from './avatars'
import { createHostingOps } from './index'

const sha = (c: string) => c.repeat(40)
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const box: SecretBox = {
  available: () => true,
  encrypt: (t) => Buffer.from([...Buffer.from(t)].reverse()),
  decrypt: (b) => Buffer.from([...b].reverse()).toString()
}

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

describe('What each service says about an author’s picture', () => {
  it('GitHub: noreply addresses, and commits linked to an account', () => {
    expect(githubNoreplyAvatar('12345+ane@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/u/12345?s=64&v=4')
    expect(githubNoreplyAvatar('ane@users.noreply.github.com')).toBeNull()
    expect(githubNoreplyAvatar('ane@example.com')).toBeNull()

    const asks = [
      { email: 'ane@example.com', sha: sha('a') },
      { email: 'jon@example.com', sha: sha('b') },
      { email: 'mikel@example.com', sha: sha('c') }
    ]
    const query = githubAvatarQuery([...asks, { email: 'x@example.com', sha: '") { evil' }])
    expect(query).toContain(`c0: object(oid: "${sha('a')}")`)
    expect(query).not.toContain('evil')
    const data = {
      repository: {
        c0: { author: { email: 'Ane@Example.com', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', user: { login: 'ane' } } },
        // Not linked to an account: GitHub's made-up picture is not taken.
        c1: { author: { email: 'jon@example.com', avatarUrl: 'https://avatars.githubusercontent.com/u/e?email=jon', user: null } },
        // The person asked about committed it.
        c2: {
          author: { email: 'ane@example.com', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', user: { login: 'ane' } },
          committer: { email: 'mikel@example.com', avatarUrl: 'https://avatars.githubusercontent.com/u/3?v=4', user: { login: 'mikel' } }
        }
      }
    }
    expect([...githubAvatars(data, asks)]).toEqual([
      ['ane@example.com', 'https://avatars.githubusercontent.com/u/1?v=4'],
      ['mikel@example.com', 'https://avatars.githubusercontent.com/u/3?v=4']
    ])
  })

  it('GitLab and Bitbucket: only pictures they keep themselves', () => {
    const base = 'https://gitlab.example.com/api/v4'
    expect(gitlabAvatar({ avatar_url: 'https://gitlab.example.com/uploads/-/system/user/avatar/7/a.png' }, base)).toBe('https://gitlab.example.com/uploads/-/system/user/avatar/7/a.png')
    expect(gitlabAvatar({ avatar_url: '/uploads/-/system/user/avatar/7/a.png' }, base)).toBe('https://gitlab.example.com/uploads/-/system/user/avatar/7/a.png')
    expect(gitlabAvatar({ avatar_url: 'https://www.gravatar.com/avatar/abc?s=64&d=identicon' }, base)).toBeNull()
    expect(gitlabAvatar({ avatar_url: null }, base)).toBeNull()

    const linked = { author: { raw: 'Ane <ane@example.com>', user: { links: { avatar: { href: 'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/1/a/128' } } } } }
    expect(cloudCommitAvatar(linked, 'ane@example.com')).toBe('https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/1/a/128')
    expect(cloudCommitAvatar(linked, 'jon@example.com')).toBeNull()
    expect(cloudCommitAvatar({ author: { raw: 'Ane <ane@example.com>' } }, 'ane@example.com')).toBeNull()

    const server = 'https://bitbucket.example.com/bitbucket'
    const commit = {
      author: { name: 'ane', emailAddress: 'ane@example.com', avatarUrl: '/bitbucket/users/ane/avatar.png?s=64', slug: 'ane' },
      committer: { name: 'Jon', emailAddress: 'jon@example.com', avatarUrl: 'https://secure.gravatar.com/avatar/x' }
    }
    expect(serverCommitAvatar(commit, 'ane@example.com', server)).toBe('https://bitbucket.example.com/bitbucket/users/ane/avatar.png?s=64')
    expect(serverCommitAvatar(commit, 'jon@example.com', server)).toBeNull()
  })
})

describe('getAuthorAvatars', () => {
  function setupFake(routes: Record<string, (init?: RequestInit) => Response>) {
    const userData = tmpDir('adar-avatar-ud-')
    const calls: Array<{ method: string; url: string; auth: string | null }> = []
    const fetchFn = async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ method, url, auth: new Headers(init?.headers).get('authorization') })
      const route = routes[`${method} ${url}`]
      return route ? route(init) : new Response('{"message":"Not Found"}', { status: 404 })
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
    return { ops, calls, settings }
  }
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
  const picture = (type = 'image/png') => new Response(PNG, { status: 200, headers: { 'content-type': type } })
  const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`

  it('GitHub: noreply addresses and linked commits, once, and nothing while pull requests are off', async () => {
    const TOKEN = 'ghp_' + 'a'.repeat(36)
    const { ops, calls, settings } = setupFake({
      'GET https://api.github.com/user': () => json({ login: 'mikel' }),
      'POST https://api.github.com/graphql': () =>
        json({
          data: {
            repository: {
              c0: { author: { email: 'ane@example.com', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=64&v=4', user: { login: 'ane' } } },
              c1: { author: { email: 'svg@example.com', avatarUrl: 'https://avatars.githubusercontent.com/u/2?s=64&v=4', user: { login: 'svg' } } }
            }
          }
        }),
      'GET https://avatars.githubusercontent.com/u/1?s=64&v=4': () => picture(),
      'GET https://avatars.githubusercontent.com/u/2?s=64&v=4': () => picture('image/svg+xml'),
      'GET https://avatars.githubusercontent.com/u/12345?s=64&v=4': () => picture()
    })
    const repo = initRepo()
    commitFile(repo, 'a.txt', 'a\n', 'first')
    git(repo, ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git'])
    const authors = [
      { email: '12345+jon@users.noreply.github.com', sha: sha('a') },
      { email: 'Ane@Example.com', sha: sha('b') },
      { email: 'svg@example.com', sha: sha('c') },
      { email: 'not an email', sha: sha('d') },
      { email: 'x@example.com', sha: 'HEAD' }
    ]

    expect(await ops.getAuthorAvatars(repo, authors)).toEqual({})
    expect(calls).toEqual([])

    await ops.connectGithub('token', TOKEN)
    calls.length = 0
    expect(await ops.getAuthorAvatars(repo, authors)).toEqual({ '12345+jon@users.noreply.github.com': dataUrl, 'ane@example.com': dataUrl })
    // One question to GitHub, pictures fetched without the token.
    expect(calls.filter((c) => c.url.includes('graphql'))).toHaveLength(1)
    expect(calls.filter((c) => c.url.startsWith('https://avatars.githubusercontent.com/')).every((c) => c.auth === null)).toBe(true)

    calls.length = 0
    expect(await ops.getAuthorAvatars(repo, authors)).toEqual({ '12345+jon@users.noreply.github.com': dataUrl, 'ane@example.com': dataUrl })
    expect(calls).toEqual([])

    await settings.updateSettings({ providerAvatars: false })
    expect(await ops.getAuthorAvatars(repo, authors)).toEqual({})
    await expect(ops.getAuthorAvatars(repo, 'nope' as unknown as [])).rejects.toThrow(/Invalid authors/)
  })

  it('GitLab: by public email, the picture fetched from GitLab itself with the sign-in', async () => {
    const SERVER = 'https://gitlab.example.com'
    const GL_TOKEN = 'glpat-' + 'g'.repeat(26)
    const avatarPath = '/uploads/-/system/user/avatar/7/ane.png'
    const { ops, calls } = setupFake({
      [`GET ${SERVER}/api/v4/user`]: () => json({ username: 'mikel', name: 'Mikel' }),
      [`GET ${SERVER}/api/v4/avatar?email=ane%40example.com&size=64`]: () => json({ avatar_url: `${SERVER}${avatarPath}` }),
      [`GET ${SERVER}/api/v4/avatar?email=jon%40example.com&size=64`]: () => json({ avatar_url: 'https://www.gravatar.com/avatar/x?d=identicon' }),
      // GitLab may keep the file in a bucket: the redirect is followed without the token.
      [`GET ${SERVER}${avatarPath}`]: () => new Response(null, { status: 302, headers: { location: 'https://storage.example.com/ane.png?sig=1' } }),
      'GET https://storage.example.com/ane.png?sig=1': () => picture('image/jpeg')
    })
    const repo = initRepo()
    commitFile(repo, 'a.txt', 'a\n', 'first')
    git(repo, ['remote', 'add', 'origin', `${SERVER}/web/widgets.git`])
    await ops.connectGitlab({ url: SERVER, token: GL_TOKEN })
    calls.length = 0

    const res = await ops.getAuthorAvatars(repo, [
      { email: 'ane@example.com', sha: sha('a') },
      { email: 'jon@example.com', sha: sha('b') }
    ])
    expect(res).toEqual({ 'ane@example.com': `data:image/jpeg;base64,${PNG.toString('base64')}` })
    expect(calls.find((c) => c.url === `${SERVER}${avatarPath}`)?.auth).toBe(`Bearer ${GL_TOKEN}`)
    expect(calls.find((c) => c.url.startsWith('https://storage.example.com/'))?.auth).toBeNull()
    // Gravatar's picture was never fetched.
    expect(calls.some((c) => c.url.includes('gravatar'))).toBe(false)
  })
})
