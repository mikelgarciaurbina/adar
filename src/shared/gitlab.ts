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
import {
  MAX_ACTIVITY_COMMITS,
  MAX_TEXT,
  isBaseMerge,
  isSafePath,
  type ConversationComment,
  type PullActivity,
  type PullReviewData,
  type ReviewFeatures,
  type ReviewSummary,
  type ReviewThread,
  type ReviewVerdict,
  type TimelineEvent
} from './review'

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

// ── Reviewing a merge request in Adar ────────────────────────────────────────

/** GitLab keeps no Viewed marks Adar can read (Adar keeps them); comments span lines; suggestions are ```suggestion:-N+0. */
export const GITLAB_FEATURES: ReviewFeatures = { viewed: 'adar', multiLine: true, suggestions: 'gitlab', events: ['comment', 'approve', 'request-changes'] }

/** What Adar reads to show a merge request's review. */
export interface GitlabReviewAnswers {
  /** GET /projects/:id/merge_requests/:iid */
  mr: unknown
  /** GET …/discussions: line threads, the conversation and GitLab's system notes. */
  discussions: unknown
  /** GET …/reviewers: each reviewer's state. */
  reviewers: unknown
  /** GET …/approvals */
  approvals: unknown
  /** GET …/draft_notes: the signed-in user's comments of a review started on GitLab's website. */
  drafts: unknown
  /** GET …/commits (newest first): the commits system notes name by their short id. */
  commits: unknown
  viewer: GitlabUser | null
}

const unescapeHtml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const lineNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null)

/** A reviewer's state (GET …/reviewers) in Adar's words; null when they have not said anything yet. */
function reviewerVerdict(state: string): ReviewVerdict | 'requested' {
  if (state === 'approved') return 'approved'
  if (state === 'requested_changes') return 'changes-requested'
  if (state === 'reviewed') return 'commented'
  return 'requested' // unreviewed, review_started, unapproved
}

/** What a system note says happened, for the conversation (GitLab writes them in English). */
function systemEvent(body: string): { kind: 'approved' | 'changes' | 'ready' | 'requested' | 'commits'; reviewers?: string[] } | null {
  const first = body.split('\n')[0].trim()
  if (/^approved this merge request$/i.test(first)) return { kind: 'approved' }
  if (/^requested changes\b/i.test(first)) return { kind: 'changes' }
  if (/^marked this merge request as \*\*ready\*\*$/i.test(first)) return { kind: 'ready' }
  const asked = /^requested review from (.+)$/i.exec(first)
  if (asked) {
    const reviewers = asked[1]
      .split(/,\s*|\s+and\s+/)
      .map((r) => r.trim().replace(/^@/, ''))
      .filter((r) => /^[\w.-]+$/.test(r))
    return reviewers.length ? { kind: 'requested', reviewers } : null
  }
  if (/^added \d+ (?:new )?commits?\b/i.test(first)) return { kind: 'commits' }
  return null
}

/** The commits an "added N commits" note lists (`<li>1a2b3c4d - Subject</li>`), resolved to full ids where known. */
function noteCommits(body: string, known: ReadonlyArray<{ sha: string; subject: string }>): Array<{ sha: string; subject: string }> {
  const out: Array<{ sha: string; subject: string }> = []
  for (const m of body.matchAll(/<li>([0-9a-f]{7,40}) - (.*?)<\/li>/g)) {
    const hit = known.find((c) => c.sha.startsWith(m[1].toLowerCase()))
    if (hit) out.push({ sha: hit.sha, subject: hit.subject || unescapeHtml(m[2]).slice(0, 300) })
  }
  return out
}

/** A merge request's review as Adar shows it, or null when the answer is not a merge request. */
export function gitlabReview(a: GitlabReviewAnswers): PullReviewData | null {
  if (!isObj(a.mr)) return null
  const mr = a.mr
  const number = num(mr.iid)
  if (!number) return null
  const viewer = a.viewer?.username ?? ''
  const me = viewer.toLowerCase()
  const author = gitlabUser(mr.author)?.username ?? ''
  const refs = obj(mr.diff_refs)
  const headSha = hexSha(refs.head_sha) || hexSha(mr.sha)
  const userOf = (v: unknown) => gitlabUser(v)?.username ?? ''
  const mine = (who: string) => !!me && who.toLowerCase() === me
  const text = (v: unknown) => str(v).slice(0, MAX_TEXT)

  const known = arr(a.commits)
    .filter((c) => hexSha(c.id))
    .map((c) => ({ sha: hexSha(c.id), subject: (str(c.title) || str(c.message).split('\n')[0]).slice(0, 300), author: str(c.author_name), at: str(c.created_at) || str(c.committed_date) }))

  const threads: ReviewThread[] = []
  const comments: ConversationComment[] = []
  const reviews: ReviewSummary[] = []
  const timeline: TimelineEvent[] = []
  const pushed = new Set<string>()
  for (const d of arr(a.discussions)) {
    const notes = arr(d.notes)
    const id = str(d.id)
    if (!notes.length || !id) continue
    const first = notes[0]
    if (first.system === true) {
      const at = str(first.created_at)
      const who = userOf(first.author)
      const ev = systemEvent(str(first.body))
      if (!ev) continue
      if (ev.kind === 'approved' || ev.kind === 'changes') {
        reviews.push({ id: `note-${num(first.id)}`, author: who, verdict: ev.kind === 'approved' ? 'approved' : 'changes-requested', body: '', submittedAt: at, commit: null, comments: 0 })
      } else if (ev.kind === 'ready') timeline.push({ kind: 'ready', at, actor: who })
      else if (ev.kind === 'requested') for (const reviewer of ev.reviewers ?? []) timeline.push({ kind: 'review-requested', at, actor: who, reviewer })
      else {
        const list = noteCommits(str(first.body), known)
        for (const c of list) pushed.add(c.sha)
        if (list.length) timeline.push({ kind: 'commits', at, author: who, commits: list })
      }
      continue
    }
    const said = notes.filter((n) => n.system !== true && num(n.id) > 0)
    const position = obj(first.position)
    if (first.type === 'DiffNote') {
      // Comments on an image's pixels have no line to sit on.
      if (str(position.position_type || 'text') !== 'text') continue
      const path = str(position.new_path) || str(position.old_path)
      if (!isSafePath(path) || !said.length) continue
      const newLine = lineNumber(position.new_line)
      const oldLine = lineNumber(position.old_line)
      const side = newLine ? 'RIGHT' : 'LEFT'
      const line = newLine ?? oldLine
      const range = obj(position.line_range)
      const start = obj(range.start)
      const startNo = side === 'RIGHT' ? lineNumber(start.new_line) : lineNumber(start.old_line)
      // GitLab moves a thread to each new version while its lines stay the same; one left behind is outdated.
      const outdated = !!headSha && hexSha(position.head_sha) !== headSha
      threads.push({
        id,
        path,
        side,
        line: outdated ? null : line,
        startLine: !outdated && startNo && line && startNo < line ? startNo : null,
        originalLine: line,
        resolved: first.resolved === true,
        outdated,
        canResolve: first.resolvable === true,
        canReply: true,
        comments: said.map((n) => ({ id: num(n.id), author: userOf(n.author), body: text(n.body), createdAt: str(n.created_at), viewerDidAuthor: mine(userOf(n.author)) }))
      })
      continue
    }
    // Comments on the merge request itself (threads started there read in order).
    for (const n of said) comments.push({ id: num(n.id), author: userOf(n.author), body: text(n.body), createdAt: str(n.created_at), viewerDidAuthor: mine(userOf(n.author)) })
  }

  // The commits it was opened with: no note lists them.
  const opening = known.filter((c) => !pushed.has(c.sha)).reverse()
  if (opening.length) timeline.push({ kind: 'commits', at: str(mr.created_at) || opening[0].at, author, commits: opening.map((c) => ({ sha: c.sha, subject: c.subject })) })
  timeline.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))

  const reviewers: PullReviewData['reviewers'] = []
  const put = (login: string, verdict: ReviewVerdict | 'requested') => {
    if (!login || login === author) return
    const had = reviewers.find((r) => r.login === login)
    if (had) had.verdict = verdict
    else reviewers.push({ login, verdict })
  }
  for (const r of arr(a.reviewers)) put(userOf(r.user), reviewerVerdict(str(r.state)))
  for (const u of gitlabApprovers(a.approvals)) put(u.username, 'approved')

  const drafts = arr(a.drafts).length
  return {
    number,
    nodeId: String(num(mr.id) || number),
    features: GITLAB_FEATURES,
    viewer,
    title: str(mr.title),
    body: text(mr.description),
    author,
    headSha,
    // The target branch's tip this version was compared with: its merge base with the head is where the changes start.
    baseSha: hexSha(refs.start_sha) || hexSha(refs.base_sha),
    viewed: {},
    threads,
    reviews: reviews.sort((x, y) => (x.submittedAt < y.submittedAt ? -1 : x.submittedAt > y.submittedAt ? 1 : 0)),
    comments,
    timeline,
    reviewers,
    pendingOnService: drafts ? { id: 'drafts', comments: drafts } : null
  }
}

// ── What changed since the user looked (the list's dots and notifications) ──

/** What Adar reads of an open merge request for its dots: GET …/notes (newest first), …/commits and …/versions. */
export interface GitlabActivityAnswers {
  notes: unknown
  commits: unknown
  versions: unknown
}

/** The signed-in user's part in a merge request and what others said, as GitLab's notes, commits and versions tell. */
export function gitlabActivity(a: GitlabActivityAnswers, viewer: GitlabUser | null, baseRef: string): PullActivity {
  const me = viewer?.username.toLowerCase() ?? ''
  const mine = (who: string) => !!me && who.toLowerCase() === me
  // Each push makes a version: the head at a given time is the last version's before it.
  const versions = arr(a.versions)
    .map((v) => ({ head: hexSha(v.head_commit_sha), at: str(v.created_at) }))
    .filter((v) => v.head && v.at)
    .sort((x, y) => (x.at < y.at ? -1 : 1))
  const headAt = (at: string) => versions.filter((v) => v.at <= at).at(-1)?.head ?? null

  let viewerReview: PullActivity['viewerReview'] = null
  let viewerCommentAt: string | null = null
  const others: PullActivity['others'] = []
  const review = (r: NonNullable<PullActivity['viewerReview']>) => {
    if (!viewerReview || r.at > viewerReview.at) viewerReview = r
  }
  for (const n of arr(a.notes)) {
    const who = gitlabUser(n.author)?.username ?? ''
    const at = str(n.created_at)
    if (!who || !at) continue
    if (n.system === true) {
      const ev = systemEvent(str(n.body))
      if (ev?.kind !== 'approved' && ev?.kind !== 'changes') continue
      const verdict: ReviewVerdict = ev.kind === 'approved' ? 'approved' : 'changes-requested'
      if (mine(who)) review({ commit: headAt(at), at, verdict })
      else others.push({ who, at, kind: 'review', verdict })
      continue
    }
    if (!mine(who)) {
      others.push({ who, at, kind: 'comment' })
      continue
    }
    // A comment on a line is part of a review of the version it was written on; others are on the conversation.
    const pos = obj(n.position)
    if (n.type === 'DiffNote') review({ commit: hexSha(pos.head_sha) || headAt(at), at, verdict: 'commented' })
    else if (!viewerCommentAt || at > viewerCommentAt) viewerCommentAt = at
  }
  others.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))

  const listed = arr(a.commits).filter((c) => hexSha(c.id))
  const commits = listed
    .slice(0, MAX_ACTIVITY_COMMITS)
    .reverse()
    .map((c) => ({
      sha: hexSha(c.id),
      at: str(c.committed_date) || str(c.created_at),
      baseMerge: Array.isArray(c.parent_ids) && c.parent_ids.length > 1 && isBaseMerge(str(c.title) || str(c.message).split('\n')[0], baseRef)
    }))
  return { viewerReview, viewerCommentAt, commits, moreCommits: listed.length > MAX_ACTIVITY_COMMITS, others }
}

