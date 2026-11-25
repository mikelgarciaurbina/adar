// Terminals, user-level actions: what a project's tab shows (graph, both, terminal), the terminal commands of the
// menu and the palette (they act on the terminals of the tab in front), and showing the terminal a notification
// was about.

import type { TerminalViewMode } from '@shared/terminal'
import { isGroupOwner, SHELL_LAUNCHER } from '@shared/terminal'
import { isElectron } from '@renderer/api/client'
import type { Direction } from '@renderer/components/terminal/layout'
import {
  clearTerminal,
  closeTerminal,
  currentTerminal,
  cwdOf,
  equalizeSplits,
  FIND_EVENT,
  focusTerminal,
  moveFocus,
  openTerminal,
  resizeSplit,
  stepTermTab,
  toggleZoom,
  useTerminals,
  workspaceOf
} from '@renderer/components/terminal/terminalStore'
import { useApp } from '@renderer/store/appStore'

/** Terminals exist in the desktop app only (a shell behind the browser bridge would be a remote shell). */
export const terminalsAvailable = isElectron

export function viewOf(path: string): TerminalViewMode {
  return terminalsAvailable ? (useApp.getState().settings.terminalViews[path] ?? 'graph') : 'graph'
}

export function setTerminalView(path: string, view: TerminalViewMode): void {
  if (!terminalsAvailable) return
  const s = useApp.getState()
  if ((s.settings.terminalViews[path] ?? 'graph') === view) return
  const views = { ...s.settings.terminalViews }
  // The graph is what a tab shows unless told otherwise: nothing to keep for it.
  if (view === 'graph') delete views[path]
  else views[path] = view
  void s.updateSettings({ terminalViews: views })
  if (view !== 'graph') focusTerminalSoon(path)
}

/**
 * Give the keyboard to the owner's terminal once its view is on the page; with none there yet, to the choice of what
 * to start (Enter starts a shell).
 */
export function focusTerminalSoon(owner: string): void {
  setTimeout(() => {
    const id = currentTerminal(owner)
    if (id) return focusTerminal(id)
    document.querySelector<HTMLElement>(`.tm-empty[data-owner="${CSS.escape(owner)}"] .tm-empty-button`)?.focus()
  }, 60)
}

/**
 * The owner whose terminals a command acts on: the group whose view is in front, else the active tab when its
 * terminals are showing (null while only the graph is).
 */
export function terminalOwner(): string | null {
  const s = useApp.getState()
  if (s.groupView) return s.groupView
  const path = s.activePath
  return path && viewOf(path) !== 'graph' ? path : null
}

/** Is the keyboard in a terminal? Shortcuts shared with the git side then mean the terminal's. */
export function terminalHasKeyboard(): boolean {
  return !!useTerminals.getState().focus
}

/** Graph ↔ terminal, from anywhere (⌘E): the terminal alone, or back to what was there. */
export function toggleTerminal(): void {
  const path = useApp.getState().activePath
  if (!path) return
  setTerminalView(path, viewOf(path) === 'terminal' ? 'graph' : 'terminal')
}

/** A terminal command needs a terminal view: show the active tab's when only its graph is in front. */
function ownerOrShow(): string | null {
  const owner = terminalOwner()
  if (owner) return owner
  const path = useApp.getState().activePath
  if (!path || !terminalsAvailable) return null
  setTerminalView(path, 'both')
  return path
}

export function newTerminal(launcher: string = SHELL_LAUNCHER): void {
  const owner = ownerOrShow()
  if (owner) void openTerminal(owner, cwdOf(owner), { launcher })
}

export function splitTerminal(dir: 'row' | 'column'): void {
  const owner = ownerOrShow()
  if (!owner) return
  // Nothing to split yet: the first terminal takes the whole view.
  void openTerminal(owner, cwdOf(owner), workspaceOf(owner).tabs.length ? { split: dir } : {})
}

export function closeFocusedTerminal(): void {
  const id = currentTerminal(terminalOwner())
  if (id) void closeTerminal(id)
}

export function clearFocusedTerminal(): void {
  const id = currentTerminal(terminalOwner())
  if (id) clearTerminal(id)
}

export function findInTerminal(): void {
  const owner = terminalOwner()
  if (owner) window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: owner }))
}

export function zoomTerminal(): void {
  const owner = terminalOwner()
  if (owner) toggleZoom(owner)
}

export function equalizeTerminals(): void {
  const owner = terminalOwner()
  if (owner) equalizeSplits(owner)
}

export function focusPane(to: Direction | 1 | -1): void {
  const owner = terminalOwner()
  if (owner) moveFocus(owner, to)
}

export function resizePane(dir: Direction): void {
  const owner = terminalOwner()
  if (owner) resizeSplit(owner, dir)
}

export function stepTerminalTab(step: 1 | -1): void {
  const owner = terminalOwner()
  if (owner) stepTermTab(owner, step)
}

/** A terminal notification was clicked: bring its owner's terminals to the front, with that terminal focused. */
export function showTerminal(owner: string, id: string): void {
  const s = useApp.getState()
  if (isGroupOwner(owner)) s.setGroupView(owner)
  else {
    if (!s.tabs.some((t) => t.path === owner)) return
    s.setGroupView(null)
    s.setActive(owner)
    if (viewOf(owner) === 'graph') setTerminalView(owner, 'terminal')
  }
  setTimeout(() => focusTerminal(id), 80)
}
