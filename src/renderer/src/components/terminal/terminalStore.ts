// Terminals, UI side. Each terminal the main process runs (src/main/terminal) is drawn by one xterm.js instance
// kept here for as long as the terminal lives: its element moves in and out of the page as tabs and views change,
// so nothing is lost when the graph is in front. The store holds what React draws: each owner's terminal tabs
// (a repository's, or a tab group's), their panes as a split tree, which pane has the keyboard, and what each
// terminal says it is doing. The layout survives a reload of the window (localStorage); the terminals themselves
// live in the main process.

import { useEffect } from 'react'
import { create } from 'zustand'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { AppSettings } from '@shared/types'
import { isGroupOwner, SHELL_LAUNCHER, type TerminalInfo } from '@shared/terminal'
import { api, isMac, onAdarEvent, terminalWindow } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { describeError } from '@shared/errors'
import { addCloseGuard, useApp } from '@renderer/store/appStore'
import {
  equalize,
  hasPane,
  moveBefore,
  movePane,
  neighbour,
  nudge,
  pane,
  panesOf,
  parseTree,
  removePane,
  setRatio,
  splitPane,
  stepPane,
  type Direction,
  type PaneTree,
  type SplitPath
} from './layout'
import { noticeFor, shouldNotify } from './model'

export interface TermTab {
  id: string
  tree: PaneTree
  /** The pane that takes the keyboard when the tab is in front. */
  focused: string
  /** Only the focused pane is drawn, over the whole tab. */
  zoomed: boolean
  /** A name the user gave it ('' = the name of what runs in it). */
  name: string
}

export interface Workspace {
  tabs: TermTab[]
  /** The tab in front ('' when there is none). */
  active: string
}

interface TerminalsState {
  /** Every running terminal, by id. */
  infos: Record<string, TerminalInfo>
  /** Terminal tabs by owner: a repository's path, or `group:<id>`. */
  workspaces: Record<string, Workspace>
  /** The terminal with the keyboard, when one has it. */
  focus: string | null
  /** The list of running terminals was read (after a reload): the stored layout is in. */
  ready: boolean
}

export const useTerminals = create<TerminalsState>()(() => ({ infos: {}, workspaces: {}, focus: null, ready: false }))

const EMPTY: Workspace = { tabs: [], active: '' }

export function workspaceOf(owner: string): Workspace {
  return useTerminals.getState().workspaces[owner] ?? EMPTY
}

const activeTab = (ws: Workspace): TermTab | undefined => ws.tabs.find((t) => t.id === ws.active) ?? ws.tabs[0]

/** Where a terminal is drawn: its owner and tab. */
export function locate(id: string): { owner: string; tab: TermTab } | null {
  for (const [owner, ws] of Object.entries(useTerminals.getState().workspaces)) {
    const tab = ws.tabs.find((t) => hasPane(t.tree, id))
    if (tab) return { owner, tab }
  }
  return null
}

// ── Layout changes ─────────────────────────────────────────────────────────

const STORE_KEY = 'adar.terminals.v1'
let tabSeq = 0
const newTabId = () => `tab${++tabSeq}-${Date.now().toString(36)}`

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(useTerminals.getState().workspaces))
  } catch {
    // Storage is full or blocked: the layout is rebuilt as one tab per terminal next time.
  }
}

function setWorkspace(owner: string, change: (ws: Workspace) => Workspace): void {
  useTerminals.setState((s) => {
    const cur = s.workspaces[owner] ?? EMPTY
    const next = change(cur)
    if (next === cur) return s
    const workspaces = { ...s.workspaces }
    if (next.tabs.length) workspaces[owner] = next
    else delete workspaces[owner]
    return { workspaces }
  })
  save()
}

function changeTab(owner: string, tabId: string, change: (t: TermTab) => TermTab): void {
  setWorkspace(owner, (ws) => {
    let changed = false
    const tabs = ws.tabs.map((t) => {
      if (t.id !== tabId) return t
      const next = change(t)
      if (next !== t) changed = true
      return next
    })
    return changed ? { ...ws, tabs } : ws
  })
}

/** Take a terminal out of the layout (it was closed or its shell ended). */
function dropPane(id: string): void {
  const at = locate(id)
  if (!at) return
  setWorkspace(at.owner, (ws) => {
    const tabs: TermTab[] = []
    for (const t of ws.tabs) {
      if (t.id !== at.tab.id) {
        tabs.push(t)
        continue
      }
      const tree = removePane(t.tree, id)
      if (!tree) continue
      const focused = t.focused === id ? stepWithin(t.tree, id) : t.focused
      tabs.push({ ...t, tree, focused: hasPane(tree, focused) ? focused : panesOf(tree)[0], zoomed: t.zoomed && t.focused !== id })
    }
    const i = ws.tabs.findIndex((t) => t.id === at.tab.id)
    const active = tabs.some((t) => t.id === ws.active) ? ws.active : (tabs[Math.min(i, tabs.length - 1)]?.id ?? '')
    return { tabs, active }
  })
}

/** The pane that takes over from one that goes: the one before it, else the one after. */
function stepWithin(tree: PaneTree, id: string): string {
  const all = panesOf(tree)
  const i = all.indexOf(id)
  return all[i > 0 ? i - 1 : 1] ?? id
}

// ── xterm instances ────────────────────────────────────────────────────────

interface Entry {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  webgl: WebglAddon | null
  /** The element xterm draws in; it moves between the page and nowhere. */
  host: HTMLDivElement
  opened: boolean
  mounted: boolean
  /** Its output so far was painted: what arrives goes straight in. */
  ready: boolean
  queue: string[]
  /** Output drawn and not yet reported to the main process. */
  drawn: number
}

const entries = new Map<string, Entry>()
const ACK_EVERY = 20_000

const cssVar = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** The terminal's colours, from the theme in use (styles/theme.css: --term-*). */
export function terminalTheme(): ITheme {
  const c = (n: string, f: string) => cssVar(`--term-${n}`, f)
  return {
    background: c('bg', '#0a0d0c'),
    foreground: c('fg', '#cad3cb'),
    cursor: c('cursor', '#f3f6f1'),
    cursorAccent: c('bg', '#0a0d0c'),
    selectionBackground: c('selection', 'rgb(197 245 106 / 0.28)'),
    selectionInactiveBackground: c('selection-inactive', 'rgb(214 240 222 / 0.14)'),
    scrollbarSliderBackground: c('scrollbar', 'rgb(214 240 222 / 0.14)'),
    scrollbarSliderHoverBackground: c('scrollbar-hover', 'rgb(214 240 222 / 0.24)'),
    scrollbarSliderActiveBackground: c('scrollbar-hover', 'rgb(214 240 222 / 0.24)'),
    black: c('black', '#1b2220'),
    red: c('red', '#ff8c5f'),
    green: c('green', '#46e2b4'),
    yellow: c('yellow', '#ffd36e'),
    blue: c('blue', '#6cb4ff'),
    magenta: c('magenta', '#b595ff'),
    cyan: c('cyan', '#6fd8e0'),
    white: c('white', '#cad3cb'),
    brightBlack: c('bright-black', '#77837c'),
    brightRed: c('bright-red', '#ffa988'),
    brightGreen: c('bright-green', '#7af0cc'),
    brightYellow: c('bright-yellow', '#ffe19a'),
    brightBlue: c('bright-blue', '#9ccbff'),
    brightMagenta: c('bright-magenta', '#cbb5ff'),
    brightCyan: c('bright-cyan', '#9be7ec'),
    brightWhite: c('bright-white', '#f3f6f1')
  }
}

/** Geist Mono, then fonts with the symbols prompts like to use, when the system has one. */
const FONT_FALLBACK = "'Geist Mono', 'Symbols Nerd Font Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace"

type TermSettings = Pick<AppSettings, 'terminalFontFamily' | 'terminalFontSize' | 'terminalCursor' | 'terminalCursorBlink' | 'terminalScrollback' | 'terminalOptionAsMeta'>

function fontOf(s: TermSettings): string {
  const own = s.terminalFontFamily.trim().replace(/["\\]/g, '')
  return own ? `"${own}", ${FONT_FALLBACK}` : FONT_FALLBACK
}

function applySettings(term: Terminal, s: TermSettings): void {
  term.options.fontFamily = fontOf(s)
  term.options.fontSize = s.terminalFontSize
  term.options.cursorStyle = s.terminalCursor
  term.options.cursorBlink = s.terminalCursorBlink
  term.options.scrollback = s.terminalScrollback
  term.options.macOptionIsMeta = s.terminalOptionAsMeta
}

function openLink(event: MouseEvent, uri: string): void {
  // Like other terminals: a plain click selects, Cmd/Ctrl-click opens.
  if (!(isMac ? event.metaKey : event.ctrlKey)) return
  if (/^https?:\/\//i.test(uri)) void api.openExternal(uri).catch(() => undefined)
}

function send(id: string, data: string): void {
  void api.terminalWrite(id, data).catch(() => undefined)
}

function createEntry(id: string): Entry {
  const s = useApp.getState().settings
  const term = new Terminal({
    allowProposedApi: true,
    cols: 80,
    rows: 24,
    fontFamily: fontOf(s),
    fontSize: s.terminalFontSize,
    fontWeight: 400,
    fontWeightBold: 600,
    lineHeight: 1.2,
    cursorStyle: s.terminalCursor,
    cursorBlink: s.terminalCursorBlink,
    cursorInactiveStyle: 'outline',
    scrollback: s.terminalScrollback,
    macOptionIsMeta: s.terminalOptionAsMeta,
    macOptionClickForcesSelection: true,
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 3,
    theme: terminalTheme(),
    linkHandler: { activate: openLink }
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon(openLink))
  const unicode = new Unicode11Addon()
  term.loadAddon(unicode)
  term.unicode.activeVersion = '11'

  const host = document.createElement('div')
  host.className = 'tm-host'
  const entry: Entry = { term, fit, search, webgl: null, host, opened: false, mounted: false, ready: false, queue: [], drawn: 0 }
  entries.set(id, entry)

  term.onData((data) => send(id, data))
  term.onBinary((data) => send(id, data))
  term.onResize(({ cols, rows }) => void api.terminalResize(id, cols, rows).catch(() => undefined))
  term.onSelectionChange(() => {
    if (!useApp.getState().settings.terminalCopyOnSelect || !term.hasSelection()) return
    void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined)
  })
  term.attachCustomKeyEventHandler((ev) => !handleKey(id, ev))

  // What it printed before this window drew it, then what follows.
  void api.terminalAttach(id).then(
    ({ info, replay }) => {
      useTerminals.setState((st) => ({ infos: { ...st.infos, [id]: info } }))
      if (replay) term.write(replay)
      entry.ready = true
      for (const data of entry.queue.splice(0)) write(id, entry, data)
    },
    () => {
      // It ended before it was drawn.
      entry.ready = true
      forget(id)
    }
  )
  return entry
}

function write(id: string, entry: Entry, data: string): void {
  entry.term.write(data, () => {
    entry.drawn += data.length
    if (entry.drawn < ACK_EVERY) return
    const n = entry.drawn
    entry.drawn = 0
    void api.terminalAck(id, n).catch(() => undefined)
  })
}

function useGpu(entry: Entry): void {
  if (entry.webgl) return
  try {
    const gl = new WebglAddon()
    // The context can be taken away (too many of them, the GPU restarting): the DOM renderer takes over.
    gl.onContextLoss(() => {
      gl.dispose()
      if (entry.webgl === gl) entry.webgl = null
    })
    entry.term.loadAddon(gl)
    entry.webgl = gl
  } catch {
    entry.webgl = null
  }
}

/** Put a terminal's element into the page; returns what takes it out again. */
export function mountTerminal(id: string, container: HTMLElement): () => void {
  const entry = entries.get(id) ?? createEntry(id)
  container.appendChild(entry.host)
  if (!entry.opened) {
    entry.term.open(entry.host)
    entry.opened = true
    const area = entry.term.textarea
    area?.addEventListener('focus', () => onFocus(id))
    area?.addEventListener('blur', () => onBlur(id))
  }
  entry.mounted = true
  // Only the terminals on screen hold a GPU context (browsers allow few).
  useGpu(entry)
  fitTerminal(id)
  markSeenIfInView(id)
  return () => {
    entry.mounted = false
    entry.webgl?.dispose()
    entry.webgl = null
    entry.host.remove()
  }
}

/** Make the terminal as many columns and rows as fit its element. */
export function fitTerminal(id: string): void {
  const entry = entries.get(id)
  if (!entry?.opened || !entry.mounted) return
  if (entry.host.clientWidth < 20 || entry.host.clientHeight < 20) return
  try {
    entry.fit.fit()
  } catch {
    // Not laid out yet.
  }
}

function forget(id: string): void {
  const entry = entries.get(id)
  if (entry) {
    entries.delete(id)
    entry.webgl?.dispose()
    entry.host.remove()
    entry.term.dispose()
  }
  dropPane(id)
  useTerminals.setState((s) => {
    if (!(id in s.infos) && s.focus !== id) return s
    const infos = { ...s.infos }
    delete infos[id]
    return { infos, focus: s.focus === id ? null : s.focus }
  })
}

export function searchOf(id: string): SearchAddon | null {
  return entries.get(id)?.search ?? null
}

export function termOf(id: string): Terminal | null {
  return entries.get(id)?.term ?? null
}

// ── Focus ──────────────────────────────────────────────────────────────────

function onFocus(id: string): void {
  const at = locate(id)
  if (at && at.tab.focused !== id) changeTab(at.owner, at.tab.id, (t) => ({ ...t, focused: id }))
  if (useTerminals.getState().focus !== id) useTerminals.setState({ focus: id })
  // Elsewhere than macOS the menu's shortcuts are Ctrl-based, which a shell needs for itself.
  void terminalWindow.terminalFocusChanged(true).catch(() => undefined)
  markSeenIfInView(id)
}

function onBlur(id: string): void {
  if (useTerminals.getState().focus === id) useTerminals.setState({ focus: null })
  void terminalWindow.terminalFocusChanged(false).catch(() => undefined)
}

/** Give a terminal the keyboard (and bring its tab to the front of its owner's). */
export function focusTerminal(id: string): void {
  const at = locate(id)
  if (!at) return
  setWorkspace(at.owner, (ws) => (ws.active === at.tab.id ? ws : { ...ws, active: at.tab.id }))
  changeTab(at.owner, at.tab.id, (t) => (t.focused === id ? t : { ...t, focused: id }))
  // After React put its element on the page.
  requestAnimationFrame(() => entries.get(id)?.term.focus())
}

/** The terminal that has the keyboard, or would take it in the owner in front. */
export function currentTerminal(owner: string | null): string | null {
  const s = useTerminals.getState()
  if (s.focus && (!owner || locate(s.focus)?.owner === owner)) return s.focus
  if (!owner) return null
  return activeTab(workspaceOf(owner))?.focused ?? null
}

/** Is this terminal on screen right now, in a window the user is looking at? */
function inView(id: string): boolean {
  return !!entries.get(id)?.mounted && document.hasFocus() && document.visibilityState === 'visible'
}

function markSeenIfInView(id: string): void {
  const info = useTerminals.getState().infos[id]
  if (!info?.state || info.state === 'working' || !inView(id)) return
  void api.terminalSeen(id).catch(() => undefined)
}

// ── Actions ────────────────────────────────────────────────────────────────

export interface OpenOptions {
  launcher?: string
  /** Next to the focused pane (row: to its right, column: below it) instead of in a new tab. */
  split?: 'row' | 'column'
}

/** Start a terminal for an owner in a folder, in a new tab or beside the focused pane. */
export async function openTerminal(owner: string, cwd: string, opts: OpenOptions = {}): Promise<string | null> {
  const ws = workspaceOf(owner)
  const tab = opts.split ? activeTab(ws) : undefined
  // A split starts where its neighbour is working, like a new pane in other terminals.
  const from = tab ? useTerminals.getState().infos[tab.focused] : undefined
  let info: TerminalInfo
  try {
    info = await api.terminalOpen({ owner, cwd: from?.cwd || cwd, cols: 80, rows: 24, launcher: opts.launcher ?? SHELL_LAUNCHER })
  } catch (err) {
    toast.error('Could not start the terminal', { detail: describeError(err) })
    return null
  }
  useTerminals.setState((s) => ({ infos: { ...s.infos, [info.id]: info } }))
  createEntry(info.id)
  setWorkspace(owner, (cur) => {
    const target = opts.split ? activeTab(cur) : undefined
    if (target && opts.split) {
      const dir = opts.split
      return { ...cur, tabs: cur.tabs.map((t) => (t.id === target.id ? { ...t, tree: splitPane(t.tree, t.focused, info.id, dir), focused: info.id, zoomed: false } : t)) }
    }
    const added: TermTab = { id: newTabId(), tree: pane(info.id), focused: info.id, zoomed: false, name: '' }
    return { tabs: [...cur.tabs, added], active: added.id }
  })
  requestAnimationFrame(() => entries.get(info.id)?.term.focus())
  return info.id
}

/** Close a terminal; asks first when a program runs in it (unless told not to). */
export async function closeTerminal(id: string, opts: { ask?: boolean } = {}): Promise<boolean> {
  const settings = useApp.getState().settings
  if (opts.ask !== false && settings.terminalConfirmClose) {
    // What is in front right now, not what was when its info last changed.
    const live = (await api.terminalList().catch(() => [])).find((t) => t.id === id)
    if (live?.busy) {
      const what = live.name || live.process || 'A program'
      const ok = await confirm({ title: 'Close this terminal?', message: `${what} is still running in it and will be stopped.`, confirmLabel: 'Close', danger: true })
      if (!ok) return false
    }
  }
  await api.terminalClose(id).catch(() => undefined)
  // Its 'terminal-exit' event follows; the pane goes now so the layout does not wait for it.
  dropPane(id)
  const at = currentTerminal(null)
  if (at) requestAnimationFrame(() => entries.get(at)?.term.focus())
  return true
}

export async function closeTermTab(owner: string, tabId: string): Promise<void> {
  const tab = workspaceOf(owner).tabs.find((t) => t.id === tabId)
  if (!tab) return
  const ids = panesOf(tab.tree)
  if (useApp.getState().settings.terminalConfirmClose) {
    const live = await api.terminalList().catch(() => [])
    const busy = live.filter((t) => ids.includes(t.id) && t.busy)
    if (busy.length) {
      const what = busy.length === 1 ? `${busy[0].name || busy[0].process || 'A program'} is` : `${busy.length} programs are`
      const ok = await confirm({ title: 'Close this terminal tab?', message: `${what} still running in it and will be stopped.`, confirmLabel: 'Close', danger: true })
      if (!ok) return
    }
  }
  for (const id of ids) await closeTerminal(id, { ask: false })
}

/** Every terminal of an owner goes (its tab or group was closed); asks first when programs run in them. False: keep them. */
export async function closeOwner(owner: string, what = 'this tab'): Promise<boolean> {
  const ids = workspaceOf(owner).tabs.flatMap((t) => panesOf(t.tree))
  if (!ids.length) return true
  if (useApp.getState().settings.terminalConfirmClose) {
    const busy = (await api.terminalList().catch(() => [])).filter((t) => ids.includes(t.id) && t.busy)
    if (busy.length) {
      const names = [...new Set(busy.map((t) => t.name || t.process || 'a program'))].join(', ')
      const ok = await confirm({
        title: `Close ${what} and its terminals?`,
        message: `${busy.length === 1 ? 'A terminal is' : `${busy.length} terminals are`} still running ${names}, and will be stopped.`,
        confirmLabel: 'Close',
        danger: true
      })
      if (!ok) return false
    }
  }
  for (const id of ids) void closeTerminal(id, { ask: false })
  return true
}

// A repository's terminals go with its tab.
addCloseGuard((path) => closeOwner(path))

// A group that no longer exists takes its terminals, and its view, with it.
useApp.subscribe((state, prev) => {
  if (state.settings.tabGroups === prev.settings.tabGroups) return
  const alive = new Set(state.settings.tabGroups.map((g) => `group:${g.id}`))
  for (const owner of Object.keys(useTerminals.getState().workspaces)) {
    if (isGroupOwner(owner) && !alive.has(owner)) for (const id of workspaceOf(owner).tabs.flatMap((t) => panesOf(t.tree))) void closeTerminal(id, { ask: false })
  }
  if (state.groupView && !alive.has(state.groupView)) state.setGroupView(null)
})

export function selectTermTab(owner: string, tabId: string): void {
  setWorkspace(owner, (ws) => (ws.active === tabId ? ws : { ...ws, active: tabId }))
  const tab = workspaceOf(owner).tabs.find((t) => t.id === tabId)
  if (tab) requestAnimationFrame(() => entries.get(tab.focused)?.term.focus())
}

export function stepTermTab(owner: string, step: 1 | -1): void {
  const ws = workspaceOf(owner)
  if (ws.tabs.length < 2) return
  const i = ws.tabs.findIndex((t) => t.id === ws.active)
  selectTermTab(owner, ws.tabs[(i + step + ws.tabs.length) % ws.tabs.length].id)
}

export function renameTermTab(owner: string, tabId: string, name: string): void {
  changeTab(owner, tabId, (t) => ({ ...t, name: name.trim().slice(0, 40) }))
}

/** Put a tab just before another one of its owner (at the end when null): dragging a tab, Move Tab Left / Right. */
export function moveTermTab(owner: string, tabId: string, before: string | null): void {
  setWorkspace(owner, (ws) => {
    const tabs = moveBefore(ws.tabs, tabId, before)
    return tabs === ws.tabs ? ws : { ...ws, tabs: [...tabs] }
  })
}

/** A tab one place to the left (-1) or right (1). */
export function stepTermTabPlace(owner: string, tabId: string, step: 1 | -1): void {
  const tabs = workspaceOf(owner).tabs
  const i = tabs.findIndex((t) => t.id === tabId)
  const to = i + step
  if (i < 0 || to < 0 || to >= tabs.length) return
  moveTermTab(owner, tabId, step < 0 ? tabs[to].id : (tabs[to + 1]?.id ?? null))
}

/** Put a pane on a side of another pane of its tab (dragging its header there); it keeps the keyboard. */
export function movePaneTo(id: string, target: string, side: Direction): void {
  const at = locate(id)
  if (!at || !hasPane(at.tab.tree, target)) return
  changeTab(at.owner, at.tab.id, (t) => {
    const tree = movePane(t.tree, id, target, side)
    return tree === t.tree ? t : { ...t, tree, focused: id, zoomed: false }
  })
  requestAnimationFrame(() => entries.get(id)?.term.focus())
}

/** Move a pane past the one beside it in a direction (Move Pane Left…): it lands on that side of its neighbour. */
export function movePaneToward(id: string, dir: Direction): void {
  const at = locate(id)
  const target = at && neighbour(at.tab.tree, id, dir)
  if (target) movePaneTo(id, target, dir)
}

export function moveFocus(owner: string, to: Direction | 1 | -1): void {
  const tab = activeTab(workspaceOf(owner))
  if (!tab) return
  const next = typeof to === 'number' ? stepPane(tab.tree, tab.focused, to) : neighbour(tab.tree, tab.focused, to)
  if (!next || next === tab.focused) return
  // Moving out of a zoomed pane shows them all again.
  changeTab(owner, tab.id, (t) => ({ ...t, focused: next, zoomed: false }))
  requestAnimationFrame(() => entries.get(next)?.term.focus())
}

export function toggleZoom(owner: string): void {
  const tab = activeTab(workspaceOf(owner))
  if (!tab || panesOf(tab.tree).length < 2) return
  changeTab(owner, tab.id, (t) => ({ ...t, zoomed: !t.zoomed }))
  requestAnimationFrame(() => entries.get(tab.focused)?.term.focus())
}

export function equalizeSplits(owner: string): void {
  const tab = activeTab(workspaceOf(owner))
  if (tab) changeTab(owner, tab.id, (t) => ({ ...t, tree: equalize(t.tree) }))
}

export function resizeSplit(owner: string, dir: Direction): void {
  const tab = activeTab(workspaceOf(owner))
  if (tab) changeTab(owner, tab.id, (t) => ({ ...t, tree: nudge(t.tree, t.focused, dir) }))
}

export function setSplitRatio(owner: string, tabId: string, at: SplitPath, ratio: number): void {
  changeTab(owner, tabId, (t) => ({ ...t, tree: setRatio(t.tree, at, ratio) }))
}

/** Clear the screen and what scrolled away; the program redraws its prompt (Ctrl-L). */
export function clearTerminal(id: string): void {
  const term = entries.get(id)?.term
  if (!term) return
  term.clear()
  send(id, '\x0c')
}

export function copySelection(id: string): void {
  const term = entries.get(id)?.term
  if (term?.hasSelection()) void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined)
}

export async function pasteInto(id: string): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => '')
  if (text) entries.get(id)?.term.paste(text)
}

/** Type text into a terminal as if pasted (a review's notes for the agent running there). */
export function typeInto(id: string, text: string): void {
  entries.get(id)?.term.paste(text)
}

// ── Keyboard ───────────────────────────────────────────────────────────────

/** The find bar of the owner in front asks to open (the view listens). */
export const FIND_EVENT = 'adar-terminal-find'

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/**
 * Terminal shortcuts, from the keyboard itself (macOS's native menu takes most of them first: see commands.ts).
 * Cmd on macOS; Ctrl+Shift elsewhere, where Ctrl alone belongs to the shell. True when the key was one of ours.
 */
function handleKey(id: string, ev: KeyboardEvent): boolean {
  if (ev.type !== 'keydown') return false
  const at = locate(id)
  if (!at) return false
  const owner = at.owner
  const mod = isMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && ev.shiftKey && !ev.metaKey
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key
  const done = () => {
    ev.preventDefault()
    ev.stopPropagation()
    return true
  }
  // Shift+Enter: a new line in the agents' prompts, which a bare terminal cannot tell from Enter.
  if (ev.key === 'Enter' && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
    send(id, '\x1b\r')
    return done()
  }
  if (isMac && ev.metaKey && ev.ctrlKey) {
    if (ARROWS[ev.key]) return resizeSplit(owner, ARROWS[ev.key]), done()
    if (key === '=') return equalizeSplits(owner), done()
    return false
  }
  if (!mod) return false
  // macOS line editing, as other terminals map it: to the start or end of the line, delete to its start.
  if (isMac && !ev.altKey && !ev.shiftKey) {
    if (ev.key === 'ArrowLeft') return send(id, '\x01'), done()
    if (ev.key === 'ArrowRight') return send(id, '\x05'), done()
    if (ev.key === 'Backspace') return send(id, '\x15'), done()
  }
  const arrow = ARROWS[ev.key]
  if (arrow && ev.altKey) return moveFocus(owner, arrow), done()
  if (ev.altKey) return false
  const shift = isMac ? ev.shiftKey : false
  switch (key) {
    case 'd':
      return void openTerminal(owner, cwdOf(owner), { split: shift ? 'column' : 'row' }), done()
    case 't':
      return void openTerminal(owner, cwdOf(owner)), done()
    case 'w':
      return void closeTerminal(id), done()
    case 'k':
      return clearTerminal(id), done()
    case 'f':
      return window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: owner })), done()
    case 'Enter':
      return shift || !isMac ? (toggleZoom(owner), done()) : false
    case '[':
      return moveFocus(owner, -1), done()
    case ']':
      return moveFocus(owner, 1), done()
    case '{':
      return stepTermTab(owner, -1), done()
    case '}':
      return stepTermTab(owner, 1), done()
    case 'c':
      // Ctrl+Shift+C elsewhere; macOS copies through its Edit menu.
      return isMac ? false : (copySelection(id), done())
    case 'v':
      return isMac ? false : (void pasteInto(id), done())
  }
  return false
}

/** Where an owner's new terminals start: the repository's folder, or the folder a group's first terminal got. */
const owners = new Map<string, string>()
export function setOwnerFolder(owner: string, cwd: string): void {
  owners.set(owner, cwd)
}
export function cwdOf(owner: string): string {
  return owners.get(owner) ?? (isGroupOwner(owner) ? '' : owner)
}

// ── Keeping in step with the main process ──────────────────────────────────

/** Rebuild the tabs after a reload: the stored layout for the terminals still running, a tab for each other one. */
function restore(list: readonly TerminalInfo[]): void {
  const known = new Set(list.map((t) => t.id))
  let stored: Record<string, { tabs?: unknown[]; active?: unknown }> = {}
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as unknown
    if (raw && typeof raw === 'object') stored = raw as typeof stored
  } catch {
    stored = {}
  }
  const workspaces: Record<string, Workspace> = {}
  const placed = new Set<string>()
  for (const [owner, ws] of Object.entries(stored)) {
    const tabs: TermTab[] = []
    for (const raw of Array.isArray(ws?.tabs) ? ws.tabs : []) {
      const t = raw as Partial<TermTab> | null
      const tree = parseTree(t?.tree, known)
      if (!tree || typeof t?.id !== 'string') continue
      const ids = panesOf(tree).filter((id) => !placed.has(id) && list.find((i) => i.id === id)?.owner === owner)
      if (ids.length !== panesOf(tree).length) continue
      ids.forEach((id) => placed.add(id))
      tabs.push({ id: t.id, tree, focused: typeof t.focused === 'string' && ids.includes(t.focused) ? t.focused : ids[0], zoomed: false, name: typeof t.name === 'string' ? t.name : '' })
    }
    if (tabs.length) workspaces[owner] = { tabs, active: tabs.some((t) => t.id === ws.active) ? (ws.active as string) : tabs[0].id }
  }
  for (const info of list) {
    if (placed.has(info.id)) continue
    const ws = workspaces[info.owner] ?? { tabs: [], active: '' }
    const tab: TermTab = { id: newTabId(), tree: pane(info.id), focused: info.id, zoomed: false, name: '' }
    workspaces[info.owner] = { tabs: [...ws.tabs, tab], active: ws.active || tab.id }
  }
  useTerminals.setState({ infos: Object.fromEntries(list.map((t) => [t.id, t])), workspaces, ready: true })
  save()
}

function onInfo(info: TerminalInfo): void {
  const before = useTerminals.getState().infos[info.id]
  useTerminals.setState((s) => ({ infos: { ...s.infos, [info.id]: info } }))
  if (!info.state || info.state === before?.state) return
  if (inView(info.id)) return markSeenIfInView(info.id)
  const app = useApp.getState()
  if (!shouldNotify(info, app.settings)) return
  const notice = noticeFor(info, app.tabs, app.settings.tabGroups)
  if (notice) void api.notifyTerminal(notice).catch(() => undefined)
}

function applyToAll(): void {
  const s = useApp.getState().settings
  const theme = terminalTheme()
  for (const [id, e] of entries) {
    applySettings(e.term, s)
    e.term.options.theme = theme
    fitTerminal(id)
  }
}

/** Keep this window's terminals in step with the main process, the theme and the settings. */
export function useTerminalSync(onOpen: (owner: string, id: string) => void): void {
  const ready = useApp((s) => s.ready)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void api.terminalList().then(
      (list) => !cancelled && restore(list),
      () => !cancelled && useTerminals.setState({ ready: true })
    )
    // The bundled font must be in before xterm measures a cell.
    void document.fonts?.load("13px 'Geist Mono'").then(() => !cancelled && applyToAll(), () => undefined)
    return () => {
      cancelled = true
    }
  }, [ready])

  useEffect(
    () =>
      onAdarEvent((ev) => {
        if (ev.type === 'terminal-data') {
          const entry = entries.get(ev.id)
          if (!entry) return
          if (entry.ready) write(ev.id, entry, ev.data)
          else entry.queue.push(ev.data)
        } else if (ev.type === 'terminal-info') onInfo(ev.info)
        else if (ev.type === 'terminal-exit') forget(ev.id)
        else if (ev.type === 'open-terminal') onOpen(ev.owner, ev.id)
      }),
    [onOpen]
  )

  // Fonts, cursor and scrollback follow the settings; colours follow the theme.
  const font = useApp((s) => `${s.settings.terminalFontFamily}|${s.settings.terminalFontSize}|${s.settings.terminalCursor}|${s.settings.terminalCursorBlink}|${s.settings.terminalScrollback}|${s.settings.terminalOptionAsMeta}`)
  useEffect(() => applyToAll(), [font])
  useEffect(() => {
    const watch = new MutationObserver(() => requestAnimationFrame(applyToAll))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => watch.disconnect()
  }, [])

  // Back in front: what finished meanwhile and is on screen has been seen.
  useEffect(() => {
    const seen = () => {
      for (const id of entries.keys()) markSeenIfInView(id)
    }
    window.addEventListener('focus', seen)
    return () => window.removeEventListener('focus', seen)
  }, [])
}

/** Terminals with a program running, by what the main process knows now (asked before quitting). */
export async function busyTerminals(): Promise<TerminalInfo[]> {
  return (await api.terminalList().catch(() => [])).filter((t) => t.busy)
}
