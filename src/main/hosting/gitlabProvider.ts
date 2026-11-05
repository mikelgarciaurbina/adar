// GitLab merge requests of one project (REST API v4 on gitlab.com or a self-managed instance, personal
// access token). The list leaves out pipelines, so each open merge request is read with its approvals and,
// for the dots, its notes, commits and versions; a finished pipeline's jobs, the paths of forks and each merge
// request's activity (until it changes) are cached. Reviews: threads are GitLab's discussions, a review is the
// user's draft notes published together, with an approval or a reviewer state.

import { createHash } from 'node:crypto'
import { AdarError } from '@shared/errors'
import {
  gitlabActivity,
  gitlabApprovers,
  gitlabCommits,
  gitlabJobs,
  gitlabMergeChecks,
  gitlabMergeMethods,
  gitlabProtected,
  gitlabPull,
  gitlabReview,
  type GitlabExtra,
  type GitlabUser
} from '@shared/gitlab'
import { sameCommit, type PullCheck, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { MAX_ACTIVITY_COMMITS, type DraftComment, type PullActivity } from '@shared/review'
import { gitlabAvatar } from './avatars'
import { BoundedCache, mapLimit, type ApiClient } from './http'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PlacedLine, type PullProvider, type ReviewRepo } from './provider'

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
  /** What changed in each open merge request, and the user's state as its reviewer, by "<project>!<iid>", until it changes again. */
  activity: BoundedCache<{ key: string; value: Followed }>
}

export const newGitlabCaches = (): GitlabCaches => ({ jobs: new BoundedCache(), forks: new BoundedCache(), activity: new BoundedCache() })

/** Pages of a list GitLab answers 100 at a time. */
const MAX_PAGES = 5

/** GitLab's code for a line of a diff: the file's SHA-1, its old and its new number. */
const lineCode = (l: PlacedLine) => `${createHash('sha1').update(l.newPath).digest('hex')}_${l.oldPos}_${l.newPos}`

const lineRef = (l: PlacedLine) => ({
  line_code: lineCode(l),
  // "new" for an added line, "old" otherwise.
  type: l.oldLine === null ? 'new' : 'old',
  ...(l.oldLine !== null ? { old_line: l.oldLine } : {}),
  ...(l.newLine !== null ? { new_line: l.newLine } : {})
})

/** What the dots read of an open merge request. */
interface Followed {
  activity: PullActivity
  /** The signed-in user's state as a reviewer (GET …/reviewers), or null when they are not one. */
  reviewState: string | null
}

/** Reviewer states of someone who has answered: GitLab asks them again by setting them back to unreviewed. */
const ANSWERED = new Set(['reviewed', 'requested_changes', 'approved'])

interface DiffRefs {
  base: string
  start: string
  head: string
}

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

  /** A list GitLab pages (100 a page), up to MAX_PAGES pages. */
  const pages = async (path: string): Promise<Obj[]> => {
    const out: Obj[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const got = arr(await api.json('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`))
      out.push(...got)
      if (got.length < 100) break
    }
    return out
  }

  /** What changed in an open merge request: its notes, commits, versions and reviewers, read again only once it changed. */
  const followed = async (mr: Obj, approvers: GitlabUser[] | null, who: GitlabUser | null): Promise<Followed> => {
    const number = num(mr.iid)
    const key = [str(mr.updated_at), str(mr.sha), num(mr.user_notes_count), str(mr.detailed_merge_status), (approvers ?? []).map((u) => u.username).sort().join(',')].join('|')
    const id = `${at.owner}/${at.name}!${number}`
    const cached = caches.activity.get(id)
    if (cached?.key === key) return cached.value
    const p = `${base}/merge_requests/${number}`
    const [notes, commits, versions, reviewers] = await Promise.all([
      api.json('GET', `${p}/notes?sort=desc&order_by=created_at&per_page=100`),
      api.json('GET', `${p}/commits?per_page=${MAX_ACTIVITY_COMMITS + 1}`),
      api.json('GET', `${p}/versions`),
      unlessRefused(() => api.json('GET', `${p}/reviewers`))
    ])
    const me = who?.username.toLowerCase()
    const mine = arr(reviewers).find((r) => !!me && str(obj(r.user).username).toLowerCase() === me)
    const value: Followed = { activity: gitlabActivity({ notes, commits, versions }, who, str(mr.target_branch)), reviewState: mine ? str(mine.state) : null }
    caches.activity.set(id, { key, value })
    return value
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
    const pr = gitlabPull(full, who, extra, repoUrl)
    if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return pr
    const f = await followed(full, extra.approvers, who).catch(() => null)
    // Once the user reviewed it, it waits for the author until GitLab asks them again.
    return { ...pr, activity: f?.activity ?? null, reviewRequested: pr.reviewRequested && !ANSWERED.has(f?.reviewState ?? '') }
  }

  /** The versions GitLab compares now: where the changes start, the target branch's tip and the head. */
  const diffRefs = async (number: number): Promise<DiffRefs> => {
    const mr = await read(number)
    const r = obj(mr.diff_refs)
    const hex = (v: unknown) => (/^[0-9a-f]{40}$/i.test(str(v)) ? str(v).toLowerCase() : '')
    const refs = { base: hex(r.base_sha), start: hex(r.start_sha), head: hex(r.head_sha) || hex(mr.sha) }
    if (!refs.base || !refs.start || !refs.head) throw new AdarError({ message: `GitLab has no diff for merge request !${number} yet. Try again in a moment.`, code: 'NOT_FOUND' })
    return refs
  }

  /** Where a comment goes in GitLab's diff (its last line, and the first for several lines). */
  const positionOf = async (refs: DiffRefs, c: DraftComment, repo: ReviewRepo): Promise<Obj> => {
    const file = await repo.lines(refs.base, refs.head, c.path)
    const end = file.at(c.side, c.line)
    return {
      base_sha: refs.base,
      start_sha: refs.start,
      head_sha: refs.head,
      position_type: 'text',
      old_path: end.oldPath,
      new_path: end.newPath,
      ...(end.oldLine !== null ? { old_line: end.oldLine } : {}),
      ...(end.newLine !== null ? { new_line: end.newLine } : {}),
      ...(c.startLine && c.startLine < c.line ? { line_range: { start: lineRef(file.at(c.side, c.startLine)), end: lineRef(end) } } : {})
    }
  }

  /** The diff GitLab has is the one the comments were written on. */
  const current = async (number: number, commit: string): Promise<DiffRefs> => {
    const refs = await diffRefs(number)
    if (!sameCommit(refs.head, commit)) throw changedSinceLooked('GitLab', 'merge request')
    return refs
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
    },

    async avatars(authors) {
      // GitLab answers by public email, whatever the commit.
      const out = new Map<string, string>()
      await mapLimit(authors, 4, async (a) => {
        const url = gitlabAvatar(await unlessRefused(() => api.json('GET', `/avatar?email=${encodeURIComponent(a.email)}&size=64`)), api.base)
        if (url) out.set(a.email, url)
      })
      return out
    },

    image: (url) => api.image(url),

    async review(number) {
      const p = `${base}/merge_requests/${number}`
      const [mr, discussions, reviewers, approvals, drafts, commits, who] = await Promise.all([
        read(number),
        pages(`${p}/discussions`),
        unlessRefused(() => api.json('GET', `${p}/reviewers`)),
        unlessRefused(() => api.json('GET', `${p}/approvals`)),
        unlessRefused(() => api.json('GET', `${p}/draft_notes?per_page=100`)),
        unlessRefused(() => api.json('GET', `${p}/commits?per_page=100`)),
        viewer()
      ])
      const data = gitlabReview({ mr, discussions, reviewers, approvals, drafts, commits, viewer: who })
      if (!data) throw new AdarError({ message: `Merge request !${number} was not found on GitLab`, code: 'NOT_FOUND' })
      return data
    },

    async reviewAction(number, action, repo) {
      const p = `${base}/merge_requests/${number}`
      const thread = (id: string) => `${p}/discussions/${encodeURIComponent(id)}`
      switch (action.kind) {
        case 'comment': {
          const refs = await current(number, action.commit)
          await api.json('POST', `${p}/discussions`, { body: action.comment.body, position: await positionOf(refs, action.comment, repo) })
          return
        }
        case 'reply':
          await api.json('POST', `${thread(action.threadId)}/notes`, { body: action.body })
          return
        case 'resolve':
          await api.json('PUT', thread(action.threadId), { resolved: action.resolved })
          return
        case 'conversation':
          await api.json('POST', `${p}/notes`, { body: action.body })
          return
        case 'viewed':
          throw invalid('GitLab keeps no Viewed marks Adar can change: Adar keeps them on this computer')
        case 'submit': {
          const refs = await current(number, action.commit)
          const started = arr(await unlessRefused(() => api.json('GET', `${p}/draft_notes?per_page=100`))).length
          // The review is the user's draft notes published together: the summary first, then the line comments.
          const made: number[] = []
          try {
            if (action.body.trim()) made.push(num(obj(await api.json('POST', `${p}/draft_notes`, { note: action.body })).id))
            for (const c of action.comments) made.push(num(obj(await api.json('POST', `${p}/draft_notes`, { note: c.body, position: await positionOf(refs, c, repo) })).id))
          } catch (err) {
            // Nothing half sent stays behind as a review started on GitLab.
            await Promise.all(made.filter(Boolean).map((id) => api.json('DELETE', `${p}/draft_notes/${id}`).catch(() => undefined)))
            throw err
          }
          if (action.event !== 'approve') {
            await api.json('POST', `${p}/draft_notes/bulk_publish`, { reviewer_state: action.event === 'request-changes' ? 'requested_changes' : 'reviewed' })
            return
          }
          if (made.length || started) await api.json('POST', `${p}/draft_notes/bulk_publish`, {})
          try {
            await api.json('POST', `${p}/approve`, { sha: refs.head })
          } catch (err) {
            if (err instanceof AdarError && /sha|409|conflict/i.test(err.message)) throw changedSinceLooked('GitLab', 'merge request')
            throw err
          }
          return
        }
      }
    }
  }
}
