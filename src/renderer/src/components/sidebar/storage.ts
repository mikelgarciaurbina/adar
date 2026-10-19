// Per-viewer UI persistence for the left panel (collapsed sections, folder
// expansion per repo). localStorage can be missing or throw (private mode,
// blocked storage), so every access is guarded and falls back to defaults.

import { SECTION_ORDER, type SectionId } from './tree'

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Max folder keys remembered per repo (oldest dropped first). */
export const MAX_TOGGLED = 500

function defaultStorage(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export const sectionStorageKey = (id: SectionId): string => `adar.sb.section.${id}.collapsed`
export const treeStorageKey = (repo: string): string => `adar.sb.tree.${repo}`

export function loadCollapsedSections(storage: KV | null = defaultStorage()): Set<SectionId> {
  const out = new Set<SectionId>()
  if (!storage) return out
  for (const id of SECTION_ORDER) {
    try {
      if (storage.getItem(sectionStorageKey(id)) === '1') out.add(id)
    } catch {
      /* storage unavailable */
    }
  }
  return out
}

export function saveCollapsedSections(collapsed: ReadonlySet<SectionId>, storage: KV | null = defaultStorage()): void {
  if (!storage) return
  for (const id of SECTION_ORDER) {
    try {
      if (collapsed.has(id)) storage.setItem(sectionStorageKey(id), '1')
      else storage.removeItem(sectionStorageKey(id))
    } catch {
      /* storage unavailable or full */
    }
  }
}

export function loadToggled(repo: string, storage: KV | null = defaultStorage()): Set<string> {
  if (!storage) return new Set()
  try {
    const raw = storage.getItem(treeStorageKey(repo))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveToggled(repo: string, toggled: ReadonlySet<string>, storage: KV | null = defaultStorage()): void {
  if (!storage) return
  try {
    const list = [...toggled]
    if (!list.length) storage.removeItem(treeStorageKey(repo))
    else storage.setItem(treeStorageKey(repo), JSON.stringify(list.slice(-MAX_TOGGLED)))
  } catch {
    /* storage unavailable or full */
  }
}
