// GitHub pull requests (opt-in): types shared by the backend (src/main/hosting) and the
// renderer (components/pulls), the GraphQL query and the pure mapping of its answer.
// Only github.com for now; GitLab, Bitbucket and Azure DevOps would reuse the same types.

export const GITHUB_API = 'https://api.github.com'

export type GithubAuthMethod = 'gh' | 'token'
export type PullState = 'open' | 'draft' | 'merged' | 'closed'
/** Combined state of a pull request's checks (GitHub Actions, status checks). */
export type ChecksState = 'passed' | 'failed' | 'running' | 'none'
export type ReviewState = 'approved' | 'changes-requested' | 'review-required' | 'none'
export type MergeMethod = 'squash' | 'merge' | 'rebase'

export interface PullCheck {
  name: string
  state: 'passed' | 'failed' | 'running' | 'skipped'
  /** Web page of the check (https only), or null. */
  url: string | null
}

export interface PullRequest {
  number: number
  title: string
  /** Markdown description, cut to MAX_BODY characters ('' for merged and closed ones). */
  body: string
  url: string
  state: PullState
  author: string
  authorName: string | null
  /** Branch in the head repository. */
  headRef: string
  headSha: string
  /** owner/name of the head repository when it is a fork, else null. */
  headFork: string | null
  baseRef: string
  createdAt: string
  updatedAt: string
  /** When it was merged or closed. */
  closedAt: string | null
  additions: number
  deletions: number
  commitCount: number
  checks: ChecksState
  /** Failed checks first, then running ones, then the rest (at most MAX_CHECKS). */
  checkRuns: PullCheck[]
  review: ReviewState
  approvedBy: string[]
  changesRequestedBy: string[]
  /** Users and teams asked to review who have not reviewed yet. */
  reviewRequests: string[]
  /** The signed-in user is asked to review it. */
  reviewRequested: boolean
  /** Conflicts with the base branch ('unknown' while GitHub works it out). */
  mergeable: 'clean' | 'conflicts' | 'unknown'
  /** Branch protection does not allow merging yet (required checks or reviews missing). */
  mergeBlocked: boolean
  viewerIsAuthor: boolean
}

export interface RepoPullRequests {
  owner: string
  name: string
  /** Git remote the repository was found through ("origin"). */
  remote: string
  webUrl: string
  /** Signed-in user. */
  viewer: string
  defaultBranch: string
  /** Ways of merging the repository allows, in the order GitHub offers them. */
  mergeMethods: MergeMethod[]
  /** GitHub deletes head branches after a merge. */
  deleteBranchOnMerge: boolean
  /** The signed-in user can merge (write access or more). */
  canMerge: boolean
  /** Open and draft pull requests (most recently updated first), then recently merged and closed ones. */
  pulls: PullRequest[]
}

export interface GithubConnection {
  /** How Adar signs in to GitHub, or null when pull requests are off. */
  method: GithubAuthMethod | null
  /** Signed-in user, once checked. */
  login: string | null
  /** Why the sign-in does not work (revoked token, gh signed out…). */
  error: string | null
  /** gh is installed and signed in to github.com: its user ('' when gh does not say), else null (or not asked). */
  ghLogin: string | null
  /** A personal access token can be kept encrypted on this computer. */
  canStoreToken: boolean
}

export interface CreatePullOptions {
  /** Branch on the pull request's remote. */
  head: string
  base: string
  title: string
  body: string
  draft: boolean
}

export const MAX_BODY = 20_000
export const MAX_CHECKS = 30
export const MAX_TITLE = 256

// ── GraphQL ──────────────────────────────────────────────────────────────────

const PULL_FIELDS = `
  number title url state isDraft createdAt updatedAt mergedAt closedAt
  author { login ... on User { name } }
  headRefName headRefOid isCrossRepository
  headRepository { nameWithOwner }
  baseRefName
  viewerDidAuthor`

export const PULLS_QUERY = `query AdarPulls($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    url viewerPermission
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed deleteBranchOnMerge
    defaultBranchRef { name }
    open: pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        ${PULL_FIELDS}
        body additions deletions reviewDecision mergeable mergeStateStatus
        commits(last: 1) {
          totalCount
          nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          } } } } }
        }
        reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } } } }
        latestReviews(first: 30) { nodes { author { login } state } }
      }
    }
    done: pullRequests(states: [MERGED, CLOSED], first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { ${PULL_FIELDS} }
    }
  }
}`

// ── Mapping (pure; the answer is untrusted data) ─────────────────────────────

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const nodes = (v: unknown): Obj[] => (isObj(v) && Array.isArray(v.nodes) ? v.nodes.filter(isObj) : [])

/** https links only (check and pull request pages); anything else is dropped. */
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
  } catch {
    return null
  }
}

/** A branch name as GitHub reports it, safe to pass to git (no option injection, no ref tricks). */
export function isSafeBranchName(name: unknown): name is string {
  if (typeof name !== 'string' || !name || name.length > 255) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false
  return !name.includes('..') && !name.includes('//') && !name.includes('@{') && !name.split('/').some((p) => p.startsWith('.'))
}

const CHECK_ORDER: Record<PullCheck['state'], number> = { failed: 0, running: 1, passed: 2, skipped: 3 }

function checkRunState(status: string, conclusion: string): PullCheck['state'] {
  if (status && status !== 'COMPLETED') return 'running'
  switch (conclusion) {
    case 'SUCCESS':
      return 'passed'
    case 'NEUTRAL':
    case 'SKIPPED':
    case 'STALE':
      return 'skipped'
    case '':
      return 'running'
    default:
      return 'failed' // FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE
  }
}

function statusContextState(state: string): PullCheck['state'] {
  if (state === 'SUCCESS') return 'passed'
  if (state === 'PENDING' || state === 'EXPECTED') return 'running'
  return 'failed' // ERROR, FAILURE
}

/** Checks of a pull request's last commit (its statusCheckRollup). */
export function checksOf(rollup: unknown): { checks: ChecksState; runs: PullCheck[] } {
  if (!isObj(rollup)) return { checks: 'none', runs: [] }
  const runs: PullCheck[] = []
  for (const c of nodes(rollup.contexts)) {
    if (c.__typename === 'CheckRun') runs.push({ name: str(c.name), state: checkRunState(str(c.status), str(c.conclusion)), url: httpsUrl(c.detailsUrl) })
    else if (c.__typename === 'StatusContext') runs.push({ name: str(c.context), state: statusContextState(str(c.state)), url: httpsUrl(c.targetUrl) })
  }
  runs.sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name))
  const state = str(rollup.state)
  let checks: ChecksState = 'none'
  if (runs.some((r) => r.state === 'failed') || state === 'FAILURE' || state === 'ERROR') checks = 'failed'
  else if (runs.some((r) => r.state === 'running') || state === 'PENDING' || state === 'EXPECTED') checks = 'running'
  else if (runs.length || state === 'SUCCESS') checks = 'passed'
  return { checks, runs: runs.slice(0, MAX_CHECKS) }
}

function reviewOf(decision: string): ReviewState {
  switch (decision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'REVIEW_REQUIRED':
      return 'review-required'
    default:
      return 'none'
  }
}

function stateOf(node: Obj): PullState {
  const state = str(node.state)
  if (state === 'MERGED') return 'merged'
  if (state === 'CLOSED') return 'closed'
  return node.isDraft === true ? 'draft' : 'open'
}

/** One pull request node of PULLS_QUERY (open ones carry checks and reviews), or null when unusable. */
export function pullFromNode(node: unknown, viewer: string): PullRequest | null {
  if (!isObj(node)) return null
  const number = num(node.number)
  const url = httpsUrl(node.url)
  if (!number || !url || !isSafeBranchName(node.headRefName) || !isSafeBranchName(node.baseRefName)) return null
  const state = stateOf(node)
  const author = isObj(node.author) ? node.author : {}
  const commits = isObj(node.commits) ? node.commits : {}
  const lastCommit = nodes(commits)[0]
  const { checks, runs } = checksOf(isObj(lastCommit?.commit) ? lastCommit.commit.statusCheckRollup : null)
  const reviews = nodes(node.latestReviews)
  const reviewers = (s: string) => [...new Set(reviews.filter((r) => r.state === s && isObj(r.author)).map((r) => str((r.author as Obj).login)).filter(Boolean))]
  const requests = nodes(node.reviewRequests)
    .map((r) => (isObj(r.requestedReviewer) ? r.requestedReviewer : null))
    .filter((r): r is Obj => !!r)
  const requestNames = requests.map((r) => str(r.login) || str(r.name)).filter(Boolean)
  const open = state === 'open' || state === 'draft'
  const mergeable = str(node.mergeable)
  return {
    number,
    title: str(node.title).slice(0, MAX_TITLE * 4),
    body: open ? str(node.body).slice(0, MAX_BODY) : '',
    url,
    state,
    author: str(author.login),
    authorName: str(author.name) || null,
    headRef: node.headRefName as string,
    headSha: /^[0-9a-f]{40}$/i.test(str(node.headRefOid)) ? str(node.headRefOid).toLowerCase() : '',
    headFork: node.isCrossRepository === true ? str(isObj(node.headRepository) ? node.headRepository.nameWithOwner : '') || 'a fork' : null,
    baseRef: node.baseRefName as string,
    createdAt: str(node.createdAt),
    updatedAt: str(node.updatedAt),
    closedAt: str(node.mergedAt) || str(node.closedAt) || null,
    additions: num(node.additions),
    deletions: num(node.deletions),
    commitCount: num(commits.totalCount),
    checks: open ? checks : 'none',
    checkRuns: open ? runs : [],
    review: open ? reviewOf(str(node.reviewDecision)) : 'none',
    approvedBy: reviewers('APPROVED'),
    changesRequestedBy: reviewers('CHANGES_REQUESTED'),
    reviewRequests: requestNames,
    reviewRequested: !!viewer && requests.some((r) => r.__typename === 'User' && str(r.login).toLowerCase() === viewer.toLowerCase()),
    mergeable: mergeable === 'MERGEABLE' ? 'clean' : mergeable === 'CONFLICTING' ? 'conflicts' : 'unknown',
    mergeBlocked: str(node.mergeStateStatus) === 'BLOCKED',
    viewerIsAuthor: node.viewerDidAuthor === true || (!!viewer && str(author.login).toLowerCase() === viewer.toLowerCase())
  }
}

/** The answer of PULLS_QUERY (its `data`) as RepoPullRequests, or null when the repository is missing. */
export function pullsFromQuery(data: unknown, at: { owner: string; name: string; remote: string }): RepoPullRequests | null {
  if (!isObj(data) || !isObj(data.repository)) return null
  const repo = data.repository
  const viewer = isObj(data.viewer) ? str(data.viewer.login) : ''
  const pulls: PullRequest[] = []
  const seen = new Set<number>()
  for (const n of [...nodes(repo.open), ...nodes(repo.done)]) {
    const pr = pullFromNode(n, viewer)
    if (pr && !seen.has(pr.number)) {
      seen.add(pr.number)
      pulls.push(pr)
    }
  }
  const methods: MergeMethod[] = []
  if (repo.squashMergeAllowed === true) methods.push('squash')
  if (repo.mergeCommitAllowed === true) methods.push('merge')
  if (repo.rebaseMergeAllowed === true) methods.push('rebase')
  const permission = str(repo.viewerPermission)
  return {
    owner: at.owner,
    name: at.name,
    remote: at.remote,
    webUrl: httpsUrl(repo.url) ?? `https://github.com/${at.owner}/${at.name}`,
    viewer,
    defaultBranch: isObj(repo.defaultBranchRef) && isSafeBranchName(repo.defaultBranchRef.name) ? (repo.defaultBranchRef.name as string) : 'main',
    mergeMethods: methods.length ? methods : ['merge'],
    deleteBranchOnMerge: repo.deleteBranchOnMerge === true,
    canMerge: permission === 'ADMIN' || permission === 'MAINTAIN' || permission === 'WRITE',
    pulls
  }
}

/** A pull request from the REST API (POST /pulls answers), with what REST does not say left empty. */
export function pullFromRest(v: unknown, viewer: string): PullRequest | null {
  if (!isObj(v)) return null
  const head = isObj(v.head) ? v.head : {}
  const base = isObj(v.base) ? v.base : {}
  const user = isObj(v.user) ? v.user : {}
  const headRepo = isObj(head.repo) ? str(head.repo.full_name) : ''
  const baseRepo = isObj(base.repo) ? str(base.repo.full_name) : ''
  return pullFromNode(
    {
      number: v.number,
      title: v.title,
      body: v.body,
      url: v.html_url,
      state: v.merged_at ? 'MERGED' : v.state === 'closed' ? 'CLOSED' : 'OPEN',
      isDraft: v.draft === true,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
      mergedAt: v.merged_at,
      closedAt: v.closed_at,
      author: { login: user.login },
      headRefName: head.ref,
      headRefOid: head.sha,
      isCrossRepository: !!headRepo && !!baseRepo && headRepo !== baseRepo,
      headRepository: { nameWithOwner: headRepo },
      baseRefName: base.ref,
      additions: v.additions,
      deletions: v.deletions,
      commits: { totalCount: v.commits, nodes: [] }
    },
    viewer
  )
}

/** "GitHub: <message>" from an error answer ({ message, errors: [{ message }] }). */
export function githubErrorMessage(body: unknown, fallback: string): string {
  if (!isObj(body)) return fallback
  const details = Array.isArray(body.errors)
    ? body.errors.map((e) => (isObj(e) ? str(e.message) || [str(e.field), str(e.code)].filter(Boolean).join(' ') : str(e))).filter(Boolean)
    : []
  const main = str(body.message)
  const text = details.length ? details.join('; ') : main
  return text ? text.slice(0, 300) : fallback
}
