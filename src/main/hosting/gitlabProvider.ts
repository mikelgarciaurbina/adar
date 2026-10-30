// GitLab merge requests of one project (REST API v4 on gitlab.com or a self-managed instance, personal
// access token). The list leaves out pipelines, so each open merge request is read with its approvals;
// a finished pipeline's jobs, and the paths of forks, are cached.

import { AdarError } from '@shared/errors'
import { gitlabApprovers, gitlabCommits, gitlabJobs, gitlabMergeChecks, gitlabMergeMethods, gitlabProtected, gitlabPull, type GitlabExtra, type GitlabUser } from '@shared/gitlab'
import { sameCommit, type PullCheck, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { BoundedCache, mapLimit, type ApiClient } from './http'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PullProvider } from './provider'

/** Open merge requests read in full (pipeline, approvals) per update; the rest show without them. */
const MAX_DETAILED = 30
/** Pipelines whose jobs no longer change. */
const FINISHED = new Set(['success', 'failed', 'canceled', 'skipped'])
/** GitLab's Developer role: the lowest that can usually merge. */
const DEVELOPER = 30

export interface GitlabCaches {
  /** Jobs of finished pipelines, by "<project id>/<pipeline id>". */
  jobs: BoundedCache<PullCheck[]>
  /** group/project of forks, by project id. */
  forks: BoundedCache<string>
}

export const newGitlabCaches = (): GitlabCaches => ({ jobs: new BoundedCache(), forks: new BoundedCache() })

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : 0)

const NO_EXTRA: GitlabExtra = { approvers: null, pipeline: null, fork: null }

export function gitlabProvider(api: ApiClient, at: HostingRemote, server: string, viewer: () => Promise<GitlabUser | null>, caches: GitlabCaches): PullProvider {
  const base = `/projects/${encodeURIComponent(`${at.owner}/${at.name}`)}`
  const repoUrl = `${server}/${at.owner}/${at.name}`
  const read = async (number: number) => obj(await api.json('GET', `${base}/merge_requests/${number}`))

  const jobs = async (pipeline: Obj): Promise<PullCheck[]> => {
    const id = num(pipeline.id)
    const project = num(pipeline.project_id)
    if (!id || !project) return []
    const key = `${project}/${id}`
    const cached = caches.jobs.get(key)
    if (cached) return cached
    const list = gitlabJobs(await api.json('GET', `/projects/${project}/pipelines/${id}/jobs?per_page=100`).catch(() => null))
    if (FINISHED.has(str(pipeline.status))) caches.jobs.set(key, list)
    return list
  }

  const forkOf = async (mr: Obj): Promise<string | null> => {
    const id = num(mr.source_project_id)
    if (!id || id === num(mr.target_project_id)) return null
    const cached = caches.forks.get(String(id))
    if (cached) return cached
    const path = str(obj(await api.json('GET', `/projects/${id}`).catch(() => null)).path_with_namespace)
    if (path) caches.forks.set(String(id), path)
    return path || null
  }

  const detailed = async (listed: Obj, who: GitlabUser | null): Promise<PullRequest | null> => {
    const number = num(listed.iid)
    const [full, approvals] = await Promise.all([read(number).catch(() => listed), api.json('GET', `${base}/merge_requests/${number}/approvals`).catch(() => null)])
    const head = obj(full.head_pipeline)
    const extra: GitlabExtra = {
      approvers: approvals ? gitlabApprovers(approvals) : null,
      pipeline: num(head.id) ? { status: str(head.status), jobs: await jobs(head) } : null,
      fork: await forkOf(full)
    }
    return gitlabPull(full, who, extra, repoUrl)
  }

  return {
    async list(): Promise<RepoPullRequests> {
      const recent = (state: string, count: number) => api.json('GET', `${base}/merge_requests?state=${state}&order_by=updated_at&sort=desc&per_page=${count}`)
      const [project, open, merged, closed, who] = await Promise.all([api.json('GET', base), recent('opened', 50), recent('merged', 20), recent('closed', 10), viewer()])
      const openList = arr(open)
      const full = await mapLimit(openList.slice(0, MAX_DETAILED), 6, (mr) => detailed(mr, who))
      const rest = [...openList.slice(MAX_DETAILED), ...arr(merged), ...arr(closed)].map((mr) => gitlabPull(mr, who, NO_EXTRA, repoUrl))
      const p = obj(project)
      const permissions = obj(p.permissions)
      const access = Math.max(num(obj(permissions.project_access).access_level), num(obj(permissions.group_access).access_level))
      return {
        provider: 'gitlab',
        host: new URL(server).host,
        owner: at.owner,
        name: at.name,
        remote: at.remote,
        webUrl: repoUrl,
        viewer: who?.username ?? '',
        defaultBranch: str(p.default_branch) || 'main',
        mergeMethods: gitlabMergeMethods(p),
        // Adar cleans up after a merge itself (it merges with should_remove_source_branch off).
        deleteBranchOnMerge: false,
        // Protected branches may ask for more: GitLab's merge status says so per merge request.
        canMerge: 'permissions' in p ? access >= DEVELOPER : true,
        reportsConflicts: true,
        mergeChecks: true,
        pulls: [...full, ...rest].filter((x): x is PullRequest => !!x)
      }
    },

    async commits(number) {
      return gitlabCommits(await api.json('GET', `${base}/merge_requests/${number}/commits?per_page=100`))
    },

    async create(opts) {
      const created = await api.json('POST', `${base}/merge_requests`, {
        source_branch: opts.head,
        target_branch: opts.base,
        // GitLab marks merge requests whose title starts with "Draft:" as drafts.
        title: opts.draft ? `Draft: ${opts.title}` : opts.title,
        description: opts.body,
        remove_source_branch: false
      })
      const pr = gitlabPull(created, await viewer(), NO_EXTRA, repoUrl)
      if (!pr) throw new AdarError({ message: 'GitLab created the merge request but its answer could not be read', code: 'UNKNOWN' })
      return pr
    },

    async merge(number, method, headSha) {
      const [mr, project] = await Promise.all([read(number), api.json('GET', base)])
      const sha = str(mr.sha)
      if (!sameCommit(sha, headSha)) throw changedSinceLooked('GitLab', 'merge request')
      if (!gitlabMergeMethods(project).includes(method)) throw invalid('This project does not allow merging that way')
      await api.json('PUT', `${base}/merge_requests/${number}/merge`, { sha, squash: method === 'squash', should_remove_source_branch: false })
    },

    async source(number) {
      const mr = await read(number)
      const headRef = str(mr.source_branch)
      const fromFork = num(mr.source_project_id) !== num(mr.target_project_id)
      // GitLab keeps every merge request's commits at refs/merge-requests/<iid>/head on the target project.
      return { headRef, fork: fromFork ? { from: at.remote, ref: `refs/merge-requests/${number}/head` } : null }
    },

    async mergeChecks(number) {
      return gitlabMergeChecks(await read(number))
    },

    async protectedBranches() {
      return unlessRefused(async () => gitlabProtected(await api.json('GET', `${base}/protected_branches?per_page=100`)))
    }
  }
}
