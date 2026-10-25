// GitHub pull requests (opt-in): sign-in state, the pull requests of a repository's GitHub
// remote, creating and merging them, and the local branch for checking one out.
// Nothing talks to GitHub while settings.githubAuth is off.

import { AdarError } from '@shared/errors'
import {
  MAX_BODY,
  MAX_TITLE,
  PULLS_QUERY,
  isSafeBranchName,
  pullCommitsFromRest,
  pullFromRest,
  pullsFromQuery,
  type CreatePullOptions,
  type GithubAuthMethod,
  type GithubConnection,
  type MergeMethod,
  type PullRequest,
  type RepoPullRequests
} from '@shared/hosting'
import { githubRepoOf } from '@shared/remoteUrl'
import type { GitContext } from '../git/context'
import type { HostingOps } from '../git/ops'
import { assertRepo } from '../git/read/common'
import type { SystemServices } from '../system'
import { GhCli, TokenStore, isPlausibleToken } from './auth'
import { GithubClient } from './github'

export interface GithubRemote {
  remote: string
  owner: string
  name: string
}

const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })

/**
 * The remote pull requests live on, from `git config --get-regexp ^remote\..*\.url$` output: the one gh
 * was told to use (remote.<name>.gh-resolved = base), else origin, else the first github.com remote.
 */
export function pickGithubRemote(urlLines: string, resolvedLines = ''): GithubRemote | null {
  const found: GithubRemote[] = []
  for (const line of urlLines.split('\n')) {
    const m = /^remote\.(.+)\.url (.+)$/.exec(line.trim())
    if (!m || m[1].startsWith('-')) continue
    const repo = githubRepoOf(m[2])
    if (repo && !found.some((f) => f.remote === m[1])) found.push({ remote: m[1], ...repo })
  }
  const base = /^remote\.(.+)\.gh-resolved base$/m.exec(resolvedLines)?.[1]
  return found.find((f) => f.remote === base) ?? found.find((f) => f.remote === 'origin') ?? found[0] ?? null
}

export interface HostingOptions {
  /** The GitHub CLI (tests pass a fake so they never read the developer's own sign-in). */
  gh?: Pick<GhCli, 'token' | 'login' | 'forget'>
}

export function createHostingOps(ctx: GitContext, services: Pick<SystemServices, 'ready' | 'settings'>, options: HostingOptions = {}): HostingOps {
  const gh = options.gh ?? new GhCli(services.ready)
  const tokens = new TokenStore(ctx.platform.userDataDir, ctx.platform.secrets)
  const fetchFn = ctx.platform.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const userAgent = `Adar/${ctx.platform.appVersion}`
  /** Signed-in user per auth method, once GitHub confirmed it (cleared on a 401 or a change). */
  let known: { method: GithubAuthMethod; login: string } | null = null

  const method = async (): Promise<GithubAuthMethod | null> => {
    const s = await services.settings.getSettings()
    return s.githubAuth || null
  }

  const tokenFor = async (m: GithubAuthMethod): Promise<string> => {
    const token = m === 'gh' ? await gh.token() : await tokens.read()
    if (token) return token
    throw new AdarError({
      message: m === 'gh' ? 'The GitHub CLI is not signed in to github.com. Run “gh auth login”, or sign in again in Adar.' : 'No GitHub token is stored on this computer. Sign in again.',
      code: 'AUTH_FAILED'
    })
  }

  const clientWith = (token: string) =>
    new GithubClient(
      fetchFn,
      token,
      userAgent,
      () => {
        known = null
        gh.forget()
      },
      ctx.platform.githubApi
    )

  /** Client for the configured sign-in; AUTH_FAILED when pull requests are on but the sign-in is gone. */
  const client = async (): Promise<GithubClient | null> => {
    const m = await method()
    return m ? clientWith(await tokenFor(m)) : null
  }

  const loginWith = async (c: GithubClient): Promise<string> => {
    const user = (await c.rest('GET', '/user')) as { login?: unknown } | null
    if (typeof user?.login !== 'string' || !user.login) throw new AdarError({ message: 'GitHub did not say who is signed in', code: 'AUTH_FAILED' })
    return user.login
  }

  const githubRemote = async (repo: string): Promise<GithubRemote | null> => {
    const [urls, resolved] = await Promise.all([
      ctx.git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'], { allowFailure: true }),
      ctx.git(repo, ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$'], { allowFailure: true })
    ])
    return pickGithubRemote(urls.code === 0 ? urls.stdout : '', resolved.code === 0 ? resolved.stdout : '')
  }

  const requireRemote = async (repo: string): Promise<GithubRemote> => {
    const at = await githubRemote(repo)
    if (!at) throw invalid('This repository has no GitHub remote')
    return at
  }

  const requireClient = async (): Promise<GithubClient> => {
    const c = await client()
    if (!c) throw invalid('Pull requests are off. Turn them on in Settings → Integrations.')
    return c
  }

  const repoPath = (at: GithubRemote) => `/repos/${encodeURIComponent(at.owner)}/${encodeURIComponent(at.name)}`

  const getGithubConnection = async (opts?: { detectGh?: boolean }): Promise<GithubConnection> => {
    const m = await method()
    const ghLogin = opts?.detectGh === true || m === 'gh' ? await gh.login() : null
    const canStoreToken = tokens.available()
    let login: string | null = null
    let error: string | null = null
    if (m) {
      if (known?.method === m) login = known.login
      else {
        try {
          login = await loginWith(clientWith(await tokenFor(m)))
          known = { method: m, login }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
      }
    }
    return { method: m, login, error, ghLogin, canStoreToken }
  }

  return {
    getGithubConnection,

    async connectGithub(m, token) {
      if (m !== 'gh' && m !== 'token') throw invalid('Unknown sign-in method')
      let secret: string
      if (m === 'gh') {
        gh.forget()
        secret = await tokenFor('gh')
      } else {
        const t = typeof token === 'string' ? token.trim() : ''
        if (!isPlausibleToken(t)) throw invalid('That does not look like a GitHub token')
        if (!tokens.available()) throw invalid('This computer offers no protected storage for a token. Use the GitHub CLI instead.')
        secret = t
      }
      const login = await loginWith(clientWith(secret))
      if (m === 'token') await tokens.write(secret)
      else await tokens.clear()
      await services.settings.updateSettings({ githubAuth: m })
      known = { method: m, login }
      return getGithubConnection()
    },

    async disconnectGithub() {
      known = null
      gh.forget()
      await tokens.clear()
      await services.settings.updateSettings({ githubAuth: '' })
      return getGithubConnection()
    },

    async getPullRequests(repo): Promise<RepoPullRequests | null> {
      await assertRepo(ctx, repo)
      if (!(await method())) return null
      const at = await githubRemote(repo)
      if (!at) return null
      const c = await requireClient()
      const data = await c.graphql(PULLS_QUERY, { owner: at.owner, name: at.name })
      const result = pullsFromQuery(data, at)
      if (!result) throw new AdarError({ message: `GitHub: ${at.owner}/${at.name} was not found, or this sign-in has no access to it`, code: 'NOT_FOUND' })
      return result
    },

    async getPullRequestCommits(repo, number) {
      await assertRepo(ctx, repo)
      if (!Number.isSafeInteger(number) || number <= 0) throw invalid('Invalid pull request number')
      const at = await requireRemote(repo)
      const c = await requireClient()
      return pullCommitsFromRest(await c.rest('GET', `${repoPath(at)}/pulls/${number}/commits?per_page=100`))
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
      const at = await requireRemote(repo)
      const c = await requireClient()
      const created = await c.rest('POST', `${repoPath(at)}/pulls`, { title, body, head: opts.head, base: opts.base, draft: opts.draft === true })
      const pr = pullFromRest(created, known?.login ?? '')
      if (!pr) throw new AdarError({ message: 'GitHub created the pull request but its answer could not be read', code: 'UNKNOWN' })
      return pr
    },

    async mergePullRequest(repo, number, opts): Promise<void> {
      await assertRepo(ctx, repo)
      const m: MergeMethod | undefined = opts?.method
      if (!Number.isSafeInteger(number) || number <= 0) throw invalid('Invalid pull request number')
      if (m !== 'squash' && m !== 'merge' && m !== 'rebase') throw invalid('Unknown merge method')
      if (typeof opts.headSha !== 'string' || !/^[0-9a-f]{40}$/i.test(opts.headSha)) throw invalid('Invalid commit')
      const at = await requireRemote(repo)
      const c = await requireClient()
      try {
        await c.rest('PUT', `${repoPath(at)}/pulls/${number}/merge`, { merge_method: m, sha: opts.headSha.toLowerCase() })
      } catch (err) {
        if (err instanceof AdarError && /head branch was modified|sha/i.test(err.message)) {
          throw invalid('The pull request changed on GitHub since Adar last looked. Check it again before merging.')
        }
        throw err
      }
    },

    async pullRequestBranch(repo, number): Promise<string> {
      await assertRepo(ctx, repo)
      if (!Number.isSafeInteger(number) || number <= 0) throw invalid('Invalid pull request number')
      const at = await requireRemote(repo)
      const c = await requireClient()
      const pr = pullFromRest(await c.rest('GET', `${repoPath(at)}/pulls/${number}`), '')
      if (!pr) throw new AdarError({ message: `Pull request #${number} could not be read`, code: 'UNKNOWN' })
      const exists = async (branch: string) =>
        (await ctx.git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true })).code === 0

      return ctx.exclusive(repo, async () => {
        if (!pr.headFork) {
          const branch = pr.headRef
          if (await exists(branch)) return branch
          const tracking = `refs/remotes/${at.remote}/${branch}`
          await ctx.gitNetwork(repo, ['fetch', at.remote, `+refs/heads/${branch}:${tracking}`])
          await ctx.git(repo, ['branch', '--track', branch, tracking])
          return branch
        }
        // From a fork: GitHub keeps every pull request's head at refs/pull/<n>/head on the base repository.
        const branch = `pr/${number}`
        const head = await ctx.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
        if (head.code === 0 && head.stdout.trim() === branch) {
          await ctx.gitNetwork(repo, ['fetch', at.remote, `refs/pull/${number}/head`])
          await ctx.git(repo, ['merge', '--ff-only', 'FETCH_HEAD'])
          return branch
        }
        try {
          await ctx.gitNetwork(repo, ['fetch', at.remote, `refs/pull/${number}/head:refs/heads/${branch}`])
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
