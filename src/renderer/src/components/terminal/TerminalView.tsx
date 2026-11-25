// The terminals of one owner (a repository's tab, or a tab group): a strip with its terminal tabs and the split
// controls, and under it the panes of the tab in front, each one a terminal. Used on its own (the Terminal view),
// docked under the graph (Both) and as a tab group's view. A tab is dragged along the strip to another place, and
// a pane by its header onto a side of another pane of its tab. Files dropped on a pane type their paths there.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Columns2, Ellipsis, Maximize2, Minimize2, Plus, Rows2, Search, SquareTerminal, X } from 'lucide-react'
import { showContextMenu, showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { prompt } from '@renderer/components/common/dialogs'
import { isMac } from '@renderer/api/client'
import { useApp } from '@renderer/store/appStore'
import { SHELL_LAUNCHER, STATE_LABEL, type AgentRunState, type TerminalInfo } from '@shared/terminal'
import { hasPane, neighbour, panesOf, sideAt, type Direction, type PaneTree, type SplitPath } from './layout'
import { labelText, shortFolder, tabLabels, terminalLabel, type TabLabel } from './model'
import { StateDot } from './parts'
import {
  clearTerminal,
  closeTerminal,
  closeTermTab,
  copySelection,
  dropFiles,
  equalizeSplits,
  FIND_EVENT,
  fitTerminal,
  focusTerminal,
  mountTerminal,
  movePaneTo,
  movePaneToward,
  moveTermTab,
  openTerminal,
  pasteInto,
  renameTermTab,
  searchOf,
  selectTermTab,
  setOwnerFolder,
  setSplitRatio,
  stepTermTabPlace,
  termOf,
  toggleZoom,
  useTerminals,
  type TermTab,
  type Workspace
} from './terminalStore'
import './terminal.css'

/** "⌘D" on macOS, "Ctrl+Shift+D" elsewhere (Ctrl alone belongs to the shell). */
export function termShortcut(key: string, opts: { shift?: boolean; alt?: boolean; ctrl?: boolean } = {}): string {
  if (isMac) return `${opts.ctrl ? '⌃' : ''}${opts.alt ? '⌥' : ''}${opts.shift ? '⇧' : ''}⌘${key}`
  return `Ctrl+Shift+${opts.alt ? 'Alt+' : ''}${key}`
}

const EMPTY: Workspace = { tabs: [], active: '' }
/** A terminal tab dragged along its strip, and a pane dragged by its header: what the drag carries is its id. */
const TAB_MIME = 'application/x-adar-term-tab'
const PANE_MIME = 'application/x-adar-term-pane'
/** What is being dragged: a drag's data cannot be read until it is dropped, only its kind. */
let dragged: { kind: 'tab' | 'pane'; id: string; owner: string } | null = null
const drags = (e: React.DragEvent, kind: 'tab' | 'pane', owner: string): boolean =>
  dragged?.kind === kind && dragged.owner === owner && Array.from(e.dataTransfer.types).includes(kind === 'tab' ? TAB_MIME : PANE_MIME)
/** A drag that carries files (from the Finder, the desktop, another app). */
const carriesFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')
const SIDE_NAME: Record<Direction, string> = { left: 'Left', right: 'Right', up: 'Up', down: 'Down' }
const SIDES: readonly Direction[] = ['left', 'right', 'up', 'down']
/** Owners whose first terminal was already started for them (closing every one leaves the empty view). */
const started = new Set<string>()

function launcherItems(owner: string, cwd: string, split?: 'row' | 'column'): MenuItem[] {
  const launchers = useApp.getState().settings.terminalLaunchers
  return [
    { label: 'Shell', icon: <SquareTerminal size={14} />, shortcut: split ? undefined : termShortcut('T'), onClick: () => void openTerminal(owner, cwd, { launcher: SHELL_LAUNCHER, split }) },
    ...launchers.map((l): MenuItem => ({ label: l.name, onClick: () => void openTerminal(owner, cwd, { launcher: l.id, split }) }))
  ]
}

export function TerminalWorkspace({ owner, cwd }: { owner: string; cwd: string }) {
  const ws = useTerminals((s) => s.workspaces[owner]) ?? EMPTY
  const infos = useTerminals((s) => s.infos)
  const ready = useTerminals((s) => s.ready)
  const [finding, setFinding] = useState(false)
  const tab = ws.tabs.find((t) => t.id === ws.active) ?? ws.tabs[0]
  const labels = tabLabels(
    ws.tabs.map((t) => ({ name: t.name, info: infos[t.focused] })),
    cwd
  )
  /** The tab a dragged one would land beside, and on which side. */
  const [tabDrop, setTabDrop] = useState<{ id: string; after: boolean } | null>(null)
  const overTab = useCallback((id: string, after: boolean | null) => {
    setTabDrop((d) => (after === null ? (d?.id === id ? null : d) : d && d.id === id && d.after === after ? d : { id, after }))
  }, [])
  // Past the last tab, on the strip itself: the end.
  const overStrip = (e: React.DragEvent) => {
    const last = ws.tabs.at(-1)
    if (!last || !drags(e, 'tab', owner) || (e.target as HTMLElement).closest('.tm-tab')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    overTab(last.id, true)
  }
  const dropOnStrip = (e: React.DragEvent) => {
    if (!drags(e, 'tab', owner) || (e.target as HTMLElement).closest('.tm-tab')) return
    e.preventDefault()
    const id = e.dataTransfer.getData(TAB_MIME) || dragged?.id
    setTabDrop(null)
    if (id) moveTermTab(owner, id, null)
  }

  useEffect(() => setOwnerFolder(owner, cwd), [owner, cwd])

  // The first time a view of terminals is shown, one is there.
  useEffect(() => {
    if (!ready || ws.tabs.length || started.has(owner)) return
    started.add(owner)
    void openTerminal(owner, cwd)
  }, [ready, owner, cwd, ws.tabs.length])
  useEffect(() => {
    if (ws.tabs.length) started.add(owner)
  }, [owner, ws.tabs.length])

  useEffect(() => {
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail === owner) setFinding(true)
    }
    window.addEventListener(FIND_EVENT, open)
    return () => window.removeEventListener(FIND_EVENT, open)
  }, [owner])

  const panes = tab ? panesOf(tab.tree) : []
  const closeFind = useCallback(() => {
    setFinding(false)
    if (tab) {
      searchOf(tab.focused)?.clearDecorations()
      focusTerminal(tab.focused)
    }
  }, [tab])

  const more = (el: HTMLElement) => {
    if (!tab) return
    showMenuBelow(el, [
      { label: 'Find…', shortcut: termShortcut('F'), onClick: () => setFinding(true) },
      { label: 'Clear', shortcut: termShortcut('K'), onClick: () => clearTerminal(tab.focused) },
      { type: 'separator' },
      { label: 'Equalize Splits', shortcut: isMac ? '⌃⌘=' : undefined, disabled: panes.length < 2, onClick: () => equalizeSplits(owner) },
      { label: 'Rename Tab…', onClick: () => void renameTab(owner, tab, labels[ws.tabs.indexOf(tab)]) },
      { type: 'separator' },
      { label: 'Close Tab', danger: true, onClick: () => void closeTermTab(owner, tab.id) }
    ])
  }

  return (
    <div className="tm-root">
      <div className="tm-strip">
        <div className="tm-tabs" role="tablist" aria-label="Terminals" onDragOver={overStrip} onDrop={dropOnStrip}>
          {ws.tabs.map((t, i) => (
            <TabButton
              key={t.id}
              owner={owner}
              tab={t}
              label={labels[i]}
              active={t.id === tab?.id}
              infos={infos}
              place={i === 0 ? (ws.tabs.length === 1 ? 'only' : 'first') : i === ws.tabs.length - 1 ? 'last' : 'middle'}
              next={ws.tabs[i + 1]?.id ?? null}
              drop={tabDrop?.id === t.id ? (tabDrop.after ? 'after' : 'before') : null}
              onOver={overTab}
            />
          ))}
          <button className="tm-add" title="New terminal" aria-label="New terminal: shell, or one of the launchers" onClick={(e) => showMenuBelow(e.currentTarget, launcherItems(owner, cwd))}>
            <Plus size={14} />
            <ChevronDown size={11} />
          </button>
        </div>
        <div className="tm-tools">
          <button className="tm-tool" title={`Split right (${termShortcut('D')})`} aria-label="Split right" disabled={!tab} onClick={() => void openTerminal(owner, cwd, { split: 'row' })}>
            <Columns2 size={15} />
          </button>
          <button className="tm-tool" title={`Split down (${termShortcut('D', { shift: true })})`} aria-label="Split down" disabled={!tab} onClick={() => void openTerminal(owner, cwd, { split: 'column' })}>
            <Rows2 size={15} />
          </button>
          <button
            className="tm-tool"
            title={`${tab?.zoomed ? 'Show every pane' : 'Zoom the focused pane'} (${termShortcut('↩', { shift: true })})`}
            aria-label="Zoom the focused pane"
            aria-pressed={!!tab?.zoomed}
            disabled={panes.length < 2}
            onClick={() => toggleZoom(owner)}
          >
            {tab?.zoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button className="tm-tool" title={`Find (${termShortcut('F')})`} aria-label="Find in the terminal" aria-pressed={finding} disabled={!tab} onClick={() => (finding ? closeFind() : setFinding(true))}>
            <Search size={14} />
          </button>
          <button className="tm-tool" title="More" aria-label="More terminal actions" disabled={!tab} onClick={(e) => more(e.currentTarget)}>
            <Ellipsis size={15} />
          </button>
        </div>
      </div>
      <div className="tm-body">
        {tab ? (
          tab.zoomed ? (
            <Pane key={tab.focused} owner={owner} cwd={cwd} tab={tab} id={tab.focused} only />
          ) : (
            <Tree owner={owner} cwd={cwd} tab={tab} node={tab.tree} at={[]} only={panes.length === 1} />
          )
        ) : (
          <div className="tm-empty">
            <SquareTerminal size={28} />
            <div className="tm-empty-title">No terminal open here</div>
            <div className="tm-empty-actions">
              {launcherItems(owner, cwd).map((item) =>
                item.type === undefined || item.type === 'item' ? (
                  <button key={item.label} className="tm-empty-button" onClick={() => void item.onClick?.()}>
                    {item.label}
                  </button>
                ) : null
              )}
            </div>
          </div>
        )}
        {finding && tab && <FindBar id={tab.focused} onClose={closeFind} />}
      </div>
    </div>
  )
}

/** Is the pointer of a drag over the second half of the element it is on? */
const after = (e: React.DragEvent): boolean => {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientX > r.left + r.width / 2
}

/** The side of the element a drag's pointer is nearest to. */
const sideOf = (e: React.DragEvent): Direction => {
  const r = e.currentTarget.getBoundingClientRect()
  return sideAt((e.clientX - r.left) / (r.width || 1), (e.clientY - r.top) / (r.height || 1))
}

async function renameTab(owner: string, tab: TermTab, label: TabLabel): Promise<void> {
  const name = await prompt({ title: 'Rename terminal tab', label: 'Name', defaultValue: tab.name || label.text, confirmLabel: 'Rename' })
  if (name !== null) renameTermTab(owner, tab.id, name)
}

interface TabButtonProps {
  owner: string
  tab: TermTab
  label: TabLabel
  active: boolean
  infos: Record<string, TerminalInfo>
  /** Where it is on the strip, for Move Tab Left / Right. */
  place: 'only' | 'first' | 'middle' | 'last'
  /** The tab after it, if any. */
  next: string | null
  /** A dragged tab would land on this side of it. */
  drop: 'before' | 'after' | null
  onOver: (id: string, after: boolean | null) => void
}

function TabButton({ owner, tab, label, active, infos, place, next, drop, onOver }: TabButtonProps) {
  const ids = panesOf(tab.tree)
  // A tab says what its most urgent pane says.
  const state = ids.reduce<AgentRunState | null>((top, id) => {
    const s = infos[id]?.state ?? null
    const rank = (x: AgentRunState | null) => (x === 'needs-you' ? 3 : x === 'finished' ? 2 : x === 'working' ? 1 : 0)
    return rank(s) > rank(top) ? s : top
  }, null)
  const full = labelText(label)
  const folder = infos[tab.focused]?.cwd
  return (
    <div
      className={`tm-tab${active ? ' tm-tab-active' : ''}${drop ? ` tm-tab-drop-${drop}` : ''}`}
      draggable
      onDragStart={(e) => {
        dragged = { kind: 'tab', id: tab.id, owner }
        e.dataTransfer.setData(TAB_MIME, tab.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!drags(e, 'tab', owner)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        // Its own place is no move: no line there.
        onOver(tab.id, dragged?.id === tab.id ? null : after(e))
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && onOver(tab.id, null)}
      onDrop={(e) => {
        if (!drags(e, 'tab', owner)) return
        e.preventDefault()
        const id = e.dataTransfer.getData(TAB_MIME) || dragged?.id
        onOver(tab.id, null)
        if (id && id !== tab.id) moveTermTab(owner, id, after(e) ? next : tab.id)
      }}
      onDragEnd={() => {
        dragged = null
        onOver(tab.id, null)
      }}
    >
      <button
        className="tm-tab-main"
        role="tab"
        aria-selected={active}
        title={folder ? `${full} — ${shortFolder(folder)}` : full}
        onClick={() => selectTermTab(owner, tab.id)}
        onDoubleClick={() => void renameTab(owner, tab, label)}
        onAuxClick={(e) => e.button === 1 && void closeTermTab(owner, tab.id)}
        onContextMenu={(e) =>
          showContextMenu(e, [
            { label: 'Rename Tab…', onClick: () => void renameTab(owner, tab, label) },
            { label: 'Move Tab Left', disabled: place === 'only' || place === 'first', onClick: () => stepTermTabPlace(owner, tab.id, -1) },
            { label: 'Move Tab Right', disabled: place === 'only' || place === 'last', onClick: () => stepTermTabPlace(owner, tab.id, 1) },
            { type: 'separator' },
            { label: 'Close Tab', danger: true, onClick: () => void closeTermTab(owner, tab.id) }
          ])
        }
      >
        {state && <StateDot state={state} />}
        <span className="tm-tab-name">{label.text}</span>
        {label.detail && <span className="tm-tab-task">{label.detail}</span>}
        {ids.length > 1 && <span className="tm-tab-count">{ids.length} panes</span>}
      </button>
      <button className="tm-tab-close" title="Close tab" aria-label={`Close ${full}`} onClick={() => void closeTermTab(owner, tab.id)}>
        <X size={12} />
      </button>
    </div>
  )
}

function Tree({ owner, cwd, tab, node, at, only }: { owner: string; cwd: string; tab: TermTab; node: PaneTree; at: SplitPath; only: boolean }) {
  if (node.kind === 'pane') return <Pane key={node.id} owner={owner} cwd={cwd} tab={tab} id={node.id} only={only} />
  return (
    <div className={`tm-split tm-split-${node.dir}`}>
      <div className="tm-side" style={{ flex: `${node.ratio} 1 0` }}>
        <Tree owner={owner} cwd={cwd} tab={tab} node={node.a} at={[...at, 0]} only={false} />
      </div>
      <Divider owner={owner} tabId={tab.id} dir={node.dir} at={at} />
      <div className="tm-side" style={{ flex: `${1 - node.ratio} 1 0` }}>
        <Tree owner={owner} cwd={cwd} tab={tab} node={node.b} at={[...at, 1]} only={false} />
      </div>
    </div>
  )
}

function Divider({ owner, tabId, dir, at }: { owner: string; tabId: string; dir: 'row' | 'column'; at: SplitPath }) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    const box = el.parentElement?.getBoundingClientRect()
    if (!box) return
    el.setPointerCapture(e.pointerId)
    el.classList.add('tm-divider-drag')
    document.body.classList.add('ui-resizing')
    const move = (ev: PointerEvent) => {
      const ratio = dir === 'row' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
      setSplitRatio(owner, tabId, at, ratio)
    }
    const up = () => {
      el.classList.remove('tm-divider-drag')
      document.body.classList.remove('ui-resizing')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  return <div className="tm-divider" role="separator" aria-orientation={dir === 'row' ? 'vertical' : 'horizontal'} onPointerDown={onPointerDown} onDoubleClick={() => equalizeSplits(owner)} />
}

function Pane({ owner, cwd, tab, id, only }: { owner: string; cwd: string; tab: TermTab; id: string; only: boolean }) {
  const info = useTerminals((s) => s.infos[id])
  const hasKeyboard = useTerminals((s) => s.focus === id)
  const dim = useApp((s) => s.settings.terminalDimUnfocused)
  const body = useRef<HTMLDivElement>(null)
  const focused = tab.focused === id
  /** Dragged by its header; and the side of it another pane of the tab would land on. */
  const [moving, setMoving] = useState(false)
  const [side, setSide] = useState<Direction | null>(null)
  /** Files are being dragged over it: dropped, their paths are typed here. */
  const [files, setFiles] = useState(false)
  const takes = (e: React.DragEvent) => drags(e, 'pane', owner) && dragged?.id !== id && hasPane(tab.tree, dragged?.id ?? '')
  // A drag that ends anywhere else leaves no mark here.
  useEffect(() => {
    if (!side && !files) return
    const clear = () => {
      setSide(null)
      setFiles(false)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [side, files])

  useEffect(() => {
    const el = body.current
    if (!el) return
    const off = mountTerminal(id, el)
    let frame = 0
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitTerminal(id))
    })
    watch.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
      off()
    }
  }, [id])

  const menu = (e: React.MouseEvent) => {
    focusTerminal(id)
    const selected = !!termOf(id)?.hasSelection()
    showContextMenu(e, [
      ...launcherItems(owner, cwd).map((i) => (i.type === undefined || i.type === 'item' ? { ...i, label: i.label === 'Shell' ? 'New Terminal' : `Run ${i.label}` } : i)),
      { type: 'separator' },
      { label: 'Split Right', shortcut: termShortcut('D'), onClick: () => void openTerminal(owner, cwd, { split: 'row' }) },
      { label: 'Split Down', shortcut: termShortcut('D', { shift: true }), onClick: () => void openTerminal(owner, cwd, { split: 'column' }) },
      { label: tab.zoomed ? 'Show Every Pane' : 'Zoom Pane', shortcut: termShortcut('↩', { shift: true }), disabled: only && !tab.zoomed, onClick: () => toggleZoom(owner) },
      { label: 'Equalize Splits', shortcut: isMac ? '⌃⌘=' : undefined, disabled: only, onClick: () => equalizeSplits(owner) },
      // Past the pane beside it, where there is one (dragging the header does the same, onto any pane).
      ...(only ? [] : SIDES.filter((d) => neighbour(tab.tree, id, d)).map((d): MenuItem => ({ label: `Move Pane ${SIDE_NAME[d]}`, onClick: () => movePaneToward(id, d) }))),
      { type: 'separator' },
      { label: 'Copy', shortcut: isMac ? '⌘C' : 'Ctrl+Shift+C', disabled: !selected, onClick: () => copySelection(id) },
      { label: 'Paste', shortcut: isMac ? '⌘V' : 'Ctrl+Shift+V', onClick: () => void pasteInto(id) },
      { label: 'Find…', shortcut: termShortcut('F'), onClick: () => window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: owner })) },
      { label: 'Clear', shortcut: termShortcut('K'), onClick: () => clearTerminal(id) },
      { type: 'separator' },
      { label: 'Close Pane', shortcut: termShortcut('W'), danger: true, onClick: () => void closeTerminal(id) }
    ])
  }

  const state = info?.state ?? null
  return (
    <section
      className={`tm-pane${focused ? ' tm-pane-focused' : ''}${hasKeyboard ? ' tm-pane-keyboard' : ''}${dim && !focused && !only ? ' tm-pane-dim' : ''}${moving ? ' tm-pane-moving' : ''}`}
      aria-label={`Terminal: ${terminalLabel(info)}`}
      onMouseDownCapture={() => !hasKeyboard && focusTerminal(id)}
      onContextMenu={menu}
      onDragOver={(e) => {
        if (carriesFiles(e)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          return setFiles(true)
        }
        if (!takes(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const to = sideOf(e)
        setSide((s) => (s === to ? s : to))
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setSide(null)
        setFiles(false)
      }}
      onDrop={(e) => {
        if (carriesFiles(e)) {
          e.preventDefault()
          setFiles(false)
          return dropFiles(id, Array.from(e.dataTransfer.files), cwd)
        }
        if (!takes(e)) return
        e.preventDefault()
        const from = e.dataTransfer.getData(PANE_MIME) || dragged?.id
        setSide(null)
        if (from) movePaneTo(from, id, sideOf(e))
      }}
    >
      <header
        className={`tm-pane-head${only ? '' : ' tm-pane-head-movable'}`}
        draggable={!only}
        onDragStart={(e) => {
          dragged = { kind: 'pane', id, owner }
          e.dataTransfer.setData(PANE_MIME, id)
          e.dataTransfer.effectAllowed = 'move'
          setMoving(true)
        }}
        onDragEnd={() => {
          dragged = null
          setMoving(false)
        }}
      >
        <span className="tm-pane-name">{terminalLabel(info)}</span>
        <span className="tm-pane-cwd" title={info?.cwd}>
          {info ? shortFolder(info.cwd) : ''}
        </span>
        {state && (
          <span className={`tm-pane-state tm-state-${state}`} title={info?.message || undefined}>
            {STATE_LABEL[state]}
          </span>
        )}
        <button className="tm-pane-close" title={`Close pane (${termShortcut('W')})`} aria-label="Close pane" onMouseDown={(e) => e.stopPropagation()} onClick={() => void closeTerminal(id)}>
          <X size={12} />
        </button>
      </header>
      <div className="tm-pane-body" ref={body} />
      {side && <div className={`tm-pane-drop tm-pane-drop-${side}`} aria-hidden="true" />}
      {files && (
        <div className="tm-pane-drop tm-pane-drop-files" aria-hidden="true">
          <span>Drop to type the path here</span>
        </div>
      )}
    </section>
  )
}

function FindBar({ id, onClose }: { id: string; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<boolean | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const find = (text: string, back = false, incremental = false) => {
    const search = searchOf(id)
    if (!search || !text) {
      search?.clearDecorations()
      return setFound(null)
    }
    const css = getComputedStyle(document.documentElement)
    const colour = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
    const options = {
      incremental,
      decorations: {
        matchBackground: colour('--term-match', '#3a4a2a'),
        matchOverviewRuler: colour('--term-match', '#3a4a2a'),
        activeMatchBackground: colour('--term-match-active', '#8a6400'),
        activeMatchColorOverviewRuler: colour('--term-match-active', '#8a6400')
      }
    }
    setFound(back ? search.findPrevious(text, options) : search.findNext(text, options))
  }

  return (
    <div className="tm-find" role="search">
      <Search size={13} />
      <input
        ref={input}
        className="tm-find-input"
        aria-label="Find in the terminal"
        placeholder="Find"
        value={query}
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          find(e.target.value, false, true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            find(query, e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
      />
      {found === false && <span className="tm-find-none">No results</span>}
      <button className="tm-tool" title="Close (Esc)" aria-label="Close find" onClick={onClose}>
        <X size={13} />
      </button>
    </div>
  )
}
