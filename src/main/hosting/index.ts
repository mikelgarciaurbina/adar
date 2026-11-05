// Pull requests (opt-in) from GitHub, GitLab, Bitbucket Cloud, Bitbucket Data Center and Azure DevOps: the sign-ins,
// then each repository's pull requests through the provider its remote lives on (provider.ts),
// and the local branch for checking one out. Nothing talks to a provider the user has not turned on.

import { createHash } from 'node:crypto'
import { AdarError } from '@shared/errors'
import { azureErrorMessage, azureUser, type AzureUser } from '@shared/azure'
import { bitbucketErrorMessage, cloudViewer, type CloudViewer } from '@shared/bitbucket'
import { gitlabErrorMessage, gitlabUser, type GitlabUser } from '@shared/gitlab'
import {
  AZURE_DEVOPS,
  BITBUCKET_API,
  GITLAB_COM,
  MAX_BODY,
  MAX_TITLE,
  PROVIDER_NAMES,
  isSafeBranchName,
  type AuthorAsk,
  type AzureConnections,
  type BitbucketConnections,
  type CreatePullOptions,
  type GithubAuthMethod,
  type GithubConnection,
  type HostingServer,
  type ServerAuth,
  type GitlabConnections,
  type MergeMethod,
  type PullRequest,
  type RepoPullRequests
} from '@shared/hosting'
import { pickHostingRemote } from '@shared/remoteUrl'
import { parsePullNotice, parseReviewAction, rangeDiffChanged, rangeDiffSame, type ReviewRange } from '@shared/review'
import type { AppSettings } from '@shared/types'
import type { GitContext } from '../git/context'
import type { HostingOps } from '../git/ops'
import { assertRepo } from '../git/read/common'
import type { SystemServices } from '../system'
import { normalizeServerUrl } from '../system/settings'
import { GhCli, GlabCli, TokenStore, isPlausibleToken } from './auth'
import { azureProvider, newAzureCaches } from './azureProvider'
import { bitbucketCloudProvider, newCloudCaches } from './bitbucketCloud'
import { bitbucketServerProvider, newServerCaches, serverWhoAmI } from './bitbucketServer'
import { MAX_AVATAR_ASKS, PUBLIC_AVATAR_HOSTS } from './avatars'
import { GithubClient } from './github'
import { GITHUB_OAUTH_CLIENT_ID, GithubDeviceFlow } from './githubDevice'
import { githubProvider } from './githubProvider'
import { gitlabProvider, newGitlabCaches } from './gitlabProvider'
import { ApiClient, BoundedCache, mapLimit, publicImage } from './http'
import { fileLines, lineLength, mergeBase } from './place'
import { invalid, type HostingRemote, type PullProvider } from './provider'

export interface HostingOptions {
  /** The GitHub CLI (tests pass a fake so they never read the developer's own sign-in). */
  gh?: Pick<GhCli, 'token' | 'login' | 'forget'>
  /** The GitLab CLI (the same, for glab). */
  glab?: Pick<GlabCli, 'token' | 'forget'>
  /** Signing in from the browser: tests pass an OAuth app id, a stand-in for github.com and their own clock. */
  githubOAuth?: { clientId: string; web?: string; now?: () => number }
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
/** An author the provider had no picture for is asked about again after this long. */
const AVATAR_MISS_MS = 30 * 60_000
const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,200}$/
const HOST = /^[a-z0-9.-]{1,200}(:\d{1,5})?$/

export function createHostingOps(ctx: GitContext, services: Pick<SystemServices, 'ready' | 'settings'>, options: HostingOptions = {}): HostingOps {
  const { platform } = ctx
  const gh = options.gh ?? new GhCli(services.ready)
  const glab = options.glab ?? new GlabCli(services.ready)
  const githubTokens = new TokenStore(platform.userDataDir, platform.secrets)
  const cloudTokens = new TokenStore(platform.userDataDir, platform.secrets, 'bitbucket-token.json')
  const serverTokens = (url: string) =>
    new TokenStore(platform.userDataDir, platform.secrets, `bitbucket-server-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`)
  const gitlabTokens = (url: string) =>
    new TokenStore(platform.userDataDir, platform.secrets, `gitlab-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`)
  const enterpriseTokens = (url: string) =>
    new TokenStore(platform.userDataDir, platform.secrets, `github-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`)
  const azureTokens = (url: string) =>
    new TokenStore(platform.userDataDir, platform.secrets, `azure-${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`)
  const fetchFn = platform.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const userAgent = `Adar/${platform.appVersion}`
  const caches = { cloud: newCloudCaches(), server: newServerCaches(), gitlab: newGitlabCaches(), azure: newAzureCaches() }
  const device = new GithubDeviceFlow({
    fetch: fetchFn,
    userAgent,
    clientId: options.githubOAuth?.clientId ?? platform.githubClientId ?? GITHUB_OAUTH_CLIENT_ID,
    web: options.githubOAuth?.web ?? platform.githubWeb,
    now: options.githubOAuth?.now
  })

  /** Who each sign-in is, once the provider confirmed it (cleared on a 401 or a change). */
  let githubKnown: { method: GithubAuthMethod; login: string } | null = null
  let cloudKnown: (CloudViewer & { email: string }) | null = null
  const serverKnown = new Map<string, string>()
  const gitlabKnown = new Map<string, GitlabUser>()
  const azureKnown = new Map<string, AzureUser>()
  /** GitHub Enterprise servers' signed-in users, by address. */
  const enterpriseKnown = new Map<string, string>()
  /** Authors' pictures (data: URLs, or null for none) by provider and email, for this run of Adar. */
  const avatarCache = new BoundedCache<{ data: string | null; at: number }>(2000)

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

  // GitHub Enterprise Server: its API under /api (REST at /api/v3, GraphQL at /api/graphql), with gh's sign-in
  // for its host or a token kept encrypted per server.
  const hostOf = (url: string) => new URL(url).host

  const enterpriseClient = (url: string, token: string) =>
    new GithubClient(
      fetchFn,
      token,
      userAgent,
      () => {
        enterpriseKnown.delete(url)
        gh.forget(hostOf(url))
      },
      `${url}/api`,
      '/v3'
    )

  const enterpriseToken = async (server: HostingServer): Promise<string> => {
    const host = hostOf(server.url)
    const token = server.auth === 'gh' ? await gh.token(host) : await enterpriseTokens(server.url).read()
    if (token) return token
    throw new AdarError({
      message:
        server.auth === 'gh'
          ? `The GitHub CLI is not signed in to ${host}. Run “gh auth login --hostname ${host}”, or sign in again in Adar.`
          : `No token for ${host} is stored on this computer. Sign in again.`,
      code: 'AUTH_FAILED'
    })
  }

  const enterpriseServers = async (): Promise<GithubConnection['servers']> =>
    Promise.all(
      (await settings()).githubServers.map(async (server) => {
        const method: GithubAuthMethod = server.auth === 'gh' ? 'gh' : 'token'
        const host = hostOf(server.url)
        const known = enterpriseKnown.get(server.url)
        if (known) return { url: server.url, host, method, login: known, error: null }
        try {
          const login = await githubLogin(enterpriseClient(server.url, await enterpriseToken(server)))
          enterpriseKnown.set(server.url, login)
          return { url: server.url, host, method, login, error: null }
        } catch (err) {
          return { url: server.url, host, method, login: null, error: err instanceof Error ? err.message : String(err) }
        }
      })
    )

  const getGithubConnection = async (opts?: { detectGh?: boolean; server?: string }): Promise<GithubConnection> => {
    const m = (await settings()).githubAuth || null
    const asked = typeof opts?.server === 'string' ? normalizeServerUrl(opts.server, !!platform.allowLoopbackServers) : null
    const ghLogin = asked ? (opts?.detectGh === true ? await gh.login(hostOf(asked)) : null) : opts?.detectGh === true || m === 'gh' ? await gh.login() : null
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
    const canStoreToken = githubTokens.available()
    return { method: m, login, error, ghLogin, servers: await enterpriseServers(), canStoreToken, canUseBrowser: canStoreToken && device.available }
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

  /**
   * The password git's credential helper keeps for a server (osxkeychain, the Git Credential Manager…): often a
   * personal access token for GitLab. Asked for with every prompt off; never stored by Adar.
   */
  const gitCredential = async (url: string): Promise<string | null> => {
    const u = new URL(url)
    const input = `protocol=${u.protocol.replace(':', '')}\nhost=${u.host}\n${u.pathname.length > 1 ? `path=${u.pathname.slice(1)}\n` : ''}\n`
    const res = await ctx.gitGlobal(['-c', 'core.askPass=', '-c', 'credential.interactive=false', 'credential', 'fill'], {
      input,
      allowFailure: true,
      timeoutMs: 15_000,
      env: { GIT_ASKPASS: undefined, SSH_ASKPASS: undefined, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' }
    })
    if (res.code !== 0) return null
    const password = /^password=(.*)$/m.exec(res.stdout)?.[1]?.trim() ?? ''
    return isPlausibleToken(password) ? password : null
  }

  /** A GitLab server's token: kept encrypted, or asked of glab or git's credential helper each time. */
  const gitlabToken = async (url: string, auth?: ServerAuth) => {
    const host = new URL(url).host
    const token = auth === 'glab' ? await glab.token(host) : auth === 'git' ? await gitCredential(url) : await gitlabTokens(url).read()
    if (token) return token
    throw new AdarError({
      message:
        auth === 'glab'
          ? `The GitLab CLI is not signed in to ${host}. Run “glab auth login --hostname ${host}”, or sign in again in Adar.`
          : auth === 'git'
            ? `Git no longer has a saved token for ${host}. Sign in again.`
            : `No token for ${host} is stored on this computer. Sign in again.`,
      code: 'AUTH_FAILED'
    })
  }

  const gitlabWho = async (api: ApiClient, url: string): Promise<GitlabUser> => {
    const cached = gitlabKnown.get(url)
    if (cached) return cached
    const user = gitlabUser(await api.json('GET', '/user'))
    if (!user) throw new AdarError({ message: 'GitLab did not say who is signed in', code: 'AUTH_FAILED' })
    gitlabKnown.set(url, user)
    return user
  }

  const getGitlabConnections = async (opts?: { detect?: string }): Promise<GitlabConnections> => {
    const s = await settings()
    const servers = await Promise.all(
      s.gitlabServers.map(async ({ url, auth }) => {
        const host = new URL(url).host
        const method: GitlabConnections['servers'][number]['method'] = auth === 'glab' || auth === 'git' ? auth : 'token'
        try {
          const who = await gitlabWho(gitlabClient(url, await gitlabToken(url, auth)), url)
          return { url, host, method, login: who.name, error: null }
        } catch (err) {
          return { url, host, method, login: null, error: err instanceof Error ? err.message : String(err) }
        }
      })
    )
    // Only the sign-in dialog asks what glab and git's credential helper have for the server.
    const asked = typeof opts?.detect === 'string' ? normalizeServerUrl(opts.detect, !!platform.allowLoopbackServers) : null
    const found = asked ? { glab: !!(await glab.token(new URL(asked).host)), git: !!(await gitCredential(asked)) } : null
    return { servers, found, canStoreToken: githubTokens.available() }
  }

  // ── Azure DevOps ────────────────────────────────────────────────────────

  /** An organization's address, https://dev.azure.com/<org> in lower case, or null. */
  const azureOrgUrl = (raw: unknown): string | null => {
    const url = normalizeServerUrl(raw, false)?.toLowerCase() ?? null
    return url && /^https:\/\/dev\.azure\.com\/[^/]{1,64}$/.test(url) ? url : null
  }

  const azureClient = (url: string, token: string) =>
    new ApiClient({
      fetch: fetchFn,
      // Development only: a stand-in for dev.azure.com.
      base: platform.azureDevOps ? url.replace(AZURE_DEVOPS, platform.azureDevOps) : url,
      auth: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
      userAgent,
      service: 'Azure DevOps',
      errorMessage: azureErrorMessage,
      onUnauthorized: () => azureKnown.delete(url)
    })

  const azureToken = async (url: string) => {
    const token = await azureTokens(url).read()
    if (token) return token
    throw new AdarError({ message: `No token for ${url.replace('https://', '')} is stored on this computer. Sign in again.`, code: 'AUTH_FAILED' })
  }

  const azureWho = async (api: ApiClient, url: string): Promise<AzureUser> => {
    const cached = azureKnown.get(url)
    if (cached) return cached
    // A wrong token gets a sign-in page instead of an answer: no account in it.
    const user = azureUser(await api.json('GET', '/_apis/connectionData'))
    if (!user) throw new AdarError({ message: 'Azure DevOps did not accept the token: it is wrong, expired, or not for this organization', code: 'AUTH_FAILED' })
    azureKnown.set(url, user)
    return user
  }

  const getAzureConnections = async (): Promise<AzureConnections> => {
    const s = await settings()
    const organizations = await Promise.all(
      s.azureServers.map(async ({ url }) => {
        const name = decodeURIComponent(url.slice(`${AZURE_DEVOPS}/`.length))
        try {
          const who = await azureWho(azureClient(url, await azureToken(url)), url)
          return { url, name, login: who.login, error: null }
        } catch (err) {
          return { url, name, login: null, error: err instanceof Error ? err.message : String(err) }
        }
      })
    )
    return { organizations, canStoreToken: azureTokens('').available() }
  }

  // ── Repositories ────────────────────────────────────────────────────────

  const remoteOf = async (repo: string, s: AppSettings): Promise<HostingRemote | null> => {
    const [urls, resolved] = await Promise.all([
      ctx.git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'], { allowFailure: true }),
      ctx.git(repo, ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$'], { allowFailure: true })
    ])
    const remotes = urls.code === 0 ? parseRemoteUrls(urls.stdout) : []
    const preferred = resolved.code === 0 ? /^remote\.(.+)\.gh-resolved base$/m.exec(resolved.stdout)?.[1] : null
    const at = pickHostingRemote(remotes, { bitbucket: s.bitbucketServers, gitlab: s.gitlabServers, github: s.githubServers }, preferred)
    return at ? { ...at, url: remotes.find((r) => r.name === at.remote)?.url ?? '' } : null
  }

  /** The provider for a repository's remote, when the user turned it on; null otherwise. */
  const providerFor = async (repo: string): Promise<{ at: HostingRemote | null; provider: PullProvider | null }> => {
    const s = await settings()
    const at = await remoteOf(repo, s)
    if (!at) return { at, provider: null }
    if (at.provider === 'github' && at.server) {
      const server = s.githubServers.find((x) => x.url === at.server)
      if (!server) return { at, provider: null }
      const client = enterpriseClient(server.url, await enterpriseToken(server))
      return { at, provider: githubProvider(client, at, () => enterpriseKnown.get(server.url) ?? '') }
    }
    if (at.provider === 'github') {
      const m = s.githubAuth || null
      return { at, provider: m ? githubProvider(githubClient(await githubTokenFor(m)), at, () => githubKnown?.login ?? '') : null }
    }
    if (at.provider === 'gitlab') {
      const server = s.gitlabServers.find((x) => x.url === at.server)
      if (!server) return { at, provider: null }
      const api = gitlabClient(server.url, await gitlabToken(server.url, server.auth))
      return { at, provider: gitlabProvider(api, at, server.url, () => gitlabWho(api, server.url).catch(() => null), caches.gitlab) }
    }
    if (at.provider === 'bitbucket-cloud') {
      if (!s.bitbucketAuth) return { at, provider: null }
      const api = cloudClient(s.bitbucketEmail, await cloudToken())
      return { at, provider: bitbucketCloudProvider(api, at, () => cloudWho(api, s.bitbucketEmail).catch(() => null), caches.cloud) }
    }
    if (at.provider === 'azure') {
      const org = s.azureServers.find((x) => x.url === at.server)
      if (!org) return { at, provider: null }
      const api = azureClient(org.url, await azureToken(org.url))
      return { at, provider: azureProvider(api, at, org.url, () => azureWho(api, org.url).catch(() => null), caches.azure) }
    }
    const server = s.bitbucketServers.find((x) => x.url === at.server)
    if (!server) return { at, provider: null }
    const api = serverClient(server.url, await serverToken(server.url))
    return { at, provider: bitbucketServerProvider(api, at, server.url, () => serverWho(api, server.url).catch(() => ''), caches.server) }
  }

  const requireProvider = async (repo: string): Promise<{ at: HostingRemote; provider: PullProvider }> => {
    const { at, provider } = await providerFor(repo)
    if (!at) throw invalid('This repository has no GitHub, GitLab, Bitbucket or Azure DevOps remote')
    if (!provider) throw invalid('Pull requests are off for this repository. Turn them on in Settings → Integrations.')
    return { at, provider }
  }

  const checkNumber = (number: unknown) => {
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw invalid('Invalid pull request number')
  }

  const fullSha = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v) ? v.toLowerCase() : null)

  /** Where the repository has a pull request's changes, fetching what it lacks (no branches are created). */
  const prepareReview = async (repo: string, number: number, head: string, baseRef: string, baseSha: string | null, since: string | null): Promise<ReviewRange> => {
    const { at, provider } = await requireProvider(repo)
    const run = (args: string[]) => ctx.git(repo, args, { allowFailure: true })
    const has = async (sha: string) => (await run(['cat-file', '-e', `${sha}^{commit}`])).code === 0
    const baseTracking = `refs/remotes/${at.remote}/${baseRef}`
    const hasBase = async () => (await run(['show-ref', '--verify', '--quiet', baseTracking])).code === 0

    // The base branch as the service has it now (the local one may be behind: the changes would include its commits).
    const baseBehind = async () => !(await hasBase()) || (!!baseSha && !(await has(baseSha)))
    if (!(await has(head)) || (await baseBehind())) {
      await ctx.exclusive(repo, async () => {
        if (await baseBehind()) await ctx.gitNetwork(repo, ['fetch', at.remote, `+refs/heads/${baseRef}:${baseTracking}`])
        if (await has(head)) return
        const src = await provider.source(number)
        if (src.fork) {
          if (src.fork.from.startsWith('-')) throw invalid('Invalid fork address')
          // Only FETCH_HEAD is written: the commits are here, no branch is made.
          await ctx.gitNetwork(repo, ['fetch', src.fork.from, src.fork.ref])
        } else {
          if (!isSafeBranchName(src.headRef)) throw invalid('The pull request has an unusable branch name')
          await ctx.gitNetwork(repo, ['fetch', at.remote, `+refs/heads/${src.headRef}:refs/remotes/${at.remote}/${src.headRef}`])
        }
      })
      if (!(await has(head))) throw new AdarError({ message: 'The pull request moved on since Adar last looked. Refresh it and try again.', code: 'NOT_FOUND' })
    }

    const baseRev = baseSha && (await has(baseSha)) ? baseSha : baseTracking
    const mb = await run(['merge-base', head, baseRev])
    const base = mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : (await ctx.git(repo, ['rev-parse', '--verify', `${baseRev}^{commit}`])).stdout.trim()
    const range: ReviewRange = { base, head, since: null, sinceState: since ? 'missing' : 'none', sinceCommits: 0, onlyMerges: false }
    if (!since || since === head) return since ? { ...range, since, sinceState: 'ancestor' } : range

    // The commit last reviewed may be gone from the branch (a force push): services still serve it by its id.
    if (!(await has(since))) await ctx.exclusive(repo, () => ctx.gitNetwork(repo, ['fetch', at.remote, since], { allowFailure: true }))
    if (!(await has(since))) return range
    range.since = since
    if ((await run(['merge-base', '--is-ancestor', since, head])).code === 0) {
      const firsts = (await ctx.git(repo, ['rev-list', '--first-parent', '--parents', `${since}..${head}`])).stdout.split('\n').filter(Boolean)
      range.sinceState = 'ancestor'
      range.sinceCommits = firsts.length
      range.onlyMerges = firsts.length > 0 && firsts.every((l) => l.trim().split(' ').length > 2)
      return range
    }
    // Rewritten: compared commit by commit with the version reviewed.
    const oldBase = await run(['merge-base', since, baseRev])
    const from = oldBase.code === 0 && oldBase.stdout.trim() ? oldBase.stdout.trim() : base
    const rd = await run(['range-diff', '--no-color', '-s', `${from}..${since}`, `${base}..${head}`])
    range.sinceState = rd.code === 0 && rangeDiffSame(rd.stdout) ? 'same-changes' : 'rewritten'
    range.sinceCommits = rd.code === 0 ? rangeDiffChanged(rd.stdout) : 0
    return range
  }

  return {
    getGithubConnection,

    async connectGithub(m, token, server) {
      if (m !== 'gh' && m !== 'token') throw invalid('Unknown sign-in method')
      if (server !== undefined) {
        const url = normalizeServerUrl(server?.url, !!platform.allowLoopbackServers)
        if (!url) throw invalid('Use the https address of your GitHub Enterprise server, such as https://github.example.com')
        const host = hostOf(url)
        let secret: string | null
        if (m === 'gh') {
          gh.forget(host)
          secret = await gh.token(host)
          if (!secret) throw new AdarError({ message: `The GitHub CLI is not signed in to ${host}. Run “gh auth login --hostname ${host}” first.`, code: 'AUTH_FAILED' })
        } else {
          secret = typeof token === 'string' ? token.trim() : ''
          if (!isPlausibleToken(secret)) throw invalid('That does not look like a GitHub token')
          if (!enterpriseTokens(url).available()) throw invalid('This computer offers no protected storage for a token. Use the GitHub CLI instead.')
        }
        enterpriseKnown.delete(url)
        const login = await githubLogin(enterpriseClient(url, secret))
        if (m === 'token') await enterpriseTokens(url).write(secret)
        else await enterpriseTokens(url).clear()
        const hosts = [host, typeof server.remoteHost === 'string' ? server.remoteHost.toLowerCase() : ''].filter((h) => HOST.test(h))
        const others = (await settings()).githubServers.filter((x) => x.url !== url)
        await services.settings.updateSettings({ githubServers: [...others, { url, hosts: [...new Set(hosts)], ...(m === 'gh' ? { auth: 'gh' as const } : {}) }] })
        enterpriseKnown.set(url, login)
        return getGithubConnection()
      }
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

    async startGithubSignIn() {
      if (!githubTokens.available()) throw invalid('This computer offers no protected storage for a token. Use the GitHub CLI instead.')
      return device.start()
    },

    async checkGithubSignIn(id) {
      if (typeof id !== 'string') throw invalid('Unknown sign-in')
      const token = await device.check(id)
      if (!token) return null
      const login = await githubLogin(githubClient(token))
      await githubTokens.write(token)
      await services.settings.updateSettings({ githubAuth: 'browser' })
      githubKnown = { method: 'browser', login }
      return getGithubConnection()
    },

    async cancelGithubSignIn(id) {
      if (typeof id === 'string') device.cancel(id)
    },

    async disconnectGithub(server) {
      if (typeof server === 'string') {
        enterpriseKnown.delete(server)
        await enterpriseTokens(server).clear()
        const servers = (await settings()).githubServers.filter((x) => x.url !== server)
        await services.settings.updateSettings({ githubServers: servers })
        return getGithubConnection()
      }
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
      const method = opts?.method ?? 'token'
      if (method !== 'token' && method !== 'glab' && method !== 'git') throw invalid('Unknown sign-in method')
      const url = normalizeServerUrl(opts?.url, !!platform.allowLoopbackServers)
      if (!url) throw invalid('Use the https address of your GitLab, such as https://gitlab.example.com')
      const host = new URL(url).host
      let token: string
      if (method === 'token') {
        token = typeof opts.token === 'string' ? opts.token.trim() : ''
        if (!isPlausibleToken(token)) throw invalid('That does not look like a GitLab token')
        if (!githubTokens.available()) throw invalid('This computer offers no protected storage for a token.')
      } else {
        glab.forget(host)
        const found = method === 'glab' ? await glab.token(host) : await gitCredential(url)
        if (!found) {
          throw new AdarError({
            message: method === 'glab' ? `The GitLab CLI is not signed in to ${host}.` : `Git has no saved token for ${host}.`,
            code: 'AUTH_FAILED'
          })
        }
        token = found
      }
      gitlabKnown.delete(url)
      try {
        await gitlabWho(gitlabClient(url, token), url)
      } catch (err) {
        // A saved account password is not a token GitLab's API takes.
        if (method === 'git' && err instanceof AdarError && err.code === 'AUTH_FAILED') {
          throw new AdarError({ message: `What git keeps for ${host} is not a token GitLab accepts (it may be a password). Use a personal access token.`, code: 'AUTH_FAILED' })
        }
        throw err
      }
      if (method === 'token') await gitlabTokens(url).write(token)
      else await gitlabTokens(url).clear()
      const hosts = [host, typeof opts.remoteHost === 'string' ? opts.remoteHost.toLowerCase() : ''].filter((h) => HOST.test(h))
      const others = (await settings()).gitlabServers.filter((x) => x.url !== url)
      await services.settings.updateSettings({ gitlabServers: [...others, { url, hosts: [...new Set(hosts)], ...(method === 'token' ? {} : { auth: method }) }] })
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

    getAzureConnections,

    async connectAzure(opts) {
      const token = typeof opts?.token === 'string' ? opts.token.trim() : ''
      if (!isPlausibleToken(token)) throw invalid('That does not look like an Azure DevOps token')
      if (!azureTokens('').available()) throw invalid('This computer offers no protected storage for a token.')
      const url = azureOrgUrl(opts?.url)
      if (!url) throw invalid('Use the address of your organization, such as https://dev.azure.com/contoso')
      azureKnown.delete(url)
      await azureWho(azureClient(url, token), url)
      await azureTokens(url).write(token)
      const org = url.slice(`${AZURE_DEVOPS}/`.length)
      const others = (await settings()).azureServers.filter((x) => x.url !== url)
      await services.settings.updateSettings({ azureServers: [...others, { url, hosts: ['dev.azure.com', 'ssh.dev.azure.com', `${org}.visualstudio.com`] }] })
      return getAzureConnections()
    },

    async disconnectAzure(url) {
      if (typeof url !== 'string') throw invalid('Unknown Azure DevOps organization')
      azureKnown.delete(url)
      await azureTokens(url).clear()
      const organizations = (await settings()).azureServers.filter((x) => x.url !== url)
      await services.settings.updateSettings({ azureServers: organizations })
      return getAzureConnections()
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

    async getAuthorAvatars(repo, authors) {
      await assertRepo(ctx, repo)
      if (!Array.isArray(authors)) throw invalid('Invalid authors')
      if (!(await settings()).providerAvatars) return {}
      const asks = new Map<string, AuthorAsk>()
      for (const a of authors as unknown[]) {
        const { email, sha } = (typeof a === 'object' && a !== null ? a : {}) as Record<string, unknown>
        const e = typeof email === 'string' ? email.trim().toLowerCase() : ''
        const c = typeof sha === 'string' ? sha.toLowerCase() : ''
        if (EMAIL.test(e) && /^[0-9a-f]{40}$/.test(c) && !asks.has(e)) asks.set(e, { email: e, sha: c })
      }
      if (!asks.size) return {}
      // Only while pull requests are on for the repository's provider.
      const { at, provider } = await providerFor(repo).catch(() => ({ at: null, provider: null }))
      if (!at || !provider?.avatars) return {}
      const key = at.server ?? at.host
      const out: Record<string, string> = {}
      const now = Date.now()
      const missing: AuthorAsk[] = []
      for (const a of asks.values()) {
        const hit = avatarCache.get(`${key}|${a.email}`)
        if (hit?.data) out[a.email] = hit.data
        else if (!hit || now - hit.at > AVATAR_MISS_MS) missing.push(a)
      }
      const asking = missing.slice(0, MAX_AVATAR_ASKS)
      if (!asking.length) return out
      let urls: Map<string, string>
      try {
        urls = await provider.avatars(asking)
      } catch {
        // Asked again next time (offline, rate limited…).
        return out
      }
      const hosts = at.server ? [...PUBLIC_AVATAR_HOSTS, new RegExp(`^avatars\\.${new URL(at.server).hostname.replace(/[.]/g, '\\.')}$`)] : PUBLIC_AVATAR_HOSTS
      await mapLimit(asking, 6, async (a) => {
        const url = urls.get(a.email)
        const data = url ? ((await provider.image?.(url)) ?? (await publicImage(fetchFn, url, userAgent, hosts))) : null
        avatarCache.set(`${key}|${a.email}`, { data, at: now })
        if (data) out[a.email] = data
      })
      return out
    },

    async getProtectedBranches(repo): Promise<string[] | null> {
      await assertRepo(ctx, repo)
      return (await requireProvider(repo)).provider.protectedBranches()
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

    async getPullReview(repo, number) {
      await assertRepo(ctx, repo)
      checkNumber(number)
      const { at, provider } = await requireProvider(repo)
      if (!provider.review) throw invalid(`Adar does not review pull requests on ${PROVIDER_NAMES[at.provider]} yet. Review this one there.`)
      return provider.review(number)
    },

    async pullReviewAction(repo, number, raw) {
      await assertRepo(ctx, repo)
      checkNumber(number)
      const action = parseReviewAction(raw)
      if (!action) throw invalid('Invalid review action')
      const { at, provider } = await requireProvider(repo)
      if (!provider.reviewAction) throw invalid(`Adar does not review pull requests on ${PROVIDER_NAMES[at.provider]} yet. Review this one there.`)
      await provider.reviewAction(number, action, {
        lines: (base, head, path) => fileLines(ctx, repo, base, head, path),
        mergeBase: (a, b) => mergeBase(ctx, repo, a, b),
        lineLength: (commit, path, line) => lineLength(ctx, repo, commit, path, line)
      })
    },

    async preparePullReview(repo, number, opts) {
      await assertRepo(ctx, repo)
      checkNumber(number)
      const head = fullSha(opts?.head)
      if (!head) throw invalid('Invalid commit')
      if (!isSafeBranchName(opts.baseRef)) throw invalid('Invalid branch name')
      const since = opts.since == null ? null : fullSha(opts.since)
      const baseSha = opts.baseSha == null ? null : fullSha(opts.baseSha)
      if ((opts.since != null && !since) || (opts.baseSha != null && !baseSha)) throw invalid('Invalid commit')
      return prepareReview(repo, number, head, opts.baseRef, baseSha, since)
    },

    async notifyPullRequest(repo, raw) {
      await assertRepo(ctx, repo)
      const notice = parsePullNotice(raw)
      if (!notice) throw invalid('Invalid notification')
      platform.notify?.(repo, notice)
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
