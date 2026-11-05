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
import {
  MAX_TEXT,
  isBaseMerge,
  isSafePath,
  type ConversationComment,
  type PullActivity,
  type PullReviewData,
  type ReviewComment,
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

// ── Reviewing a pull request in Adar ─────────────────────────────────────────

/** Azure DevOps keeps no Viewed marks Adar can read; comments span lines; suggested changes are ```suggestion. */
export const AZURE_FEATURES: ReviewFeatures = { viewed: 'adar', multiLine: true, suggestions: 'github', events: ['comment', 'approve', 'request-changes'] }

/** The votes Adar casts: Approved, and Waiting for author for changes. */
export const AZURE_VOTES = { approve: 10, 'request-changes': -5 } as const

/** What Adar reads to show a pull request's review. */
export interface AzureReviewAnswers {
  /** GET …/pullrequests/{id} */
  pr: unknown
  /** GET …/pullRequests/{id}/threads */
  threads: unknown
  /** GET …/pullRequests/{id}/iterations?includeCommits=true: each push, with its commits. */
  iterations: unknown
  viewer: AzureUser | null
}

const lineOf = (v: unknown): number | null => {
  const n = num(obj(v).line)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
const prop = (t: Obj, key: string): string => {
  const p = obj(obj(t.properties)[key])
  return p.$value === undefined ? '' : String(p.$value)
}
/** Thread states that count as resolved (fixed, won't fix, closed, by design). */
const RESOLVED = new Set(['fixed', 'wontFix', 'closed', 'byDesign', '2', '3', '4', '5'])
const byTime = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)

/** Each iteration (push): when, by whom, its head and its commits. */
function azureIterations(json: unknown): Array<{ id: number; at: string; author: string; head: string; commits: Array<{ sha: string; subject: string }> }> {
  return values(json)
    .map((i) => ({
      id: num(i.id),
      at: str(i.createdDate),
      author: str(obj(i.author).displayName) || str(obj(i.author).uniqueName),
      head: hexSha(obj(i.sourceRefCommit).commitId),
      commits: values(i.commits)
        .filter((c) => hexSha(c.commitId))
        .map((c) => ({ sha: hexSha(c.commitId), subject: str(c.comment).split('\n')[0].slice(0, 300) }))
        .reverse()
    }))
    .filter((i) => i.id > 0)
    .sort((a, b) => a.id - b.id)
}

/** A vote as a review verdict (10, 5: approved; -5, -10: changes requested; 0: none). */
const voteVerdict = (vote: number): ReviewVerdict | null => (vote >= 5 ? 'approved' : vote <= -5 ? 'changes-requested' : null)

/** A pull request's review as Adar shows it, or null when the answer is not a pull request. */
export function azureReview(a: AzureReviewAnswers): PullReviewData | null {
  if (!isObj(a.pr)) return null
  const pr = a.pr
  const number = num(pr.pullRequestId)
  if (!number) return null
  const viewer = a.viewer
  const isViewer = (u: unknown) => !!viewer && str(obj(u).id).toLowerCase() === viewer.id.toLowerCase()
  const who = (u: unknown) => str(obj(u).displayName) || str(obj(u).uniqueName)
  const iterations = azureIterations(a.iterations)
  const headOf = new Map(iterations.map((i) => [i.id, i.head]))
  const comment = (c: Obj): ReviewComment => ({ id: num(c.id), author: who(c.author), body: str(c.content).slice(0, MAX_TEXT), createdAt: str(c.publishedDate), viewerDidAuthor: isViewer(c.author) })

  const threads: ReviewThread[] = []
  const comments: ConversationComment[] = []
  const reviews: ReviewSummary[] = []
  const timeline: TimelineEvent[] = []
  for (const t of values(a.threads)) {
    if (t.isDeleted === true || !num(t.id)) continue
    const said = values(t.comments).filter((c) => c.isDeleted !== true && num(c.id) > 0)
    if (!said.length) continue
    if (str(said[0].commentType) === 'system') {
      const at = str(said[0].publishedDate)
      const type = prop(t, 'CodeReviewThreadType')
      if (type === 'VoteUpdate') {
        const verdict = voteVerdict(Number(prop(t, 'CodeReviewVoteResult')))
        if (verdict && at) reviews.push({ id: `t${num(t.id)}`, author: who(said[0].author), verdict, body: '', submittedAt: at, commit: null, comments: 0 })
      }
      continue
    }
    const context = obj(t.threadContext)
    const path = str(context.filePath).replace(/^\//, '')
    if (!path) {
      for (const c of said) comments.push(comment(c))
      continue
    }
    if (!isSafePath(path)) continue
    const right = isObj(context.rightFileStart)
    const side = right ? 'RIGHT' : 'LEFT'
    const start = lineOf(right ? context.rightFileStart : context.leftFileStart)
    const end = lineOf(right ? context.rightFileEnd : context.leftFileEnd) ?? start
    if (!end) {
      // On a whole file: the conversation.
      for (const c of said) comments.push(comment(c))
      continue
    }
    const iteration = num(obj(obj(t.pullRequestThreadContext).iterationContext).secondComparingIteration)
    threads.push({
      id: String(num(t.id)),
      path,
      side,
      line: end,
      startLine: start && start < end ? start : null,
      originalLine: end,
      resolved: RESOLVED.has(str(t.status)),
      outdated: false,
      canResolve: true,
      canReply: true,
      comments: said.map(comment),
      // Azure DevOps keeps a thread's lines as of the push it was written on.
      writtenOn: headOf.get(iteration) ?? null
    })
  }
  for (const i of iterations) if (i.commits.length) timeline.push({ kind: 'commits', at: i.at, author: i.author, commits: i.commits })

  const author = who(pr.createdBy)
  const reviewers: PullReviewData['reviewers'] = values(pr.reviewers)
    .filter((r) => r.isContainer !== true && who(r) && who(r) !== author)
    .map((r) => ({ login: who(r), verdict: voteVerdict(num(r.vote)) ?? 'requested' }))
  return {
    number,
    nodeId: String(number),
    features: AZURE_FEATURES,
    viewer: viewer?.name ?? '',
    title: str(pr.title),
    body: str(pr.description).slice(0, MAX_TEXT),
    author,
    headSha: hexSha(obj(pr.lastMergeSourceCommit).commitId),
    baseSha: hexSha(obj(pr.lastMergeTargetCommit).commitId),
    viewed: {},
    threads,
    reviews: reviews.sort((x, y) => (x.submittedAt < y.submittedAt ? -1 : 1)),
    comments: comments.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1)),
    timeline: timeline.sort(byTime),
    reviewers,
    pendingOnService: null
  }
}

/** The signed-in user's part in a pull request and what others did (its threads, iterations and commits newest first). */
export function azureActivity(threadsJson: unknown, iterationsJson: unknown, commitsJson: unknown, viewer: AzureUser | null, baseRef: string, maxCommits: number): PullActivity {
  const isViewer = (u: unknown) => !!viewer && str(obj(u).id).toLowerCase() === viewer.id.toLowerCase()
  const who = (u: unknown) => str(obj(u).displayName) || str(obj(u).uniqueName)
  const iterations = azureIterations(iterationsJson)
  const headOf = new Map(iterations.map((i) => [i.id, i.head]))
  const headAt = (at: string) => iterations.filter((i) => i.at <= at).at(-1)?.head || null
  let viewerReview: PullActivity['viewerReview'] = null
  let viewerCommentAt: string | null = null
  const others: PullActivity['others'] = []
  const review = (r: NonNullable<PullActivity['viewerReview']>) => {
    if (!viewerReview || r.at > viewerReview.at) viewerReview = r
  }
  for (const t of values(threadsJson)) {
    if (t.isDeleted === true) continue
    const said = values(t.comments).filter((c) => c.isDeleted !== true)
    if (!said.length) continue
    if (str(said[0].commentType) === 'system') {
      const verdict = prop(t, 'CodeReviewThreadType') === 'VoteUpdate' ? voteVerdict(Number(prop(t, 'CodeReviewVoteResult'))) : null
      const at = str(said[0].publishedDate)
      if (!verdict || !at) continue
      if (isViewer(said[0].author)) review({ commit: headAt(at), at, verdict })
      else others.push({ who: who(said[0].author), at, kind: 'review', verdict })
      continue
    }
    const onLine = !!str(obj(t.threadContext).filePath)
    const iteration = num(obj(obj(t.pullRequestThreadContext).iterationContext).secondComparingIteration)
    for (const c of said) {
      const at = str(c.publishedDate)
      if (!at) continue
      if (!isViewer(c.author)) others.push({ who: who(c.author), at, kind: 'comment' })
      else if (onLine) review({ commit: headOf.get(iteration) || headAt(at), at, verdict: 'commented' })
      else if (!viewerCommentAt || at > viewerCommentAt) viewerCommentAt = at
    }
  }
  const listed = values(commitsJson).filter((c) => hexSha(c.commitId))
  const commits = listed
    .slice(0, maxCommits)
    .reverse()
    .map((c) => ({
      sha: hexSha(c.commitId),
      at: str(obj(c.committer).date) || str(obj(c.author).date),
      baseMerge: (Array.isArray(c.parents) ? c.parents.length > 1 : /^Merge/.test(str(c.comment))) && isBaseMerge(str(c.comment).split('\n')[0], baseRef)
    }))
  return { viewerReview, viewerCommentAt, commits, moreCommits: listed.length > maxCommits, others: others.sort(byTime) }
}
