// Revealing a selected commit that is not loaded yet (e.g. picked in the left
// panel or by search far down a big history): page history in until it is loaded
// — CommitGraph then scrolls to it — and report it as "not shown" only when
// paging has truly reached the end of the history without finding it.
//
// Pure (no React, no store): CommitGraph wires it to the store, unit tested.

import type { Selection } from '@renderer/store/appStore'

/** The parts of a RepoTab the revealer reads. */
export interface RevealTab {
  selection: Selection
  commits: readonly { sha: string }[]
  hasMore: boolean
  loading: { log: boolean; more: boolean }
}

export interface RevealDeps {
  /** Latest state of the tab (undefined once it is closed). */
  getTab(): RevealTab | undefined
  /** Store paging (useApp.ensureCommitLoaded): resolves true once the commit is loaded. */
  ensureCommitLoaded(sha: string): Promise<boolean>
  /** Paging reached the end of the history without finding the commit (hidden / filtered branch). */
  onNotFound(sha: string): void
  /** Paging kept failing before the end of the history. */
  onFailed(sha: string): void
  /** Delay before retrying after a page load that made no progress. */
  retryDelay?: number
  /** Retries without progress before giving up. */
  maxRetries?: number
}

export interface CommitRevealer {
  /** Sha being revealed, or null. */
  readonly sha: string | null
  /** Reveal `sha` (the current commit selection); keeps an in-flight reveal of the same sha. */
  start(sha: string): void
  /** Try again after a refresh / page load settled (no-op when idle or already paging). */
  resume(): void
  /** Stop (the commit was found, the selection changed or the graph unmounted). */
  cancel(): void
}

interface Pending {
  sha: string
  /** Consecutive paging attempts that loaded nothing new. */
  attempts: number
  /** ensureCommitLoaded is in flight. */
  running: boolean
}

/** Same matching as the store (full sha or a prefix of at least 4 characters). */
export function commitLoaded(commits: readonly { sha: string }[], sha: string): boolean {
  return commits.some((c) => c.sha === sha || (sha.length >= 4 && c.sha.startsWith(sha)))
}

export function createCommitRevealer(deps: RevealDeps): CommitRevealer {
  const retryDelay = deps.retryDelay ?? 250
  const maxRetries = deps.maxRetries ?? 3
  let pending: Pending | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  /** `p` is still what we are revealing and still the selected commit. */
  const isCurrent = (p: Pending): boolean => {
    if (pending !== p) return false
    const sel = deps.getTab()?.selection
    if (sel?.kind === 'commit' && sel.sha === p.sha) return true
    pending = null
    return false
  }

  /**
   * Decide what to do with the current state. Returns true when paging should
   * (continue to) run; false when there is nothing to do right now: the commit is
   * loaded (CommitGraph scrolls to it), a refresh / page load is in flight (resume()
   * is called when it settles) or the reveal ended (reported through the callbacks).
   */
  const shouldPage = (p: Pending): boolean => {
    const t = deps.getTab()
    if (!t) {
      pending = null
      return false
    }
    if (commitLoaded(t.commits, p.sha)) return false
    if (t.loading.log || t.loading.more) return false
    if (!t.hasMore) {
      pending = null
      deps.onNotFound(p.sha)
      return false
    }
    return true
  }

  const run = (): void => {
    clearTimer()
    const p = pending
    if (!p || p.running || !isCurrent(p) || !shouldPage(p)) return
    p.running = true
    const before = deps.getTab()?.commits.length ?? 0
    const settle = (found: boolean): void => {
      p.running = false
      if (!isCurrent(p) || found || !shouldPage(p)) return
      // Paging stopped short of the end (a failed page, or the store's page limit):
      // retry, counting only the attempts that loaded nothing new.
      const now = deps.getTab()?.commits.length ?? 0
      p.attempts = now > before ? 0 : p.attempts + 1
      if (p.attempts > maxRetries) {
        pending = null
        deps.onFailed(p.sha)
        return
      }
      timer = setTimeout(run, retryDelay)
    }
    deps.ensureCommitLoaded(p.sha).then(settle, () => settle(false))
  }

  return {
    get sha() {
      return pending?.sha ?? null
    },
    start(sha) {
      if (pending?.sha !== sha) pending = { sha, attempts: 0, running: false }
      run()
    },
    resume() {
      if (pending && !pending.running && timer === null) run()
    },
    cancel() {
      clearTimer()
      pending = null
    }
  }
}
