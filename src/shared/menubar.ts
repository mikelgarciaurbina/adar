// macOS menu bar extra: the antlers in the menu bar and a small panel under them with the active project
// (its branch and the latest commits on their lanes). Main side: src/main/menuBar.ts; panel renderer:
// src/renderer/menubar.html. The panel window may only call these methods plus PANEL_API_METHODS, and only on
// repositories Adar opened (its tabs, or one the panel opened through menuBarUseRepo, which checks trust).

import type { AdarApiMethod } from './api'
import type { RepoInfo } from './types'

export const MENUBAR_METHODS = ['menuBarState', 'menuBarUseRepo', 'menuBarOpenInAdar', 'menuBarHide', 'menuBarShowMenu', 'menuBarSetHeight'] as const
export type MenuBarMethod = (typeof MENUBAR_METHODS)[number]

/** Backend methods the panel window may call: reading a repository, plus fetch, pull and push. */
export const PANEL_API_METHODS: readonly AdarApiMethod[] = ['getSettings', 'getRecentRepos', 'getRefs', 'getStatus', 'getLog', 'fetch', 'pull', 'push']

export interface MenuBarState {
  /** Repository path → when Adar last fetched it (ms since epoch), for fetches since the app started. */
  lastFetch: Record<string, number>
}

export interface MenuBarApi {
  menuBarState(): Promise<MenuBarState>
  /** Open `repo` for the panel like Adar opens a tab (refuses untrusted repositories with UNTRUSTED_REPO). */
  menuBarUseRepo(repo: string): Promise<RepoInfo>
  /** Bring Adar's window to the front (opening the window if needed) and switch to `repo` when given. */
  menuBarOpenInAdar(repo: string | null): Promise<void>
  menuBarHide(): Promise<void>
  /** The panel's "…" menu: notifications, Settings…, Quit. */
  menuBarShowMenu(): Promise<void>
  /** Fit the panel window to its content. */
  menuBarSetHeight(height: number): Promise<void>
}

export const PANEL_WIDTH = 380
export const PANEL_MIN_HEIGHT = 180
export const PANEL_MAX_HEIGHT = 640
