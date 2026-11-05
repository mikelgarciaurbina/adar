// Azure DevOps pull requests of one repository (Azure Repos REST API 7.1 at https://dev.azure.com/<org>, personal
// access token). Open pull requests are read with their statuses and branch policy evaluations, and for the dots
// their threads, iterations and commits (again after a push or a vote, else every few minutes); completing one
// waits a moment for Azure DevOps, which merges in the background. Reviews: threads posted one by one (Azure DevOps
// publishes no drafts), then the user's vote.

import { AdarError } from '@shared/errors'
import {
  AZURE_API_VERSION,
  AZURE_MERGE_STRATEGY,
  AZURE_VOTES,
  azureActivity,
  azureChecks,
  azureCommits,
  azureMergeChecks,
  azureMergeMethods,
  azureProtected,
  azurePull,
  azureRepo,
  azureReview,
  type AzureRepo,
  type AzureUser
} from '@shared/azure'
import { sameCommit, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { MAX_ACTIVITY_COMMITS, type DraftComment, type PullActivity } from '@shared/review'
import { BoundedCache, mapLimit, type ApiClient } from './http'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PullProvider, type ReviewRepo } from './provider'

/** Open pull requests read in full (statuses, policies) per update; the rest show without them. */
const MAX_DETAILED = 30
/** How long a completion Azure DevOps runs in the background is waited for. */
const MERGE_WAIT_MS = 60_000

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (v: unknown): Obj[] => {
  const value = obj(v).value
  return Array.isArray(value) ? value.map(obj) : []
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const enc = encodeURIComponent
const num = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) ? v : 0)

/** Azure DevOps says nothing cheap about new comments: each open pull request's activity is read again at least this often. */
const ACTIVITY_TTL_MS = 5 * 60_000

export interface AzureCaches {
  /** What changed in each open pull request, by "<org>/<project>/<repo>!<id>": read again after a push, a vote or ACTIVITY_TTL_MS. */
  activity: BoundedCache<{ key: string; at: number; value: PullActivity }>
}

export const newAzureCaches = (): AzureCaches => ({ activity: new BoundedCache() })

/**
 * `api` is the organization's client (base https://dev.azure.com/<org>); `orgUrl` its web address, which links are
 * built from (the same, except while testing).
 */
export function azureProvider(api: ApiClient, at: HostingRemote, orgUrl: string, viewer: () => Promise<AzureUser | null>, caches: AzureCaches = newAzureCaches()): PullProvider {
  const project = at.owner
  const repoPath = `/${enc(project)}/_apis/git/repositories/${enc(at.name)}`
  const repoUrl = `${orgUrl}/${enc(project)}/_git/${enc(at.name)}`
  const v = (path: string) => `${path}${path.includes('?') ? '&' : '?'}api-version=${AZURE_API_VERSION}`
  const read = async (number: number) => obj(await api.json('GET', v(`${repoPath}/pullrequests/${number}`)))
  let repoInfo: AzureRepo | null = null
  const repository = async (): Promise<AzureRepo> => {
    if (repoInfo) return repoInfo
    const info = azureRepo(await api.json('GET', v(repoPath)))
    if (!info) throw new AdarError({ message: `Azure DevOps: ${project}/${at.name} was not found, or this token has no access to it`, code: 'NOT_FOUND' })
    return (repoInfo = info)
  }
  // Policy evaluations are still a preview API.
  const evaluations = (repo: AzureRepo, number: number) =>
    api.json('GET', `/${enc(project)}/_apis/policy/evaluations?artifactId=${enc(`vstfs:///CodeReview/CodeReviewId/${repo.projectId}/${number}`)}&api-version=${AZURE_API_VERSION}-preview.1`)
  const configurations = () => api.json('GET', v(`/${enc(project)}/_apis/policy/configurations`))
  const buildsUrl = `${orgUrl}/${enc(project)}/_build/results`

  /** What changed in an open pull request (threads, iterations, commits), read again after a push, a vote or a few minutes. */
  const activity = async (pr: Obj, who: AzureUser | null): Promise<PullActivity> => {
    const number = num(pr.pullRequestId)
    const id = `${api.base}/${project}/${at.name}!${number}`
    const votes = (Array.isArray(pr.reviewers) ? pr.reviewers.map(obj) : []).map((r) => `${str(r.id)}:${String(r.vote)}`).sort().join(',')
    const key = `${str(obj(pr.lastMergeSourceCommit).commitId)}|${votes}`
    const cached = caches.activity.get(id)
    if (cached && cached.key === key && Date.now() - cached.at < ACTIVITY_TTL_MS) return cached.value
    const p = `${repoPath}/pullRequests/${number}`
    const [threads, iterations, commits] = await Promise.all([
      api.json('GET', v(`${p}/threads`)),
      api.json('GET', v(`${p}/iterations`)),
      api.json('GET', v(`${p}/commits?$top=${MAX_ACTIVITY_COMMITS + 1}`))
    ])
    const value = azureActivity(threads, iterations, commits, who, str(pr.targetRefName).replace(/^refs\/heads\//, ''), MAX_ACTIVITY_COMMITS)
    caches.activity.set(id, { key, at: Date.now(), value })
    return value
  }

  const detailed = async (listed: Obj, repo: AzureRepo, who: AzureUser | null): Promise<PullRequest | null> => {
    const number = Number(listed.pullRequestId)
    const [statuses, evals] = await Promise.all([
      api.json('GET', v(`${repoPath}/pullRequests/${number}/statuses`)).catch(() => null),
      evaluations(repo, number).catch(() => null)
    ])
    const pr = azurePull(listed, who?.id ?? '', { checks: azureChecks(statuses, evals, buildsUrl), evaluations: evals }, repoUrl)
    if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return pr
    return { ...pr, activity: await activity(listed, who).catch(() => null) }
  }

  /** The pull request, while its head is still the one the comments were written on. */
  const current = async (number: number, commit: string): Promise<Obj> => {
    const pr = await read(number)
    if (!sameCommit(str(obj(pr.lastMergeSourceCommit).commitId), commit)) throw changedSinceLooked('Azure DevOps')
    return pr
  }

  /** Where a new thread goes: the file and its lines (with the end of the last one), on the latest push compared with the base. */
  const threadOn = async (number: number, pr: Obj, c: DraftComment, repo: ReviewRepo): Promise<Obj> => {
    const head = str(obj(pr.lastMergeSourceCommit).commitId).toLowerCase()
    const target = str(obj(pr.lastMergeTargetCommit).commitId).toLowerCase()
    const at = c.side === 'RIGHT' ? head : await repo.mergeBase(target, head)
    const first = c.startLine && c.startLine < c.line ? c.startLine : c.line
    const end = (await repo.lineLength(at, c.path, c.line)) + 1
    const iterations = list(await api.json('GET', v(`${repoPath}/pullRequests/${number}/iterations`)))
    const latest = Math.max(0, ...iterations.map((i) => num(i.id)))
    // The file's id across pushes, so Azure DevOps keeps the thread on its lines as the pull request moves on.
    const changes = latest ? await api.json('GET', v(`${repoPath}/pullRequests/${number}/iterations/${latest}/changes?$compareTo=0&$top=2000`)).catch(() => null) : null
    const entry = (Array.isArray(obj(changes).changeEntries) ? (obj(changes).changeEntries as unknown[]).map(obj) : []).find((e) => str(obj(e.item).path) === `/${c.path}`)
    const range = { start: { line: first, offset: 1 }, end: { line: c.line, offset: Math.max(1, end) } }
    return {
      threadContext:
        c.side === 'RIGHT'
          ? { filePath: `/${c.path}`, rightFileStart: range.start, rightFileEnd: range.end }
          : { filePath: `/${c.path}`, leftFileStart: range.start, leftFileEnd: range.end },
      ...(latest ? { pullRequestThreadContext: { iterationContext: { firstComparingIteration: latest, secondComparingIteration: latest }, ...(entry ? { changeTrackingId: num(entry.changeTrackingId) } : {}) } } : {})
    }
  }

  return {
    async list(): Promise<RepoPullRequests> {
      const repo = await repository()
      const recent = (status: string, top: number) => api.json('GET', v(`${repoPath}/pullrequests?searchCriteria.status=${status}&$top=${top}`))
      const [open, done, abandoned, who, configs] = await Promise.all([
        recent('active', 50),
        recent('completed', 20),
        recent('abandoned', 10),
        viewer(),
        configurations().catch(() => null)
      ])
      const openList = list(open)
      const full = await mapLimit(openList.slice(0, MAX_DETAILED), 6, (pr) => detailed(pr, repo, who))
      const rest = [...openList.slice(MAX_DETAILED), ...list(done), ...list(abandoned)].map((pr) =>
        azurePull(pr, who?.id ?? '', { checks: null, evaluations: null }, repoUrl)
      )
      return {
        provider: 'azure',
        host: 'dev.azure.com',
        owner: project,
        name: at.name,
        remote: at.remote,
        webUrl: repoUrl,
        viewer: who?.login ?? '',
        defaultBranch: repo.defaultBranch,
        mergeMethods: azureMergeMethods(configs, repo.id, repo.defaultBranch),
        // Adar cleans up after a merge itself (it completes with deleteSourceBranch off).
        deleteBranchOnMerge: false,
        // Branch policies decide: their evaluations say so per pull request.
        canMerge: true,
        reportsConflicts: true,
        mergeChecks: true,
        pulls: [...full, ...rest].filter((x): x is PullRequest => !!x)
      }
    },

    async commits(number) {
      return azureCommits(await api.json('GET', v(`${repoPath}/pullRequests/${number}/commits?$top=100`)))
    },

    async create(opts) {
      const created = await api.json('POST', v(`${repoPath}/pullrequests`), {
        sourceRefName: `refs/heads/${opts.head}`,
        targetRefName: `refs/heads/${opts.base}`,
        title: opts.title,
        description: opts.body,
        isDraft: opts.draft
      })
      const pr = azurePull(created, (await viewer())?.id ?? '', { checks: null, evaluations: null }, repoUrl)
      if (!pr) throw new AdarError({ message: 'Azure DevOps created the pull request but its answer could not be read', code: 'UNKNOWN' })
      return pr
    },

    async merge(number, method, headSha) {
      const strategy = AZURE_MERGE_STRATEGY[method]
      if (!strategy) throw invalid('Azure DevOps does not complete pull requests by fast-forwarding')
      const pr = await read(number)
      const sha = str(obj(pr.lastMergeSourceCommit).commitId)
      if (!sameCommit(sha, headSha)) throw changedSinceLooked('Azure DevOps')
      // Azure DevOps refuses when the source moved past lastMergeSourceCommit: the same check, on its side.
      await api.json('PATCH', v(`${repoPath}/pullrequests/${number}`), {
        status: 'completed',
        lastMergeSourceCommit: { commitId: sha },
        completionOptions: { mergeStrategy: strategy, deleteSourceBranch: false }
      })
      const until = Date.now() + MERGE_WAIT_MS
      while (Date.now() < until) {
        const now = await read(number)
        if (str(now.status) === 'completed') return
        const status = str(now.mergeStatus)
        if (status === 'conflicts') throw invalid('Azure DevOps could not complete it: it conflicts with the target branch')
        if (status === 'rejectedByPolicy' || status === 'failure') {
          throw new AdarError({ message: `Azure DevOps could not complete it${str(now.mergeFailureMessage) ? `: ${str(now.mergeFailureMessage)}` : ''}`, code: 'UNKNOWN' })
        }
        await sleep(1000)
      }
      throw new AdarError({ message: 'Azure DevOps is still completing the pull request. Check it on Azure DevOps in a moment.', code: 'NETWORK' })
    },

    async source(number) {
      const pr = await read(number)
      const headRef = str(pr.sourceRefName).replace(/^refs\/heads\//, '')
      const fork = obj(obj(pr.forkSource).repository)
      if (!str(fork.name)) return { headRef, fork: null }
      // A fork's branch is fetched from the fork itself, over https on Azure DevOps.
      const url = str(fork.remoteUrl)
      let from: URL
      try {
        from = new URL(url)
      } catch {
        throw invalid('Azure DevOps did not say where the fork is')
      }
      if (from.protocol !== 'https:' || !(from.hostname === 'dev.azure.com' || from.hostname.endsWith('.visualstudio.com'))) {
        throw invalid('The fork is not on Azure DevOps')
      }
      from.username = ''
      from.password = ''
      return { headRef, fork: { from: from.href, ref: `refs/heads/${headRef}` } }
    },

    async mergeChecks(number) {
      const [pr, repo] = await Promise.all([read(number), repository()])
      return azureMergeChecks(pr, await evaluations(repo, number).catch(() => null))
    },

    async protectedBranches() {
      const repo = await repository()
      return unlessRefused(async () => azureProtected(await configurations(), repo.id))
    },

    async review(number) {
      const p = `${repoPath}/pullRequests/${number}`
      const [pr, threads, iterations, who] = await Promise.all([read(number), api.json('GET', v(`${p}/threads`)), api.json('GET', v(`${p}/iterations?includeCommits=true`)), viewer()])
      const data = azureReview({ pr, threads, iterations, viewer: who })
      if (!data) throw new AdarError({ message: `Pull request !${number} was not found on Azure DevOps`, code: 'NOT_FOUND' })
      return data
    },

    async reviewAction(number, action, repo) {
      const p = `${repoPath}/pullRequests/${number}`
      const text = (content: string) => ({ comments: [{ parentCommentId: 0, content, commentType: 1 }], status: 1 })
      const thread = async (body: Obj) => num(obj(await api.json('POST', v(`${p}/threads`), body)).id)
      switch (action.kind) {
        case 'comment': {
          const pr = await current(number, action.commit)
          await thread({ ...text(action.comment.body), ...(await threadOn(number, pr, action.comment, repo)) })
          return
        }
        case 'reply':
          if (!/^\d+$/.test(action.threadId)) throw invalid('Invalid thread')
          await api.json('POST', v(`${p}/threads/${action.threadId}/comments`), { content: action.body, parentCommentId: action.commentId, commentType: 1 })
          return
        case 'resolve':
          if (!/^\d+$/.test(action.threadId)) throw invalid('Invalid thread')
          await api.json('PATCH', v(`${p}/threads/${action.threadId}`), { status: action.resolved ? 'fixed' : 'active' })
          return
        case 'conversation':
          await thread(text(action.body))
          return
        case 'viewed':
          throw invalid('Azure DevOps keeps no Viewed marks Adar can change: Adar keeps them on this computer')
        case 'submit': {
          const pr = await current(number, action.commit)
          const who = await viewer()
          if (action.event !== 'comment' && !who) throw new AdarError({ message: 'Azure DevOps did not say who the token belongs to', code: 'AUTH_FAILED' })
          // Azure DevOps publishes no drafts: each thread goes now; if anything fails, the ones sent are taken back.
          const made: number[] = []
          try {
            for (const c of action.comments) made.push(await thread({ ...text(c.body), ...(await threadOn(number, pr, c, repo)) }))
            if (action.body.trim()) made.push(await thread(text(action.body)))
            if (action.event !== 'comment' && who) await api.json('PUT', v(`${p}/reviewers/${enc(who.id)}`), { vote: AZURE_VOTES[action.event], id: who.id })
          } catch (err) {
            await Promise.all(made.filter(Boolean).map((id) => api.json('DELETE', v(`${p}/threads/${id}/comments/1`)).catch(() => undefined)))
            throw err
          }
          return
        }
      }
    }
  }
}
