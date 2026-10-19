// Pure helpers for the application chrome (tab bar, toolbar, status bar, welcome).
// No DOM / store access so they can be unit-tested in node.

import type { ProgressState } from '@renderer/store/appStore'
import type { UpdateStatus } from '@shared/update'

/**
 * Target index for `moveTab(from, to)` (splice semantics: remove `from`, insert at `to`)
 * when a tab is dropped on the left (`after` false) or right half of tab `over`.
 */
export function reorderIndex(from: number, over: number, after: boolean): number {
  const insertion = over + (after ? 1 : 0)
  return insertion > from ? insertion - 1 : insertion
}

/**
 * Latest progress line relevant to the active repo: entries for that repo or with
 * no repo (clone). The store keeps insertion order, so the last match is the newest op.
 */
export function pickProgress(
  progress: Record<string, ProgressState>,
  activePath: string | null
): { opId: string; state: ProgressState } | null {
  let found: { opId: string; state: ProgressState } | null = null
  for (const [opId, state] of Object.entries(progress)) {
    if (!state.repoPath || state.repoPath === activePath || opId.startsWith('clone')) found = { opId, state }
  }
  return found
}

/** Latest progress entry whose opId starts with `prefix` (e.g. 'clone'). */
export function latestProgressWithPrefix(progress: Record<string, ProgressState>, prefix: string): ProgressState | null {
  let found: ProgressState | null = null
  for (const [opId, state] of Object.entries(progress)) if (opId.startsWith(prefix)) found = state
  return found
}

/** Busy labels relevant to the active repo ("push:/repo" keys) plus global ones (clone). */
export function busyLabelsFor(busy: Record<string, string>, activePath: string | null): string[] {
  const out: string[] = []
  for (const [key, label] of Object.entries(busy)) {
    const colon = key.indexOf(':')
    const target = colon >= 0 ? key.slice(colon + 1) : ''
    if ((activePath && target === activePath) || key.startsWith('clone:')) out.push(label)
  }
  return out
}

/** True when busy has `<kind>:<repo>`. */
export function isBusyFor(busy: Record<string, string>, kind: string, repo: string): boolean {
  return `${kind}:${repo}` in busy
}

/** "git version 2.39.5 (Apple Git-154)" → "2.39.5". Empty for unknown values. */
export function formatGitVersion(raw: string | undefined | null): string {
  if (!raw) return ''
  const m = /(\d+\.\d+(?:\.\d+)?(?:\.[a-z0-9]+)*)/i.exec(raw)
  if (m) return m[1]
  return /unknown/i.test(raw) ? '' : raw.replace(/^git version\s*/i, '').trim()
}

/** Normalise a timestamp that may be in seconds or milliseconds to unix seconds. */
export function toUnixSeconds(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts)
}

/** Replace the home directory prefix with "~". */
export function tildify(path: string, homeDir: string | undefined | null): string {
  if (!homeDir) return path
  const home = homeDir.replace(/[\\/]+$/, '')
  if (path === home) return '~'
  if (path.startsWith(home + '/') || path.startsWith(home + '\\')) return '~' + path.slice(home.length)
  return path
}

function pathSegments(p: string): string[] {
  return p.replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean)
}

/**
 * Hints that tell apart repositories sharing a name (VS Code style): the shortest run of
 * parent folders that differs, e.g. /a/fx/demo + /a/fx2/demo → "fx" and "fx2". Entries with a
 * unique name get no hint (absent from the map).
 */
export function distinctParents(entries: Array<{ path: string; name: string }>): Map<string, string> {
  const groups = new Map<string, string[]>()
  for (const e of entries) {
    const list = groups.get(e.name) ?? []
    if (!list.includes(e.path)) list.push(e.path)
    groups.set(e.name, list)
  }
  const out = new Map<string, string>()
  for (const paths of groups.values()) {
    if (paths.length < 2) continue
    const parents = paths.map((p) => pathSegments(p).slice(0, -1))
    const maxDepth = Math.max(1, ...parents.map((s) => s.length))
    let labels: string[] = []
    for (let depth = 1; depth <= maxDepth; depth++) {
      labels = parents.map((s) => s.slice(-depth).join('/') || '/')
      if (new Set(labels).size === labels.length) break
    }
    paths.forEach((p, i) => out.set(p, labels[i]))
  }
  return out
}

/** Short label for a detached HEAD or branch. */
export function headLabel(head: { branch: string | null; detached: boolean; sha: string | null; unborn?: boolean } | null | undefined): string {
  if (!head) return '…'
  if (head.branch) return head.branch
  if (head.detached && head.sha) return `detached HEAD`
  return 'no branch'
}

/** Clamp the Git console height to sensible bounds for the window. */
export function clampConsoleHeight(h: number, windowHeight: number): number {
  const max = Math.max(160, Math.floor(windowHeight * 0.8))
  return Math.round(Math.max(120, Math.min(max, h)))
}

/** Number shown in a badge: "99+" above 99, '' for 0/undefined. */
export function badgeCount(n: number | undefined | null): string {
  if (!n || n <= 0) return ''
  return n > 99 ? '99+' : String(n)
}

/** Window geometry used to detect native full screen (no Electron API in the renderer). */
export interface WindowMetrics {
  /** CSS px (window.innerWidth / innerHeight): shrink as the UI zoom grows. */
  innerWidth: number
  innerHeight: number
  /** UI zoom factor applied to the page (settings.zoom). */
  zoom: number
  /** DIPs (window.screen.width / height): not affected by the zoom. */
  screenWidth: number
  screenHeight: number
  /** document.fullscreenElement is set (HTML fullscreen API). */
  htmlFullscreen: boolean
}

/**
 * True when the window covers the whole screen: HTML fullscreen, or native (green button /
 * View → Toggle Full Screen) full screen, where the viewport is exactly the screen size. A
 * maximised ("zoomed") macOS window never covers the menu bar, so it does not match.
 * The viewport is used rather than window.outerWidth/outerHeight because Electron updates the
 * outer size only after the full-screen animation, without a further resize event.
 */
export function isFullscreenWindow(m: WindowMetrics): boolean {
  if (m.htmlFullscreen) return true
  if (!(m.screenWidth > 0) || !(m.screenHeight > 0) || !(m.innerWidth > 0) || !(m.innerHeight > 0)) return false
  const zoom = m.zoom > 0 ? m.zoom : 1
  // innerWidth is rounded to whole CSS px, so allow up to one CSS px of slack.
  const slack = Math.max(1, zoom)
  return m.innerWidth * zoom >= m.screenWidth - slack && m.innerHeight * zoom >= m.screenHeight - slack
}

/** The tab bar shows an "Update" pill while a newer release is available or downloaded. */
export function pendingUpdateVersion(status: UpdateStatus | null | undefined): string | null {
  if (!status?.info) return null
  return status.state === 'available' || status.state === 'downloaded' ? status.info.latestVersion : null
}
