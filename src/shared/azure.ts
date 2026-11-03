// Azure DevOps' answers (Azure Repos REST API 7.1) mapped onto the provider-neutral pull request types of
// hosting.ts. Azure DevOps numbers pull requests !12, keeps reviewers' votes, and runs branch policies (builds,
// required reviewers…) whose evaluations are the checks and the reasons it would not complete one.
// Pure: the answers are untrusted data.

import {
  MAX_BODY,
  MAX_TITLE,
  httpsUrl,
  isSafeBranchName,
  keepPatterns,
  summarizeChecks,
  type MergeChecks,
  type MergeMethod,
  type PullCheck,
  type PullCommit,
  type PullRequest,
  type PullState,
  type ReviewState
} from './hosting'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const obj = (v: unknown): Obj => (isObj(v) ? v : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const values = (v: unknown): Obj[] => {
  const list = Array.isArray(v) ? v : obj(v).value
  return Array.isArray(list) ? list.filter(isObj) : []
}
const hexSha = (v: unknown): string => (/^[0-9a-f]{40}$/i.test(str(v)) ? str(v).toLowerCase() : '')
const uniq = (list: string[]) => [...new Set(list.filter(Boolean))]
const branchOf = (ref: unknown) => str(ref).replace(/^refs\/heads\//, '')

/** The scope a personal access token needs: Code, read and write. */
export const AZURE_TOKEN_SCOPE = 'Code (Read & write)'
export const AZURE_API_VERSION = '7.1'

export interface AzureUser {
  id: string
  name: string
  /** The sign-in name (usually an email). */
  login: string
}

/** Who a token belongs to (GET {org}/_apis/connectionData). */
export function azureUser(json: unknown): AzureUser | null {
  const u = obj(obj(json).authenticatedUser)
  const id = str(u.id)
  const login = str(obj(obj(u.properties).Account).$value)
  const name = str(u.providerDisplayName) || login
  // An anonymous answer (no or a wrong token) has no account.
  if (!id || !login || /^anonymous$/i.test(name)) return null
  return { id, name, login }
}

/** "<message>" from an error answer ({ message, typeKey }), without Azure's TFnnnnnn: prefix. */
export function azureErrorMessage(body: unknown, fallback: string): string {
  const message = str(obj(body).message).replace(/^TF\d+:\s*/, '')
  return message ? message.slice(0, 300) : fallback
}

/** The repository (GET {org}/{project}/_apis/git/repositories/{repo}). */
export interface AzureRepo {
  id: string
  projectId: string
  defaultBranch: string
  webUrl: string | null
}

export function azureRepo(json: unknown): AzureRepo | null {
  const r = obj(json)
  const id = str(r.id)
  const projectId = str(obj(r.project).id)
  if (!id || !projectId) return null
  return { id, projectId, defaultBranch: branchOf(r.defaultBranch) || 'main', webUrl: httpsUrl(r.webUrl) }
}

// ── Checks and policies ──────────────────────────────────────────────────────

function statusState(state: string): PullCheck['state'] {
  switch (state) {
    case 'succeeded':
      return 'passed'
    case 'failed':
    case 'error':
      return 'failed'
    case 'notApplicable':
      return 'skipped'
    default:
      return 'running' // pending, notSet
  }
}

function policyState(status: string): PullCheck['state'] {
  switch (status) {
    case 'approved':
      return 'passed'
    case 'rejected':
    case 'broken':
      return 'failed'
    case 'notApplicable':
      return 'skipped'
    default:
      return 'running' // queued, running
  }
}

/**
 * The checks of a pull request: the statuses services posted on it (the newest per name), and the build policies'
 * evaluations. `buildsUrl` (the project's …/_build/results page) makes the links to builds.
 */
export function azureChecks(statuses: unknown, evaluations: unknown, buildsUrl: string | null): PullCheck[] {
  const byName = new Map<string, PullCheck>()
  for (const s of values(statuses)) {
    const c = obj(s.context)
    const name = [str(c.genre), str(c.name)].filter(Boolean).join('/') || str(s.description) || 'Status'
    byName.set(name, { name, state: statusState(str(s.state)), url: httpsUrl(s.targetUrl) })
  }
  for (const e of values(evaluations)) {
    const config = obj(e.configuration)
    if (config.isEnabled === false || str(obj(config.type).displayName) !== 'Build') continue
    const name = str(obj(config.settings).displayName) || 'Build'
    const buildId = num(obj(e.context).buildId)
    byName.set(name, { name, state: policyState(str(e.status)), url: buildId && buildsUrl ? `${buildsUrl}?buildId=${buildId}` : null })
  }
  return [...byName.values()]
}

/** Why a blocking policy that is not met yet stops the merge, in a few words. */
function policyReason(e: Obj): string | null {
  const config = obj(e.configuration)
  const status = str(e.status)
  if (config.isEnabled === false || config.isBlocking === false || status === 'approved' || status === 'notApplicable') return null
  const type = str(obj(config.type).displayName)
  const name = str(obj(config.settings).displayName)
  switch (type) {
    case 'Minimum number of reviewers':
      return 'It needs more approvals'
    case 'Required reviewers':
      return 'Required reviewers have not approved it'
    case 'Comment requirements':
      return 'All comments must be resolved'
    case 'Work item linking':
      return 'It must be linked to a work item'
    case 'Build':
      return status === 'rejected' || status === 'broken' ? `${name || 'The build'} failed` : `${name || 'The build'} must succeed first`
    case 'Status':
      return `${name || 'A required status'} must succeed first`
    case 'Require a merge strategy':
      return null
    default:
      return type ? `${type}: not met yet` : 'A branch policy is not met yet'
  }
}

/** What stands between a pull request and completing it: its blocking policies, rejections and conflicts. */
export function azureMergeChecks(pr: unknown, evaluations: unknown): MergeChecks {
  const p = obj(pr)
  const reasons = uniq(values(evaluations).map(policyReason).filter((r): r is string => !!r))
  if (p.isDraft === true) reasons.unshift('It is a draft')
  if (values(p.reviewers).some((r) => num(r.vote) === -10)) reasons.push('A reviewer rejected it')
  const conflicts = str(p.mergeStatus) === 'conflicts'
  if (conflicts) reasons.push(`It conflicts with ${branchOf(p.targetRefName) || 'the target branch'}`)
  return { blocked: reasons.length > 0, reasons, conflicts }
}

// ── Pull requests ──────────────────────────────────────────────────────────

/** What Adar read besides the pull request itself. */
export interface AzureExtra {
  /** Statuses and build policies, or null when not read. */
  checks: PullCheck[] | null
  /** Its policies' evaluations, or null when not read. */
  evaluations: unknown
}

function reviewOf(approved: string[], rejected: string[], waiting: string[], requiredWaiting: boolean): ReviewState {
  if (rejected.length) return 'changes-requested'
  if (approved.length && !requiredWaiting) return 'approved'
  return waiting.length ? 'review-required' : approved.length ? 'approved' : 'none'
}

/**
 * A pull request (GET …/pullrequests[/{id}]) as a provider-neutral one. `repoUrl` is the repository's web page
 * (https://dev.azure.com/org/project/_git/repo), which the link is built from; `viewer` the signed-in user's id.
 */
export function azurePull(v: unknown, viewer: string, extra: AzureExtra, repoUrl: string): PullRequest | null {
  if (!isObj(v)) return null
  const number = num(v.pullRequestId)
  const headRef = branchOf(v.sourceRefName)
  const baseRef = branchOf(v.targetRefName)
  if (!number || !isSafeBranchName(headRef) || !isSafeBranchName(baseRef)) return null
  const s = str(v.status)
  const state: PullState = s === 'completed' ? 'merged' : s === 'abandoned' ? 'closed' : v.isDraft === true ? 'draft' : 'open'
  const open = state === 'open' || state === 'draft'
  const author = obj(v.createdBy)
  // Groups and teams vote through their members; people are what counts here.
  const reviewers = values(v.reviewers).filter((r) => r.isContainer !== true)
  const name = (r: Obj) => str(r.displayName) || str(r.uniqueName)
  const approved = uniq(reviewers.filter((r) => num(r.vote) >= 5).map(name))
  const rejected = uniq(reviewers.filter((r) => num(r.vote) <= -5).map(name))
  const waiting = uniq(reviewers.filter((r) => num(r.vote) === 0).map(name))
  const requiredWaiting = reviewers.some((r) => r.isRequired === true && num(r.vote) < 5)
  const { checks, runs } = extra.checks ? summarizeChecks(extra.checks) : { checks: 'none' as const, runs: [] }
  const checksBlock = open && extra.evaluations !== null && azureMergeChecks(v, extra.evaluations).blocked
  const fork = obj(v.forkSource)
  const forkRepo = obj(fork.repository)
  const mergeStatus = str(v.mergeStatus)
  const isViewer = (id: unknown) => !!viewer && str(id).toLowerCase() === viewer.toLowerCase()
  return {
    provider: 'azure',
    number,
    title: str(v.title).slice(0, MAX_TITLE * 4),
    body: open ? str(v.description).slice(0, MAX_BODY) : '',
    url: `${repoUrl}/pullrequest/${number}`,
    state,
    author: str(author.uniqueName),
    authorName: str(author.displayName) || null,
    headRef,
    headSha: hexSha(obj(v.lastMergeSourceCommit).commitId),
    headFork: str(forkRepo.name) ? `${str(obj(forkRepo.project).name) || 'fork'}/${str(forkRepo.name)}` : null,
    baseRef,
    createdAt: str(v.creationDate),
    updatedAt: str(v.closedDate) || str(v.creationDate),
    closedAt: open ? null : str(v.closedDate) || null,
    additions: 0,
    deletions: 0,
    commitCount: 0,
    checks: open ? checks : 'none',
    checkRuns: open ? runs : [],
    review: open ? reviewOf(approved, rejected, waiting, requiredWaiting) : 'none',
    approvedBy: approved,
    changesRequestedBy: rejected,
    reviewRequests: open ? waiting : [],
    reviewRequested: open && reviewers.some((r) => isViewer(r.id) && num(r.vote) === 0),
    mergeable: mergeStatus === 'conflicts' ? 'conflicts' : mergeStatus === 'succeeded' ? 'clean' : 'unknown',
    mergeBlocked: checksBlock,
    viewerIsAuthor: isViewer(author.id),
    openTasks: 0
  }
}

export function azureCommits(json: unknown): PullCommit[] {
  return values(json)
    .filter((c) => /^[0-9a-f]{40}$/i.test(str(c.commitId)))
    .map((c) => ({
      sha: str(c.commitId).toLowerCase(),
      subject: str(c.comment).split('\n')[0].slice(0, 300),
      author: str(obj(c.author).name)
    }))
}

/** How Adar's merge methods are asked for (completionOptions.mergeStrategy). */
export const AZURE_MERGE_STRATEGY: Partial<Record<MergeMethod, string>> = { merge: 'noFastForward', squash: 'squash', rebase: 'rebase' }

/**
 * Ways of completing pull requests into `branch`: what its "Require a merge strategy" policy allows (GET
 * {org}/{project}/_apis/policy/configurations), or all of them; the merge commit first, as Azure DevOps does.
 */
export function azureMergeMethods(configurations: unknown, repoId: string, branch: string): MergeMethod[] {
  for (const c of values(configurations)) {
    if (c.isEnabled === false || str(obj(c.type).displayName) !== 'Require a merge strategy') continue
    const settings = obj(c.settings)
    if (!scopes(settings).some((s) => s.applies(repoId, branch))) continue
    const allowed: MergeMethod[] = []
    if (settings.allowNoFastForward === true) allowed.push('merge')
    if (settings.allowSquash === true || settings.useSquashMerge === true) allowed.push('squash')
    if (settings.allowRebase === true) allowed.push('rebase')
    if (allowed.length) return allowed
  }
  return ['merge', 'squash', 'rebase']
}

/** The branches a policy applies to ({ refName, matchKind: exact | prefix, repositoryId }). */
function scopes(settings: Obj): Array<{ pattern: string; applies(repoId: string, branch: string): boolean }> {
  return values(settings.scope).flatMap((s) => {
    const ref = str(s.refName)
    if (!ref.startsWith('refs/heads/')) return []
    const name = ref.slice('refs/heads/'.length)
    const prefix = /^prefix$/i.test(str(s.matchKind))
    const repo = str(s.repositoryId)
    return [
      {
        pattern: prefix ? `${name.replace(/\/?$/, '/')}*` : name,
        applies: (repoId: string, branch: string) => (!repo || repo === repoId) && (prefix ? branch.startsWith(name) : branch === name)
      }
    ]
  })
}

/** Branches the repository's blocking branch policies protect (names, and prefixes as "release/*"). */
export function azureProtected(configurations: unknown, repoId: string): string[] {
  const patterns: string[] = []
  for (const c of values(configurations)) {
    if (c.isEnabled === false || c.isBlocking === false) continue
    for (const s of values(obj(c.settings).scope)) {
      const repo = str(s.repositoryId)
      const ref = str(s.refName)
      if ((repo && repo !== repoId) || !ref.startsWith('refs/heads/')) continue
      const name = ref.slice('refs/heads/'.length)
      patterns.push(/^prefix$/i.test(str(s.matchKind)) ? `${name.replace(/\/?$/, '/')}*` : name)
    }
  }
  return keepPatterns(patterns)
}
