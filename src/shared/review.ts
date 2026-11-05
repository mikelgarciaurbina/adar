// Reviewing a pull request in Adar: what the review view shows (files viewed, line comment threads, reviews, the
// conversation and its timeline) whatever the service, what each service lets it do (ReviewFeatures), what it can
// do on the service, GitHub's GraphQL query and the pure mapping of its answer (GitLab's is in gitlab.ts). The diff
// itself comes from the local repository (preparePullReview). Also what the pull request list says about the
// signed-in user's part in each one (PullActivity), for the dots and notifications of what changed since they looked.

// hosting.ts imports this module (the list query's activity fields): nothing is imported back from it.

/** A review's verdict as the service records it. */
export type ReviewVerdict = 'approved' | 'changes-requested' | 'commented' | 'dismissed'
/** What submitting a review says. */
export type ReviewEvent = 'approve' | 'request-changes' | 'comment'
/** A diff side: the old file (LEFT) or the new one (RIGHT), as GitHub calls them. */
export type DiffSide = 'LEFT' | 'RIGHT'
/** GitHub's per-file "Viewed" mark; 'changed' when the file changed after it was marked. */
export type FileViewed = 'viewed' | 'unviewed' | 'changed'

export interface ReviewComment {
  /** The service's number for the comment (replies point at it). */
  id: number
  author: string
  body: string
  createdAt: string
  viewerDidAuthor: boolean
}

/** Comments on some lines of a file, with their replies. */
export interface ReviewThread {
  id: string
  path: string
  side: DiffSide
  /** Line in the pull request's current diff (null when the lines it was on changed: outdated). */
  line: number | null
  /** First line of a comment on several lines, else null. */
  startLine: number | null
  /** Line it was written on, in the diff of its time. */
  originalLine: number | null
  resolved: boolean
  outdated: boolean
  canResolve: boolean
  canReply: boolean
  comments: ReviewComment[]
  /**
   * The commit it was written on, when the service keeps its line as of that version (Bitbucket Cloud): once its file
   * changed since, the line may be another one, and the review view shows the thread as outdated.
   */
  writtenOn?: string | null
}

export interface ReviewSummary {
  id: string
  author: string
  verdict: ReviewVerdict
  body: string
  submittedAt: string
  /** The commit it reviewed. */
  commit: string | null
  /** How many line comments it made. */
  comments: number
}

/** A comment on the conversation, not on a line. */
export interface ConversationComment {
  id: number
  author: string
  body: string
  createdAt: string
  viewerDidAuthor: boolean
}

/** What happened on the pull request besides reviews and comments, oldest first. */
export type TimelineEvent =
  | { kind: 'commits'; at: string; author: string; commits: Array<{ sha: string; subject: string }> }
  | { kind: 'force-push'; at: string; actor: string; before: string | null; after: string | null }
  | { kind: 'review-requested'; at: string; actor: string; reviewer: string }
  | { kind: 'ready'; at: string; actor: string }
  | { kind: 'merged' | 'closed' | 'reopened'; at: string; actor: string }

/** What a service lets a review in Adar do. */
export interface ReviewFeatures {
  /** Viewed marks kept by the service (GitHub's), or by Adar on this computer for services that keep none. */
  viewed: 'service' | 'adar'
  /** A comment may cover several lines. */
  multiLine: boolean
  /** How the service writes a suggested change: GitHub's ```suggestion, GitLab's ```suggestion:-N+0; null: none. */
  suggestions: 'github' | 'gitlab' | null
  /** The verdicts a review can be submitted with. */
  events: ReviewEvent[]
}

export const GITHUB_FEATURES: ReviewFeatures = { viewed: 'service', multiLine: true, suggestions: 'github', events: ['comment', 'approve', 'request-changes'] }

/** A suggested change replacing `lines` (the commented lines, last one anchored), as `kind` writes it. */
export function suggestionBlock(kind: NonNullable<ReviewFeatures['suggestions']>, lines: readonly string[]): string {
  const open = kind === 'gitlab' ? `\`\`\`suggestion:-${Math.max(0, lines.length - 1)}+0` : '```suggestion'
  return `${open}\n${lines.join('\n')}\n\`\`\``
}

export interface PullReviewData {
  number: number
  /** The service's id of the pull request (GitHub: for its GraphQL changes). */
  nodeId: string
  features: ReviewFeatures
  viewer: string
  title: string
  body: string
  author: string
  headSha: string
  baseSha: string
  /** GitHub's Viewed mark of each file, by path. */
  viewed: Record<string, FileViewed>
  threads: ReviewThread[]
  /** Submitted reviews, oldest first. */
  reviews: ReviewSummary[]
  comments: ConversationComment[]
  timeline: TimelineEvent[]
  /** Who reviewed last, and what (each reviewer once), and who is asked to. */
  reviewers: Array<{ login: string; verdict: ReviewVerdict | 'requested' }>
  /** The signed-in user has a review started on the service's website that is not submitted yet. */
  pendingOnService: { id: string; comments: number } | null
}

/** A line comment written in Adar, kept until the review is submitted. */
export interface DraftComment {
  path: string
  side: DiffSide
  line: number
  startLine?: number
  body: string
}

/** Something done to a pull request from the review view. */
export type ReviewAction =
  /** A line comment posted at once ("Comment now"). */
  | { kind: 'comment'; commit: string; comment: DraftComment }
  /** A reply in a thread, after its comment `commentId` (GitHub answers the comment, GitLab the thread). */
  | { kind: 'reply'; threadId: string; commentId: number; body: string }
  | { kind: 'resolve'; threadId: string; resolved: boolean }
  | { kind: 'viewed'; path: string; viewed: boolean }
  /** The review: its verdict, summary and the comments kept for it (added to a review started on the website). */
  | { kind: 'submit'; commit: string; event: ReviewEvent; body: string; comments: DraftComment[] }
  /** A comment on the conversation. */
  | { kind: 'conversation'; body: string }

/** Where the local repository has what the review view shows (preparePullReview). */
export interface ReviewRange {
  /** Where the pull request's changes start: the merge base of its head and its base branch. */
  base: string
  head: string
  /** The commit "since" was asked about, when the repository has it (it may be fetched for this), else null. */
  since: string | null
  /** How `since` relates to head: one of its ancestors, rewritten with the same changes, rewritten, or missing. */
  sinceState: 'none' | 'ancestor' | 'same-changes' | 'rewritten' | 'missing'
  /** Commits on the pull request's branch after `since` (first parents only). */
  sinceCommits: number
  /** Every one of them is a merge (the base branch brought in), so the pull request's own changes did not change. */
  onlyMerges: boolean
}

export const MAX_COMMENT = 65_000
/** Longest text kept from the service (descriptions, comments). */
export const MAX_TEXT = 20_000
export const MAX_DRAFTS = 200

// ── GraphQL ──────────────────────────────────────────────────────────────────

export const REVIEW_QUERY = `query AdarReview($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title body headRefOid baseRefOid
      author { login }
      files(first: 100) { nodes { path viewerViewedState } }
      reviewThreads(first: 100) { nodes {
        id path line startLine originalLine diffSide isResolved isOutdated viewerCanResolve viewerCanUnresolve viewerCanReply
        comments(first: 50) { nodes { databaseId author { login } body createdAt viewerDidAuthor state } }
      } }
      reviews(last: 50) { nodes { id author { login } state body submittedAt commit { oid } comments { totalCount } } }
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } } } }
      comments(last: 100) { nodes { databaseId author { login } body createdAt viewerDidAuthor } }
      timelineItems(last: 100, itemTypes: [PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT, REVIEW_REQUESTED_EVENT, READY_FOR_REVIEW_EVENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT]) {
        nodes {
          __typename
          ... on PullRequestCommit { commit { oid messageHeadline committedDate author { name user { login } } } }
          ... on HeadRefForcePushedEvent { createdAt actor { login } beforeCommit { oid } afterCommit { oid } }
          ... on ReviewRequestedEvent { createdAt actor { login } requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Bot { login } } }
          ... on ReadyForReviewEvent { createdAt actor { login } }
          ... on MergedEvent { createdAt actor { login } }
          ... on ClosedEvent { createdAt actor { login } }
          ... on ReopenedEvent { createdAt actor { login } }
        }
      }
    }
  }
}`

export const ADD_REVIEW_MUTATION = `mutation AdarAddReview($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) { pullRequestReview { id } }
}`
export const ADD_THREAD_MUTATION = `mutation AdarAddThread($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) { thread { id } }
}`
export const SUBMIT_REVIEW_MUTATION = `mutation AdarSubmitReview($input: SubmitPullRequestReviewInput!) {
  submitPullRequestReview(input: $input) { pullRequestReview { id } }
}`
export const RESOLVE_MUTATION = `mutation AdarResolve($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { id } } }`
export const UNRESOLVE_MUTATION = `mutation AdarUnresolve($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { thread { id } } }`
export const VIEWED_MUTATION = `mutation AdarViewed($input: MarkFileAsViewedInput!) { markFileAsViewed(input: $input) { clientMutationId } }`
export const UNVIEWED_MUTATION = `mutation AdarUnviewed($input: UnmarkFileAsViewedInput!) { unmarkFileAsViewed(input: $input) { clientMutationId } }`

export const REVIEW_EVENTS: Record<ReviewEvent, string> = { approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES', comment: 'COMMENT' }

/** A draft comment as GitHub's DraftPullRequestReviewThread (and addPullRequestReviewThread) take it. */
export function draftThread(c: DraftComment): Record<string, unknown> {
  return {
    path: c.path,
    line: c.line,
    side: c.side,
    ...(c.startLine && c.startLine < c.line ? { startLine: c.startLine, startSide: c.side } : {}),
    body: c.body
  }
}

// ── Mapping (pure; the answer is untrusted data) ─────────────────────────────

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const nodes = (v: unknown): Obj[] => (isObj(v) && Array.isArray(v.nodes) ? v.nodes.filter(isObj) : [])
const login = (v: unknown): string => (isObj(v) ? str(v.login) : '')
const sha = (v: unknown): string | null => {
  const oid = isObj(v) ? str(v.oid) : str(v)
  return /^[0-9a-f]{40}$/i.test(oid) ? oid.toLowerCase() : null
}
const lineNo = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null)
const text = (v: unknown) => str(v).slice(0, MAX_TEXT)

export function verdictOf(state: unknown): ReviewVerdict | null {
  switch (state) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'COMMENTED':
      return 'commented'
    case 'DISMISSED':
      return 'dismissed'
    default:
      return null // PENDING: not submitted
  }
}

/** A path GitHub reports, usable as a repository-relative path (no absolute paths or "..", no control characters). */
export function isSafePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 4096 || p.startsWith('/') || p.includes('\\')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(p)) return false
  return !p.split('/').some((part) => part === '..' || part === '.' || part === '')
}

function reviewerName(r: unknown): string {
  return isObj(r) ? str(r.login) || str(r.name) : ''
}

/** Commits further apart than this are shown as separate pushes. */
const PUSH_GAP_MS = 2 * 3600_000

function timelineOf(items: Obj[], prAuthor: string): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const n of items) {
    const at = str(n.createdAt)
    const actor = login(n.actor)
    switch (n.__typename) {
      case 'PullRequestCommit': {
        const c = isObj(n.commit) ? n.commit : {}
        const oid = sha(c.oid)
        if (!oid) break
        const who = isObj(c.author) ? login(c.author.user) || str(c.author.name) : ''
        const last = out[out.length - 1]
        const entry = { sha: oid, subject: str(c.messageHeadline).slice(0, 300) }
        const at = str(c.committedDate)
        // Commits in a row by the same person, made close together, read as one push (GitHub does not say when each was pushed).
        const close = last?.kind === 'commits' && Math.abs(Date.parse(at) - Date.parse(last.at)) <= PUSH_GAP_MS
        if (last?.kind === 'commits' && close && (last.author === (who || prAuthor) || !who)) {
          last.commits.push(entry)
          last.at = at || last.at
        } else out.push({ kind: 'commits', at, author: who || prAuthor, commits: [entry] })
        break
      }
      case 'HeadRefForcePushedEvent':
        out.push({ kind: 'force-push', at, actor, before: sha(n.beforeCommit), after: sha(n.afterCommit) })
        break
      case 'ReviewRequestedEvent': {
        const reviewer = reviewerName(n.requestedReviewer)
        if (reviewer) out.push({ kind: 'review-requested', at, actor, reviewer })
        break
      }
      case 'ReadyForReviewEvent':
        out.push({ kind: 'ready', at, actor })
        break
      case 'MergedEvent':
        out.push({ kind: 'merged', at, actor })
        break
      case 'ClosedEvent':
        out.push({ kind: 'closed', at, actor })
        break
      case 'ReopenedEvent':
        out.push({ kind: 'reopened', at, actor })
        break
    }
  }
  return out
}

/** Commits (oldest first) as pushes: in a row by the same person, made close together, they read as one. */
export function commitsTimeline(commits: ReadonlyArray<{ sha: string; subject: string; author: string; at: string }>): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const c of commits) {
    const last = out[out.length - 1]
    const entry = { sha: c.sha, subject: c.subject.slice(0, 300) }
    if (last?.kind === 'commits' && last.author === c.author && Math.abs(Date.parse(c.at) - Date.parse(last.at)) <= PUSH_GAP_MS) {
      last.commits.push(entry)
      last.at = c.at || last.at
    } else out.push({ kind: 'commits', at: c.at, author: c.author, commits: [entry] })
  }
  return out
}

/** The answer of REVIEW_QUERY (its `data`) as PullReviewData, or null when the pull request is missing. */
export function reviewFromQuery(data: unknown): PullReviewData | null {
  if (!isObj(data) || !isObj(data.repository) || !isObj(data.repository.pullRequest)) return null
  const pr = data.repository.pullRequest
  const viewer = isObj(data.viewer) ? str(data.viewer.login) : ''
  const nodeId = str(pr.id)
  const number = num(pr.number)
  if (!nodeId || !number) return null
  const author = login(pr.author)

  const viewed: Record<string, FileViewed> = {}
  for (const f of nodes(pr.files)) {
    if (!isSafePath(f.path)) continue
    viewed[f.path] = f.viewerViewedState === 'VIEWED' ? 'viewed' : f.viewerViewedState === 'DISMISSED' ? 'changed' : 'unviewed'
  }

  let pendingComments = 0
  const threads: ReviewThread[] = []
  for (const t of nodes(pr.reviewThreads)) {
    if (!isSafePath(t.path) || !str(t.id)) continue
    const comments: ReviewComment[] = []
    for (const c of nodes(t.comments)) {
      // The user's own comments of a review started on the website are not shown until it is submitted there.
      if (c.state === 'PENDING') {
        pendingComments++
        continue
      }
      const id = num(c.databaseId)
      if (id) comments.push({ id, author: login(c.author), body: text(c.body), createdAt: str(c.createdAt), viewerDidAuthor: c.viewerDidAuthor === true })
    }
    if (!comments.length) continue
    const resolved = t.isResolved === true
    threads.push({
      id: str(t.id),
      path: t.path,
      side: t.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
      line: lineNo(t.line),
      startLine: lineNo(t.startLine),
      originalLine: lineNo(t.originalLine),
      resolved,
      outdated: t.isOutdated === true || lineNo(t.line) === null,
      canResolve: resolved ? t.viewerCanUnresolve === true : t.viewerCanResolve === true,
      canReply: t.viewerCanReply !== false,
      comments
    })
  }

  let pendingOnService: PullReviewData['pendingOnService'] = null
  const reviews: ReviewSummary[] = []
  for (const r of nodes(pr.reviews)) {
    if (r.state === 'PENDING') {
      if (str(r.id) && login(r.author).toLowerCase() === viewer.toLowerCase()) pendingOnService = { id: str(r.id), comments: pendingComments }
      continue
    }
    const verdict = verdictOf(r.state)
    if (!verdict || !str(r.id)) continue
    reviews.push({
      id: str(r.id),
      author: login(r.author),
      verdict,
      body: text(r.body),
      submittedAt: str(r.submittedAt),
      commit: sha(r.commit),
      comments: num(isObj(r.comments) ? r.comments.totalCount : 0)
    })
  }

  // Each reviewer's last say that counts (a comment does not undo an approval), then who is asked to.
  const last = new Map<string, ReviewVerdict>()
  for (const r of reviews) {
    if (!r.author || r.author === author) continue
    const prev = last.get(r.author)
    if (r.verdict !== 'commented' || !prev || prev === 'commented') last.set(r.author, r.verdict)
  }
  const reviewers: PullReviewData['reviewers'] = [...last].map(([who, verdict]) => ({ login: who, verdict }))
  for (const q of nodes(pr.reviewRequests)) {
    const who = reviewerName(q.requestedReviewer)
    if (!who) continue
    const known = reviewers.find((x) => x.login === who)
    if (known) known.verdict = 'requested'
    else reviewers.push({ login: who, verdict: 'requested' })
  }

  const comments: ConversationComment[] = nodes(pr.comments)
    .map((c) => ({ id: num(c.databaseId), author: login(c.author), body: text(c.body), createdAt: str(c.createdAt), viewerDidAuthor: c.viewerDidAuthor === true }))
    .filter((c) => c.id > 0)

  return {
    number,
    nodeId,
    features: GITHUB_FEATURES,
    viewer,
    title: str(pr.title),
    body: text(pr.body),
    author,
    headSha: sha(pr.headRefOid) ?? '',
    baseSha: sha(pr.baseRefOid) ?? '',
    viewed,
    threads,
    reviews,
    comments,
    timeline: timelineOf(nodes(pr.timelineItems), author),
    reviewers,
    pendingOnService
  }
}

// ── What the list says about the signed-in user's part (dots and notifications) ──

/** Commits of each pull request the dots look at (as many as GitHub's list gives). */
export const MAX_ACTIVITY_COMMITS = 30

/** Fields added to each open pull request of the list query. */
export const ACTIVITY_FIELDS = `
        viewerLatestReview { state submittedAt commit { oid } }
        recent: commits(last: 30) { totalCount nodes { commit { oid committedDate messageHeadline parents { totalCount } } } }
        talk: comments(last: 10) { nodes { author { login } createdAt } }
        said: reviews(last: 10) { nodes { author { login } state submittedAt } }`

/** The signed-in user's part in a pull request and what others did, as the pull request list reports it. */
export interface PullActivity {
  /** Their last submitted review: the commit it was on, when, and its verdict. */
  viewerReview: { commit: string | null; at: string; verdict: ReviewVerdict } | null
  /** When they last commented on the conversation (not on a line). */
  viewerCommentAt: string | null
  /** The last commits (at most 30), oldest first; `baseMerge`: a merge that only brings the base branch in. */
  commits: Array<{ sha: string; at: string; baseMerge: boolean }>
  /** The pull request has more commits than `commits` lists. */
  moreCommits: boolean
  /** Comments and reviews by others, oldest first. */
  others: Array<{ who: string; at: string; kind: 'comment' | 'review'; verdict?: ReviewVerdict }>
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A merge commit's subject says it brings the base branch in ("Merge branch 'main' into feat/x", "Merge remote-tracking branch 'origin/main'…"). */
export function isBaseMerge(subject: string, base: string): boolean {
  const b = escapeRe(base)
  return new RegExp(`^Merge (?:remote-tracking )?branch '(?:[^'/]+/)?${b}'`).test(subject) || new RegExp(`^Merge branch '${b}' of `).test(subject)
}

/** The activity fields of one open pull request node, for the signed-in user `viewer`. */
export function activityOf(node: Obj, viewer: string, baseRef: string): PullActivity {
  const me = viewer.toLowerCase()
  const mine = (who: string) => !!me && who.toLowerCase() === me
  const vr = isObj(node.viewerLatestReview) ? node.viewerLatestReview : null
  const verdict = vr ? verdictOf(vr.state) : null
  const recent = isObj(node.recent) ? node.recent : {}
  const commits: PullActivity['commits'] = []
  for (const n of nodes(recent)) {
    const c = isObj(n.commit) ? n.commit : {}
    const oid = sha(c.oid)
    if (!oid) continue
    const parents = isObj(c.parents) ? num(c.parents.totalCount) : 1
    commits.push({ sha: oid, at: str(c.committedDate), baseMerge: parents > 1 && isBaseMerge(str(c.messageHeadline), baseRef) })
  }
  const myComments: string[] = []
  const others: PullActivity['others'] = []
  for (const c of nodes(node.talk)) {
    const who = login(c.author)
    const at = str(c.createdAt)
    if (!who || !at) continue
    if (mine(who)) myComments.push(at)
    else others.push({ who, at, kind: 'comment' })
  }
  const viewerCommentAt = myComments.length ? myComments.sort().at(-1)! : null
  for (const r of nodes(node.said)) {
    const who = login(r.author)
    const at = str(r.submittedAt)
    const v = verdictOf(r.state)
    if (!who || !at || !v || mine(who)) continue
    others.push({ who, at, kind: 'review', verdict: v })
  }
  others.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return {
    viewerReview: vr && verdict ? { commit: sha(vr.commit), at: str(vr.submittedAt), verdict } : null,
    viewerCommentAt,
    commits,
    moreCommits: num(recent.totalCount) > commits.length,
    others
  }
}

// ── Checking what the renderer asks for (the main process trusts nothing it sends) ──

/** A system notification about a pull request (see notifyPullRequest). */
export interface PullNotice {
  number: number
  /** "#42 · 2 new commits" */
  title: string
  /** The repository and the pull request's title. */
  subtitle: string
  body: string
  /** What a click opens: the review, its conversation, or the pull requests of every open repository. */
  open: 'review' | 'conversation' | 'inbox'
}

const SHA = /^[0-9a-f]{40}$/i
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const commentBody = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.length <= MAX_COMMENT ? v : null)
/** A thread's id: GitHub's node id, GitLab's discussion id, a number. */
const isThreadId = (v: unknown): v is string => typeof v === 'string' && /^[\w=-]{1,200}$/.test(v)

function parseDraft(raw: unknown): DraftComment | null {
  if (!isObj(raw)) return null
  const body = commentBody(raw.body)
  if (!body || !isSafePath(raw.path) || !posInt(raw.line) || (raw.side !== 'LEFT' && raw.side !== 'RIGHT')) return null
  if (raw.startLine !== undefined && raw.startLine !== null && (!posInt(raw.startLine) || raw.startLine > raw.line)) return null
  return { path: raw.path, side: raw.side, line: raw.line, ...(posInt(raw.startLine) && raw.startLine < raw.line ? { startLine: raw.startLine } : {}), body }
}

/** A ReviewAction from untrusted input, or null when it is not one. */
export function parseReviewAction(raw: unknown): ReviewAction | null {
  if (!isObj(raw)) return null
  switch (raw.kind) {
    case 'comment': {
      const comment = parseDraft(raw.comment)
      return comment && typeof raw.commit === 'string' && SHA.test(raw.commit) ? { kind: 'comment', commit: raw.commit.toLowerCase(), comment } : null
    }
    case 'reply': {
      const body = commentBody(raw.body)
      return body && posInt(raw.commentId) && isThreadId(raw.threadId) ? { kind: 'reply', threadId: raw.threadId, commentId: raw.commentId, body } : null
    }
    case 'resolve':
      return isThreadId(raw.threadId) && typeof raw.resolved === 'boolean'
        ? { kind: 'resolve', threadId: raw.threadId, resolved: raw.resolved }
        : null
    case 'viewed':
      return isSafePath(raw.path) && typeof raw.viewed === 'boolean' ? { kind: 'viewed', path: raw.path, viewed: raw.viewed } : null
    case 'submit': {
      if (typeof raw.commit !== 'string' || !SHA.test(raw.commit) || typeof raw.body !== 'string' || raw.body.length > MAX_COMMENT) return null
      if (raw.event !== 'approve' && raw.event !== 'request-changes' && raw.event !== 'comment') return null
      if (!Array.isArray(raw.comments) || raw.comments.length > MAX_DRAFTS) return null
      const comments = raw.comments.map(parseDraft)
      if (comments.some((c) => !c)) return null
      // Asking for changes or only commenting needs something to say.
      if (raw.event !== 'approve' && !raw.body.trim() && !comments.length) return null
      return { kind: 'submit', commit: raw.commit.toLowerCase(), event: raw.event, body: raw.body, comments: comments as DraftComment[] }
    }
    case 'conversation': {
      const body = commentBody(raw.body)
      return body ? { kind: 'conversation', body } : null
    }
    default:
      return null
  }
}

/** A PullNotice from untrusted input (texts cut to size), or null. */
export function parsePullNotice(raw: unknown): PullNotice | null {
  if (!isObj(raw) || !posInt(raw.number) || typeof raw.title !== 'string' || !raw.title.trim()) return null
  if (raw.open !== 'review' && raw.open !== 'conversation' && raw.open !== 'inbox') return null
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  return { number: raw.number, title: clean(raw.title, 120), subtitle: clean(raw.subtitle, 160), body: clean(raw.body, 300), open: raw.open }
}

/** One line of `git range-diff -s` output says the commit is the same in both versions ("1:  abc = 1:  def …"). */
export function rangeDiffSame(output: string): boolean {
  const lines = output.split('\n').filter((l) => l.trim())
  return lines.length > 0 && lines.every((l) => /^\s*\d+:\s+[0-9a-f]+\s+=\s+\d+:\s+[0-9a-f]+/.test(l))
}

/** How many commits `git range-diff -s` output says are new or changed in the second version. */
export function rangeDiffChanged(output: string): number {
  return output.split('\n').filter((l) => /^\s*(?:\d+|-+):\s+(?:[0-9a-f]+|-+)\s+[!>]\s+/.test(l)).length
}
