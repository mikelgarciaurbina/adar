// Bitbucket Data Center pull requests of one repository (REST 1.0 on the company's server, HTTP
// access token). Builds are read per commit (cached once they finished); merge checks on demand; each open pull
// request's activities and commits for the dots, until it changes. Reviews: pending comments finished together with
// a status (PUT …/review); servers without reviews get the comments one by one, then the status.

import { AdarError } from '@shared/errors'
import { buildRuns, pageValues, serverActivity, serverCommits, serverMergeChecks, serverMergeMethods, serverProtected, serverPull, serverReview } from '@shared/bitbucket'
import { sameCommit, type PullCheck, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { MAX_ACTIVITY_COMMITS, type DraftComment, type PullActivity } from '@shared/review'
import { serverCommitAvatar } from './avatars'
import { BoundedCache, mapLimit, type ApiClient } from './http'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PullProvider, type ReviewRepo } from './provider'

export interface ServerCaches {
  /** Finished builds by commit. */
  builds: BoundedCache<PullCheck[]>
  /** What changed in each open pull request, by "<repo>#<id>", until it changes again. */
  activity: BoundedCache<{ key: string; value: PullActivity }>
}

export const newServerCaches = (): ServerCaches => ({ builds: new BoundedCache(), activity: new BoundedCache() })

/** Pages of activities read at most (100 each). */
const MAX_PAGES = 5

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : 0)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : [])
const SHA = /^[0-9a-f]{40}$/i

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

  /** Every page of a paged answer (start/limit), up to `max` pages. */
  const pages = async (path: string, max = MAX_PAGES): Promise<Obj[]> => {
    const out: Obj[] = []
    let start = 0
    for (let i = 0; i < max; i++) {
      const page = obj(await api.json('GET', `${path}${path.includes('?') ? '&' : '?'}limit=100&start=${start}`))
      out.push(...pageValues(page))
      if (page.isLastPage !== false || typeof page.nextPageStart !== 'number') break
      start = page.nextPageStart
    }
    return out
  }

  /** What changed in an open pull request (activities and commits), read again only once it changed. */
  const activity = async (p: Obj, who: string): Promise<PullActivity> => {
    const id = `${at.owner}/${at.name}#${String(p.id)}`
    const states = arr(p.reviewers).map((r) => `${str(obj(r.user).slug)}:${str(r.status)}`).sort().join(',')
    const key = [String(p.updatedDate), String(p.version), str(obj(p.fromRef).latestCommit), states].join('|')
    const cached = caches.activity.get(id)
    if (cached?.key === key) return cached.value
    const path = `${repoPath}/pull-requests/${String(p.id)}`
    const [events, commits] = await Promise.all([pages(`${path}/activities`, 1), api.json('GET', `${path}/commits?limit=${MAX_ACTIVITY_COMMITS + 1}`)])
    const value = serverActivity(events, pageValues(commits), who, str(obj(p.toRef).displayId), MAX_ACTIVITY_COMMITS)
    caches.activity.set(id, { key, value })
    return value
  }

  /** The pull request, while its head is still the one the comments were written on. */
  const current = async (number: number, commit: string): Promise<Obj> => {
    const pr = await read(number)
    if (!sameCommit(str(obj(pr.fromRef).latestCommit), commit)) throw changedSinceLooked('Bitbucket')
    return pr
  }

  /** Where a comment goes on the pull request's diff: Bitbucket wants the line's kind and its number on that side. */
  const anchorOf = async (pr: Obj, c: DraftComment, repo: ReviewRepo): Promise<Obj> => {
    const head = str(obj(pr.fromRef).latestCommit).toLowerCase()
    const target = str(obj(pr.toRef).latestCommit).toLowerCase()
    if (!SHA.test(head) || !SHA.test(target)) throw invalid('Bitbucket did not say which commits the pull request compares')
    const base = await repo.mergeBase(target, head)
    const l = (await repo.lines(base, head, c.path)).at(c.side, c.line)
    const lineType = l.oldLine === null ? 'ADDED' : l.newLine === null ? 'REMOVED' : 'CONTEXT'
    return {
      diffType: 'EFFECTIVE',
      line: lineType === 'REMOVED' ? l.oldLine : l.newLine,
      lineType,
      fileType: lineType === 'REMOVED' ? 'FROM' : 'TO',
      path: l.newPath,
      ...(l.oldPath !== l.newPath ? { srcPath: l.oldPath } : {}),
      fromHash: base,
      toHash: head
    }
  }

  /** The signed-in user's slug, as the pull request names them (else their name). */
  const slugOf = (pr: Obj, who: string): string => {
    const me = who.toLowerCase()
    const user = [...arr(pr.reviewers), ...arr(pr.participants)].map((r) => obj(r.user)).find((u) => [str(u.name), str(u.slug)].some((n) => n.toLowerCase() === me))
    return str(user?.slug) || me
  }

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
        const pr = serverPull(p, who, /^[0-9a-f]{40}$/i.test(sha) ? await builds(sha.toLowerCase()) : [], repoUrl)
        if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return pr
        return { ...pr, activity: await activity(p, who).catch(() => null) }
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
    },

    async protectedBranches() {
      // Branch permissions are shown only to repository admins; anyone else gets a 401 or a 403.
      const path = `/rest/branch-permissions/2.0/projects/${encodeURIComponent(project)}/repos/${encodeURIComponent(at.name)}/restrictions?limit=100`
      return unlessRefused(async () => serverProtected(await api.json('GET', path)), ['AUTH_FAILED', 'INVALID_ARGUMENT', 'NOT_FOUND'])
    },

    async avatars(authors) {
      const out = new Map<string, string>()
      await mapLimit(authors, 4, async (a) => {
        const url = serverCommitAvatar(await unlessRefused(() => api.json('GET', `${repoPath}/commits/${a.sha}?avatarSize=64`)), a.email, api.base)
        if (url) out.set(a.email, url)
      })
      return out
    },

    image: (url) => api.image(url),

    async review(number) {
      const p = `${repoPath}/pull-requests/${number}`
      const [pr, activities, commits, pending, who] = await Promise.all([
        read(number),
        pages(`${p}/activities`),
        api.json('GET', `${p}/commits?limit=100`).catch(() => null),
        // Servers older than reviews (before 8.x) have no …/review: null.
        unlessRefused(async () => pageValues(await api.json('GET', `${p}/review?limit=100`))),
        viewer()
      ])
      const data = serverReview({ pr, activities, commits: pageValues(commits), pending, viewer: who })
      if (!data) throw new AdarError({ message: `Pull request #${number} was not found on Bitbucket`, code: 'NOT_FOUND' })
      return data
    },

    async reviewAction(number, action, repo) {
      const p = `${repoPath}/pull-requests/${number}`
      const post = async (body: Obj) => num(obj(await api.json('POST', `${p}/comments`, body)).id)
      switch (action.kind) {
        case 'comment': {
          const pr = await current(number, action.commit)
          await post({ text: action.comment.body, anchor: await anchorOf(pr, action.comment, repo) })
          return
        }
        case 'reply':
          await post({ text: action.body, parent: { id: action.commentId } })
          return
        case 'resolve': {
          if (!/^\d+$/.test(action.threadId)) throw invalid('Invalid thread')
          const c = obj(await api.json('GET', `${p}/comments/${action.threadId}`))
          await api.json('PUT', `${p}/comments/${action.threadId}`, { version: num(c.version), threadResolved: action.resolved })
          return
        }
        case 'conversation':
          await post({ text: action.body })
          return
        case 'viewed':
          throw invalid('Bitbucket keeps no Viewed marks Adar can change: Adar keeps them on this computer')
        case 'submit': {
          const pr = await current(number, action.commit)
          const head = str(obj(pr.fromRef).latestCommit).toLowerCase()
          const reviews = (await unlessRefused(() => api.json('GET', `${p}/review?limit=1`))) !== null
          const status = action.event === 'approve' ? 'APPROVED' : action.event === 'request-changes' ? 'NEEDS_WORK' : null
          const made: number[] = []
          try {
            for (const c of action.comments) made.push(await post({ text: c.body, anchor: await anchorOf(pr, c, repo), ...(reviews ? { state: 'PENDING' } : {}) }))
            if (reviews) {
              // The review: the pending comments (the user's from the website too) published with the summary and the status.
              await api.json('PUT', `${p}/review`, { ...(action.body.trim() ? { commentText: action.body } : {}), lastReviewedCommit: head, ...(status ? { participantStatus: status } : {}) })
            } else {
              if (action.body.trim()) made.push(await post({ text: action.body }))
              if (status) await api.json('PUT', `${p}/participants/${encodeURIComponent(slugOf(pr, await viewer()))}`, { status, lastReviewedCommit: head })
            }
          } catch (err) {
            // Nothing half sent stays behind.
            await Promise.all(made.filter(Boolean).map((id) => api.json('DELETE', `${p}/comments/${id}?version=0`).catch(() => undefined)))
            throw err
          }
          return
        }
      }
    }
  }
}
