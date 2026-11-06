// Reviewing an agent's work before its pull request, in its worktree's tab: everything the worktree has that its
// base branch lacks (the branch's commits and the changes not committed) in the review view, with Adar's Viewed
// marks and notes on lines; finishing a review copies the notes as one message for the agent (Adar does not talk to
// agents: the user pastes it into the agent's chat) and keeps the version reviewed, so the next review shows only
// what changed after it.

import { api } from '@renderer/api/client'
import { toast } from '@renderer/components/common/toast'
import { agentPrompt, workSinceFiles } from '@renderer/components/review/model'
import { entryKey, EMPTY_ENTRY, useReview, workKey } from '@renderer/components/review/reviewStore'
import { pluralize } from '@renderer/lib/format'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { WORK_FEATURES, type PullReviewData, type WorkReviewMark, type WorkReviewRange } from '@shared/review'
import { focusWorktree } from './agents'
import { copyText } from './git'
import { settle, workKeyOf } from './review'

const store = () => useApp.getState()
const review = () => useReview.getState()

/** Review the work of a worktree (its tab opened if needed): only what changed since the last review when there was one. */
export async function openWorkReview(path: string, repo?: string): Promise<void> {
  if (!(await focusWorktree(path, repo))) return
  const reviewed = !!review().reviewed[workKeyOf(path)]
  store().setCenter(path, { kind: 'work-review', mode: reviewed ? 'since' : 'all', tab: 'files' })
  if (store().rightCollapsed) store().toggleRight()
  void loadWorkReview(path, { force: true })
}

const loading = new Map<string, Promise<void>>()

const sinceOf = (mark: WorkReviewMark | undefined) => (mark ? { head: mark.head, tip: mark.tip } : null)

/** What the review of a tab's work shows: the worktree looked at now (a snapshot of what is not committed), against the last review. */
export function loadWorkReview(repo: string, opts: { force?: boolean } = {}): Promise<void> {
  const key = entryKey(repo, 'work')
  const running = loading.get(key)
  if (running) return running
  const prev = review().entries[key] ?? EMPTY_ENTRY
  if (!opts.force && prev.data && Date.now() - prev.at < 60_000) return Promise.resolve()
  review().patch(key, { loading: true, error: null })
  const run = (async () => {
    try {
      let mark = review().reviewed[workKeyOf(repo)]
      let range: WorkReviewRange = await api.prepareWorkReview(repo, { since: sinceOf(mark) })
      // The branch checked out is not the one the tab last showed: its own last review counts.
      const pull = workKey(repo, range.branch)
      if (review().reviewed[pull] !== mark) {
        mark = review().reviewed[pull]
        range = await api.prepareWorkReview(repo, { since: sinceOf(mark) })
      }
      const data: PullReviewData = {
        number: 0,
        nodeId: '',
        features: WORK_FEATURES,
        viewer: '',
        title: range.branch ?? 'Work in progress',
        body: '',
        author: '',
        headSha: range.head,
        baseSha: range.base,
        viewed: {},
        threads: [],
        reviews: [],
        comments: [],
        timeline: [],
        reviewers: [],
        pendingOnService: null
      }
      const changed = range.since && range.sinceState !== 'missing' && range.since !== range.head ? api.getCompareFiles(repo, range.since, range.head) : Promise.resolve(null)
      const [files, sinceFiles, log, settled] = await Promise.all([
        api.getCompareFiles(repo, range.base, range.head),
        changed,
        range.base === range.tip ? Promise.resolve(null) : api.getLog(repo, { revisions: [range.tip, `^${range.base}`], maxCount: 250 }),
        settle(repo, pull, data, range.head)
      ])
      review().patch(key, {
        data: settled,
        range,
        work: range,
        files,
        sinceFiles: sinceFiles && workSinceFiles(sinceFiles, files),
        commits: log?.commits ?? [],
        since: mark ? { sha: mark.head, tip: mark.tip, how: 'review', at: mark.at } : null,
        loading: false,
        error: null,
        at: Date.now()
      })
    } catch (err) {
      review().patch(key, { loading: false, error: describeError(err), at: Date.now() })
    }
  })().finally(() => loading.delete(key))
  loading.set(key, run)
  return run
}

/**
 * Finish reviewing the tab's work: copy the notes and the summary for the agent (when there are any), and keep this
 * version as the one reviewed. The notes are cleared once copied.
 */
export async function finishWorkReview(repo: string, summary: string): Promise<boolean> {
  const range = review().entries[entryKey(repo, 'work')]?.work
  if (!range) return false
  const key = workKey(repo, range.branch)
  const notes = review().drafts[key] ?? []
  if (notes.length || summary.trim()) {
    await copyText(
      agentPrompt({ branch: range.branch, baseRef: range.baseRef, notes, summary }),
      notes.length ? `Copied ${pluralize(notes.length, 'note')} for the agent: paste them into its chat` : 'Copied for the agent: paste it into its chat'
    )
    review().setDrafts(key, [])
  } else {
    toast.success('Marked as reviewed', { detail: 'Next time you see only what changes after this version.' })
  }
  review().setWorkReviewed(key, { head: range.head, tip: range.tip, at: new Date().toISOString() })
  await loadWorkReview(repo, { force: true })
  return true
}
