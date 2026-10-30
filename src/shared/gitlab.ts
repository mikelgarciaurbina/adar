// GitLab's answers (REST API v4, gitlab.com and self-managed instances) mapped onto the
// provider-neutral pull request types of hosting.ts. GitLab calls them merge requests (!number).
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
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const hexSha = (v: unknown): string => (/^[0-9a-f]{40}$/i.test(str(v)) ? str(v).toLowerCase() : '')
const uniq = (list: string[]) => [...new Set(list.filter(Boolean))]

/** The scope a personal access token needs: reading and writing merge requests goes through `api`. */
export const GITLAB_TOKEN_SCOPE = 'api'

/** A GitLab user as the API names them. */
export interface GitlabUser {
  username: string
  name: string
}

export function gitlabUser(v: unknown): GitlabUser | null {
  const u = obj(v)
  const username = str(u.username)
  return username ? { username, name: str(u.name) || username } : null
}

/** "<message>" from an error answer ({ message } as text, list or per-field lists, or OAuth's { error, error_description }). */
export function gitlabErrorMessage(body: unknown, fallback: string): string {
  const b = obj(body)
  if (b.error === 'insufficient_scope') {
    return `the token lacks the ${str(b.scope) || GITLAB_TOKEN_SCOPE} scope. Create a personal access token with the ${GITLAB_TOKEN_SCOPE} scope.`
  }
  const m = b.message
  let text = ''
  if (typeof m === 'string') text = m === '401 Unauthorized' ? 'the token is wrong, expired or revoked' : m
  else if (Array.isArray(m)) text = m.filter((x): x is string => typeof x === 'string').join('; ')
  else if (isObj(m)) {
    text = Object.entries(m)
      .map(([field, v]) => {
        const said = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string').join(', ')
        return field === 'base' ? said : `${field.replace(/_/g, ' ')} ${said}`
      })
      .filter(Boolean)
      .join('; ')
  }
  text ||= str(b.error_description) || str(b.error)
  return text ? text.slice(0, 300) : fallback
}

// ── Pipelines ──────────────────────────────────────────────────────────────

function jobState(status: string, allowFailure: boolean): PullCheck['state'] {
  switch (status) {
    case 'success':
      return 'passed'
    case 'failed':
      // GitLab passes the pipeline with a warning.
      return allowFailure ? 'skipped' : 'failed'
    case 'canceled':
    case 'canceling':
      return 'failed'
    case 'manual':
    case 'skipped':
      return 'skipped'
    default:
      return 'running' // created, pending, preparing, waiting_for_resource, scheduled, running…
  }
}

/** The jobs of a pipeline (GET /projects/:id/pipelines/:pipeline_id/jobs). */
export function gitlabJobs(json: unknown): PullCheck[] {
  return arr(json).map((j) => ({
    name: str(j.name) || 'Job',
    state: jobState(str(j.status), j.allow_failure === true),
    url: httpsUrl(j.web_url)
  }))
}

/** A pipeline's status in summarizeChecks' words. */
function pipelineOverall(status: string): string {
  if (status === 'success') return 'SUCCESS'
  if (status === 'failed' || status === 'canceled') return 'FAILURE'
  if (status === 'skipped' || status === 'manual' || !status) return ''
  return 'PENDING'
}

// ── Merge requests ─────────────────────────────────────────────────────────

/** What Adar read besides the merge request itself. */
export interface GitlabExtra {
  /** Who approved it (GET …/approvals), or null when not read. */
  approvers: GitlabUser[] | null
  /** Its head pipeline: the status and the jobs, or null when not read or there is none. */
  pipeline: { status: string; jobs: PullCheck[] } | null
  /** group/project of the fork it comes from, when it does and the fork could be read. */
  fork: string | null
}

const SETTLED = new Set(['mergeable', 'checking', 'unchecked', 'preparing', 'approvals_syncing', ''])
const UNKNOWN = new Set(['checking', 'unchecked', 'preparing', 'approvals_syncing', ''])

function reviewOf(changes: boolean, approvals: string[], waiting: string[], status: string): ReviewState {
  if (changes) return 'changes-requested'
  if (approvals.length) return 'approved'
  return waiting.length || status === 'not_approved' ? 'review-required' : 'none'
}

/**
 * A merge request (GET /projects/:id/merge_requests[/:iid]) as a pull request. `repoUrl` is the project's web page
 * on the instance Adar signed in to, which the link is built from.
 */
export function gitlabPull(v: unknown, viewer: GitlabUser | null, extra: GitlabExtra, repoUrl: string): PullRequest | null {
  if (!isObj(v)) return null
  const number = num(v.iid)
  const headRef = str(v.source_branch)
  const baseRef = str(v.target_branch)
  if (!number || !isSafeBranchName(headRef) || !isSafeBranchName(baseRef)) return null
  const s = str(v.state)
  const state: PullState = s === 'merged' ? 'merged' : s === 'closed' ? 'closed' : v.draft === true || v.work_in_progress === true ? 'draft' : 'open'
  const open = state === 'open' || state === 'draft'
  const status = str(v.detailed_merge_status)
  const author = gitlabUser(v.author)
  const approvers = extra.approvers ?? []
  const approvedBy = uniq(approvers.map((u) => u.name))
  const reviewers = arr(v.reviewers)
    .map(gitlabUser)
    .filter((u): u is GitlabUser => !!u)
  const approvedNames = new Set(approvers.map((u) => u.username))
  const waiting = uniq(reviewers.filter((r) => !approvedNames.has(r.username)).map((r) => r.name))
  const isViewer = (u: GitlabUser | null) => !!u && !!viewer && u.username.toLowerCase() === viewer.username.toLowerCase()
  const pipeline = extra.pipeline
  const { checks, runs } = pipeline ? summarizeChecks(pipeline.jobs, pipelineOverall(pipeline.status)) : { checks: 'none' as const, runs: [] }
  const fromFork = num(v.source_project_id) !== 0 && num(v.source_project_id) !== num(v.target_project_id)
  return {
    provider: 'gitlab',
    number,
    title: str(v.title).slice(0, MAX_TITLE * 4),
    body: open ? str(v.description).slice(0, MAX_BODY) : '',
    url: `${repoUrl}/-/merge_requests/${number}`,
    state,
    author: author?.username ?? '',
    authorName: author?.name ?? null,
    headRef,
    headSha: hexSha(v.sha),
    headFork: fromFork ? (extra.fork ?? 'fork') : null,
    baseRef,
    createdAt: str(v.created_at),
    updatedAt: str(v.updated_at),
    closedAt: open ? null : str(v.merged_at) || str(v.closed_at) || str(v.updated_at) || null,
    additions: 0,
    deletions: 0,
    commitCount: 0,
    checks: open ? checks : 'none',
    checkRuns: open ? runs : [],
    review: open ? reviewOf(status === 'requested_changes', approvedBy, waiting, status) : 'none',
    approvedBy,
    changesRequestedBy: [],
    reviewRequests: open ? waiting : [],
    reviewRequested: open && reviewers.some(isViewer) && !approvers.some(isViewer),
    mergeable: v.has_conflicts === true || status === 'conflict' ? 'conflicts' : UNKNOWN.has(status) ? 'unknown' : 'clean',
    mergeBlocked: open && !SETTLED.has(status) && status !== 'conflict' && status !== 'draft_status',
    viewerIsAuthor: isViewer(author),
    openTasks: 0
  }
}

/** Who approved a merge request (GET …/merge_requests/:iid/approvals). */
export function gitlabApprovers(json: unknown): GitlabUser[] {
  return arr(obj(json).approved_by)
    .map((a) => gitlabUser(a.user))
    .filter((u): u is GitlabUser => !!u)
}

/**
 * Ways of merging a project allows (GET /projects/:id): its merge method (merge commit, semi-linear history or
 * fast-forward) with or without squashing, as its squash option says, the default first.
 */
export function gitlabMergeMethods(project: unknown): MergeMethod[] {
  const p = obj(project)
  const base: MergeMethod = str(p.merge_method) === 'ff' ? 'fast-forward' : 'merge'
  switch (str(p.squash_option)) {
    case 'always':
      return ['squash']
    case 'default_on':
      return ['squash', base]
    case 'never':
      return [base]
    default:
      return [base, 'squash']
  }
}

export function gitlabCommits(json: unknown): PullCommit[] {
  return arr(json)
    .filter((c) => /^[0-9a-f]{40}$/i.test(str(c.id)))
    .map((c) => ({
      sha: str(c.id).toLowerCase(),
      subject: (str(c.title) || str(c.message).split('\n')[0]).slice(0, 300),
      author: str(c.author_name)
    }))
}

/** Why GitLab would not merge it now (detailed_merge_status), in a few words each. */
const BLOCKERS: Record<string, (base: string) => string> = {
  ci_must_pass: () => 'The pipeline must succeed first',
  ci_still_running: () => 'The pipeline is still running',
  discussions_not_resolved: () => 'All threads must be resolved',
  draft_status: () => 'It is a draft',
  not_approved: () => 'It needs approval',
  requested_changes: () => 'A reviewer requested changes',
  need_rebase: (base) => `It needs a rebase onto ${base}`,
  conflict: (base) => `It conflicts with ${base}`,
  merge_request_blocked: () => 'Another merge request blocks it',
  jira_association_missing: () => 'Its title or description must mention a Jira issue',
  status_checks_must_pass: () => 'External status checks must pass',
  external_status_checks: () => 'External status checks must pass',
  security_policy_violations: () => 'Security policies must be satisfied',
  security_policy_pipeline_check: () => 'The pipelines of its last commit must succeed',
  locked_paths: () => 'Paths locked by others must be unlocked',
  locked_lfs_files: () => 'LFS files locked by others must be unlocked',
  title_regex: () => 'Its title must match the project’s rule',
  merge_time: () => 'It cannot be merged before its scheduled time',
  commits_status: () => 'Its source branch must exist and have commits',
  not_open: () => 'It is not open'
}

/** What stands between a merge request (GET …/merge_requests/:iid) and merging it, as GitLab says. */
export function gitlabMergeChecks(mr: unknown): MergeChecks {
  const v = obj(mr)
  const status = str(v.detailed_merge_status)
  const base = str(v.target_branch) || 'the target branch'
  const reasons: string[] = []
  if (obj(v.user).can_merge === false) reasons.push('You do not have permission to merge it')
  if (!SETTLED.has(status)) reasons.push(BLOCKERS[status]?.(base) ?? 'It cannot be merged yet')
  return { blocked: reasons.length > 0, reasons, conflicts: v.has_conflicts === true || status === 'conflict' }
}

/** Names and patterns ("release/*") of GET /projects/:id/protected_branches. */
export function gitlabProtected(json: unknown): string[] {
  return keepPatterns(arr(json).map((b) => b.name))
}
