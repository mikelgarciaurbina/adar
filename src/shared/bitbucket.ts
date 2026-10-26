// Bitbucket's answers (Cloud's 2.0 API and Data Center's REST 1.0 API) mapped onto the
// provider-neutral pull request types of hosting.ts. Pure: the answers are untrusted data.

import {
  MAX_BODY,
  MAX_TITLE,
  httpsUrl,
  isSafeBranchName,
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
