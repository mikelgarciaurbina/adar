import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commitLoaded, createCommitRevealer, type RevealTab } from './reveal'

const sha = (n: number) => n.toString(16).padStart(40, '0')
const page = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ sha: sha(from + i) }))

/**
 * Fake tab + store paging. `total` commits exist in the graph's history; each page
 * loads `pageSize`. `ensure` behaves like the store's ensureCommitLoaded (pages
 * until found / end / no progress) unless a test overrides it.
 */
function setup(opts: { total: number; loaded: number; pageSize?: number; target: string }) {
  const pageSize = opts.pageSize ?? 10
  const tab: RevealTab = {
    selection: { kind: 'commit', sha: opts.target },
    commits: page(0, opts.loaded),
    hasMore: opts.loaded < opts.total,
    loading: { log: false, more: false }
  }
  const loadPage = () => {
    const n = tab.commits.length
    const next = Math.min(opts.total, n + pageSize)
    tab.commits = [...tab.commits, ...page(n, next)]
    tab.hasMore = next < opts.total
  }
  const ensure = vi.fn(async (target: string): Promise<boolean> => {
    for (let i = 0; i < 50; i++) {
      if (commitLoaded(tab.commits, target)) return true
      if (!tab.hasMore) return false
      const before = tab.commits.length
      await Promise.resolve()
      loadPage()
      if (tab.commits.length <= before) return false
    }
    return false
  })
  const onNotFound = vi.fn()
  const onFailed = vi.fn()
  const revealer = createCommitRevealer({
    getTab: () => tab,
    ensureCommitLoaded: (s) => ensure(s),
    onNotFound,
    onFailed,
    retryDelay: 250,
    maxRetries: 3
  })
  return { tab, ensure, onNotFound, onFailed, revealer, loadPage }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('commitLoaded', () => {
  it('matches full shas and prefixes of at least 4 characters', () => {
    const commits = [{ sha: 'abcdef0123' }]
    expect(commitLoaded(commits, 'abcdef0123')).toBe(true)
    expect(commitLoaded(commits, 'abcd')).toBe(true)
    expect(commitLoaded(commits, 'abc')).toBe(false)
    expect(commitLoaded(commits, 'ffff')).toBe(false)
  })
})

describe('createCommitRevealer', () => {
  it('pages a far commit in without any toast', async () => {
    const s = setup({ total: 100, loaded: 10, target: sha(73) })
    s.revealer.start(sha(73))
    expect(s.revealer.sha).toBe(sha(73))
    await flush()
    expect(commitLoaded(s.tab.commits, sha(73))).toBe(true)
    expect(s.onNotFound).not.toHaveBeenCalled()
    expect(s.onFailed).not.toHaveBeenCalled()
    // Still pending until CommitGraph finds the row and cancels.
    expect(s.revealer.sha).toBe(sha(73))
    s.revealer.cancel()
    expect(s.revealer.sha).toBeNull()
  })

  it('reports "not shown" only after paging reached the end of the history', async () => {
    const s = setup({ total: 30, loaded: 10, target: sha(999) })
    s.revealer.start(sha(999))
    await flush()
    expect(s.tab.hasMore).toBe(false)
    expect(s.onNotFound).toHaveBeenCalledTimes(1)
    expect(s.onNotFound).toHaveBeenCalledWith(sha(999))
    expect(s.revealer.sha).toBeNull()
  })

  it('reports at once when everything is loaded and the commit is not there', () => {
    const s = setup({ total: 10, loaded: 10, target: sha(999) })
    s.revealer.start(sha(999))
    expect(s.ensure).not.toHaveBeenCalled()
    expect(s.onNotFound).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-flight refresh instead of reporting (refresh keeps a far selection)', async () => {
    const s = setup({ total: 100, loaded: 10, target: sha(50) })
    s.tab.loading.log = true
    s.revealer.start(sha(50))
    expect(s.ensure).not.toHaveBeenCalled()
    // The refresh replaced the page (same length) and finished; hasMore stays true.
    s.tab.commits = page(0, 10)
    s.tab.loading.log = false
    s.revealer.resume()
    await flush()
    expect(commitLoaded(s.tab.commits, sha(50))).toBe(true)
    expect(s.onNotFound).not.toHaveBeenCalled()
  })

  it('does not report when paging was interrupted by a refresh; resumes once it settles', async () => {
    const s = setup({ total: 100, loaded: 10, target: sha(80) })
    // First call: a refresh starts while paging and the page result is dropped.
    s.ensure.mockImplementationOnce(async () => {
      s.tab.loading.log = true
      return false
    })
    s.revealer.start(sha(80))
    await flush()
    expect(s.onNotFound).not.toHaveBeenCalled()
    expect(s.onFailed).not.toHaveBeenCalled()
    expect(s.revealer.sha).toBe(sha(80))
    // No retry timer while the refresh is in flight.
    vi.advanceTimersByTime(5000)
    expect(s.ensure).toHaveBeenCalledTimes(1)
    s.tab.loading.log = false
    s.revealer.resume()
    await flush()
    expect(commitLoaded(s.tab.commits, sha(80))).toBe(true)
    expect(s.onNotFound).not.toHaveBeenCalled()
  })

  it('waits while another page load is in flight (shared loadMore)', async () => {
    const s = setup({ total: 100, loaded: 10, target: sha(15) })
    s.tab.loading.more = true
    s.revealer.start(sha(15))
    expect(s.ensure).not.toHaveBeenCalled()
    // The in-flight page lands and brings the commit with it.
    s.loadPage()
    s.tab.loading.more = false
    s.revealer.resume()
    expect(s.ensure).not.toHaveBeenCalled()
    expect(s.onNotFound).not.toHaveBeenCalled()
    expect(s.revealer.sha).toBe(sha(15))
  })

  it('retries pages that make no progress, then gives up with a failure (not "not shown")', async () => {
    const s = setup({ total: 100, loaded: 10, target: sha(80) })
    s.ensure.mockImplementation(async () => false) // every page load fails
    s.revealer.start(sha(80))
    await flush()
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(250)
      await flush()
    }
    expect(s.ensure).toHaveBeenCalledTimes(4)
    expect(s.onFailed).toHaveBeenCalledTimes(1)
    expect(s.onNotFound).not.toHaveBeenCalled()
    expect(s.revealer.sha).toBeNull()
  })

  it('keeps going while paging makes progress (store page limit)', async () => {
    const s = setup({ total: 200, loaded: 10, target: sha(190) })
    // The store stops after 2 pages per call even though more history remains.
    s.ensure.mockImplementation(async (target: string) => {
      for (let i = 0; i < 2; i++) {
        if (commitLoaded(s.tab.commits, target)) return true
        s.loadPage()
      }
      return commitLoaded(s.tab.commits, target)
    })
    s.revealer.start(sha(190))
    for (let i = 0; i < 12; i++) {
      await flush()
      vi.advanceTimersByTime(250)
    }
    expect(commitLoaded(s.tab.commits, sha(190))).toBe(true)
    expect(s.onFailed).not.toHaveBeenCalled()
    expect(s.onNotFound).not.toHaveBeenCalled()
  })

  it('stops silently when the selection changes or it is cancelled mid-paging', async () => {
    const s = setup({ total: 30, loaded: 10, target: sha(999) })
    s.revealer.start(sha(999))
    s.tab.selection = { kind: 'commit', sha: sha(5) }
    await flush()
    expect(s.onNotFound).not.toHaveBeenCalled()
    expect(s.revealer.sha).toBeNull()

    const t = setup({ total: 30, loaded: 10, target: sha(999) })
    t.revealer.start(sha(999))
    t.revealer.cancel()
    await flush()
    expect(t.onNotFound).not.toHaveBeenCalled()
  })

  it('does not start a second paging run for the same commit', async () => {
    const s = setup({ total: 100, loaded: 10, target: sha(60) })
    s.revealer.start(sha(60))
    s.revealer.start(sha(60))
    s.revealer.resume()
    expect(s.ensure).toHaveBeenCalledTimes(1)
    await flush()
  })

  it('switches to a newly selected commit', async () => {
    const s = setup({ total: 100, loaded: 10, target: sha(40) })
    s.revealer.start(sha(40))
    s.tab.selection = { kind: 'commit', sha: sha(90) }
    s.revealer.start(sha(90))
    expect(s.revealer.sha).toBe(sha(90))
    await flush()
    expect(commitLoaded(s.tab.commits, sha(90))).toBe(true)
    expect(s.onNotFound).not.toHaveBeenCalled()
  })

  it('stops when the tab is closed', () => {
    const s = setup({ total: 100, loaded: 10, target: sha(40) })
    const revealer = createCommitRevealer({
      getTab: () => undefined,
      ensureCommitLoaded: s.ensure,
      onNotFound: s.onNotFound,
      onFailed: s.onFailed
    })
    revealer.start(sha(40))
    expect(revealer.sha).toBeNull()
    expect(s.ensure).not.toHaveBeenCalled()
    expect(s.onNotFound).not.toHaveBeenCalled()
  })
})
