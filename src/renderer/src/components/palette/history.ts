// Persistent input history for the Git console (and small storage helpers shared
// by the palette module). Pure functions + guarded localStorage access.

export const HISTORY_LIMIT = 100

/** Append `entry` to `list`, removing an earlier identical entry, keeping the last `max`. */
export function pushHistory(list: readonly string[], entry: string, max = HISTORY_LIMIT): string[] {
  const value = entry.trim()
  if (!value) return [...list]
  const next = list.filter((e) => e !== value)
  next.push(value)
  return next.length > max ? next.slice(next.length - max) : next
}

export interface HistoryCursor {
  /** Index into history; history.length means "the current draft". */
  index: number
  /** What the user typed before navigating. */
  draft: string
}

/**
 * Move through history like a shell. `dir` -1 = older (↑), +1 = newer (↓).
 * Returns the new cursor and the text to show in the input.
 */
export function navigateHistory(
  history: readonly string[],
  cursor: HistoryCursor,
  dir: -1 | 1,
  currentText: string
): { cursor: HistoryCursor; text: string } {
  const atDraft = cursor.index >= history.length
  const draft = atDraft ? currentText : cursor.draft
  const index = Math.max(0, Math.min(history.length, cursor.index + dir))
  const text = index >= history.length ? draft : history[index]
  return { cursor: { index, draft }, text }
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or unavailable */
  }
}

export function loadStringList(key: string): string[] {
  const v = readJson<unknown>(key, [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
