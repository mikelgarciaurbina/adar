// State of the review view, per repository and pull request: what GitHub says (threads, reviews, Viewed marks),
// where the local repository has the changes (ReviewRange), the files changed in all of them and since the review,
// and the line comments written in Adar for the next review (kept in this browser's storage until submitted).

import { create } from 'zustand'
import type { DraftComment, PullReviewData, ReviewRange } from '@shared/review'
import type { Commit, FileChange } from '@shared/types'

export interface ReviewEntry {
  data: PullReviewData | null
  range: ReviewRange | null
  /** The pull request's files (base..head) and those changed since the review (since..head), when known. */
  files: FileChange[] | null
  sinceFiles: FileChange[] | null
  /** The pull request's commits as the repository has them (base..head), newest first. */
  commits: Commit[] | null
  /** What "since" means here: the user's last review, comment or look, fixed when the view opened. */
  since: { sha: string; how: 'review' | 'comment' | 'seen'; at: string } | null
  loading: boolean
  error: string | null
  at: number
}

export const EMPTY_ENTRY: ReviewEntry = { data: null, range: null, files: null, sinceFiles: null, commits: null, since: null, loading: false, error: null, at: 0 }

interface ReviewState {
  entries: Record<string, ReviewEntry>
  /** Line comments for the next review, by pull request ("github.com/acme/widgets#42"). */
  drafts: Record<string, DraftComment[]>
  /** The comment box open in the diff (one at a time). */
  composer: { key: string; path: string; side: 'LEFT' | 'RIGHT'; line: number; startLine?: number; body: string } | null
  patch(key: string, p: Partial<ReviewEntry>): void
  setDrafts(pull: string, drafts: DraftComment[]): void
  setComposer(c: ReviewState['composer']): void
}

export const entryKey = (repo: string, number: number) => `${repo}\0${number}`

const DRAFTS_KEY = 'adar.reviewDrafts.v1'

function loadDrafts(): Record<string, DraftComment[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, DraftComment[]> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (!Array.isArray(v)) continue
      const list = v.filter(
        (d): d is DraftComment =>
          !!d && typeof d === 'object' && typeof d.path === 'string' && typeof d.line === 'number' && (d.side === 'LEFT' || d.side === 'RIGHT') && typeof d.body === 'string'
      )
      if (list.length) out[k] = list
    }
    return out
  } catch {
    return {}
  }
}

function saveDrafts(drafts: Record<string, DraftComment[]>): void {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    /* storage unavailable: kept for this run only */
  }
}

export const useReview = create<ReviewState>()((set) => ({
  entries: {},
  drafts: loadDrafts(),
  composer: null,

  patch(key, p) {
    set((s) => ({ entries: { ...s.entries, [key]: { ...(s.entries[key] ?? EMPTY_ENTRY), ...p } } }))
  },

  setDrafts(pull, list) {
    set((s) => {
      const drafts = { ...s.drafts }
      if (list.length) drafts[pull] = list
      else delete drafts[pull]
      saveDrafts(drafts)
      return { drafts }
    })
  },

  setComposer(composer) {
    set({ composer })
  }
}))

const NO_DRAFTS: DraftComment[] = []

/** The line comments kept for a pull request's next review. */
export const useDrafts = (pull: string | null) => useReview((s) => (pull ? (s.drafts[pull] ?? NO_DRAFTS) : NO_DRAFTS))

/** A review view's entry (EMPTY_ENTRY until loaded). */
export const useReviewEntry = (repo: string, number: number) => useReview((s) => s.entries[entryKey(repo, number)] ?? EMPTY_ENTRY)
