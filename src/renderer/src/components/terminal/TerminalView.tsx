// The terminals of one owner (a repository's tab, or a tab group): a strip with its terminal tabs and the split
// controls, and under it the panes of the tab in front, each one a terminal. Used on its own (the Terminal view),
// docked under the graph (Both) and as a tab group's view.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Columns2, Ellipsis, Maximize2, Minimize2, Plus, Rows2, Search, SquareTerminal, X } from 'lucide-react'
import { showContextMenu, showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { prompt } from '@renderer/components/common/dialogs'
import { isMac } from '@renderer/api/client'
import { useApp } from '@renderer/store/appStore'
import { SHELL_LAUNCHER, STATE_LABEL, type AgentRunState, type TerminalInfo } from '@shared/terminal'
import { panesOf, type PaneTree, type SplitPath } from './layout'
import { labelText, shortFolder, tabLabels, terminalLabel, type TabLabel } from './model'
import { StateDot } from './parts'
import {
  clearTerminal,
  closeTerminal,
  closeTermTab,
  copySelection,
  equalizeSplits,
  FIND_EVENT,
  fitTerminal,
  focusTerminal,
  mountTerminal,
  openTerminal,
  pasteInto,
  renameTermTab,
  searchOf,
  selectTermTab,
  setOwnerFolder,
  setSplitRatio,
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
        <div className="tm-tabs" role="tablist" aria-label="Terminals">
          {ws.tabs.map((t, i) => (
            <TabButton key={t.id} owner={owner} tab={t} label={labels[i]} active={t.id === tab?.id} infos={infos} />
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

async function renameTab(owner: string, tab: TermTab, label: TabLabel): Promise<void> {
  const name = await prompt({ title: 'Rename terminal tab', label: 'Name', defaultValue: tab.name || label.text, confirmLabel: 'Rename' })
  if (name !== null) renameTermTab(owner, tab.id, name)
}

function TabButton({ owner, tab, label, active, infos }: { owner: string; tab: TermTab; label: TabLabel; active: boolean; infos: Record<string, TerminalInfo> }) {
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
    <div className={`tm-tab${active ? ' tm-tab-active' : ''}`}>
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
      className={`tm-pane${focused ? ' tm-pane-focused' : ''}${hasKeyboard ? ' tm-pane-keyboard' : ''}${dim && !focused && !only ? ' tm-pane-dim' : ''}`}
      aria-label={`Terminal: ${terminalLabel(info)}`}
      onMouseDownCapture={() => !hasKeyboard && focusTerminal(id)}
      onContextMenu={menu}
    >
      <header className="tm-pane-head">
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
