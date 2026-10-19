// GitKraken-style left panel: filter box + collapsible LOCAL / REMOTE / TAGS /
// STASHES / SUBMODULES sections rendered as one virtualised tree. Rows support
// click-to-select, double-click checkout, context menus, ref drag & drop,
// hide/solo in graph and full keyboard navigation.

import './sidebar.css'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { Search, TriangleAlert, X } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { isMac } from '@renderer/api/client'
import { Button } from '@renderer/components/common/Button'
import { showContextMenu, type MenuItem } from '@renderer/components/common/ContextMenu'
import { getRefDragData, hasRefDragData, setRefDragData, type DraggedRef } from '@renderer/lib/dnd'
import { isEditableTarget, isMod } from '@renderer/lib/keys'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { Ref, RemoteInfo } from '@shared/types'
import {
  folderMenu,
  headMenu,
  localBranchMenu,
  remoteBranchMenu,
  remoteMenu,
  sectionMenu,
  stashMenu,
  submoduleMenu,
  tagMenu,
  type ContainerMenuState,
  type SidebarMenuCtx
} from './menus'
import {
  fetchRemote,
  openSubmodule,
  remoteFetchKey,
  selectCommit,
  selectRef,
  selectStash,
  setRefsHidden,
  toggleSolo,
  updateSubmodules,
  useSidebarBusy
} from './ops'
import { RowView, Skeleton, type HiddenState, type RowHandlers } from './SidebarRow'
import { loadCollapsedSections, loadToggled, saveCollapsedSections, saveToggled } from './storage'
import {
  buildTree,
  collectContainers,
  collectRefs,
  firstLeafIndex,
  firstNavigable,
  flattenTree,
  lastNavigable,
  normalizeFilter,
  parentIndex,
  stepIndex,
  withExpanded,
  type ContainerNode,
  type Row,
  type Section,
  type SectionId
} from './tree'

const ROW_H = 24
const SECTION_H = 26
const EMPTY_REMOTES: RemoteInfo[] = []
const FILTER_PLACEHOLDER = isMac ? 'Filter (⌥⌘F)' : 'Filter (Ctrl+Alt+F)'
/** Window event that focuses the branch filter (for commands; the panel must be visible). */
export const FOCUS_FILTER_EVENT = 'adar:focus-branch-filter'

// Refs below a container, cached per (immutable) tree node.
const refsCache = new WeakMap<object, Ref[]>()
function refsBelow(node: ContainerNode | Section): Ref[] {
  let refs = refsCache.get(node)
  if (!refs) refsCache.set(node, (refs = collectRefs(node)))
  return refs
}

function toggleIn<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function toDragged(ref: Ref): DraggedRef {
  return { name: ref.name, fullName: ref.fullName, type: ref.type, sha: ref.sha }
}

// ── Component ──────────────────────────────────────────────────────────────

export function LeftPanel({ tab }: { tab: RepoTab }) {
  const repo = tab.path
  const refs = tab.refs
  const remotesRaw = tab.info?.remotes ?? EMPTY_REMOTES
  // RepoInfo is re-fetched often; only rebuild the tree when remotes really change.
  const remotesKey = remotesRaw.map((r) => `${r.name}\u0000${r.fetchUrl}\u0000${r.pushUrl}`).join('\n')
  const remotes = useMemo(() => remotesRaw, [remotesKey])

  const [filter, setFilter] = useState('')
  const query = useDeferredValue(filter)
  const q = normalizeFilter(query)
  const filtering = q.length > 0

  const [collapsedSections, setCollapsedSections] = useState(() => loadCollapsedSections())
  const [toggled, setToggled] = useState(() => loadToggled(repo))
  const [filterCollapsed, setFilterCollapsed] = useState<Set<string>>(() => new Set())
  const [cursorKey, setCursorKey] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [menuKey, setMenuKey] = useState<string | null>(null)

  // Per-repo view state restarts if this instance is ever reused for another repository.
  const [stateRepo, setStateRepo] = useState(repo)
  if (stateRepo !== repo) {
    setStateRepo(repo)
    setToggled(loadToggled(repo))
    setFilter('')
    setFilterCollapsed(new Set())
    setCursorKey(null)
    setSelectedKey(null)
  }

  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragSource = useRef<string | null>(null)

  const fetchAllBusy = useApp((s) => !!s.busy[`fetch:${repo}`])
  const submodulesBusy = useApp((s) => !!s.busy[`submodules:${repo}`])
  const fetchingMap = useSidebarBusy((s) => s.fetching)

  useEffect(() => saveCollapsedSections(collapsedSections), [collapsedSections])
  useEffect(() => {
    if (stateRepo === repo) saveToggled(repo, toggled)
  }, [repo, stateRepo, toggled])

  // ── Model ────────────────────────────────────────────────────────────────

  const sections = useMemo(() => (refs ? buildTree(refs, remotes) : null), [refs, remotes])
  const rows = useMemo(
    () => (sections ? flattenTree(sections, { filter: query, collapsedSections, toggled, filterCollapsed }) : []),
    [sections, query, collapsedSections, toggled, filterCollapsed]
  )
  const indexByKey = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r, i) => m.set(r.key, i))
    return m
  }, [rows])
  const hidden = useMemo(() => new Set(tab.hiddenRefs), [tab.hiddenRefs])
  const containerHiddenCache = useMemo(() => new WeakMap<object, HiddenState>(), [hidden])
  const containerHidden = (node: ContainerNode): HiddenState => {
    let st = containerHiddenCache.get(node)
    if (!st) {
      const list = refsBelow(node)
      const n = list.reduce((acc, r) => acc + (hidden.has(r.fullName) ? 1 : 0), 0)
      st = n === 0 ? 'none' : n === list.length ? 'all' : 'some'
      containerHiddenCache.set(node, st)
    }
    return st
  }

  const cursorIndex = cursorKey !== null ? (indexByKey.get(cursorKey) ?? -1) : -1

  // Highlight the clicked row while the store selection still points at it.
  const sel = tab.selection
  let activeKey: string | null = null
  if (sel.kind === 'stash') activeKey = indexByKey.has(`stash:${sel.sha}`) ? `stash:${sel.sha}` : null
  else if (sel.kind === 'commit' && selectedKey !== null) {
    const i = indexByKey.get(selectedKey)
    const row = i !== undefined ? rows[i] : undefined
    if ((row?.kind === 'ref' && row.node.ref.sha === sel.sha) || (row?.kind === 'head' && row.node.sha === sel.sha)) activeKey = selectedKey
  }

  const anySingleFetch = useMemo(() => Object.keys(fetchingMap).some((k) => k.startsWith(repo + '\u0000')), [fetchingMap, repo])
  const remoteBusy = (name: string) => !!fetchingMap[remoteFetchKey(repo, name)] || (fetchAllBusy && !anySingleFetch)

  // ── Expansion ────────────────────────────────────────────────────────────

  const toggleSection = useCallback(
    (id: SectionId) => {
      if (filtering) setFilterCollapsed((prev) => toggleIn(prev, `s:${id}`))
      else setCollapsedSections((prev) => toggleIn(prev, id))
    },
    [filtering]
  )

  const setSectionExpanded = useCallback(
    (id: SectionId, expanded: boolean) => {
      if (filtering)
        setFilterCollapsed((prev) => {
          const next = new Set(prev)
          if (expanded) next.delete(`s:${id}`)
          else next.add(`s:${id}`)
          return next
        })
      else
        setCollapsedSections((prev) => {
          const next = new Set(prev)
          if (expanded) next.delete(id)
          else next.add(id)
          return next
        })
    },
    [filtering]
  )

  const setContainersExpanded = useCallback(
    (nodes: readonly ContainerNode[], expanded: boolean) => {
      if (!nodes.length) return
      if (filtering)
        setFilterCollapsed((prev) => {
          const next = new Set(prev)
          for (const n of nodes) {
            if (expanded) next.delete(n.key)
            else next.add(n.key)
          }
          return next
        })
      else setToggled((prev) => withExpanded(prev, nodes, expanded))
    },
    [filtering]
  )

  const toggleContainer = useCallback(
    (node: ContainerNode) => {
      if (filtering) setFilterCollapsed((prev) => toggleIn(prev, node.key))
      else setToggled((prev) => toggleIn(prev, node.key))
    },
    [filtering]
  )

  // ── Virtualisation (with a sticky section header) ────────────────────────

  const stickyIndexes = useMemo(() => {
    const out: number[] = []
    rows.forEach((r, i) => r.kind === 'section' && out.push(i))
    return out
  }, [rows])
  const activeSticky = useRef(-1)
  const rangeExtractor = useCallback(
    (range: Range) => {
      let active = -1
      for (const i of stickyIndexes) {
        if (i <= range.startIndex) active = i
        else break
      }
      activeSticky.current = active
      const base = defaultRangeExtractor(range)
      if (active < 0 || base.includes(active)) return base
      return [active, ...base]
    },
    [stickyIndexes]
  )
  const getItemKey = useCallback((i: number) => rows[i]?.key ?? i, [rows])
  const estimateSize = useCallback((i: number) => (rows[i]?.kind === 'section' ? SECTION_H : ROW_H), [rows])
  // Row offsets (sizes are fixed) so the sticky header can be pushed up by the next one.
  const rowStarts = useMemo(() => {
    const out = new Float64Array(rows.length)
    let y = 0
    rows.forEach((r, i) => {
      out[i] = y
      y += r.kind === 'section' ? SECTION_H : ROW_H
    })
    return out
  }, [rows])

  // The next section header pushes the sticky one out instead of sliding under it. Updated on
  // every scroll event through a CSS variable (the virtualizer only re-renders when the range changes).
  const stickyNextStart = useRef<number | null>(null)
  const applyStickyTop = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = stickyNextStart.current
    const top = next === null ? 0 : Math.min(0, next - el.scrollTop - SECTION_H)
    el.style.setProperty('--sb-sticky-top', `${top}px`)
    el.toggleAttribute('data-scrolled', el.scrollTop > 0)
  }, [])
  useLayoutEffect(applyStickyTop)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    rangeExtractor,
    overscan: 16,
    // Render a first screenful before the scroll element is measured.
    initialRect: { width: 260, height: 800 },
    scrollPaddingStart: SECTION_H,
    scrollPaddingEnd: 4
  })

  // A new filter starts at the top of the results; clearing it brings the cursor row back into view.
  const prevQ = useRef(q)
  useEffect(() => {
    if (prevQ.current === q) return
    const cleared = !q && !!prevQ.current
    prevQ.current = q
    const idx = cleared && cursorKey !== null ? indexByKey.get(cursorKey) : undefined
    if (idx !== undefined) virtualizer.scrollToIndex(idx, { align: 'center' })
    else if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [q, cursorKey, indexByKey, virtualizer])

  const moveCursor = useCallback(
    (idx: number) => {
      const row = rows[idx]
      if (!row) return
      setCursorKey(row.key)
      virtualizer.scrollToIndex(idx, { align: 'auto' })
    },
    [rows, virtualizer]
  )

  // ── Actions on rows ──────────────────────────────────────────────────────

  const menuCtx = (): SidebarMenuCtx | null =>
    refs ? { repo, refs, remotes, hidden, soloRef: tab.soloRef } : null

  const containerState = (nodes: readonly ContainerNode[], refList: Ref[]): ContainerMenuState => ({
    refs: refList,
    canExpandAll: nodes.length > 0,
    expandAll: () => setContainersExpanded(nodes, true),
    collapseAll: () => setContainersExpanded(nodes, false)
  })

  const menuFor = (row: Row): MenuItem[] => {
    const ctx = menuCtx()
    if (!ctx) return []
    switch (row.kind) {
      case 'section': {
        const section = sections?.find((s) => s.id === row.id)
        if (!section) return []
        return sectionMenu(ctx, row.id, containerState(collectContainers(section.children), refsBelow(section)))
      }
      case 'folder': {
        const node = row.node
        return folderMenu(ctx, node.path, row.expanded, () => toggleContainer(node), containerState(collectContainers(node.children), refsBelow(node)))
      }
      case 'remote':
        return remoteMenu(ctx, { name: row.node.name, url: row.node.url, refs: refsBelow(row.node) }, { fetching: remoteBusy(row.node.name) })
      case 'ref': {
        const ref = row.node.ref
        if (ref.type === 'branch') return localBranchMenu(ctx, ref)
        if (ref.type === 'remote') return remoteBranchMenu(ctx, ref)
        return tagMenu(ctx, ref)
      }
      case 'head':
        return headMenu(ctx, row.node.sha)
      case 'stash':
        return stashMenu(ctx, row.node.stash)
      case 'submodule':
        return submoduleMenu(ctx, row.node.submodule)
      default:
        return []
    }
  }

  /** Single click / Space: select (leaves) or toggle (containers). */
  const selectRow = (row: Row) => {
    switch (row.kind) {
      case 'section':
        toggleSection(row.id)
        break
      case 'folder':
      case 'remote':
        toggleContainer(row.node)
        break
      case 'ref':
        setSelectedKey(row.key)
        selectRef(repo, row.node.ref)
        break
      case 'head':
        if (row.node.sha) {
          setSelectedKey(row.key)
          selectCommit(repo, row.node.sha)
        }
        break
      case 'stash':
        setSelectedKey(row.key)
        selectStash(repo, row.node.stash)
        break
    }
  }

  /** Double click / Enter: checkout (refs), apply (stash), open (submodule), toggle (containers). */
  const activateRow = (row: Row) => {
    switch (row.kind) {
      case 'ref': {
        const ref = row.node.ref
        if (ref.type === 'branch' && ref.isHead) return
        const key = row.key
        setPendingKey(key)
        void git.checkoutRef(repo, ref).finally(() => setPendingKey((k) => (k === key ? null : k)))
        break
      }
      case 'stash':
        void git.applyStash(repo, row.node.stash.index)
        break
      case 'submodule':
        if (row.node.submodule.status !== 'uninitialized') void openSubmodule(repo, row.node.submodule.path)
        break
      case 'section':
        toggleSection(row.id)
        break
      case 'folder':
      case 'remote':
        toggleContainer(row.node)
        break
    }
  }

  const toggleRowHidden = (row: Row) => {
    if (row.kind === 'ref') {
      useApp.getState().setRefHidden(repo, row.node.ref.fullName, !hidden.has(row.node.ref.fullName))
    } else if (row.kind === 'folder' || row.kind === 'remote') {
      const list = refsBelow(row.node)
      setRefsHidden(
        repo,
        list.map((r) => r.fullName),
        containerHidden(row.node) !== 'all'
      )
    }
  }

  const sectionAdd = (id: SectionId) => {
    const headSha = refs?.head.sha ?? null
    if (id === 'local') void git.createBranch(repo)
    else if (id === 'remote') useApp.getState().openModal({ kind: 'remotes', repo })
    else if (id === 'tags' && headSha) void git.createTag(repo, headSha)
    else if (id === 'submodules') void updateSubmodules(repo)
  }

  const openMenuAtRow = (idx: number) => {
    const row = rows[idx]
    if (!row) return
    const items = menuFor(row)
    if (!items.length) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${idx}"]`)
    const r = el?.getBoundingClientRect()
    showContextMenu({ clientX: (r?.left ?? 0) + 28, clientY: r?.bottom ?? 0 }, items)
    setMenuKey(row.key)
  }

  // Stable handler object for memoised rows; reads the latest render's closures.
  const latest = useRef({ selectRow, activateRow, menuFor, toggleRowHidden, sectionAdd, repo })
  latest.current = { selectRow, activateRow, menuFor, toggleRowHidden, sectionAdd, repo }

  const handlers = useMemo<RowHandlers>(
    () => ({
      click(row, e) {
        setCursorKey(row.key)
        // The second click of a double-click must not re-toggle containers.
        if (e.detail > 1 && (row.kind === 'section' || row.kind === 'folder' || row.kind === 'remote')) return
        latest.current.selectRow(row)
      },
      doubleClick(row) {
        if (row.kind === 'section' || row.kind === 'folder' || row.kind === 'remote') return
        latest.current.activateRow(row)
      },
      contextMenu(row, e) {
        setCursorKey(row.key)
        const items = latest.current.menuFor(row)
        if (items.length) {
          showContextMenu(e, items)
          setMenuKey(row.key)
        } else e.preventDefault()
      },
      toggleHidden(row) {
        latest.current.toggleRowHidden(row)
      },
      unsolo(row) {
        if (row.kind === 'ref') toggleSolo(latest.current.repo, row.node.ref.fullName)
      },
      fetch(name) {
        void fetchRemote(latest.current.repo, name)
      },
      add(id) {
        latest.current.sectionAdd(id)
      },
      dragStart(row, e) {
        if (row.kind !== 'ref') return
        setRefDragData(e, row.node.ref)
        dragSource.current = row.key
        setDragKey(row.key)
      },
      dragEnd() {
        dragSource.current = null
        setDragKey(null)
        setDropKey(null)
      },
      dragOver(row, e) {
        if (row.kind !== 'ref' || !hasRefDragData(e)) return
        if (row.key === dragSource.current) {
          e.dataTransfer.dropEffect = 'none'
          return
        }
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropKey((prev) => (prev === row.key ? prev : row.key))
      },
      dragLeave(row, e) {
        const related = e.relatedTarget as Node | null
        if (related && e.currentTarget.contains(related)) return
        setDropKey((prev) => (prev === row.key ? null : prev))
      },
      drop(row, e) {
        if (row.kind !== 'ref') return
        e.preventDefault()
        setDropKey(null)
        setDragKey(null)
        const source = getRefDragData(e)
        const target = toDragged(row.node.ref)
        if (!source || source.fullName === target.fullName) return
        git.handleRefDrop(latest.current.repo, source, target, { clientX: e.clientX, clientY: e.clientY })
      }
    }),
    []
  )

  // Keep the row highlighted while its context menu is open (the menu is portaled into <body>).
  useEffect(() => {
    if (menuKey === null) return
    let raf = 0
    const check = () => {
      if (!document.querySelector('body > .ui-menu')) setMenuKey(null)
    }
    // The menu mounts after this effect on the same tick; start observing once it exists.
    raf = requestAnimationFrame(check)
    const obs = new MutationObserver(check)
    obs.observe(document.body, { childList: true })
    // Another context menu (e.g. in the graph) replaces ours without unmounting it.
    const other = () => setMenuKey(null)
    window.addEventListener('contextmenu', other, true)
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
      window.removeEventListener('contextmenu', other, true)
    }
  }, [menuKey])

  // Clear drop highlight when a drag that started elsewhere (e.g. the graph) ends.
  useEffect(() => {
    const clear = () => {
      dragSource.current = null
      setDropKey(null)
      setDragKey(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  // ⌥⌘F focuses the filter while the panel is mounted (i.e. visible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e) || !e.altKey || e.shiftKey) return
      if (e.code !== 'KeyF' && e.key.toLowerCase() !== 'f') return
      if (document.querySelector('.ui-backdrop')) return
      e.preventDefault()
      e.stopPropagation()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    // Lets a command (palette / menu) focus the filter: window.dispatchEvent(new Event(FOCUS_FILTER_EVENT)).
    const onFocusRequest = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(FOCUS_FILTER_EVENT, onFocusRequest)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(FOCUS_FILTER_EVENT, onFocusRequest)
    }
  }, [])

  // ── Keyboard ─────────────────────────────────────────────────────────────

  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(e.target) || (!rows.length && e.key !== 'Escape')) return
    const row = cursorIndex >= 0 ? rows[cursorIndex] : undefined
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 240) / ROW_H) - 1)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveCursor(stepIndex(rows, cursorIndex, 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        moveCursor(stepIndex(rows, cursorIndex, -1))
        return
      case 'PageDown':
        e.preventDefault()
        moveCursor(stepIndex(rows, cursorIndex, 1, page))
        return
      case 'PageUp':
        e.preventDefault()
        moveCursor(stepIndex(rows, cursorIndex, -1, page))
        return
      case 'Home':
        e.preventDefault()
        moveCursor(firstNavigable(rows))
        return
      case 'End':
        e.preventDefault()
        moveCursor(lastNavigable(rows))
        return
      case 'ArrowRight':
        if (!row) return
        e.preventDefault()
        if (row.kind === 'section' || row.kind === 'folder' || row.kind === 'remote') {
          if (!row.expanded) {
            if (row.kind === 'section') setSectionExpanded(row.id, true)
            else setContainersExpanded([row.node], true)
          } else moveCursor(stepIndex(rows, cursorIndex, 1))
        }
        return
      case 'ArrowLeft': {
        if (!row) return
        e.preventDefault()
        if ((row.kind === 'section' || row.kind === 'folder' || row.kind === 'remote') && row.expanded) {
          if (row.kind === 'section') setSectionExpanded(row.id, false)
          else setContainersExpanded([row.node], false)
        } else {
          const p = parentIndex(rows, cursorIndex)
          if (p >= 0) moveCursor(p)
        }
        return
      }
      case 'Enter':
        if (!row) return
        e.preventDefault()
        activateRow(row)
        return
      case ' ':
        if (!row) return
        e.preventDefault()
        selectRow(row)
        return
      case 'ContextMenu':
        e.preventDefault()
        openMenuAtRow(cursorIndex)
        return
      case 'F10':
        if (e.shiftKey) {
          e.preventDefault()
          openMenuAtRow(cursorIndex)
        }
        return
      case 'Escape':
        if (filter) {
          e.preventDefault()
          setFilter('')
          setFilterCollapsed(new Set())
        }
        return
      default:
        // Type-ahead: printable characters start filtering.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.trim()) {
          e.preventDefault()
          setFilter((f) => f + e.key)
          setFilterCollapsed(new Set())
          inputRef.current?.focus()
        }
    }
  }

  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (filter) {
        setFilter('')
        setFilterCollapsed(new Set())
      } else scrollRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      scrollRef.current?.focus()
      const idx = firstLeafIndex(rows)
      moveCursor(idx >= 0 ? idx : firstNavigable(rows))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const idx = firstLeafIndex(rows)
      if (idx < 0) return
      scrollRef.current?.focus()
      moveCursor(idx)
      selectRow(rows[idx])
    }
  }

  const onTreeDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Auto-scroll near the edges while dragging a ref.
    if (!hasRefDragData(e)) return
    const el = scrollRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (e.clientY < r.top + SECTION_H + 16) el.scrollTop -= 14
    else if (e.clientY > r.bottom - 24) el.scrollTop += 14
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const headUnborn = !refs?.head.sha
  const soloMode = !!tab.soloRef

  let body: ReactNode
  if (!refs) {
    body =
      tab.error && !tab.loading.refs ? (
        <div className="sb-state">
          <TriangleAlert size={22} className="sb-state-icon sb-state-error" />
          <div className="sb-state-title">Couldn’t load branches</div>
          <div className="sb-state-text">{tab.error}</div>
          <Button size="sm" onClick={() => void useApp.getState().refresh(repo)}>
            Retry
          </Button>
        </div>
      ) : (
        <Skeleton />
      )
  } else if (filtering && rows.length === 0) {
    body = (
      <div className="sb-state">
        <Search size={20} className="sb-state-icon" />
        <div className="sb-state-text">
          Nothing matches “<span className="sb-state-q">{query.trim()}</span>”
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setFilter('')
            setFilterCollapsed(new Set())
            inputRef.current?.focus()
          }}
        >
          Clear filter
        </Button>
      </div>
    )
  } else {
    const items = virtualizer.getVirtualItems()
    const sticky = activeSticky.current
    const next = sticky >= 0 ? stickyIndexes.find((i) => i > sticky) : undefined
    stickyNextStart.current = next !== undefined ? rowStarts[next] : null
    body = (
      <div className="sb-inner" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((vi) => {
          const row = rows[vi.index]
          if (!row) return null
          const isSticky = vi.index === sticky && row.kind === 'section'
          let hiddenState: HiddenState = 'none'
          let solo = false
          let busy = false
          if (row.kind === 'ref') {
            hiddenState = hidden.has(row.node.ref.fullName) ? 'all' : 'none'
            solo = tab.soloRef === row.node.ref.fullName
          } else if (row.kind === 'folder' || row.kind === 'remote') {
            hiddenState = containerHidden(row.node)
            if (row.kind === 'remote') busy = remoteBusy(row.node.name)
          } else if (row.kind === 'section' && row.id === 'submodules') busy = submodulesBusy
          return (
            <RowView
              key={vi.key}
              row={row}
              index={vi.index}
              top={vi.start}
              height={vi.size}
              sticky={isSticky}
              menuOpen={menuKey === row.key}
              selected={activeKey === row.key}
              cursor={cursorKey === row.key}
              drop={dropKey === row.key}
              dragging={dragKey === row.key}
              pending={pendingKey === row.key}
              hidden={hiddenState}
              solo={solo}
              busy={busy}
              addDisabled={row.kind === 'section' && (row.id === 'tags' || row.id === 'local') && headUnborn}
              refs={refs}
              q={q}
              h={handlers}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="sb-panel">
      <div className="sb-filter">
        <div className="sb-filter-box">
          <Search size={13} className="sb-filter-icon" />
          <input
            ref={inputRef}
            className="sb-filter-input"
            value={filter}
            placeholder={FILTER_PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            aria-label="Filter branches, tags and stashes"
            onChange={(e) => {
              setFilter(e.target.value)
              setFilterCollapsed(new Set())
            }}
            onKeyDown={onFilterKeyDown}
          />
          {filter && (
            <button
              type="button"
              className="sb-filter-clear"
              title="Clear filter (Esc)"
              aria-label="Clear filter"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setFilter('')
                setFilterCollapsed(new Set())
                inputRef.current?.focus()
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        className={`sb-tree${focused ? ' sb-focused' : ''}${soloMode ? ' sb-solo-mode' : ''}`}
        tabIndex={0}
        role="tree"
        aria-label="Branches, remotes, tags and stashes"
        onKeyDown={onTreeKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
        }}
        onDragOver={onTreeDragOver}
        onScroll={applyStickyTop}
      >
        {body}
      </div>
    </div>
  )
}
