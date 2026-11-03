// Azure DevOps pull requests of one repository (Azure Repos REST API 7.1 at https://dev.azure.com/<org>, personal
// access token). Open pull requests are read with their statuses and branch policy evaluations; completing one
// waits a moment for Azure DevOps, which merges in the background.

import { AdarError } from '@shared/errors'
import {
  AZURE_API_VERSION,
  AZURE_MERGE_STRATEGY,
  azureChecks,
  azureCommits,
  azureMergeChecks,
  azureMergeMethods,
  azureProtected,
  azurePull,
  azureRepo,
  type AzureRepo,
  type AzureUser
} from '@shared/azure'
import { sameCommit, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import { mapLimit, type ApiClient } from './http'
import { changedSinceLooked, invalid, unlessRefused, type HostingRemote, type PullProvider } from './provider'

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

/**
 * `api` is the organization's client (base https://dev.azure.com/<org>); `orgUrl` its web address, which links are
 * built from (the same, except while testing).
 */
export function azureProvider(api: ApiClient, at: HostingRemote, orgUrl: string, viewer: () => Promise<AzureUser | null>): PullProvider {
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

  const detailed = async (listed: Obj, repo: AzureRepo, who: AzureUser | null): Promise<PullRequest | null> => {
    const number = Number(listed.pullRequestId)
    const [statuses, evals] = await Promise.all([
      api.json('GET', v(`${repoPath}/pullRequests/${number}/statuses`)).catch(() => null),
      evaluations(repo, number).catch(() => null)
    ])
    return azurePull(listed, who?.id ?? '', { checks: azureChecks(statuses, evals, buildsUrl), evaluations: evals }, repoUrl)
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
    }
  }
}
