// Per-viewer UI persistence for the left panel (collapsed sections, folder
// expansion per repo). localStorage can be missing or throw (private mode,
// blocked storage), so every access is guarded and falls back to defaults.

import { SECTION_ORDER, type FolderChoices, type SectionId } from './tree'

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Max folder choices remembered per repo (oldest dropped first). */
export const MAX_FOLDER_CHOICES = 500

function defaultStorage(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export const sectionStorageKey = (id: SectionId): string => `adar.sb.section.${id}.collapsed`
export const folderStorageKey = (repo: string): string => `adar.sb.folders.${repo}`
/** Before 0.14.3: folders whose state differed from their default, which moved with the checked-out branch. */
const legacyTreeStorageKey = (repo: string): string => `adar.sb.tree.${repo}`

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

/** The folders and remotes opened (true) or closed (false) in a repository's left panel, as [key, open] pairs. */
export function loadFolders(repo: string, storage: KV | null = defaultStorage()): Map<string, boolean> {
  if (!storage) return new Map()
  try {
    const raw = storage.getItem(folderStorageKey(repo))
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    return new Map(parsed.filter((e): e is [string, boolean] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'boolean'))
  } catch {
    return new Map()
  }
}

export function saveFolders(repo: string, folders: FolderChoices, storage: KV | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(legacyTreeStorageKey(repo))
    const list = [...folders]
    if (!list.length) storage.removeItem(folderStorageKey(repo))
    else storage.setItem(folderStorageKey(repo), JSON.stringify(list.slice(-MAX_FOLDER_CHOICES)))
  } catch {
    /* storage unavailable or full */
  }
}
