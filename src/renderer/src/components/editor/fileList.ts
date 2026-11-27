// The files of each open repository, as the tree and the palette show them: listed by git when first asked for,
// kept while the tab is open and listed again when the working tree gains or loses a file.

import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@renderer/api/client'
import { describeError } from '@shared/errors'
import type { FileListing, FolderEntry } from '@shared/files'
import type { WorkingStatus } from '@shared/types'

export interface ListedFiles {
  listing: FileListing | null
  loading: boolean
  error?: string
  /** What was read of the folders the listing only names, by path. */
  folders: Record<string, FolderEntry[]>
  /** Folders being read. */
  reading: string[]
  /** The folders the tree shows open. */
  open: string[]
}

const EMPTY: ListedFiles = { listing: null, loading: false, folders: {}, reading: [], open: [] }

export const useFileLists = create<{ repos: Record<string, ListedFiles> }>(() => ({ repos: {} }))

const of = (repo: string): ListedFiles => useFileLists.getState().repos[repo] ?? EMPTY
function patch(repo: string, change: Partial<ListedFiles>): void {
  useFileLists.setState((s) => ({ repos: { ...s.repos, [repo]: { ...(s.repos[repo] ?? EMPTY), ...change } } }))
}

const inFlight = new Map<string, Promise<void>>()

/** List a repository's files (again). Asked twice at once, it is listed once. */
export function loadFiles(repo: string): Promise<void> {
  const running = inFlight.get(repo)
  if (running) return running
  patch(repo, { loading: true })
  const run = (async () => {
    try {
      const listing = await api.listFiles(repo)
      patch(repo, { listing, loading: false, error: undefined })
      // The folders read before may hold something else now.
      for (const dir of Object.keys(of(repo).folders)) void loadFolder(repo, dir, true)
    } catch (err) {
      patch(repo, { loading: false, error: describeError(err) })
    } finally {
      inFlight.delete(repo)
    }
  })()
  inFlight.set(repo, run)
  return run
}

/** Read a folder the listing only names (an ignored one), the first time it is opened. */
export async function loadFolder(repo: string, dir: string, again = false): Promise<void> {
  const known = of(repo)
  if ((!again && known.folders[dir]) || known.reading.includes(dir)) return
  patch(repo, { reading: [...known.reading, dir] })
  try {
    const entries = await api.listFolder(repo, dir)
    const now = of(repo)
    patch(repo, { folders: { ...now.folders, [dir]: entries }, reading: now.reading.filter((d) => d !== dir) })
  } catch {
    // Gone, or not to be read: an empty folder, and no longer one that was read.
    const now = of(repo)
    const { [dir]: _gone, ...folders } = now.folders
    patch(repo, { folders: again ? folders : { ...folders, [dir]: [] }, reading: now.reading.filter((d) => d !== dir) })
  }
}

export function setOpenFolders(repo: string, open: string[]): void {
  patch(repo, { open })
}

/** Forget a repository's files (its tab was closed). */
export function forgetFiles(repo: string): void {
  useFileLists.setState((s) => {
    if (!s.repos[repo]) return s
    const { [repo]: _closed, ...repos } = s.repos
    return { repos }
  })
}

/** What tells that the working tree gained or lost a file: the paths git reports as new, gone or renamed. */
export function shapeOf(status: WorkingStatus | null): string {
  if (!status) return ''
  const parts: string[] = []
  for (const f of [...status.staged, ...status.unstaged]) {
    if (f.status === 'untracked' || f.status === 'added' || f.status === 'deleted' || f.status === 'renamed' || f.status === 'copied') parts.push(`${f.status[0]}${f.path}`)
  }
  return parts.sort().join('\n')
}

/** A repository's files, listed when first used and again whenever `shape` changes or the window comes back. */
export function useFiles(repo: string, shape: string): ListedFiles {
  const listed = useFileLists((s) => s.repos[repo]) ?? EMPTY
  useEffect(() => {
    void loadFiles(repo)
  }, [repo, shape])
  useEffect(() => {
    const again = (): void => void loadFiles(repo)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [repo])
  return listed
}
