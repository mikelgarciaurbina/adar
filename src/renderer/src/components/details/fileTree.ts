// Pure helpers that turn a flat list of changed files into the rows shown by
// the right panel's file lists: a sorted flat "Path" view, or a collapsible
// "Tree" view of folders (single-child folder chains are compacted, like
// "src/renderer/src", to keep the list dense).

import type { FileChange } from '@shared/types'

export type FileViewMode = 'path' | 'tree'

export interface TreeDir {
  /** Display name (may contain "/" when compacted). */
  name: string
  /** Full repo-relative directory path without trailing slash ('' for the root). */
  path: string
  dirs: TreeDir[]
  files: FileChange[]
  /** Number of files below this directory (recursive). */
  count: number
}

export type FileRow =
  | { kind: 'dir'; key: string; path: string; name: string; depth: number; collapsed: boolean; count: number }
  | { kind: 'file'; key: string; file: FileChange; depth: number }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function comparePaths(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** Strip a trailing slash (untracked directories may be reported as "dir/"). */
function cleanPath(p: string): string {
  return p.endsWith('/') ? p.slice(0, -1) : p
}

export function fileBaseName(p: string): string {
  const c = cleanPath(p)
  const i = c.lastIndexOf('/')
  return i >= 0 ? c.slice(i + 1) : c
}

export function fileDirName(p: string): string {
  const c = cleanPath(p)
  const i = c.lastIndexOf('/')
  return i >= 0 ? c.slice(0, i) : ''
}

/** Files sorted by full path (natural, case-insensitive). Returns a new array. */
export function sortByPath(files: readonly FileChange[]): FileChange[] {
  return [...files].sort((a, b) => comparePaths(a.path, b.path))
}

interface MutableDir {
  name: string
  path: string
  dirs: Map<string, MutableDir>
  files: FileChange[]
}

/** Build a directory tree. With `compact`, chains of folders holding a single folder and no files are merged. */
export function buildTree(files: readonly FileChange[], compact = true): TreeDir {
  const root: MutableDir = { name: '', path: '', dirs: new Map(), files: [] }
  for (const f of files) {
    const dir = fileDirName(f.path)
    let node = root
    if (dir) {
      let acc = ''
      for (const part of dir.split('/')) {
        acc = acc ? `${acc}/${part}` : part
        let next = node.dirs.get(part)
        if (!next) {
          next = { name: part, path: acc, dirs: new Map(), files: [] }
          node.dirs.set(part, next)
        }
        node = next
      }
    }
    node.files.push(f)
  }

  const finish = (d: MutableDir): TreeDir => {
    const dirs = [...d.dirs.values()].map(finish).sort((a, b) => comparePaths(a.name, b.name))
    const own = [...d.files].sort((a, b) => comparePaths(fileBaseName(a.path), fileBaseName(b.path)))
    const count = own.length + dirs.reduce((n, c) => n + c.count, 0)
    let out: TreeDir = { name: d.name, path: d.path, dirs, files: own, count }
    if (compact && d.path !== '') {
      while (out.files.length === 0 && out.dirs.length === 1) {
        const only = out.dirs[0]
        out = { ...only, name: `${out.name}/${only.name}` }
      }
    }
    return out
  }
  return finish(root)
}

/** Depth-first rows of a tree, skipping the children of collapsed folders. */
export function flattenTree(root: TreeDir, collapsed: ReadonlySet<string>): FileRow[] {
  const rows: FileRow[] = []
  const walk = (dir: TreeDir, depth: number) => {
    for (const d of dir.dirs) {
      const isCollapsed = collapsed.has(d.path)
      rows.push({ kind: 'dir', key: `d:${d.path}`, path: d.path, name: d.name, depth, collapsed: isCollapsed, count: d.count })
      if (!isCollapsed) walk(d, depth + 1)
    }
    for (const f of dir.files) rows.push({ kind: 'file', key: `f:${f.path}`, file: f, depth })
  }
  walk(root, 0)
  return rows
}

/** Every file of the tree in display order (ignores collapsed state). */
export function treeFileOrder(root: TreeDir): FileChange[] {
  const out: FileChange[] = []
  const walk = (dir: TreeDir) => {
    for (const d of dir.dirs) walk(d)
    out.push(...dir.files)
  }
  walk(root)
  return out
}

/** Rows to render for a list in the given mode. */
export function buildRows(files: readonly FileChange[], mode: FileViewMode, collapsed: ReadonlySet<string>): FileRow[] {
  if (mode === 'tree') return flattenTree(buildTree(files), collapsed)
  return sortByPath(files).map((file) => ({ kind: 'file' as const, key: `f:${file.path}`, file, depth: 0 }))
}

/** Files in the order they are displayed (used for diff prev/next siblings and range selection). */
export function displayOrder(files: readonly FileChange[], mode: FileViewMode): FileChange[] {
  return mode === 'tree' ? treeFileOrder(buildTree(files)) : sortByPath(files)
}

/** Files located inside `dir` (recursively). */
export function filesUnder(files: readonly FileChange[], dir: string): FileChange[] {
  const prefix = dir ? `${dir}/` : ''
  return files.filter((f) => f.path.startsWith(prefix))
}

/** All directory paths of the tree (used for "collapse all"). */
export function allDirPaths(root: TreeDir): string[] {
  const out: string[] = []
  const walk = (d: TreeDir) => {
    for (const c of d.dirs) {
      out.push(c.path)
      walk(c)
    }
  }
  walk(root)
  return out
}
