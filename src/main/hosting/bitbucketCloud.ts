// Bitbucket Cloud pull requests of one repository (api.bitbucket.org/2.0, email + API token).
// The list leaves reviewers out, so each open pull request is read once per update (cached), and
// its builds once per commit (cached once they finished).

import { AdarError } from '@shared/errors'
import { buildRuns, cloudCommits, cloudMergeMethods, cloudProtected, cloudPull, pageValues, type CloudViewer } from '@shared/bitbucket'
import { sameCommit, type PullCheck, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { parseRemoteUrl } from '@shared/remoteUrl'
import { BoundedCache, mapLimit, type ApiClient } from './http'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PullProvider } from './provider'

/** Open pull requests read in full (reviewers, tasks) per update; the rest show without them. */
const MAX_DETAILED = 30
/** How long a merge Bitbucket runs in the background is waited for. */
const MERGE_WAIT_MS = 60_000

export interface CloudCaches {
  /** Full pull request answers by "<repo>#<id>@<updated_on>". */
  pulls: BoundedCache<unknown>
  /** Finished builds by commit. */
  builds: BoundedCache<PullCheck[]>
}

export const newCloudCaches = (): CloudCaches => ({ pulls: new BoundedCache(), builds: new BoundedCache() })

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Clone URL of a fork, in the same transport as the repository's own remote. */
export function cloudForkUrl(remoteUrl: string, fork: string): string | null {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(fork) || fork.split('/').some((part) => part === '.' || part === '..')) return null
  return parseRemoteUrl(remoteUrl)?.sshLike ? `git@bitbucket.org:${fork}.git` : `https://bitbucket.org/${fork}.git`
}

export function bitbucketCloudProvider(api: ApiClient, at: HostingRemote, viewer: () => Promise<CloudViewer | null>, caches: CloudCaches): PullProvider {
  const repoPath = `/repositories/${encodeURIComponent(at.owner)}/${encodeURIComponent(at.name)}`
  const read = (number: number) => api.json('GET', `${repoPath}/pullrequests/${number}`)

  const builds = async (pr: Obj): Promise<PullCheck[]> => {
    const sha = str(obj(obj(pr.source).commit).hash)
    const cached = sha ? caches.builds.get(sha) : undefined
    if (cached) return cached
    const runs = buildRuns(await api.json('GET', `${repoPath}/pullrequests/${String(pr.id)}/statuses?pagelen=50`).catch(() => null))
    if (sha && !runs.some((r) => r.state === 'running')) caches.builds.set(sha, runs)
    return runs
  }

  /** The sign-in's permission on the repository ("read", "write", "admin"), or '' when Bitbucket does not say. */
  const permission = async (): Promise<string> => {
    const q = encodeURIComponent(`repository.full_name="${at.owner}/${at.name}"`)
    const res = await api.json('GET', `/user/permissions/repositories?q=${q}`).catch(() => null)
    return str(pageValues(res)[0]?.permission)
  }

  const canMerge = async (): Promise<boolean> => {
    const p = await permission()
    return p ? p === 'admin' || p === 'write' : true
  }

  return {
    async list(): Promise<RepoPullRequests> {
      const [repo, open, done, who, mayMerge] = await Promise.all([
        api.json('GET', repoPath),
        api.json('GET', `${repoPath}/pullrequests?state=OPEN&pagelen=50`),
        api.json('GET', `${repoPath}/pullrequests?state=MERGED&state=DECLINED&state=SUPERSEDED&sort=-updated_on&pagelen=30`),
        viewer(),
        canMerge()
      ])
      const openList = pageValues(open)
      const detailed = await mapLimit(openList.slice(0, MAX_DETAILED), 6, async (p) => {
        const key = `${at.owner}/${at.name}#${String(p.id)}@${str(p.updated_on)}`
        let full = caches.pulls.get(key)
        if (!full) {
          full = await api.json('GET', `${repoPath}/pullrequests/${String(p.id)}`).catch(() => p)
          caches.pulls.set(key, full)
        }
        return cloudPull(full, who, await builds(obj(full)))
      })
      const rest = openList.slice(MAX_DETAILED).map((p) => cloudPull(p, who, null))
      const closed = pageValues(done).map((p) => cloudPull(p, who, null))
      const pulls = [...detailed, ...rest, ...closed].filter((p): p is PullRequest => !!p)
      const defaultBranch = str(obj(obj(repo).mainbranch).name) || 'main'
      const toDefault = openList.find((p) => str(obj(obj(p.destination).branch).name) === defaultBranch)
      return {
        provider: 'bitbucket-cloud',
        host: 'bitbucket.org',
        owner: at.owner,
        name: at.name,
        remote: at.remote,
        webUrl: `https://bitbucket.org/${at.owner}/${at.name}`,
        viewer: who?.name ?? '',
        defaultBranch,
        mergeMethods: cloudMergeMethods(obj(obj(toDefault).destination).branch).methods,
        deleteBranchOnMerge: false,
        canMerge: mayMerge,
        reportsConflicts: false,
        mergeChecks: false,
        pulls
      }
    },

    async commits(number) {
      return cloudCommits(await api.json('GET', `${repoPath}/pullrequests/${number}/commits?pagelen=100`))
    },

    async create(opts) {
      const created = await api.json('POST', `${repoPath}/pullrequests`, {
        title: opts.title,
        description: opts.body,
        source: { branch: { name: opts.head } },
        destination: { branch: { name: opts.base } },
        draft: opts.draft,
        close_source_branch: false
      })
      const pr = cloudPull(created, await viewer(), null)
      if (!pr) throw new AdarError({ message: 'Bitbucket created the pull request but its answer could not be read', code: 'UNKNOWN' })
      return pr
    },

    async merge(number, method, headSha) {
      const pr = obj(await read(number))
      if (!sameCommit(str(obj(obj(pr.source).commit).hash), headSha)) throw changedSinceLooked('Bitbucket')
      const strategy = cloudMergeMethods(obj(pr.destination).branch).ids[method]
      if (!strategy) throw invalid('This repository does not allow merging that way')
      const res = await api.call('POST', `${repoPath}/pullrequests/${number}/merge`, { merge_strategy: strategy, close_source_branch: false })
      if (res.status !== 202) return
      // A long merge runs in the background: wait for its task.
      const task = res.headers.get('location')
      if (!task) return
      const until = Date.now() + MERGE_WAIT_MS
      while (Date.now() < until) {
        await sleep(1000)
        const status = obj(await api.json('GET', task))
        const state = str(status.task_status)
        if (state === 'SUCCESS') return
        if (state === 'FAILED' || state === 'ERROR') throw new AdarError({ message: 'Bitbucket could not merge the pull request', code: 'UNKNOWN' })
      }
      throw new AdarError({ message: 'Bitbucket is still merging the pull request. Check it on Bitbucket in a moment.', code: 'NETWORK' })
    },

    async source(number) {
      const pr = obj(await read(number))
      const headRef = str(obj(obj(pr.source).branch).name)
      const fork = str(obj(obj(pr.source).repository).full_name)
      const base = str(obj(obj(pr.destination).repository).full_name)
      if (!fork || !base || fork === base) return { headRef, fork: null }
      const url = cloudForkUrl(at.url, fork)
      if (!url) throw invalid(`The fork ${fork} cannot be fetched`)
      return { headRef, fork: { from: url, ref: `refs/heads/${headRef}` } }
    },

    async mergeChecks() {
      return null
    },

    async protectedBranches() {
      // Branch restrictions are shown only to repository admins (and to tokens with an admin scope).
      const p = await permission()
      if (p && p !== 'admin') return null
      return unlessRefused(async () => cloudProtected(await api.json('GET', `${repoPath}/branch-restrictions?pagelen=100`)), ['AUTH_FAILED', 'INVALID_ARGUMENT', 'NOT_FOUND'])
    }
  }
}
