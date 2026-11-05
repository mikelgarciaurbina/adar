// Bitbucket Cloud pull requests of one repository (api.bitbucket.org/2.0, email + API token).
// The list leaves reviewers out, so each open pull request is read once per update (cached), with its activity and
// commits for the dots, and its builds once per commit (cached once they finished). Reviews: comments posted one by
// one (Cloud has no way to publish a review's drafts), then the approval or the request for changes.

import { AdarError } from '@shared/errors'
import { buildRuns, cloudActivity, cloudCommits, cloudMergeMethods, cloudProtected, cloudPull, cloudReview, pageValues, type CloudViewer } from '@shared/bitbucket'
import { sameCommit, type PullCheck, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { parseRemoteUrl } from '@shared/remoteUrl'
import { MAX_ACTIVITY_COMMITS, type DraftComment, type PullActivity } from '@shared/review'
import { cloudCommitAvatar } from './avatars'
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
  /** What changed in each open pull request, by "<repo>#<id>", until it changes again. */
  activity: BoundedCache<{ key: string; value: PullActivity }>
}

export const newCloudCaches = (): CloudCaches => ({ pulls: new BoundedCache(), builds: new BoundedCache(), activity: new BoundedCache() })

/** Pages of a paged answer read at most. */
const MAX_PAGES = 5

/** Where a comment goes on Cloud's diff: the new side's line (`to`), or the old side's (`from`), with the first of several lines. */
function inlineOf(c: DraftComment): Record<string, unknown> {
  const several = c.startLine && c.startLine < c.line
  return c.side === 'RIGHT' ? { path: c.path, to: c.line, ...(several ? { start_to: c.startLine } : {}) } : { path: c.path, from: c.line, ...(several ? { start_from: c.startLine } : {}) }
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : 0)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : [])
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

  /** Every page of a paged answer (following `next`, up to `max` pages). */
  const pages = async (path: string, max = MAX_PAGES): Promise<Obj[]> => {
    const out: Obj[] = []
    let next: string | null = path
    for (let i = 0; i < max && next; i++) {
      const page = obj(await api.json('GET', next))
      out.push(...pageValues(page))
      next = str(page.next) || null
    }
    return out
  }

  /** What changed in an open pull request (its activity and commits), read again only once it changed. */
  const activity = async (full: Obj, who: CloudViewer | null): Promise<PullActivity> => {
    const id = `${at.owner}/${at.name}#${String(full.id)}`
    const states = arr(full.participants).map((p) => `${str(obj(p.user).uuid)}:${str(p.state)}:${String(p.approved)}`).sort().join(',')
    const key = [str(full.updated_on), String(full.comment_count), str(obj(obj(full.source).commit).hash), states].join('|')
    const cached = caches.activity.get(id)
    if (cached?.key === key) return cached.value
    const p = `${repoPath}/pullrequests/${String(full.id)}`
    const [events, commits] = await Promise.all([pages(`${p}/activity?pagelen=50`, 2), api.json('GET', `${p}/commits?pagelen=${MAX_ACTIVITY_COMMITS + 1}`)])
    const value = cloudActivity(events, pageValues(commits), who, str(obj(obj(full.destination).branch).name), MAX_ACTIVITY_COMMITS)
    caches.activity.set(id, { key, value })
    return value
  }

  /** The pull request's head is still the one the comments were written on. */
  const current = async (number: number, commit: string): Promise<Obj> => {
    const pr = obj(await read(number))
    const head = str(obj(obj(pr.source).commit).hash).toLowerCase()
    if (!head || !commit.startsWith(head)) throw changedSinceLooked('Bitbucket')
    return pr
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
        const pr = cloudPull(full, who, await builds(obj(full)))
        if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return pr
        return { ...pr, activity: await activity(obj(full), who).catch(() => null) }
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
    },

    async review(number) {
      const p = `${repoPath}/pullrequests/${number}`
      const [pr, comments, events, commits, who] = await Promise.all([read(number), pages(`${p}/comments?pagelen=100`), pages(`${p}/activity?pagelen=50`, 3), pages(`${p}/commits?pagelen=100`, 2), viewer()])
      const data = cloudReview({ pr, comments, activity: events, commits, viewer: who })
      if (!data) throw new AdarError({ message: `Pull request #${number} was not found on Bitbucket`, code: 'NOT_FOUND' })
      if (!data.headSha) throw new AdarError({ message: `Bitbucket did not list the last commit of pull request #${number}. Try again in a moment.`, code: 'NOT_FOUND' })
      return data
    },

    async reviewAction(number, action) {
      const p = `${repoPath}/pullrequests/${number}`
      const post = async (body: Record<string, unknown>) => num(obj(await api.json('POST', `${p}/comments`, body)).id)
      switch (action.kind) {
        case 'comment':
          await current(number, action.commit)
          await post({ content: { raw: action.comment.body }, inline: inlineOf(action.comment) })
          return
        case 'reply':
          await post({ content: { raw: action.body }, parent: { id: action.commentId } })
          return
        case 'resolve':
          await api.json(action.resolved ? 'POST' : 'DELETE', `${p}/comments/${encodeURIComponent(action.threadId)}/resolve`)
          return
        case 'conversation':
          await post({ content: { raw: action.body } })
          return
        case 'viewed':
          throw invalid('Bitbucket keeps no Viewed marks Adar can change: Adar keeps them on this computer')
        case 'submit': {
          await current(number, action.commit)
          // Cloud publishes no drafts: each comment goes now; if anything fails, the ones sent are taken back.
          const made: number[] = []
          try {
            for (const c of action.comments) made.push(await post({ content: { raw: c.body }, inline: inlineOf(c) }))
            if (action.body.trim()) made.push(await post({ content: { raw: action.body } }))
            if (action.event === 'approve') await api.json('POST', `${p}/approve`)
            else if (action.event === 'request-changes') await api.json('POST', `${p}/request-changes`)
          } catch (err) {
            await Promise.all(made.filter(Boolean).map((id) => api.json('DELETE', `${p}/comments/${id}`).catch(() => undefined)))
            throw err
          }
          return
        }
      }
    },

    async avatars(authors) {
      // A commit Bitbucket has not seen (only local) is a 404: no picture.
      const out = new Map<string, string>()
      await mapLimit(authors, 4, async (a) => {
        const url = cloudCommitAvatar(await unlessRefused(() => api.json('GET', `${repoPath}/commit/${a.sha}`)), a.email)
        if (url) out.set(a.email, url)
      })
      return out
    }
  }
}
