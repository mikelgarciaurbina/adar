// Bitbucket Data Center pull requests of one repository (REST 1.0 on the company's server, HTTP
// access token). Builds are read per commit (cached once they finished); merge checks on demand.

import { AdarError } from '@shared/errors'
import { buildRuns, pageValues, serverCommits, serverMergeChecks, serverMergeMethods, serverPull } from '@shared/bitbucket'
import { sameCommit, type PullCheck, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { BoundedCache, mapLimit, type ApiClient } from './http'
import { changedSinceLooked, invalid, type HostingRemote, type PullProvider } from './provider'

export interface ServerCaches {
  /** Finished builds by commit. */
  builds: BoundedCache<PullCheck[]>
}

export const newServerCaches = (): ServerCaches => ({ builds: new BoundedCache() })

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The repository's web page on the server (personal repositories live under /users/<name>). */
export function serverRepoUrl(server: string, project: string, repo: string): string {
  return project.startsWith('~')
    ? `${server}/users/${encodeURIComponent(project.slice(1).toLowerCase())}/repos/${encodeURIComponent(repo)}`
    : `${server}/projects/${encodeURIComponent(project.toUpperCase())}/repos/${encodeURIComponent(repo)}`
}

/** Who the token belongs to: Bitbucket names the user in X-AUSERNAME, or the applinks whoami page answers it. */
export async function serverWhoAmI(api: ApiClient): Promise<string> {
  const res = await api.call('GET', '/rest/api/1.0/application-properties')
  const header = res.headers.get('x-ausername')
  if (header) return header
  const who = await api.call('GET', '/plugins/servlet/applinks/whoami').catch(() => null)
  const name = who?.text.trim() ?? ''
  if (/^[^\s<>]{1,100}$/.test(name)) return name
  throw new AdarError({ message: 'Bitbucket did not say who the token belongs to', code: 'AUTH_FAILED' })
}

export function bitbucketServerProvider(api: ApiClient, at: HostingRemote, server: string, viewer: () => Promise<string>, caches: ServerCaches): PullProvider {
  const project = at.owner.startsWith('~') ? at.owner : at.owner.toUpperCase()
  const repoPath = `/rest/api/1.0/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(at.name)}`
  const repoUrl = serverRepoUrl(server, at.owner, at.name)
  const read = async (number: number) => obj(await api.json('GET', `${repoPath}/pull-requests/${number}`))
  const repository = { slug: at.name, project: { key: project } }

  const builds = async (sha: string): Promise<PullCheck[]> => {
    const cached = caches.builds.get(sha)
    if (cached) return cached
    const runs = buildRuns(await api.json('GET', `/rest/build-status/1.0/commits/${sha}`).catch(() => null))
    if (!runs.some((r) => r.state === 'running')) caches.builds.set(sha, runs)
    return runs
  }

  const strategies = async () => serverMergeMethods(await api.json('GET', `${repoPath}/settings/pull-requests`).catch(() => null))

  return {
    async list(): Promise<RepoPullRequests> {
      const [open, merged, declined, who, methods, def] = await Promise.all([
        api.json('GET', `${repoPath}/pull-requests?state=OPEN&limit=50`),
        api.json('GET', `${repoPath}/pull-requests?state=MERGED&order=NEWEST&limit=20`),
        api.json('GET', `${repoPath}/pull-requests?state=DECLINED&order=NEWEST&limit=10`),
        viewer(),
        strategies(),
        api.json('GET', `${repoPath}/default-branch`).catch(() => null)
      ])
      const openList = pageValues(open)
      const withBuilds = await mapLimit(openList, 6, async (p) => {
        const sha = str(obj(p.fromRef).latestCommit)
        return serverPull(p, who, /^[0-9a-f]{40}$/i.test(sha) ? await builds(sha.toLowerCase()) : [], repoUrl)
      })
      const closed = [...pageValues(merged), ...pageValues(declined)].map((p) => serverPull(p, who, null, repoUrl))
      return {
        provider: 'bitbucket-server',
        host: new URL(server).host,
        owner: at.owner,
        name: at.name,
        remote: at.remote,
        webUrl: repoUrl,
        viewer: who,
        defaultBranch: str(obj(def).displayId) || 'main',
        mergeMethods: methods.methods,
        deleteBranchOnMerge: false,
        // Permission, approvals and the rest are Bitbucket's merge checks, asked before merging.
        canMerge: true,
        reportsConflicts: true,
        mergeChecks: true,
        pulls: [...withBuilds, ...closed].filter((p): p is PullRequest => !!p)
      }
    },

    async commits(number) {
      return serverCommits(await api.json('GET', `${repoPath}/pull-requests/${number}/commits?limit=100`))
    },

    async create(opts) {
      const created = await api.json('POST', `${repoPath}/pull-requests`, {
        title: opts.title,
        description: opts.body,
        fromRef: { id: `refs/heads/${opts.head}`, repository },
        toRef: { id: `refs/heads/${opts.base}`, repository },
        ...(opts.draft ? { draft: true } : {})
      })
      const pr = serverPull(created, await viewer(), null, repoUrl)
      if (!pr) throw new AdarError({ message: 'Bitbucket created the pull request but its answer could not be read', code: 'UNKNOWN' })
      return pr
    },

    async merge(number, method, headSha) {
      const [pr, { ids }] = await Promise.all([read(number), strategies()])
      if (!sameCommit(str(obj(pr.fromRef).latestCommit), headSha)) throw changedSinceLooked('Bitbucket')
      const strategyId = ids[method]
      if (!strategyId) throw invalid('This repository does not allow merging that way')
      const version = typeof pr.version === 'number' ? pr.version : -1
      await api.json('POST', `${repoPath}/pull-requests/${number}/merge?version=${version}`, { strategyId })
    },

    async source(number) {
      const pr = await read(number)
      const from = obj(pr.fromRef)
      const key = (ref: Obj) => `${str(obj(obj(ref.repository).project).key)}/${str(obj(ref.repository).slug)}`.toLowerCase()
      const headRef = str(from.displayId)
      // Bitbucket keeps every pull request's source at refs/pull-requests/<n>/from on the target repository.
      return { headRef, fork: key(from) === key(obj(pr.toRef)) ? null : { from: at.remote, ref: `refs/pull-requests/${number}/from` } }
    },

    async mergeChecks(number) {
      return serverMergeChecks(await api.json('GET', `${repoPath}/pull-requests/${number}/merge`))
    }
  }
}
