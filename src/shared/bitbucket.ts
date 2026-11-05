// Bitbucket's answers (Cloud's 2.0 API and Data Center's REST 1.0 API) mapped onto the
// provider-neutral pull request types of hosting.ts. Pure: the answers are untrusted data.

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
  commitsTimeline,
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
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])
const arrOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
/** `values` of a paged answer. */
export const pageValues = (v: unknown): Obj[] => arr(obj(v).values)

const hexSha = (v: unknown): string => (/^[0-9a-f]{7,40}$/i.test(str(v)) ? str(v).toLowerCase() : '')
const uniq = (list: string[]) => [...new Set(list.filter(Boolean))]

function reviewOf(changes: string[], approvals: string[], waiting: string[]): ReviewState {
  if (changes.length) return 'changes-requested'
  if (approvals.length) return 'approved'
  return waiting.length ? 'review-required' : 'none'
}

/** The scopes a Bitbucket Cloud API token needs for Adar's pull requests. */
export const CLOUD_TOKEN_SCOPES = ['read:user:bitbucket', 'read:repository:bitbucket', 'read:pullrequest:bitbucket', 'write:pullrequest:bitbucket'] as const

const inWords = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join(''))

/** How to make a token Bitbucket Cloud accepts (Atlassian's plain "Create API token" makes one without scopes). */
const SCOPED_TOKEN_HOWTO = `Create a new one with “Create API token with scopes”: choose Bitbucket and select ${inWords(CLOUD_TOKEN_SCOPES)}.`

/** "Bitbucket: <message>" from an error answer (Cloud: { error: { message, detail } }, Data Center: { errors: [{ message }] }). */
export function bitbucketErrorMessage(body: unknown, fallback: string): string {
  const b = obj(body)
  const cloud = obj(b.error)
  const message = (str(cloud.message) || str(b.message)).trim().slice(0, 200)
  // An API token made without scopes, or with another Atlassian app's.
  if (/no bitbucket scopes/i.test(message)) return `this API token has no Bitbucket scopes. ${SCOPED_TOKEN_HOWTO}`
  // A scope the token lacks: Cloud names the ones it required.
  const required = arrOf(obj(cloud.detail).required)
    .filter((s) => /^[\w:.-]{1,60}$/.test(s))
    .slice(0, 6)
  if (required.length) return `${message.replace(/\.?$/, '.')} It needs ${inWords(required)}. ${SCOPED_TOKEN_HOWTO}`
  const text = [str(cloud.message), str(cloud.detail)].filter(Boolean).join(': ') || arr(b.errors).map((e) => str(e.message)).filter(Boolean).join('; ') || str(b.message)
  return text ? text.slice(0, 300) : fallback
}

// ── Builds ─────────────────────────────────────────────────────────────────

function buildState(state: string): PullCheck['state'] {
  if (state === 'SUCCESSFUL') return 'passed'
  if (state === 'INPROGRESS') return 'running'
  if (state === 'STOPPED') return 'skipped'
  return 'failed'
}

/** Build statuses (Cloud's commit statuses and Data Center's build-status answer share their shape). */
export function buildRuns(json: unknown): PullCheck[] {
  return pageValues(json).map((b) => ({
    name: str(b.name) || str(b.key) || 'Build',
    state: buildState(str(b.state)),
    url: httpsUrl(b.url)
  }))
}

// ── Bitbucket Cloud ────────────────────────────────────────────────────────

/** The signed-in Cloud user, as GET /2.0/user answers. */
export interface CloudViewer {
  uuid: string
  accountId: string
  name: string
}

export function cloudViewer(json: unknown): CloudViewer | null {
  const u = obj(json)
  const name = str(u.display_name) || str(u.nickname)
  return str(u.uuid) || str(u.account_id) ? { uuid: str(u.uuid), accountId: str(u.account_id), name } : null
}

const cloudName = (u: unknown) => str(obj(u).display_name) || str(obj(u).nickname)
const isCloudViewer = (u: unknown, viewer: CloudViewer | null) =>
  !!viewer && ((!!viewer.uuid && str(obj(u).uuid) === viewer.uuid) || (!!viewer.accountId && str(obj(u).account_id) === viewer.accountId))

/** A Cloud pull request (GET .../pullrequests/{id} for participants and reviewers; the list leaves them out). */
export function cloudPull(v: unknown, viewer: CloudViewer | null, builds: PullCheck[] | null): PullRequest | null {
  if (!isObj(v)) return null
  const number = num(v.id)
  const url = httpsUrl(obj(obj(v.links).html).href)
  const source = obj(v.source)
  const dest = obj(v.destination)
  const headRef = str(obj(source.branch).name)
  const baseRef = str(obj(dest.branch).name)
  if (!number || !url || !isSafeBranchName(headRef) || !isSafeBranchName(baseRef)) return null
  const s = str(v.state)
  const state: PullState = s === 'MERGED' ? 'merged' : s === 'DECLINED' || s === 'SUPERSEDED' ? 'closed' : v.draft === true ? 'draft' : 'open'
  const open = state === 'open' || state === 'draft'
  const headRepo = str(obj(source.repository).full_name)
  const baseRepo = str(obj(dest.repository).full_name)
  const participants = arr(v.participants)
  const approvals = uniq(participants.filter((p) => p.approved === true || p.state === 'approved').map((p) => cloudName(p.user)))
  const changes = uniq(participants.filter((p) => p.state === 'changes_requested').map((p) => cloudName(p.user)))
  const answered = new Set([...approvals, ...changes])
  const reviewers = arr(v.reviewers)
  const waiting = uniq(reviewers.map(cloudName).filter((n) => !answered.has(n)))
  const viewerAnswered = participants.some((p) => isCloudViewer(p.user, viewer) && (p.approved === true || !!p.state))
  const { checks, runs } = summarizeChecks(builds ?? [])
  return {
    provider: 'bitbucket-cloud',
    number,
    title: str(v.title).slice(0, MAX_TITLE * 4),
    body: open ? str(v.description).slice(0, MAX_BODY) : '',
    url,
    state,
    author: str(obj(v.author).nickname) || cloudName(v.author),
    authorName: cloudName(v.author) || null,
    headRef,
    headSha: hexSha(obj(source.commit).hash),
    headFork: headRepo && baseRepo && headRepo !== baseRepo ? headRepo : null,
    baseRef,
    createdAt: str(v.created_on),
    updatedAt: str(v.updated_on),
    closedAt: open ? null : str(v.updated_on) || null,
    additions: 0,
    deletions: 0,
    commitCount: 0,
    checks: open ? checks : 'none',
    checkRuns: open ? runs : [],
    review: open ? reviewOf(changes, approvals, waiting) : 'none',
    approvedBy: approvals,
    changesRequestedBy: changes,
    reviewRequests: waiting,
    reviewRequested: open && reviewers.some((r) => isCloudViewer(r, viewer)) && !viewerAnswered,
    mergeable: 'unknown',
    mergeBlocked: false,
    viewerIsAuthor: isCloudViewer(v.author, viewer),
    openTasks: num(v.task_count)
  }
}

const CLOUD_METHODS: Record<string, MergeMethod> = {
  merge_commit: 'merge',
  squash: 'squash',
  fast_forward: 'fast-forward',
  rebase_merge: 'rebase',
  rebase_fast_forward: 'rebase',
  squash_fast_forward: 'squash'
}

/** Merge strategies of a Cloud destination branch, its default first, and Bitbucket's id for each. */
export function cloudMergeMethods(branch: unknown): { methods: MergeMethod[]; ids: Partial<Record<MergeMethod, string>> } {
  const b = obj(branch)
  const listed = Array.isArray(b.merge_strategies) ? b.merge_strategies.filter((s): s is string => typeof s === 'string') : []
  const all = listed.length ? listed : ['merge_commit', 'squash', 'fast_forward']
  const def = str(b.default_merge_strategy)
  const ordered = all.includes(def) ? [def, ...all.filter((s) => s !== def)] : all
  const ids: Partial<Record<MergeMethod, string>> = {}
  for (const s of ordered) {
    const m = CLOUD_METHODS[s]
    if (m && !ids[m]) ids[m] = s
  }
  return { methods: Object.keys(ids) as MergeMethod[], ids }
}

export function cloudCommits(json: unknown): PullCommit[] {
  return pageValues(json)
    .filter((c) => /^[0-9a-f]{40}$/i.test(str(c.hash)))
    .map((c) => ({
      sha: str(c.hash).toLowerCase(),
      subject: str(c.message).split('\n')[0].slice(0, 300),
      author: cloudName(obj(c.author).user) || str(obj(c.author).raw).replace(/\s*<[^>]*>$/, '')
    }))
}

// ── Bitbucket Data Center ──────────────────────────────────────────────────

const serverUser = (u: unknown) => obj(obj(u).user)
const serverName = (u: Obj) => str(u.displayName) || str(u.name)
const isServerViewer = (u: Obj, viewer: string) => !!viewer && [str(u.name), str(u.slug)].some((n) => n.toLowerCase() === viewer.toLowerCase())
const repoKey = (ref: Obj) => {
  const repo = obj(ref.repository)
  return `${str(obj(repo.project).key)}/${str(repo.slug)}`.toLowerCase()
}
const isoFromMs = (v: unknown) => (num(v) ? new Date(num(v)).toISOString() : '')

/**
 * A Data Center pull request (the list answers in full). `viewer` is the signed-in user's name; `repoUrl` is the
 * repository's web page on the server (…/projects/KEY/repos/slug), which the pull request's link is built from.
 */
export function serverPull(v: unknown, viewer: string, builds: PullCheck[] | null, repoUrl: string): PullRequest | null {
  if (!isObj(v)) return null
  const number = num(v.id)
  const url = `${repoUrl}/pull-requests/${number}`
  const from = obj(v.fromRef)
  const to = obj(v.toRef)
  const headRef = str(from.displayId)
  const baseRef = str(to.displayId)
  if (!number || !isSafeBranchName(headRef) || !isSafeBranchName(baseRef)) return null
  const s = str(v.state)
  const state: PullState = s === 'MERGED' ? 'merged' : s === 'DECLINED' ? 'closed' : v.draft === true ? 'draft' : 'open'
  const open = state === 'open' || state === 'draft'
  const reviewers = arr(v.reviewers)
  const named = (status: string) => uniq(reviewers.filter((r) => r.status === status).map((r) => serverName(serverUser(r))))
  const approvals = named('APPROVED')
  const changes = named('NEEDS_WORK')
  const waiting = named('UNAPPROVED')
  const author = serverUser(v.author)
  const props = obj(v.properties)
  const outcome = str(obj(props.mergeResult).outcome)
  const { checks, runs } = summarizeChecks(builds ?? [])
  const headRepo = repoKey(from)
  return {
    provider: 'bitbucket-server',
    number,
    title: str(v.title).slice(0, MAX_TITLE * 4),
    body: open ? str(v.description).slice(0, MAX_BODY) : '',
    url,
    state,
    author: str(author.name),
    authorName: str(author.displayName) || null,
    headRef,
    headSha: hexSha(from.latestCommit),
    headFork: headRepo !== repoKey(to) ? headRepo : null,
    baseRef,
    createdAt: isoFromMs(v.createdDate),
    updatedAt: isoFromMs(v.updatedDate),
    closedAt: open ? null : isoFromMs(v.closedDate) || isoFromMs(v.updatedDate) || null,
    additions: 0,
    deletions: 0,
    commitCount: 0,
    checks: open ? checks : 'none',
    checkRuns: open ? runs : [],
    review: open ? reviewOf(changes, approvals, waiting) : 'none',
    approvedBy: approvals,
    changesRequestedBy: changes,
    reviewRequests: waiting,
    reviewRequested: open && reviewers.some((r) => r.status === 'UNAPPROVED' && isServerViewer(serverUser(r), viewer)),
    mergeable: outcome === 'CLEAN' ? 'clean' : outcome === 'CONFLICTED' ? 'conflicts' : 'unknown',
    mergeBlocked: false,
    viewerIsAuthor: isServerViewer(author, viewer),
    openTasks: num(props.openTaskCount)
  }
}

const SERVER_METHODS: Record<string, MergeMethod> = {
  'no-ff': 'merge',
  ff: 'merge',
  'ff-only': 'fast-forward',
  squash: 'squash',
  'squash-ff-only': 'squash',
  'rebase-no-ff': 'rebase',
  'rebase-ff-only': 'rebase'
}

/** Merge strategies a Data Center repository allows (GET .../settings/pull-requests), its default first. */
export function serverMergeMethods(json: unknown): { methods: MergeMethod[]; ids: Partial<Record<MergeMethod, string>> } {
  const config = obj(obj(json).mergeConfig)
  const enabled = arr(config.strategies)
    .filter((s) => s.enabled !== false)
    .map((s) => str(s.id))
  const all = enabled.length ? enabled : ['no-ff']
  const def = str(obj(config.defaultStrategy).id)
  const ordered = all.includes(def) ? [def, ...all.filter((s) => s !== def)] : all
  const ids: Partial<Record<MergeMethod, string>> = {}
  for (const s of ordered) {
    const m = SERVER_METHODS[s]
    if (m && !ids[m]) ids[m] = s
  }
  if (!Object.keys(ids).length) ids.merge = 'no-ff'
  return { methods: Object.keys(ids) as MergeMethod[], ids }
}

export function serverCommits(json: unknown): PullCommit[] {
  return pageValues(json)
    .filter((c) => /^[0-9a-f]{40}$/i.test(str(c.id)))
    .map((c) => ({
      sha: str(c.id).toLowerCase(),
      subject: str(c.message).split('\n')[0].slice(0, 300),
      author: str(obj(c.author).displayName) || str(obj(c.author).name)
    }))
}

/** GET .../pull-requests/{id}/merge: can it be merged now, and Bitbucket's reasons when not. */
export function serverMergeChecks(json: unknown): MergeChecks {
  const m = obj(json)
  const reasons = uniq(arr(m.vetoes).map((v) => str(v.summaryMessage) || str(v.detailedMessage)))
  const conflicts = m.conflicted === true || str(m.outcome) === 'CONFLICTED' ? true : m.conflicted === false ? false : null
  return { blocked: m.canMerge === false, reasons, conflicts }
}

/**
 * Patterns of Cloud's branch restrictions (GET …/branch-restrictions). Those that follow the branching model
 * ("every release branch") are left out: they name a kind of branch, not a pattern.
 */
export function cloudProtected(json: unknown): string[] {
  return keepPatterns(pageValues(json).filter((r) => str(r.branch_match_kind) !== 'branching_model').map((r) => r.pattern))
}

/** Branches and patterns of Data Center's branch permissions (GET /rest/branch-permissions/2.0/…/restrictions). */
export function serverProtected(json: unknown): string[] {
  return keepPatterns(
    pageValues(json)
      .map((r) => obj(r.matcher))
      .filter((m) => m.active !== false && ['BRANCH', 'PATTERN'].includes(str(obj(m.type).id)))
      .map((m) => str(m.id).replace(/^refs\/heads\//, ''))
  )
}

// ── Reviewing a pull request in Adar ─────────────────────────────────────────

/** Bitbucket keeps no Viewed marks Adar can read; Cloud places comments on several lines and has no suggested changes. */
export const CLOUD_FEATURES: ReviewFeatures = { viewed: 'adar', multiLine: true, suggestions: null, events: ['comment', 'approve', 'request-changes'] }
/** Data Center: one line per comment, suggested changes as ```suggestion. */
export const SERVER_FEATURES: ReviewFeatures = { viewed: 'adar', multiLine: false, suggestions: 'github', events: ['comment', 'approve', 'request-changes'] }

const lineNo = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null)
const byTime = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)
const text = (v: unknown) => str(v).slice(0, MAX_TEXT)

/** The full id of a commit Bitbucket names by a prefix (Cloud's 12 characters), among those known. */
function fullSha(prefix: string, known: readonly string[]): string | null {
  const p = prefix.toLowerCase()
  return p.length >= 7 ? (known.find((k) => k.startsWith(p)) ?? null) : null
}

/** What Adar reads to show a Cloud pull request's review. */
export interface CloudReviewAnswers {
  /** GET …/pullrequests/{id} */
  pr: unknown
  /** GET …/comments, every page's values. */
  comments: Obj[]
  /** GET …/activity values (approvals, changes requested). */
  activity: Obj[]
  /** GET …/commits values, newest first. */
  commits: Obj[]
  viewer: CloudViewer | null
}

/** The commit an inline comment was written on: Cloud's `links.code` names the diff it was on (…/diff/<repo>:<hash>%0D…). */
function cloudWrittenOn(c: Obj): string {
  const m = /:([0-9a-f]{7,40})(?:%0D|\r)/i.exec(str(obj(obj(c.links).code).href))
  return m ? m[1].toLowerCase() : ''
}

/** A Cloud pull request's review as Adar shows it, or null when the answer is not a pull request. */
export function cloudReview(a: CloudReviewAnswers): PullReviewData | null {
  if (!isObj(a.pr)) return null
  const pr = a.pr
  const number = num(pr.id)
  if (!number) return null
  const known = a.commits.map((c) => hexSha(c.hash)).filter((h) => h.length === 40)
  const headSha = fullSha(str(obj(obj(pr.source).commit).hash), known) ?? ''
  const mine = (u: unknown) => isCloudViewer(u, a.viewer)
  const comment = (c: Obj): ReviewComment => ({ id: num(c.id), author: cloudName(c.user), body: text(obj(c.content).raw), createdAt: str(c.created_on), viewerDidAuthor: mine(c.user) })

  // Threads: a comment without a parent, with its replies (at any depth) in order. Drafts of a review started on the website stay private.
  const live = a.comments.filter((c) => num(c.id) > 0 && c.deleted !== true && c.pending !== true)
  const byId = new Map(live.map((c) => [num(c.id), c]))
  const rootOf = (c: Obj): Obj => {
    let at = c
    for (let i = 0; i < 50 && num(obj(at.parent).id) && byId.has(num(obj(at.parent).id)); i++) at = byId.get(num(obj(at.parent).id))!
    return at
  }
  const replies = new Map<number, Obj[]>()
  for (const c of live) {
    const root = rootOf(c)
    if (root !== c) replies.set(num(root.id), [...(replies.get(num(root.id)) ?? []), c])
  }
  const threads: ReviewThread[] = []
  const comments: ConversationComment[] = []
  for (const root of live.filter((c) => rootOf(c) === c)) {
    const all = [root, ...(replies.get(num(root.id)) ?? []).sort((x, y) => (str(x.created_on) < str(y.created_on) ? -1 : 1))]
    const inline = isObj(root.inline) ? root.inline : null
    if (!inline) {
      for (const c of all) comments.push(comment(c))
      continue
    }
    if (!isSafePath(inline.path)) continue
    const to = lineNo(inline.to)
    const from = lineNo(inline.from)
    const side = to ? 'RIGHT' : 'LEFT'
    const line = to ?? from
    const start = side === 'RIGHT' ? lineNo(inline.start_to) : lineNo(inline.start_from)
    const outdated = inline.outdated === true || !line
    const writtenOn = cloudWrittenOn(root)
    threads.push({
      id: String(num(root.id)),
      path: inline.path,
      side,
      line: outdated ? null : line,
      startLine: !outdated && start && line && start < line ? start : null,
      originalLine: line,
      resolved: isObj(root.resolution),
      outdated,
      canResolve: true,
      canReply: true,
      comments: all.map(comment),
      writtenOn: writtenOn ? (fullSha(writtenOn, known) ?? writtenOn) : null
    })
  }

  const reviews: ReviewSummary[] = []
  for (const e of a.activity) {
    const approval = obj(e.approval)
    const changes = obj(e.changes_requested)
    const said = isObj(e.approval) ? { v: approval, verdict: 'approved' as const } : isObj(e.changes_requested) ? { v: changes, verdict: 'changes-requested' as const } : null
    if (!said || !str(said.v.date)) continue
    reviews.push({ id: `${said.verdict}-${str(said.v.date)}`, author: cloudName(said.v.user), verdict: said.verdict, body: '', submittedAt: str(said.v.date), commit: null, comments: 0 })
  }

  const author = cloudName(pr.author)
  const reviewers: PullReviewData['reviewers'] = []
  const put = (login: string, verdict: ReviewVerdict | 'requested') => {
    if (!login || login === author) return
    const had = reviewers.find((r) => r.login === login)
    if (had) had.verdict = verdict
    else reviewers.push({ login, verdict })
  }
  for (const r of arr(pr.reviewers)) put(cloudName(r), 'requested')
  for (const p of arr(pr.participants)) {
    if (p.state === 'approved' || p.approved === true) put(cloudName(p.user), 'approved')
    else if (p.state === 'changes_requested') put(cloudName(p.user), 'changes-requested')
  }

  const commits = a.commits
    .filter((c) => hexSha(c.hash).length === 40)
    .map((c) => ({ sha: hexSha(c.hash), subject: str(c.message).split('\n')[0], author: cloudName(obj(c.author).user) || str(obj(c.author).raw).replace(/\s*<[^>]*>$/, ''), at: str(c.date) }))
    .reverse()
  return {
    number,
    nodeId: String(number),
    features: CLOUD_FEATURES,
    viewer: a.viewer?.name ?? '',
    title: str(pr.title),
    body: text(pr.description),
    author,
    headSha,
    // Cloud names the base by a short id: the base branch as fetched stands in for it.
    baseSha: '',
    viewed: {},
    threads,
    reviews: reviews.sort((x, y) => (x.submittedAt < y.submittedAt ? -1 : 1)),
    comments: comments.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1)),
    timeline: commitsTimeline(commits),
    reviewers,
    pendingOnService: null
  }
}

/** The signed-in user's part in a Cloud pull request and what others did (GET …/activity, …/commits newest first). */
export function cloudActivity(activity: readonly Obj[], commitsNewestFirst: readonly Obj[], viewer: CloudViewer | null, baseRef: string, maxCommits: number): PullActivity {
  const known = commitsNewestFirst.map((c) => hexSha(c.hash)).filter((h) => h.length === 40)
  // The head at a given time: the last update (push) before it.
  const updates = activity
    .map((e) => obj(e.update))
    .map((u) => ({ at: str(u.date), head: fullSha(str(obj(obj(u.source).commit).hash), known) }))
    .filter((u) => u.at && u.head)
    .sort(byTime)
  const headAt = (at: string) => updates.filter((u) => u.at <= at).at(-1)?.head ?? null
  let viewerReview: PullActivity['viewerReview'] = null
  let viewerCommentAt: string | null = null
  const others: PullActivity['others'] = []
  const review = (r: NonNullable<PullActivity['viewerReview']>) => {
    if (!viewerReview || r.at > viewerReview.at) viewerReview = r
  }
  for (const e of activity) {
    const verdict: ReviewVerdict | null = isObj(e.approval) ? 'approved' : isObj(e.changes_requested) ? 'changes-requested' : null
    if (verdict) {
      const v = obj(e.approval ?? e.changes_requested)
      const at = str(v.date)
      if (!at) continue
      if (isCloudViewer(v.user, viewer)) review({ commit: headAt(at), at, verdict })
      else others.push({ who: cloudName(v.user), at, kind: 'review', verdict })
      continue
    }
    const c = obj(e.comment)
    const at = str(c.created_on)
    if (!num(c.id) || !at || c.deleted === true || c.pending === true) continue
    if (!isCloudViewer(c.user, viewer)) others.push({ who: cloudName(c.user), at, kind: 'comment' })
    else if (isObj(c.inline)) review({ commit: fullSha(cloudWrittenOn(c), known) ?? headAt(at), at, verdict: 'commented' })
    else if (!viewerCommentAt || at > viewerCommentAt) viewerCommentAt = at
  }
  const listed = commitsNewestFirst.filter((c) => hexSha(c.hash).length === 40)
  const commits = listed
    .slice(0, maxCommits)
    .reverse()
    .map((c) => ({ sha: hexSha(c.hash), at: str(c.date), baseMerge: arr(c.parents).length > 1 && isBaseMerge(str(c.message).split('\n')[0], baseRef) }))
  return { viewerReview, viewerCommentAt, commits, moreCommits: listed.length > maxCommits, others: others.sort(byTime) }
}

/** What Adar reads to show a Data Center pull request's review. */
export interface ServerReviewAnswers {
  /** GET …/pull-requests/{id} */
  pr: unknown
  /** GET …/activities values, newest first, every page read. */
  activities: Obj[]
  /** GET …/commits values, newest first. */
  commits: Obj[]
  /** GET …/review values: the signed-in user's comments of a review not finished yet, or null when the server has no reviews. */
  pending: Obj[] | null
  viewer: string
}

const serverWho = (u: unknown) => {
  const user = obj(u)
  return str(user.displayName) || str(user.name)
}

/** Every comment of the answers by id, the newest version first seen, with each reply's thread root. */
function serverComments(activities: readonly Obj[]): { roots: Array<{ comment: Obj; anchor: Obj | null }>; replies: Map<number, Obj[]> } {
  const seen = new Map<number, Obj>()
  const parentOf = new Map<number, number>()
  const anchors = new Map<number, Obj>()
  const walk = (c: Obj, parent: number | null) => {
    const id = num(c.id)
    if (!id) return
    if (!seen.has(id)) seen.set(id, c)
    if (parent) parentOf.set(id, parent)
    for (const r of arr(c.comments)) walk(r, id)
  }
  for (const e of activities) {
    if (e.action !== 'COMMENTED' || !isObj(e.comment)) continue
    walk(e.comment, num(obj(e.comment.parent).id) || null)
    const id = num(e.comment.id)
    const anchor = isObj(e.commentAnchor) ? e.commentAnchor : isObj(e.comment.anchor) ? e.comment.anchor : null
    if (anchor && !anchors.has(id)) anchors.set(id, anchor)
  }
  const rootOf = (id: number) => {
    let at = id
    for (let i = 0; i < 50 && parentOf.has(at); i++) at = parentOf.get(at)!
    return at
  }
  const replies = new Map<number, Obj[]>()
  const roots: Array<{ comment: Obj; anchor: Obj | null }> = []
  for (const [id, c] of seen) {
    const root = rootOf(id)
    if (root === id) roots.push({ comment: c, anchor: anchors.get(id) ?? (isObj(c.anchor) ? c.anchor : null) })
    else replies.set(root, [...(replies.get(root) ?? []), c])
  }
  return { roots, replies }
}

const anchorPath = (v: unknown): string => (typeof v === 'string' ? v : str(obj(v).toString))

/** A Data Center pull request's review as Adar shows it, or null when the answer is not a pull request. */
export function serverReview(a: ServerReviewAnswers): PullReviewData | null {
  if (!isObj(a.pr)) return null
  const pr = a.pr
  const number = num(pr.id)
  if (!number) return null
  const viewer = a.viewer
  const comment = (c: Obj): ReviewComment => ({
    id: num(c.id),
    author: serverWho(c.author),
    body: text(c.text),
    createdAt: isoFromMs(c.createdDate),
    viewerDidAuthor: isServerViewer(obj(c.author), viewer)
  })
  const { roots, replies } = serverComments(a.activities)
  const threads: ReviewThread[] = []
  const comments: ConversationComment[] = []
  for (const { comment: root, anchor } of roots) {
    if (root.state === 'PENDING') continue
    const all = [root, ...(replies.get(num(root.id)) ?? []).filter((c) => c.state !== 'PENDING').sort((x, y) => num(x.createdDate) - num(y.createdDate))]
    const path = anchor ? anchorPath(anchor.path) : ''
    const line = anchor ? lineNo(anchor.line) : null
    if (anchor && !isSafePath(path)) continue
    // On the pull request, or on a whole file: the conversation.
    if (!anchor || !line) {
      for (const c of all) comments.push(comment(c))
      continue
    }
    const side = anchor.fileType === 'FROM' || anchor.lineType === 'REMOVED' ? 'LEFT' : 'RIGHT'
    // Bitbucket keeps comments on the pull request's diff where their line went; a comment on one commit's diff, or one whose line is gone, is outdated.
    const outdated = anchor.orphaned === true || root.anchored === false || (!!anchor.diffType && anchor.diffType !== 'EFFECTIVE')
    threads.push({
      id: String(num(root.id)),
      path,
      side,
      line: outdated ? null : line,
      startLine: null,
      originalLine: line,
      resolved: root.threadResolved === true,
      outdated,
      canResolve: true,
      canReply: true,
      comments: all.map(comment)
    })
  }

  const reviews: ReviewSummary[] = []
  const timeline: TimelineEvent[] = []
  const pushed = new Set<string>()
  for (const e of a.activities) {
    const at = isoFromMs(e.createdDate)
    const who = serverWho(e.user)
    if (!at) continue
    switch (e.action) {
      case 'APPROVED':
        reviews.push({ id: `a${num(e.id)}`, author: who, verdict: 'approved', body: '', submittedAt: at, commit: null, comments: 0 })
        break
      case 'REVIEWED':
        reviews.push({ id: `a${num(e.id)}`, author: who, verdict: 'changes-requested', body: '', submittedAt: at, commit: null, comments: 0 })
        break
      case 'RESCOPED': {
        const added = arr(obj(e.added).commits)
          .filter((c) => hexSha(c.id).length === 40)
          .map((c) => ({ sha: hexSha(c.id), subject: str(c.message).split('\n')[0].slice(0, 300) }))
          .reverse()
        for (const c of added) pushed.add(c.sha)
        if (added.length) timeline.push({ kind: 'commits', at, author: who, commits: added })
        else if (arr(obj(e.removed).commits).length) timeline.push({ kind: 'force-push', at, actor: who, before: hexSha(e.previousFromHash) || null, after: hexSha(e.fromHash) || null })
        break
      }
      case 'UPDATED':
        for (const r of arr(e.addedReviewers)) timeline.push({ kind: 'review-requested', at, actor: who, reviewer: serverWho(r) })
        break
      case 'MERGED':
        timeline.push({ kind: 'merged', at, actor: who })
        break
      case 'DECLINED':
        timeline.push({ kind: 'closed', at, actor: who })
        break
      case 'REOPENED':
        timeline.push({ kind: 'reopened', at, actor: who })
        break
    }
  }
  const author = serverWho(serverUser(pr.author))
  // The commits it was opened with: no rescope lists them.
  const opening = a.commits
    .filter((c) => hexSha(c.id).length === 40 && !pushed.has(hexSha(c.id)))
    .map((c) => ({ sha: hexSha(c.id), subject: str(c.message).split('\n')[0].slice(0, 300) }))
    .reverse()
  if (opening.length) timeline.push({ kind: 'commits', at: isoFromMs(pr.createdDate), author, commits: opening })

  const reviewers: PullReviewData['reviewers'] = arr(pr.reviewers)
    .map((r) => ({
      login: serverWho(serverUser(r)),
      verdict: (r.status === 'APPROVED' ? 'approved' : r.status === 'NEEDS_WORK' ? 'changes-requested' : 'requested') as ReviewVerdict | 'requested'
    }))
    .filter((r) => r.login && r.login !== author)
  const pending = (a.pending ?? []).flatMap((t) => [obj(t.comment ?? t), ...arr(obj(t.comment ?? t).comments)]).filter((c) => c.state === 'PENDING').length
  return {
    number,
    nodeId: String(number),
    features: SERVER_FEATURES,
    viewer: serverWho(arr(pr.reviewers).map(serverUser).find((u) => isServerViewer(u, viewer))) || viewer,
    title: str(pr.title),
    body: text(pr.description),
    author,
    headSha: hexSha(obj(pr.fromRef).latestCommit).length === 40 ? hexSha(obj(pr.fromRef).latestCommit) : '',
    baseSha: hexSha(obj(pr.toRef).latestCommit).length === 40 ? hexSha(obj(pr.toRef).latestCommit) : '',
    viewed: {},
    threads,
    reviews: reviews.sort((x, y) => (x.submittedAt < y.submittedAt ? -1 : 1)),
    comments: comments.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1)),
    timeline: timeline.sort(byTime),
    reviewers,
    pendingOnService: pending ? { id: 'review', comments: pending } : null
  }
}

/** The signed-in user's part in a Data Center pull request and what others did (GET …/activities newest first, …/commits newest first). */
export function serverActivity(activities: readonly Obj[], commitsNewestFirst: readonly Obj[], viewer: string, baseRef: string, maxCommits: number): PullActivity {
  // The head at a given time: the last rescope before it (or the oldest commit's first head).
  const heads = activities
    .filter((e) => e.action === 'RESCOPED' || e.action === 'OPENED')
    .map((e) => ({ at: isoFromMs(e.createdDate), head: hexSha(e.fromHash).length === 40 ? hexSha(e.fromHash) : null }))
    .filter((h) => h.at && h.head)
    .sort(byTime)
  const headAt = (at: string) => heads.filter((h) => h.at <= at).at(-1)?.head ?? null
  let viewerReview: PullActivity['viewerReview'] = null
  let viewerCommentAt: string | null = null
  const others: PullActivity['others'] = []
  const review = (r: NonNullable<PullActivity['viewerReview']>) => {
    if (!viewerReview || r.at > viewerReview.at) viewerReview = r
  }
  for (const e of activities) {
    const at = isoFromMs(e.createdDate)
    const user = obj(e.user)
    if (!at) continue
    const verdict: ReviewVerdict | null = e.action === 'APPROVED' ? 'approved' : e.action === 'REVIEWED' ? 'changes-requested' : e.action === 'REVIEW_FINISHED' ? 'commented' : null
    if (verdict) {
      if (isServerViewer(user, viewer)) review({ commit: headAt(at), at, verdict })
      else if (verdict !== 'commented') others.push({ who: serverWho(user), at, kind: 'review', verdict })
      continue
    }
    if (e.action !== 'COMMENTED' || str(e.commentAction || 'ADDED') !== 'ADDED' || obj(e.comment).state === 'PENDING') continue
    if (!isServerViewer(user, viewer)) others.push({ who: serverWho(user), at, kind: 'comment' })
    else if (isObj(e.commentAnchor) && lineNo(e.commentAnchor.line)) review({ commit: hexSha(e.commentAnchor.toHash).length === 40 ? hexSha(e.commentAnchor.toHash) : headAt(at), at, verdict: 'commented' })
    else if (!viewerCommentAt || at > viewerCommentAt) viewerCommentAt = at
  }
  const listed = commitsNewestFirst.filter((c) => hexSha(c.id).length === 40)
  const commits = listed
    .slice(0, maxCommits)
    .reverse()
    .map((c) => ({ sha: hexSha(c.id), at: isoFromMs(c.committerTimestamp ?? c.authorTimestamp), baseMerge: arr(c.parents).length > 1 && isBaseMerge(str(c.message).split('\n')[0], baseRef) }))
  return { viewerReview, viewerCommentAt, commits, moreCommits: listed.length > maxCommits, others: others.sort(byTime) }
}
