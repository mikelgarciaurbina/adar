// The commit graph — centre panel of a repository tab (GitKraken-style).
//
// Data flow: tab.commits → computeGraph (lanes) → buildDisplayRows (WIP / stash
// pseudo-rows) → virtualised GraphRow components. Selection, search and refs live
// in the store; every mutating action goes through actions/git.tsx.

import './graph.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, EyeOff, Focus, GitCommitHorizontal } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { Button, EmptyState, Spinner } from '@renderer/components/common/Button'
import { showContextMenu } from '@renderer/components/common/ContextMenu'
import { toast } from '@renderer/components/common/toast'
import { runCommand } from '@renderer/commands'
import { REF_DRAG_MIME } from '@renderer/lib/dnd'
import { isEditableTarget, isMod } from '@renderer/lib/keys'
import { useApp, useSettings, type RepoTab } from '@renderer/store/appStore'
import type { Commit, Stash } from '@shared/types'
import { DEFAULT_WIDTHS, fitColumns, loadWidths, saveWidths, setWidth, type ColumnId, type ColumnWidths } from './columns'
import {
  autoGraphCap,
  autoGraphWidth,
  DEFAULT_ROW_H,
  fitGraphWidth,
  graphContentWidth,
  hiddenLanes as countHiddenLanes,
  MIN_MSG_CSS_W,
  MIN_MSG_HIDE_W
} from './geometry'
import { GraphHeader } from './GraphHeader'
import { GraphRow } from './GraphRow'
import { GraphSearch } from './GraphSearch'
import { computeGraph, type LayoutRow } from './layout'
import { createCommitRevealer } from './reveal'
import { commitMenu, headerMenu, multiCommitMenu, refMenu, stashMenu, wipMenu } from './menus'
import {
  buildDisplayRows,
  buildPillMap,
  findSelectionIndex,
  hasWorkingChanges,
  lanesInRange,
  localBranchesIn,
  navigate,
  nearestCommitRow,
  rowSelection,
  wipCounts,
  type CommitRow,
  type DisplayModel,
  type Pill
} from './model'
import type { GraphCtx, WipInfo } from './types'

const NO_STASHES: Stash[] = []
/** Load more commits when the viewport gets this close to the end of the loaded list. */
const LOAD_MORE_THRESHOLD = 200
const OVERSCAN = 12
const MORE_KEY = '__more__'
/** Rows whose lanes size the auto GRAPH column before the virtualiser has measured the viewport. */
const FALLBACK_VIEW_ROWS = 40
/** The auto GRAPH column shrinks back this long after scrolling stops (grows immediately). */
const LANE_SHRINK_DELAY = 700
const NOT_IN_GRAPH = 'That commit is not shown in the graph (its branch may be hidden or filtered).'

/** Scroll offset per repo so returning from a diff / switching tabs restores the position. */
const savedOffsets = new Map<string, number>()

function readRowHeight(): number {
  try {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_ROW_H
  } catch {
    return DEFAULT_ROW_H
  }
}

/** Keep the previous array when a refresh returns the same history, so layout and rows are reused. */
function useStableCommits(commits: Commit[]): Commit[] {
  const ref = useRef(commits)
  const prev = ref.current
  if (prev !== commits) {
    let same = prev.length === commits.length
    for (let i = 0; same && i < commits.length; i++) if (prev[i].sha !== commits[i].sha) same = false
    if (!same) ref.current = commits
  }
  return ref.current
}

/** Same stash list (by identity of its entries' shas) → same array. */
function useStableStashes(stashes: Stash[]): Stash[] {
  const ref = useRef(stashes)
  const prev = ref.current
  if (prev !== stashes) {
    const same =
      prev.length === stashes.length &&
      prev.every((s, i) => s.sha === stashes[i].sha && s.index === stashes[i].index && s.baseSha === stashes[i].baseSha && s.message === stashes[i].message)
    if (!same) ref.current = stashes
  }
  return ref.current
}

/**
 * `value`, except that decreases only take effect once `paused` is false and
 * `delay` ms have passed — keeps the auto-sized GRAPH column from jittering while
 * the user scrolls through rows with fewer lanes.
 */
function useHeldMax(value: number, delay: number, paused: boolean): number {
  const [held, setHeld] = useState(value)
  useEffect(() => {
    if (value > held) setHeld(value)
    if (value >= held || paused) return
    const id = setTimeout(() => setHeld(value), delay)
    return () => clearTimeout(id)
  }, [value, held, delay, paused])
  return Math.max(value, held)
}

function shortRefName(fullName: string): string {
  return fullName.replace(/^refs\/(heads|remotes|tags)\//, '')
}

function MoreRow({ start, h, loading, onLoad }: { start: number; h: number; loading: boolean; onLoad: () => void }) {
  return (
    <div className="gr-more-row" style={{ transform: `translateY(${start}px)`, height: h }}>
      {loading ? (
        <>
          <Spinner size="sm" />
          <span>Loading more commits…</span>
        </>
      ) : (
        <button className="ui-link" onClick={onLoad}>
          Load more commits
        </button>
      )}
    </div>
  )
}

export function CommitGraph({ tab }: { tab: RepoTab }) {
  const settings = useSettings()
  const path = tab.path
  const [rowH] = useState(readRowHeight)
  const [widths, setWidths] = useState<ColumnWidths>(loadWidths)
  const [scrollbar, setScrollbar] = useState(0)
  const [rootW, setRootW] = useState(0)
  const [graphColW, setGraphColW] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const graphHeadRef = useRef<HTMLDivElement>(null)
  const lastOffset = useRef(savedOffsets.get(path) ?? 0)

  // ── View model ──────────────────────────────────────────────────────────
  const commits = useStableCommits(tab.commits)
  const layout = useMemo(() => computeGraph(commits), [commits])
  const rowCache = useMemo(() => new WeakMap<LayoutRow, CommitRow>(), [])
  const head = tab.refs?.head ?? tab.info?.head ?? null
  const headSha = head?.sha ?? null
  const unborn = !!head?.unborn
  // Also during a merge whose resolution left no changes: the WIP row leads back to the merge composer.
  const showWip = hasWorkingChanges(tab.status) || (!!tab.status && !tab.error && tab.info?.state === 'merge')
  const stashes = useStableStashes(settings.graphShowStashes ? (tab.refs?.stashes ?? NO_STASHES) : NO_STASHES)
  const model: DisplayModel = useMemo(
    () => buildDisplayRows({ commits, layout, headSha, showWip, stashes, cache: rowCache }),
    [commits, layout, headSha, showWip, stashes, rowCache]
  )
  const hidden = useMemo(() => new Set(tab.hiddenRefs), [tab.hiddenRefs])
  const pillMap = useMemo(
    () => buildPillMap(tab.refs, { hidden, showRemotes: settings.graphShowRemotes, showTags: settings.graphShowTags }),
    [tab.refs, hidden, settings.graphShowRemotes, settings.graphShowTags]
  )
  const draftSummary = tab.draft.summary.trim()
  const wipInfo = useMemo<WipInfo | undefined>(
    () => (showWip ? { counts: wipCounts(tab.status), summary: draftSummary } : undefined),
    [showWip, tab.status, draftSummary]
  )

  // ── Selection & search state ────────────────────────────────────────────
  const selIndex = findSelectionIndex(model, tab.selection)
  const multiSet = useMemo(() => (tab.multiSelect.length > 1 ? new Set(tab.multiSelect) : null), [tab.multiSelect])
  const { results, index: resultIndex, query, mode, open: searchOpen } = tab.search
  const matchSet = useMemo(() => (results.length ? new Set(results) : null), [results])
  const currentMatch = results.length ? results[resultIndex] : undefined
  const hlField: 'message' | 'author' | null = matchSet && query.trim() ? (mode === 'message' ? 'message' : mode === 'author' ? 'author' : null) : null
  const hl = hlField ? query.trim() : ''

  // ── Column widths (persistence) ─────────────────────────────────────────
  const firstWidths = useRef(true)
  useEffect(() => {
    if (firstWidths.current) {
      firstWidths.current = false
      return
    }
    saveWidths(widths)
  }, [widths])
  const onResize = useCallback((id: ColumnId, w: number | null) => setWidths((prev) => setWidth(prev, id, w)), [])
  const onHeaderMenu = useCallback(
    (e: React.MouseEvent) => showContextMenu(e, headerMenu(path, () => setWidths({ ...DEFAULT_WIDTHS }))),
    [path]
  )

  // Relative dates refresh once a minute.
  useEffect(() => {
    if (settings.dateFormat !== 'relative' || !settings.graphColumns.date) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [settings.dateFormat, settings.graphColumns.date])

  // ── Virtualisation ──────────────────────────────────────────────────────
  const rowsRef = useRef(model.rows)
  rowsRef.current = model.rows
  const hasMoreRow = tab.hasMore && model.rows.length > 0
  const count = model.rows.length + (hasMoreRow ? 1 : 0)
  const getItemKey = useCallback((i: number) => rowsRef.current[i]?.key ?? MORE_KEY, [])
  const estimateSize = useCallback(() => rowH, [rowH])
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: OVERSCAN,
    initialOffset: () => savedOffsets.get(path) ?? 0
  })
  const items = virtualizer.getVirtualItems()
  const lastRendered = items.length ? items[items.length - 1].index : -1

  // ── Columns ─────────────────────────────────────────────────────────────
  // The auto GRAPH column fits the lanes of the rows in view (incl. overscan),
  // capped at 45% of the panel; it grows at once and shrinks after scrolling.
  const viewFirst = items.length ? items[0].index : 0
  const viewLast = Math.min(items.length ? lastRendered : FALLBACK_VIEW_ROWS - 1, model.rows.length - 1)
  const viewLanes = useMemo(() => lanesInRange(model.rows, viewFirst, viewLast), [model.rows, viewFirst, viewLast])
  const fitLanes = useHeldMax(viewLanes, LANE_SHRINK_DELAY, virtualizer.isScrolling)
  // Lanes that stay visible even when the messages are short of room (bounded by the
  // cap; beyond it the selected node is pinned to the column edge instead).
  const laneInView = (i: number) => (i >= viewFirst && i <= viewLast ? model.rows[i].lane + 1 : 0)
  const mustShowLanes = Math.max(
    laneInView(selIndex),
    headSha ? laneInView(model.index.get(headSha) ?? -1) : 0,
    showWip ? laneInView(0) : 0
  )
  const inner = rootW ? rootW - scrollbar : Infinity
  const cap = autoGraphCap(inner, widths.refs + MIN_MSG_CSS_W)
  // Lanes come before the optional columns, which give way first (SHA, date, author)…
  const graphWant = widths.graph ?? autoGraphWidth(fitLanes, { cap, mustShow: mustShowLanes })
  const cols = useMemo(
    () => fitColumns(settings.graphColumns, widths, inner - widths.refs - graphWant - MIN_MSG_HIDE_W),
    [settings.graphColumns, widths, inner, graphWant]
  )
  // …then the graph takes what is left while keeping the messages readable.
  const graphRoom = inner - widths.refs - (cols.author ? widths.author : 0) - (cols.date ? widths.date : 0) - (cols.sha ? widths.sha : 0) - MIN_MSG_HIDE_W
  const graphW = widths.graph ?? autoGraphWidth(fitLanes, { cap, available: graphRoom, mustShow: mustShowLanes })
  const drawW = graphContentWidth(model.maxLanes)
  // Real rendered width (flex may shrink a manual width in a cramped panel).
  const colW = graphColW || graphW
  const lanesHidden = countHiddenLanes(viewLanes, colW)
  const headerWidths = useMemo(
    () => ({ refs: widths.refs, graph: graphW, author: widths.author, date: widths.date, sha: widths.sha }),
    [widths, graphW]
  )
  const fitInput = useRef({ viewLanes, colW, inner, refs: widths.refs })
  fitInput.current = { viewLanes, colW, inner, refs: widths.refs }
  /** "+N" badge: widen the GRAPH column (explicit width) so the lanes in view fit. */
  const onFitLanes = useCallback(() => {
    const { viewLanes, colW, inner, refs } = fitInput.current
    setWidths((prev) => setWidth(prev, 'graph', fitGraphWidth(viewLanes, colW, inner, refs)))
  }, [])

  // Restore the scroll position on mount (initialOffset only seeds the first range).
  useLayoutEffect(() => {
    const saved = savedOffsets.get(path)
    if (saved && scrollRef.current) scrollRef.current.scrollTop = saved
    return () => void savedOffsets.set(path, lastOffset.current)
  }, [path])

  // Header padding = body scrollbar width, so columns stay aligned; the root width
  // bounds the auto-sized graph column.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const inner = innerRef.current
    const root = rootRef.current
    if (!el || !inner || !root) return
    const measure = () => {
      setScrollbar(Math.max(0, el.offsetWidth - el.clientWidth))
      setRootW(root.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(inner)
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // Rendered GRAPH column width, re-measured before paint whenever the column
  // layout may have changed (so the "+N" badge and pinned node never lag a frame).
  useLayoutEffect(() => {
    const el = graphHeadRef.current
    if (el) setGraphColW(el.offsetWidth)
  }, [graphW, inner, cols, widths])

  // Infinite scroll. Auto-loads at most once per history length, so a failing
  // page load does not retry in a loop (the footer row offers a manual retry).
  const loadingMore = tab.loading.more
  const loadingLog = tab.loading.log
  const autoRequestedAt = useRef(-1)
  /** Pages in a selected commit that is not loaded yet (see reveal.ts). */
  const revealer = useMemo(
    () =>
      createCommitRevealer({
        getTab: () => useApp.getState().tabs.find((t) => t.path === path),
        ensureCommitLoaded: (sha) => useApp.getState().ensureCommitLoaded(path, sha),
        onNotFound: () => toast.info(NOT_IN_GRAPH),
        onFailed: () => toast.warning('Could not load enough history to show that commit.')
      }),
    [path]
  )
  useEffect(() => () => revealer.cancel(), [revealer])
  useEffect(() => {
    if (!tab.hasMore || loadingMore || loadingLog || !commits.length) return
    // The revealer is paging (ensureCommitLoaded): it loads the pages itself.
    if (revealer.sha) return
    if (lastRendered < model.rows.length - LOAD_MORE_THRESHOLD) return
    if (autoRequestedAt.current === commits.length) return
    autoRequestedAt.current = commits.length
    void useApp.getState().loadMore(path)
  }, [lastRendered, tab.hasMore, loadingMore, loadingLog, model.rows.length, commits.length, path, revealer])

  // ── Scroll the selection into view ──────────────────────────────────────
  const modelRef = useRef(model)
  modelRef.current = model
  const scrollToRow = useCallback(
    (idx: number, align?: 'center') => {
      const el = scrollRef.current
      if (!el || idx < 0) return
      const first = Math.floor(el.scrollTop / rowH)
      const last = Math.floor((el.scrollTop + el.clientHeight - 1) / rowH)
      const near = idx >= first - 1 && idx <= last + 1
      virtualizer.scrollToIndex(idx, { align: align ?? (near ? 'auto' : 'center') })
    },
    [virtualizer, rowH]
  )

  useEffect(() => {
    const sel = tab.selection
    const idx = findSelectionIndex(modelRef.current, sel)
    if (idx >= 0) {
      revealer.cancel()
      scrollToRow(idx)
    } else if (sel.kind === 'commit') {
      revealer.start(sel.sha)
    } else {
      // Nothing selected, or a WIP / stash row that is not drawn (stashes hidden).
      revealer.cancel()
    }
  }, [tab.selection, scrollToRow, revealer])

  // The commit being revealed got loaded: scroll to it.
  useEffect(() => {
    const sha = revealer.sha
    if (!sha) return
    const idx = findSelectionIndex(model, { kind: 'commit', sha })
    if (idx >= 0) {
      revealer.cancel()
      scrollToRow(idx, 'center')
    }
  }, [model, scrollToRow, revealer])

  // Resume a reveal that waited for a refresh / page load to settle.
  useEffect(() => {
    if (!loadingLog && !loadingMore) revealer.resume()
  }, [loadingLog, loadingMore, tab.hasMore, commits, revealer])

  // ── Drag & drop feedback (drags may start in the left panel) ────────────
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const end = () => {
      window.removeEventListener('mousemove', end)
      root.classList.remove('gr-dragging')
      root.querySelectorAll('.gr-drop-over').forEach((el) => el.classList.remove('gr-drop-over'))
    }
    const start = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes(REF_DRAG_MIME)) return
      root.classList.add('gr-dragging')
      // No mousemove fires during a drag: the first one afterwards is a safe fallback
      // when dragend never reaches window (source row virtualised away mid-drag).
      window.addEventListener('mousemove', end)
    }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
      window.removeEventListener('mousemove', end)
    }
  }, [])

  // ── Row event handlers (one stable object; reads the latest state) ──────
  const latest = useRef({ tab, pillMap })
  useLayoutEffect(() => {
    latest.current = { tab, pillMap }
  })
  const ctx = useMemo<GraphCtx>(() => {
    const st = () => useApp.getState()
    const repo = () => latest.current.tab.path
    return {
      onRowClick(e, row) {
        if (e.button !== 0) return
        if (row.kind === 'commit') {
          const additive = isMod(e)
          st().select(repo(), rowSelection(row), { additive, range: !additive && e.shiftKey })
        } else st().select(repo(), rowSelection(row))
      },
      onRowDoubleClick(_e, row) {
        if (row.kind === 'commit') {
          const locals = localBranchesIn(latest.current.pillMap.get(row.commit.sha))
          if (locals.length === 1 && !locals[0].isHead) void git.checkoutRef(repo(), locals[0])
        } else if (row.kind === 'wip') {
          runCommand('commit')
        }
      },
      onRowContextMenu(e, row) {
        const t = latest.current.tab
        if (row.kind === 'commit') {
          const sha = row.commit.sha
          const inMulti = t.multiSelect.length > 1 && t.multiSelect.includes(sha)
          if (inMulti) {
            showContextMenu(e, multiCommitMenu(t.path, t.multiSelect))
            return
          }
          if (!(t.selection.kind === 'commit' && t.selection.sha === sha)) st().select(t.path, rowSelection(row))
          showContextMenu(e, commitMenu(t.path, row.commit, latest.current.pillMap.get(sha)))
        } else if (row.kind === 'stash') {
          st().select(t.path, rowSelection(row))
          showContextMenu(e, stashMenu(t.path, row.stash))
        } else {
          st().select(t.path, { kind: 'wip' })
          showContextMenu(e, wipMenu(t.path))
        }
      },
      onPillDoubleClick(pill: Pill) {
        if (pill.kind === 'detached' || pill.isHead) return
        void git.checkoutRef(repo(), pill.ref)
      },
      onPillContextMenu(e, pill) {
        showContextMenu(e, refMenu(repo(), pill))
      },
      onRefDrop(source, target, at) {
        if (target.kind === 'detached') return
        const r = target.ref
        git.handleRefDrop(repo(), source, { name: r.name, fullName: r.fullName, type: r.type, sha: r.sha }, at)
      }
    }
  }, [])

  // ── Keyboard ────────────────────────────────────────────────────────────
  const focusGraph = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), [])
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && isEditableTarget(e.target)) return
    const st = useApp.getState()
    // Read the latest state: key repeat can deliver several events before React re-renders.
    const cur = st.tabs.find((t) => t.path === path)
    if (!cur) return
    if (e.key === 'Escape') {
      // Escape that closes a context menu / popover must not also act on the graph.
      if (document.querySelector('.ui-menu, .gr-pop')) return
      if (cur.search.open) {
        st.setSearch(path, { open: false, query: '', results: [], index: 0, loading: false })
        e.preventDefault()
      } else if (cur.multiSelect.length > 1 && cur.selection.kind === 'commit') {
        st.select(path, cur.selection)
        e.preventDefault()
      }
      return
    }
    // Leave modified arrows to global shortcuts (e.g. Mod+Shift+Up = push).
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const m = modelRef.current
    const at = findSelectionIndex(m, cur.selection)
    const el = scrollRef.current
    const page = Math.max(1, Math.floor((el?.clientHeight ?? rowH * 10) / rowH) - 1)
    let next = navigate(at, e.key, m.rows.length, page)
    if (next === null) return
    e.preventDefault()
    // Shift extends a commit range from the anchor; WIP / stash rows are skipped.
    const range = e.shiftKey && cur.selection.kind === 'commit'
    if (range) next = nearestCommitRow(m.rows, next, next >= at ? 1 : -1)
    if (next < 0 || next === at) {
      if (at >= 0) scrollToRow(at)
      return
    }
    st.select(path, rowSelection(m.rows[next]), range ? { range: true } : undefined)
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const rootCls =
    'gr-root' +
    (cols.author ? '' : ' gr-hide-author') +
    (cols.date ? '' : ' gr-hide-date') +
    (cols.sha ? '' : ' gr-hide-sha') +
    (lanesHidden > 0 ? ' gr-clipped' : '') +
    (matchSet ? ' gr-searching' : '')
  const rootStyle = {
    '--gr-w-refs': `${widths.refs}px`,
    '--gr-w-graph': `${graphW}px`,
    '--gr-w-author': `${widths.author}px`,
    '--gr-w-date': `${widths.date}px`,
    '--gr-w-sha': `${widths.sha}px`,
    '--gr-row-h': `${rowH}px`
  } as CSSProperties

  const noCommits = commits.length === 0
  const initialLoading = noCommits && !unborn && !tab.error && (tab.loading.log || tab.loading.refs || !tab.refs)
  const filtered = !!tab.soloRef || tab.hiddenRefs.length > 0
  const overlayTop = model.rows.length * rowH

  return (
    <div ref={rootRef} className={rootCls} style={rootStyle}>
      {tab.error && (
        <div className="gr-error" role="alert">
          <AlertTriangle size={14} />
          <span className="gr-error-msg" title={tab.error}>
            {tab.error}
          </span>
          <Button size="sm" onClick={() => void useApp.getState().refresh(path)}>
            Retry
          </Button>
        </div>
      )}
      {filtered && (
        <div className="gr-filterbar">
          {tab.soloRef ? (
            <>
              <Focus size={12} />
              <span>
                Showing only <b>{shortRefName(tab.soloRef)}</b>
              </span>
              <button className="ui-link" onClick={() => useApp.getState().setSoloRef(path, null)}>
                Show all
              </button>
            </>
          ) : (
            <>
              <EyeOff size={12} />
              <span>
                {tab.hiddenRefs.length} hidden {tab.hiddenRefs.length === 1 ? 'ref' : 'refs'}
              </span>
              <button className="ui-link" onClick={() => useApp.getState().setRefsHidden(path, tab.hiddenRefs, false)}>
                Show all
              </button>
            </>
          )}
        </div>
      )}
      {searchOpen && (
        <div className="gr-search-wrap">
          <GraphSearch tab={tab} onClose={focusGraph} />
        </div>
      )}
      <GraphHeader
        widths={headerWidths}
        scrollbar={scrollbar}
        loading={loadingLog && !noCommits}
        hiddenLanes={lanesHidden}
        onFitLanes={onFitLanes}
        graphCellRef={graphHeadRef}
        onResize={onResize}
        onContextMenu={onHeaderMenu}
      />
      <div className="gr-body">
        <div
          ref={scrollRef}
          className="gr-scroll"
          tabIndex={0}
          role="grid"
          aria-label="Commit graph"
          aria-rowcount={count}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            lastOffset.current = e.currentTarget.scrollTop
          }}
        >
          <div ref={innerRef} className="gr-inner" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              if (item.index >= model.rows.length) {
                return (
                  <MoreRow
                    key={MORE_KEY}
                    start={item.start}
                    h={rowH}
                    loading={loadingMore}
                    onLoad={() => void useApp.getState().loadMore(path)}
                  />
                )
              }
              const row = model.rows[item.index]
              const sha = row.kind === 'commit' ? row.commit.sha : null
              const isMatch = !!(sha && matchSet?.has(sha))
              return (
                <GraphRow
                  key={row.key}
                  row={row}
                  index={item.index}
                  start={item.start}
                  h={rowH}
                  graphWidth={drawW}
                  pinWidth={item.index === selIndex ? colW : 0}
                  pills={sha ? pillMap.get(sha) : undefined}
                  selected={item.index === selIndex}
                  multi={!!(sha && multiSet?.has(sha))}
                  match={isMatch ? (sha === currentMatch ? 2 : 1) : 0}
                  dim={!!matchSet && !isMatch}
                  hl={isMatch ? hl : ''}
                  hlField={isMatch ? hlField : null}
                  dateMode={settings.dateFormat}
                  now={now}
                  wip={row.kind === 'wip' ? wipInfo : undefined}
                  ctx={ctx}
                />
              )
            })}
          </div>
          {initialLoading && (
            <div className="gr-overlay" style={{ top: overlayTop }}>
              <Spinner size="lg" />
            </div>
          )}
          {!initialLoading && noCommits && (
            <div className="gr-overlay" style={{ top: overlayTop }}>
              {unborn ? (
                <EmptyState icon={<GitCommitHorizontal size={36} />} title="No commits yet">
                  Stage your changes and create the first commit to start this repository&apos;s history.
                </EmptyState>
              ) : tab.error ? (
                <EmptyState icon={<AlertTriangle size={36} />} title="Could not load the history" />
              ) : (
                <EmptyState icon={filtered ? <EyeOff size={36} /> : <GitCommitHorizontal size={36} />} title="No commits to show">
                  {filtered ? 'Some branches are hidden or a single branch is soloed.' : 'This view has no commits.'}
                </EmptyState>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
