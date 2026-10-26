// Pull requests (opt-in) from GitHub, GitLab, Bitbucket Cloud and Bitbucket Data Center: the sign-ins,
// then each repository's pull requests through the provider its remote lives on (provider.ts),
// and the local branch for checking one out. Nothing talks to a provider the user has not turned on.

import { createHash } from 'node:crypto'
import { AdarError } from '@shared/errors'
import { bitbucketErrorMessage, cloudViewer, type CloudViewer } from '@shared/bitbucket'
import { gitlabErrorMessage, gitlabUser, type GitlabUser } from '@shared/gitlab'
import {
  BITBUCKET_API,
  GITLAB_COM,
  MAX_BODY,
  MAX_TITLE,
  isSafeBranchName,
  type BitbucketConnections,
  type CreatePullOptions,
  type GithubAuthMethod,
  type GithubConnection,
  type GitlabConnections,
  type MergeMethod,
  type PullRequest,
  type RepoPullRequests
} from '@shared/hosting'
import { pickHostingRemote } from '@shared/remoteUrl'
import type { AppSettings } from '@shared/types'
import type { GitContext } from '../git/context'
import type { HostingOps } from '../git/ops'
import { assertRepo } from '../git/read/common'
import type { SystemServices } from '../system'
import { normalizeServerUrl } from '../system/settings'
import { GhCli, TokenStore, isPlausibleToken } from './auth'
import { bitbucketCloudProvider, newCloudCaches } from './bitbucketCloud'
import { bitbucketServerProvider, newServerCaches, serverWhoAmI } from './bitbucketServer'
import { GithubClient } from './github'
import { githubProvider } from './githubProvider'
import { gitlabProvider, newGitlabCaches } from './gitlabProvider'
import { ApiClient } from './http'
import { invalid, type HostingRemote, type PullProvider } from './provider'

export interface HostingOptions {
  /** The GitHub CLI (tests pass a fake so they never read the developer's own sign-in). */
  gh?: Pick<GhCli, 'token' | 'login' | 'forget'>
}

/** Remotes from `git config --get-regexp ^remote\..*\.url$` output. */
export function parseRemoteUrls(lines: string): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = []
  for (const line of lines.split('\n')) {
    const m = /^remote\.(.+)\.url (.+)$/.exec(line.trim())
    if (m) out.push({ name: m[1], url: m[2] })
  }
  return out
}

const MERGE_METHODS: readonly MergeMethod[] = ['squash', 'merge', 'rebase', 'fast-forward']
const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,200}$/
const HOST = /^[a-z0-9.-]{1,200}(:\d{1,5})?$/

export function createHostingOps(ctx: GitContext, services: Pick<SystemServices, 'ready' | 'settings'>, options: HostingOptions = {}): HostingOps {
  const { platform } = ctx
  const gh = options.gh ?? new GhCli(services.ready)
  const githubTokens = new TokenStore(platform.userDataDir, platform.secrets)
  const cloudTokens = new TokenStore(platform.userDataDir, platform.secrets, 'bitbucket-token.json')
  const serverTokens = (url: string) =>
    new TokenStore(platform.userDataDir, platform.secrets, `bitbucket-server-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`)
  const gitlabTokens = (url: string) =>
    new TokenStore(platform.userDataDir, platform.secrets, `gitlab-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`)
  const fetchFn = platform.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const userAgent = `Adar/${platform.appVersion}`
  const caches = { cloud: newCloudCaches(), server: newServerCaches(), gitlab: newGitlabCaches() }

  /** Who each sign-in is, once the provider confirmed it (cleared on a 401 or a change). */
  let githubKnown: { method: GithubAuthMethod; login: string } | null = null
  let cloudKnown: (CloudViewer & { email: string }) | null = null
  const serverKnown = new Map<string, string>()
  const gitlabKnown = new Map<string, GitlabUser>()

  const settings = () => services.settings.getSettings()

  // ── GitHub ──────────────────────────────────────────────────────────────

  const githubTokenFor = async (m: GithubAuthMethod): Promise<string> => {
    const token = m === 'gh' ? await gh.token() : await githubTokens.read()
    if (token) return token
    throw new AdarError({
      message: m === 'gh' ? 'The GitHub CLI is not signed in to github.com. Run “gh auth login”, or sign in again in Adar.' : 'No GitHub token is stored on this computer. Sign in again.',
      code: 'AUTH_FAILED'
    })
  }

  const githubClient = (token: string) =>
    new GithubClient(
      fetchFn,
      token,
      userAgent,
      () => {
        githubKnown = null
        gh.forget()
      },
      platform.githubApi
    )

  const githubLogin = async (c: GithubClient): Promise<string> => {
    const user = (await c.rest('GET', '/user')) as { login?: unknown } | null
    if (typeof user?.login !== 'string' || !user.login) throw new AdarError({ message: 'GitHub did not say who is signed in', code: 'AUTH_FAILED' })
    return user.login
  }

  const getGithubConnection = async (opts?: { detectGh?: boolean }): Promise<GithubConnection> => {
    const m = (await settings()).githubAuth || null
    const ghLogin = opts?.detectGh === true || m === 'gh' ? await gh.login() : null
    let login: string | null = null
    let error: string | null = null
    if (m) {
      if (githubKnown?.method === m) login = githubKnown.login
      else {
        try {
          login = await githubLogin(githubClient(await githubTokenFor(m)))
          githubKnown = { method: m, login }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
      }
    }
    return { method: m, login, error, ghLogin, canStoreToken: githubTokens.available() }
  }

  // ── Bitbucket ───────────────────────────────────────────────────────────

  const bitbucketClient = (base: string, auth: string, onUnauthorized: () => void) =>
    new ApiClient({ fetch: fetchFn, base, auth, userAgent, service: 'Bitbucket', errorMessage: bitbucketErrorMessage, onUnauthorized })

  const cloudClient = (email: string, token: string) =>
    bitbucketClient(platform.bitbucketApi ?? BITBUCKET_API, `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, () => (cloudKnown = null))

  const serverClient = (url: string, token: string) => bitbucketClient(url, `Bearer ${token}`, () => serverKnown.delete(url))

  const cloudToken = async () => {
    const token = await cloudTokens.read()
    if (token) return token
    throw new AdarError({ message: 'No Bitbucket token is stored on this computer. Sign in again.', code: 'AUTH_FAILED' })
  }

  const serverToken = async (url: string) => {
    const token = await serverTokens(url).read()
    if (token) return token
    throw new AdarError({ message: `No token for ${new URL(url).host} is stored on this computer. Sign in again.`, code: 'AUTH_FAILED' })
  }

  const cloudWho = async (api: ApiClient, email: string): Promise<CloudViewer> => {
    if (cloudKnown?.email === email) return cloudKnown
    const viewer = cloudViewer(await api.json('GET', '/user'))
    if (!viewer) throw new AdarError({ message: 'Bitbucket did not say who is signed in', code: 'AUTH_FAILED' })
    cloudKnown = { ...viewer, email }
    return viewer
  }

  const serverWho = async (api: ApiClient, url: string): Promise<string> => {
    const cached = serverKnown.get(url)
    if (cached) return cached
    const name = await serverWhoAmI(api)
    serverKnown.set(url, name)
    return name
  }

  const getBitbucketConnections = async (): Promise<BitbucketConnections> => {
    const s = await settings()
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
    let cloud: BitbucketConnections['cloud'] = null
    if (s.bitbucketAuth) {
      try {
        const viewer = await cloudWho(cloudClient(s.bitbucketEmail, await cloudToken()), s.bitbucketEmail)
        cloud = { email: s.bitbucketEmail, login: viewer.name, error: null }
      } catch (err) {
        cloud = { email: s.bitbucketEmail, login: null, error: message(err) }
      }
    }
    const servers = await Promise.all(
      s.bitbucketServers.map(async ({ url }) => {
        const host = new URL(url).host
        try {
          return { url, host, login: await serverWho(serverClient(url, await serverToken(url)), url), error: null }
        } catch (err) {
          return { url, host, login: null, error: message(err) }
        }
      })
    )
    return { cloud, servers, canStoreToken: cloudTokens.available() }
  }

  // ── GitLab ──────────────────────────────────────────────────────────────

  const gitlabClient = (url: string, token: string) =>
    new ApiClient({
      fetch: fetchFn,
      // Development only: a stand-in for gitlab.com.
      base: `${url === GITLAB_COM && platform.gitlabCom ? platform.gitlabCom : url}/api/v4`,
      auth: `Bearer ${token}`,
      userAgent,
      service: 'GitLab',
      errorMessage: gitlabErrorMessage,
      onUnauthorized: () => gitlabKnown.delete(url)
    })

  const gitlabToken = async (url: string) => {
    const token = await gitlabTokens(url).read()
    if (token) return token
    throw new AdarError({ message: `No token for ${new URL(url).host} is stored on this computer. Sign in again.`, code: 'AUTH_FAILED' })
  }

  const gitlabWho = async (api: ApiClient, url: string): Promise<GitlabUser> => {
    const cached = gitlabKnown.get(url)
    if (cached) return cached
    const user = gitlabUser(await api.json('GET', '/user'))
    if (!user) throw new AdarError({ message: 'GitLab did not say who is signed in', code: 'AUTH_FAILED' })
    gitlabKnown.set(url, user)
    return user
  }

  const getGitlabConnections = async (): Promise<GitlabConnections> => {
    const s = await settings()
    const servers = await Promise.all(
      s.gitlabServers.map(async ({ url }) => {
        const host = new URL(url).host
        try {
          const who = await gitlabWho(gitlabClient(url, await gitlabToken(url)), url)
          return { url, host, login: who.name, error: null }
        } catch (err) {
          return { url, host, login: null, error: err instanceof Error ? err.message : String(err) }
        }
      })
    )
    return { servers, canStoreToken: githubTokens.available() }
  }

  // ── Repositories ────────────────────────────────────────────────────────

  const remoteOf = async (repo: string, s: AppSettings): Promise<HostingRemote | null> => {
    const [urls, resolved] = await Promise.all([
      ctx.git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'], { allowFailure: true }),
      ctx.git(repo, ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$'], { allowFailure: true })
    ])
    const remotes = urls.code === 0 ? parseRemoteUrls(urls.stdout) : []
    const preferred = resolved.code === 0 ? /^remote\.(.+)\.gh-resolved base$/m.exec(resolved.stdout)?.[1] : null
    const at = pickHostingRemote(remotes, { bitbucket: s.bitbucketServers, gitlab: s.gitlabServers }, preferred)
    return at ? { ...at, url: remotes.find((r) => r.name === at.remote)?.url ?? '' } : null
  }

  /** The provider for a repository's remote, when the user turned it on; null otherwise. */
  const providerFor = async (repo: string): Promise<{ at: HostingRemote | null; provider: PullProvider | null }> => {
    const s = await settings()
    const at = await remoteOf(repo, s)
    if (!at) return { at, provider: null }
    if (at.provider === 'github') {
      const m = s.githubAuth || null
      return { at, provider: m ? githubProvider(githubClient(await githubTokenFor(m)), at, () => githubKnown?.login ?? '') : null }
    }
    if (at.provider === 'gitlab') {
      const server = s.gitlabServers.find((x) => x.url === at.server)
      if (!server) return { at, provider: null }
      const api = gitlabClient(server.url, await gitlabToken(server.url))
      return { at, provider: gitlabProvider(api, at, server.url, () => gitlabWho(api, server.url).catch(() => null), caches.gitlab) }
    }
    if (at.provider === 'bitbucket-cloud') {
      if (!s.bitbucketAuth) return { at, provider: null }
      const api = cloudClient(s.bitbucketEmail, await cloudToken())
      return { at, provider: bitbucketCloudProvider(api, at, () => cloudWho(api, s.bitbucketEmail).catch(() => null), caches.cloud) }
    }
    const server = s.bitbucketServers.find((x) => x.url === at.server)
    if (!server) return { at, provider: null }
    const api = serverClient(server.url, await serverToken(server.url))
    return { at, provider: bitbucketServerProvider(api, at, server.url, () => serverWho(api, server.url).catch(() => ''), caches.server) }
  }

  const requireProvider = async (repo: string): Promise<{ at: HostingRemote; provider: PullProvider }> => {
    const { at, provider } = await providerFor(repo)
    if (!at) throw invalid('This repository has no GitHub, GitLab or Bitbucket remote')
    if (!provider) throw invalid('Pull requests are off for this repository. Turn them on in Settings → Integrations.')
    return { at, provider }
  }

  const checkNumber = (number: unknown) => {
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw invalid('Invalid pull request number')
  }

  return {
    getGithubConnection,

    async connectGithub(m, token) {
      if (m !== 'gh' && m !== 'token') throw invalid('Unknown sign-in method')
      let secret: string
      if (m === 'gh') {
        gh.forget()
        secret = await githubTokenFor('gh')
      } else {
        const t = typeof token === 'string' ? token.trim() : ''
        if (!isPlausibleToken(t)) throw invalid('That does not look like a GitHub token')
        if (!githubTokens.available()) throw invalid('This computer offers no protected storage for a token. Use the GitHub CLI instead.')
        secret = t
      }
      const login = await githubLogin(githubClient(secret))
      if (m === 'token') await githubTokens.write(secret)
      else await githubTokens.clear()
      await services.settings.updateSettings({ githubAuth: m })
      githubKnown = { method: m, login }
      return getGithubConnection()
    },

    async disconnectGithub() {
      githubKnown = null
      gh.forget()
      await githubTokens.clear()
      await services.settings.updateSettings({ githubAuth: '' })
      return getGithubConnection()
    },

    getBitbucketConnections,

    async connectBitbucket(opts) {
      const token = typeof opts?.token === 'string' ? opts.token.trim() : ''
      if (!isPlausibleToken(token)) throw invalid('That does not look like a Bitbucket token')
      if (!cloudTokens.available()) throw invalid('This computer offers no protected storage for a token.')
      if (opts.kind === 'cloud') {
        const email = typeof opts.email === 'string' ? opts.email.trim() : ''
        if (!EMAIL.test(email)) throw invalid('Enter the email of your Atlassian account')
        cloudKnown = null
        await cloudWho(cloudClient(email, token), email)
        await cloudTokens.write(token)
        await services.settings.updateSettings({ bitbucketAuth: 'token', bitbucketEmail: email })
      } else if (opts.kind === 'server') {
        const url = normalizeServerUrl(opts.url, !!platform.allowLoopbackServers)
        if (!url) throw invalid('Use the https address of your Bitbucket server, such as https://bitbucket.example.com')
        serverKnown.delete(url)
        await serverWho(serverClient(url, token), url)
        await serverTokens(url).write(token)
        const hosts = [new URL(url).host, typeof opts.remoteHost === 'string' ? opts.remoteHost.toLowerCase() : ''].filter((h) => HOST.test(h))
        const others = (await settings()).bitbucketServers.filter((x) => x.url !== url)
        await services.settings.updateSettings({ bitbucketServers: [...others, { url, hosts: [...new Set(hosts)] }] })
      } else throw invalid('Unknown Bitbucket')
      return getBitbucketConnections()
    },

    async disconnectBitbucket(target) {
      if (target?.kind === 'cloud') {
        cloudKnown = null
        await cloudTokens.clear()
        await services.settings.updateSettings({ bitbucketAuth: '' })
      } else if (target?.kind === 'server' && typeof target.url === 'string') {
        serverKnown.delete(target.url)
        await serverTokens(target.url).clear()
        const servers = (await settings()).bitbucketServers.filter((x) => x.url !== target.url)
        await services.settings.updateSettings({ bitbucketServers: servers })
      } else throw invalid('Unknown Bitbucket')
      return getBitbucketConnections()
    },

    getGitlabConnections,

    async connectGitlab(opts) {
      const token = typeof opts?.token === 'string' ? opts.token.trim() : ''
      if (!isPlausibleToken(token)) throw invalid('That does not look like a GitLab token')
      if (!githubTokens.available()) throw invalid('This computer offers no protected storage for a token.')
      const url = normalizeServerUrl(opts.url, !!platform.allowLoopbackServers)
      if (!url) throw invalid('Use the https address of your GitLab, such as https://gitlab.example.com')
      gitlabKnown.delete(url)
      await gitlabWho(gitlabClient(url, token), url)
      await gitlabTokens(url).write(token)
      const hosts = [new URL(url).host, typeof opts.remoteHost === 'string' ? opts.remoteHost.toLowerCase() : ''].filter((h) => HOST.test(h))
      const others = (await settings()).gitlabServers.filter((x) => x.url !== url)
      await services.settings.updateSettings({ gitlabServers: [...others, { url, hosts: [...new Set(hosts)] }] })
      return getGitlabConnections()
    },

    async disconnectGitlab(url) {
      if (typeof url !== 'string') throw invalid('Unknown GitLab')
      gitlabKnown.delete(url)
      await gitlabTokens(url).clear()
      const servers = (await settings()).gitlabServers.filter((x) => x.url !== url)
      await services.settings.updateSettings({ gitlabServers: servers })
      return getGitlabConnections()
    },

    async getPullRequests(repo): Promise<RepoPullRequests | null> {
      await assertRepo(ctx, repo)
      const { provider } = await providerFor(repo)
      return provider ? provider.list() : null
    },

    async getPullRequestCommits(repo, number) {
      await assertRepo(ctx, repo)
      checkNumber(number)
      return (await requireProvider(repo)).provider.commits(number)
    },

    async getPullRequestMergeChecks(repo, number) {
      await assertRepo(ctx, repo)
      checkNumber(number)
      return (await requireProvider(repo)).provider.mergeChecks(number)
    },

    async createPullRequest(repo, opts: CreatePullOptions): Promise<PullRequest> {
      await assertRepo(ctx, repo)
      const title = typeof opts?.title === 'string' ? opts.title.trim() : ''
      const body = typeof opts?.body === 'string' ? opts.body : ''
      if (!title) throw invalid('The pull request needs a title')
      if (title.length > MAX_TITLE) throw invalid(`The title is longer than ${MAX_TITLE} characters`)
      if (body.length > MAX_BODY * 3) throw invalid('The description is too long')
      if (!isSafeBranchName(opts.head) || !isSafeBranchName(opts.base)) throw invalid('Invalid branch name')
      if (opts.head === opts.base) throw invalid('Choose two different branches')
      const { provider } = await requireProvider(repo)
      return provider.create({ head: opts.head, base: opts.base, title, body, draft: opts.draft === true })
    },

    async mergePullRequest(repo, number, opts): Promise<void> {
      await assertRepo(ctx, repo)
      checkNumber(number)
      if (!MERGE_METHODS.includes(opts?.method)) throw invalid('Unknown merge method')
      if (typeof opts.headSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(opts.headSha)) throw invalid('Invalid commit')
      const { provider } = await requireProvider(repo)
      await provider.merge(number, opts.method, opts.headSha.toLowerCase())
    },

    async pullRequestBranch(repo, number): Promise<string> {
      await assertRepo(ctx, repo)
      checkNumber(number)
      const { at, provider } = await requireProvider(repo)
      const src = await provider.source(number)
      if (!isSafeBranchName(src.headRef)) throw invalid('The pull request has an unusable branch name')
      const exists = async (branch: string) =>
        (await ctx.git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true })).code === 0

      return ctx.exclusive(repo, async () => {
        if (!src.fork) {
          const branch = src.headRef
          if (await exists(branch)) return branch
          const tracking = `refs/remotes/${at.remote}/${branch}`
          await ctx.gitNetwork(repo, ['fetch', at.remote, `+refs/heads/${branch}:${tracking}`])
          await ctx.git(repo, ['branch', '--track', branch, tracking])
          return branch
        }
        // From a fork: fetched into pr/<n> (fast-forwarded when it is checked out), never overwriting local commits.
        const { from, ref } = src.fork
        if (from.startsWith('-')) throw invalid('Invalid fork address')
        const branch = `${at.provider === 'gitlab' ? 'mr' : 'pr'}/${number}`
        const head = await ctx.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
        if (head.code === 0 && head.stdout.trim() === branch) {
          await ctx.gitNetwork(repo, ['fetch', from, ref])
          await ctx.git(repo, ['merge', '--ff-only', 'FETCH_HEAD'])
          return branch
        }
        try {
          await ctx.gitNetwork(repo, ['fetch', from, `${ref}:refs/heads/${branch}`])
        } catch (err) {
          if (err instanceof AdarError && /non-fast-forward|rejected/i.test(`${err.stderr ?? ''} ${err.message}`)) {
            throw invalid(`${branch} has commits that are not in the pull request. Rename or delete ${branch} to check it out again.`)
          }
          throw err
        }
        return branch
      })
    }
  }
}
