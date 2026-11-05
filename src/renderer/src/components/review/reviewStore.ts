// State of the review view, per repository and pull request: what the service says (threads, reviews, Viewed marks),
// where the local repository has the changes (ReviewRange), the files changed in all of them and since the review,
// the line comments written in Adar for the next review (kept in this browser's storage until submitted) and, for
// services that keep no Viewed marks Adar can read (GitLab), Adar's own: the head each file was viewed at.

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
  /** Adar's Viewed marks, by pull request: the commit each file was viewed at, and when the marks last changed. */
  viewed: Record<string, ViewedMarks>
  /** The comment box open in the diff (one at a time). */
  composer: { key: string; path: string; side: 'LEFT' | 'RIGHT'; line: number; startLine?: number; body: string } | null
  patch(key: string, p: Partial<ReviewEntry>): void
  setDrafts(pull: string, drafts: DraftComment[]): void
  /** Mark a file viewed at `head`, or not (null). */
  setViewedMark(pull: string, path: string, head: string | null): void
  setComposer(c: ReviewState['composer']): void
}

export interface ViewedMarks {
  at: number
  files: Record<string, string>
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

const VIEWED_KEY = 'adar.reviewViewed.v1'
/** Pull requests whose marks are kept (the ones changed longest ago go first), and files per pull request. */
const MAX_VIEWED_PULLS = 200
const MAX_VIEWED_FILES = 2000

function loadViewed(): Record<string, ViewedMarks> {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, ViewedMarks> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const m = v as Partial<ViewedMarks> | null
      if (!m || typeof m.at !== 'number' || !m.files || typeof m.files !== 'object') continue
      const files: Record<string, string> = {}
      for (const [path, sha] of Object.entries(m.files)) if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) files[path] = sha
      if (Object.keys(files).length) out[k] = { at: m.at, files }
    }
    return out
  } catch {
    return {}
  }
}

function saveViewed(viewed: Record<string, ViewedMarks>): void {
  try {
    localStorage.setItem(VIEWED_KEY, JSON.stringify(viewed))
  } catch {
    /* storage unavailable: kept for this run only */
  }
}

export const useReview = create<ReviewState>()((set) => ({
  entries: {},
  drafts: loadDrafts(),
  viewed: loadViewed(),
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

  setViewedMark(pull, path, head) {
    set((s) => {
      const files = { ...(s.viewed[pull]?.files ?? {}) }
      if (head) files[path] = head
      else delete files[path]
      const viewed = { ...s.viewed }
      const paths = Object.keys(files)
      if (paths.length > MAX_VIEWED_FILES) for (const p of paths.slice(0, paths.length - MAX_VIEWED_FILES)) delete files[p]
      if (paths.length) viewed[pull] = { at: Date.now(), files }
      else delete viewed[pull]
      const keys = Object.keys(viewed)
      if (keys.length > MAX_VIEWED_PULLS) for (const k of keys.sort((a, b) => viewed[a].at - viewed[b].at).slice(0, keys.length - MAX_VIEWED_PULLS)) delete viewed[k]
      saveViewed(viewed)
      return { viewed }
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
