// Reviewing pull requests in Adar and keeping up with them: opening a review (GitHub, GitLab, Bitbucket and Azure
// DevOps) and the inbox of every open repository, loading what the review shows, line comments, replies,
// resolving threads, Viewed marks (the service's, or Adar's own where the service keeps none it can read) and
// submitting the review; following a pull request and marking it seen.

import { api } from '@renderer/api/client'
import { toast } from '@renderer/components/common/toast'
import { usePulls } from '@renderer/components/pulls/pullStore'
import { settleReview } from '@renderer/components/review/model'
import { entryKey, EMPTY_ENTRY, useReview, type ReviewEntry } from '@renderer/components/review/reviewStore'
import { marksOf, pullKey, pullNews } from '@renderer/lib/following'
import { providerName, pullNoun } from '@renderer/lib/pulls'
import { useApp, type ReviewMode, type ReviewTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { HostingProvider, PullRequest, RepoPullRequests } from '@shared/hosting'
import type { DraftComment, FileViewed, PullReviewData, ReviewEvent } from '@shared/review'
import { MAX_PULLS_SEEN } from '@shared/types'
import { openWebPage } from './pulls'

const store = () => useApp.getState()
const review = () => useReview.getState()

/** Where each service shows a pull request's changes, after its own address. */
export const REVIEW_PAGE: Record<HostingProvider, string> = { github: '/files', gitlab: '/diffs', 'bitbucket-cloud': '/diff', 'bitbucket-server': '/diff', azure: '?_a=files' }

/** Services whose pull requests Adar reviews itself (all of them now: a new one opens its own page until it does). */
const IN_ADAR: ReadonlySet<HostingProvider> = new Set(['github', 'gitlab', 'bitbucket-cloud', 'bitbucket-server', 'azure'])

export const reviewsInAdar = (pr: Pick<PullRequest, 'provider'>) => IN_ADAR.has(pr.provider)

export function pullData(repo: string): RepoPullRequests | null {
  return usePulls.getState().repos[repo]?.data ?? null
}

export function pullOf(repo: string, number: number): PullRequest | undefined {
  return pullData(repo)?.pulls.find((p) => p.number === number)
}

/** "github.com/acme/widgets#42" for a pull request of a repository tab, or null before its pull requests load. */
export function keyOf(repo: string, number: number): string | null {
  const data = pullData(repo)
  return data ? pullKey(data, number) : null
}

// ── Seen and following ──────────────────────────────────────────────────────

/** The user looked at the pull request as it is now: its dot goes. */
export function markSeen(repo: string, pr: PullRequest): void {
  const key = keyOf(repo, pr.number)
  if (!key || !pr.headSha) return
  const seen = { ...store().settings.pullsSeen, [key]: { head: pr.headSha, at: new Date().toISOString() } }
  const keys = Object.keys(seen)
  if (keys.length > MAX_PULLS_SEEN) {
    const oldest = keys.sort((a, b) => (seen[a].at < seen[b].at ? -1 : 1)).slice(0, keys.length - MAX_PULLS_SEEN)
    for (const k of oldest) delete seen[k]
  }
  void store().updateSettings({ pullsSeen: seen })
}

/** Follow a pull request with the bell, or stop following it (its dot and its notifications). */
export function setFollowing(repo: string, pr: PullRequest, follow: boolean): void {
  const key = keyOf(repo, pr.number)
  if (!key) return
  const s = store().settings
  const without = (list: string[]) => list.filter((k) => k !== key)
  void store().updateSettings(
    follow ? { pullsFollowed: [...without(s.pullsFollowed), key], pullsUnfollowed: without(s.pullsUnfollowed) } : { pullsFollowed: without(s.pullsFollowed), pullsUnfollowed: [...without(s.pullsUnfollowed), key] }
  )
  toast.info(follow ? `Following ${pullNoun(pr.provider)} #${pr.number}` : `No more dots or notifications for #${pr.number}`)
}

/** What "since" means for the review of a pull request: the user's last review, else their last comment, else their last look. */
function sinceOf(repo: string, pr: PullRequest): ReviewEntry['since'] {
  const key = keyOf(repo, pr.number)
  const review = pr.activity?.viewerReview
  if (review?.commit) return { sha: review.commit, how: 'review', at: review.at }
  if (!key) return null
  const anchor = pullNews(pr, marksOf(store().settings, key)).anchor
  return anchor?.sha ? { sha: anchor.sha, how: anchor.how, at: anchor.at } : null
}

// ── Opening ─────────────────────────────────────────────────────────────────

/** Open a pull request's review in its repository's tab (other services: their page), and mark it seen. */
export function openReview(repo: string, number: number, opts: { tab?: ReviewTab; mode?: ReviewMode } = {}): void {
  const pr = pullOf(repo, number)
  if (pr && !reviewsInAdar(pr)) {
    openWebPage(`${pr.url}${REVIEW_PAGE[pr.provider]}`)
    markSeen(repo, pr)
    return
  }
  if (store().activePath !== repo) store().setActive(repo)
  const since = pr ? sinceOf(repo, pr) : null
  const updated = pr ? pullNews(pr, marksOf(store().settings, keyOf(repo, number) ?? '')).updated : false
  store().setCenter(repo, { kind: 'review', number, mode: opts.mode ?? (since && updated ? 'since' : 'all'), tab: opts.tab ?? 'files' })
  if (store().rightCollapsed) store().toggleRight()
  void loadReview(repo, number, { force: true, since })
  if (pr) markSeen(repo, pr)
}

/** The pull requests of every open repository, in the active tab. */
export function openInbox(): void {
  const repo = store().activePath
  if (!repo) return
  store().setCenter(repo, { kind: 'inbox' })
}

/** A pull request notification was clicked (its repository is open): show its review, its conversation or the inbox. */
export function openFromNotice(repo: string, number: number, view: 'review' | 'conversation' | 'inbox'): void {
  if (!store().tabs.some((t) => t.path === repo)) return
  if (store().activePath !== repo) store().setActive(repo)
  if (view === 'inbox') openInbox()
  else openReview(repo, number, view === 'conversation' ? { tab: 'conversation' } : {})
}

// ── Loading ─────────────────────────────────────────────────────────────────

const loading = new Map<string, Promise<void>>()

/** Load (or reload) what a review view shows. `since` is kept from the first load unless given. */
export function loadReview(repo: string, number: number, opts: { force?: boolean; since?: ReviewEntry['since'] } = {}): Promise<void> {
  const key = entryKey(repo, number)
  const running = loading.get(key)
  if (running) return running
  const prev = review().entries[key] ?? EMPTY_ENTRY
  if (!opts.force && prev.data && Date.now() - prev.at < 60_000) return Promise.resolve()
  review().patch(key, { loading: true, error: null, ...(opts.since !== undefined ? { since: opts.since } : {}) })
  const run = (async () => {
    try {
      let pr = pullOf(repo, number)
      if (!pr) {
        await usePulls.getState().load(repo, { force: true })
        pr = pullOf(repo, number)
      }
      if (!pr) throw new Error(`Pull request #${number} is not among this repository’s recent pull requests`)
      const since = review().entries[key]?.since ?? null
      const fetched = await api.getPullReview(repo, number)
      const range = await api.preparePullReview(repo, number, { head: fetched.headSha || pr.headSha, baseRef: pr.baseRef, baseSha: fetched.baseSha || null, since: since?.sha ?? null })
      const sinceFiles = range.since && range.sinceState !== 'missing' && range.since !== range.head ? api.getCompareFiles(repo, range.since, range.head) : Promise.resolve(null)
      const [files, changed, log, data] = await Promise.all([
        api.getCompareFiles(repo, range.base, range.head),
        sinceFiles,
        api.getLog(repo, { revisions: [range.head, `^${range.base}`], maxCount: 250 }),
        settle(repo, number, fetched, range.head)
      ])
      review().patch(key, { data, range, files, sinceFiles: changed, commits: log.commits, loading: false, error: null, at: Date.now() })
    } catch (err) {
      review().patch(key, { loading: false, error: describeError(err), at: Date.now() })
    }
  })().finally(() => loading.delete(key))
  loading.set(key, run)
  return run
}

/** The review as the repository says it is at `head` (Adar's Viewed marks, threads left on lines that changed): see settleReview. */
function settle(repo: string, number: number, data: PullReviewData, head: string): Promise<PullReviewData> {
  const pull = keyOf(repo, number)
  const marks = pull ? (review().viewed[pull]?.files ?? {}) : {}
  return settleReview(data, head, marks, (sha) =>
    api
      .getCompareFiles(repo, sha, head)
      .then((files) => new Set(files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))))
      .catch(() => null)
  )
}

/** Ask the service again for the threads, reviews and Viewed marks (after a change made from Adar). */
async function reloadData(repo: string, number: number): Promise<void> {
  const key = entryKey(repo, number)
  try {
    const head = review().entries[key]?.range?.head
    const data = await api.getPullReview(repo, number)
    review().patch(key, { data: head ? await settle(repo, number, data, head) : data })
  } catch (err) {
    toast.error(err)
  }
}

// ── Comments and the review ─────────────────────────────────────────────────

export function addDraft(pull: string, draft: DraftComment): void {
  review().setDrafts(pull, [...(review().drafts[pull] ?? []), draft])
}

export function removeDraft(pull: string, index: number): void {
  review().setDrafts(
    pull,
    (review().drafts[pull] ?? []).filter((_, i) => i !== index)
  )
}

export function editDraft(pull: string, index: number, body: string): void {
  review().setDrafts(
    pull,
    (review().drafts[pull] ?? []).map((d, i) => (i === index ? { ...d, body } : d))
  )
}

/** Post a line comment at once, outside a review. */
export async function commentNow(repo: string, number: number, draft: DraftComment): Promise<boolean> {
  const head = review().entries[entryKey(repo, number)]?.range?.head ?? pullOf(repo, number)?.headSha
  if (!head) return false
  try {
    await api.pullReviewAction(repo, number, { kind: 'comment', commit: head, comment: draft })
    await reloadData(repo, number)
    return true
  } catch (err) {
    toast.error(err)
    return false
  }
}

export async function replyTo(repo: string, number: number, threadId: string, commentId: number, body: string): Promise<boolean> {
  try {
    await api.pullReviewAction(repo, number, { kind: 'reply', threadId, commentId, body })
    await reloadData(repo, number)
    return true
  } catch (err) {
    toast.error(err)
    return false
  }
}

export async function resolveThread(repo: string, number: number, threadId: string, resolved: boolean): Promise<void> {
  try {
    await api.pullReviewAction(repo, number, { kind: 'resolve', threadId, resolved })
    await reloadData(repo, number)
  } catch (err) {
    toast.error(err)
  }
}

/** Mark a file viewed (or not) on the service, or in Adar for services without marks; shown at once, put back if the service refuses. */
export async function setViewed(repo: string, number: number, path: string, viewed: boolean): Promise<void> {
  const key = entryKey(repo, number)
  const put = (v: FileViewed) => {
    const data = review().entries[key]?.data
    if (data) review().patch(key, { data: { ...data, viewed: { ...data.viewed, [path]: v } } })
  }
  const entry = review().entries[key]
  const before = entry?.data?.viewed[path] ?? 'unviewed'
  put(viewed ? 'viewed' : 'unviewed')
  if (entry?.data?.features.viewed === 'adar') {
    const pull = keyOf(repo, number)
    const head = entry.range?.head
    if (pull && head) review().setViewedMark(pull, path, viewed ? head : null)
    return
  }
  try {
    await api.pullReviewAction(repo, number, { kind: 'viewed', path, viewed })
  } catch (err) {
    put(before)
    toast.error(err)
  }
}

export async function commentOnConversation(repo: string, number: number, body: string): Promise<boolean> {
  try {
    await api.pullReviewAction(repo, number, { kind: 'conversation', body })
    await reloadData(repo, number)
    return true
  } catch (err) {
    toast.error(err)
    return false
  }
}

const VERDICT_DONE: Record<ReviewEvent, string> = { approve: 'Approved', 'request-changes': 'Changes requested', comment: 'Review submitted' }

/** Submit the review with its verdict, summary and the comments kept for it; they are cleared once it went through. */
export async function submitReview(repo: string, number: number, event: ReviewEvent, body: string): Promise<boolean> {
  const pull = keyOf(repo, number)
  const entry = review().entries[entryKey(repo, number)]
  const pr = pullOf(repo, number)
  const head = entry?.range?.head ?? pr?.headSha
  if (!pull || !head || !pr) return false
  const drafts = review().drafts[pull] ?? []
  try {
    await api.pullReviewAction(repo, number, { kind: 'submit', commit: head, event, body, comments: drafts })
  } catch (err) {
    toast.error(err)
    return false
  }
  review().setDrafts(pull, [])
  toast.success(`${VERDICT_DONE[event]} · ${pr.title}`, { detail: drafts.length ? `With ${drafts.length === 1 ? 'one comment' : `${drafts.length} comments`} on ${providerName(pr)}` : undefined })
  await Promise.all([reloadData(repo, number), usePulls.getState().load(repo, { force: true })])
  const fresh = pullOf(repo, number)
  if (fresh) markSeen(repo, fresh)
  return true
}
