// Per-file merge-tool state kept across file switches (and while the tool is
// closed): chunk choices / hand edits survive as long as the working-tree text
// they were made against did not change. Lives in its own module so other parts
// of the UI (e.g. "Restart to update") can tell whether unsaved merge work exists.

import type { ChunkChoice } from './conflictParser'

export type Choices = Array<ChunkChoice | undefined>

export interface CachedEditor {
  merged: string | null
  choices: Choices
  manualText: string | null
  current: number
}

export const editorCache = new Map<string, CachedEditor>()
export const CACHE_LIMIT = 50
export const cacheKeyOf = (repo: string, path: string) => `${repo}\u0000${path}`

/** Files with merge-tool choices or hand edits that were not saved yet. */
export function unsavedConflictEdits(): Array<{ repo: string; path: string }> {
  const out: Array<{ repo: string; path: string }> = []
  for (const key of editorCache.keys()) {
    const i = key.indexOf('\u0000')
    out.push({ repo: key.slice(0, i), path: key.slice(i + 1) })
  }
  return out
}
