// Floating "find commit" bar bound to tab.search (opened with Mod+F).
// Typing is debounced (300ms) into store.runSearch; Enter / Shift+Enter or the
// chevrons step through results, selecting each one (CommitGraph scrolls to it
// and pages it in when needed). Esc closes and clears.

import { useCallback, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { IconButton, Spinner } from '@renderer/components/common/Button'
import { toast } from '@renderer/components/common/toast'
import { useApp, type RepoTab, type SearchState } from '@renderer/store/appStore'

const MODES: Array<{ value: SearchState['mode']; label: string; placeholder: string }> = [
  { value: 'message', label: 'Message', placeholder: 'Search commit messages' },
  { value: 'author', label: 'Author', placeholder: 'Author name or email' },
  { value: 'sha', label: 'SHA', placeholder: 'Commit SHA (prefix)' },
  { value: 'content', label: 'Content', placeholder: 'Changed lines (regex)' },
  { value: 'path', label: 'File path', placeholder: 'Path or glob' }
]

/** Matches the maxCount store.runSearch asks for. */
const RESULT_CAP = 2000
const DEBOUNCE_MS = 300

export function GraphSearch({ tab, onClose }: { tab: RepoTab; onClose: () => void }) {
  const path = tab.path
  const { query, mode, results, index, loading } = tab.search
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastRun = useRef<string | null>(null)
  const prevResults = useRef(results)

  const getSearch = useCallback(() => useApp.getState().tabs.find((t) => t.path === path)?.search, [path])

  const run = useCallback(() => {
    clearTimeout(timer.current)
    const s = getSearch()
    if (!s) return
    lastRun.current = `${s.mode}\u0000${s.query.trim()}`
    useApp
      .getState()
      .runSearch(path)
      .catch((err) => toast.error(err))
  }, [getSearch, path])

  const schedule = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(run, DEBOUNCE_MS)
  }, [run])

  const go = useCallback(
    (i: number) => {
      const s = getSearch()
      const n = s?.results.length ?? 0
      if (!s || !n) return
      const k = ((i % n) + n) % n
      const st = useApp.getState()
      st.setSearch(path, { index: k })
      st.select(path, { kind: 'commit', sha: s.results[k] })
    },
    [getSearch, path]
  )

  const close = useCallback(() => {
    clearTimeout(timer.current)
    useApp.getState().setSearch(path, { open: false, query: '', results: [], index: 0, loading: false })
    onClose()
  }, [onClose, path])

  // Focus on mount, and again whenever "open" is requested while already open (Mod+F).
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
    return useApp.subscribe((s, prev) => {
      const a = s.tabs.find((t) => t.path === path)?.search
      const b = prev.tabs.find((t) => t.path === path)?.search
      if (!a || !b || a === b || !a.open || !b.open) return
      if (a.query === b.query && a.mode === b.mode && a.results === b.results && a.index === b.index && a.loading === b.loading) {
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    })
  }, [path])

  // Run a pending query when mounted with one but no results (e.g. reopened after a view switch).
  useEffect(() => {
    const s = getSearch()
    if (s && s.query.trim() && !s.results.length && !s.loading) run()
    return () => clearTimeout(timer.current)
  }, [getSearch, run])

  // New result set → jump to the first match.
  useEffect(() => {
    if (prevResults.current === results) return
    prevResults.current = results
    if (results.length) go(0)
  }, [results, go])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const s = getSearch()
      if (!s) return
      const key = `${s.mode}\u0000${s.query.trim()}`
      if (key !== lastRun.current) run()
      else go(s.index + (e.shiftKey ? -1 : 1))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const s = getSearch()
      if (s) go(s.index + (e.key === 'ArrowUp' ? -1 : 1))
    }
  }

  const trimmed = query.trim()
  const ranCurrent = !!trimmed && lastRun.current === `${mode}\u0000${trimmed}`
  const noResults = !loading && !results.length && ranCurrent
  let count: React.ReactNode = null
  if (loading) count = <Spinner size="sm" />
  else if (results.length) count = `${Math.min(index + 1, results.length)} of ${results.length}${results.length >= RESULT_CAP ? '+' : ''}`
  else if (noResults) count = 'No results'
  const placeholder = MODES.find((m) => m.value === mode)?.placeholder ?? 'Search'

  return (
    <div className="gr-search" role="search" onMouseDown={(e) => e.stopPropagation()}>
      <Search size={14} className="gr-search-icon" />
      <input
        ref={inputRef}
        className="gr-search-input"
        value={query}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-label="Search commits"
        onChange={(e) => {
          useApp.getState().setSearch(path, { query: e.target.value })
          if (!e.target.value.trim()) run()
          else schedule()
        }}
        onKeyDown={onKeyDown}
      />
      <select
        className="gr-search-mode"
        value={mode}
        aria-label="Search in"
        onChange={(e) => {
          useApp.getState().setSearch(path, { mode: e.target.value as SearchState['mode'] })
          if (getSearch()?.query.trim()) run()
          inputRef.current?.focus()
        }}
      >
        {MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <span className={`gr-search-count${noResults ? ' gr-none' : ''}`}>{count}</span>
      <IconButton size="sm" label="Previous result (Shift+Enter)" disabled={!results.length} onClick={() => go(index - 1)}>
        <ChevronUp size={14} />
      </IconButton>
      <IconButton size="sm" label="Next result (Enter)" disabled={!results.length} onClick={() => go(index + 1)}>
        <ChevronDown size={14} />
      </IconButton>
      <IconButton size="sm" label="Close (Esc)" onClick={close}>
        <X size={14} />
      </IconButton>
    </div>
  )
}
