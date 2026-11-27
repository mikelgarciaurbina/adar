// Editing files in Adar, pure: a repository's files as a tree, finding one by name, how a file is indented, and
// what the find bar asks. Nothing here touches the page or CodeMirror, so all of it is tested in node.

import { fuzzyMatch } from '@renderer/components/palette/fuzzy'
import type { FileListing, FolderEntry } from '@shared/files'
import type { DiffHunk, FileStatusCode, WorkingStatus } from '@shared/types'

// ── The tree ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TreeNode {
  name: string
  /** Relative to the repository, with "/" ('' for the root). */
  path: string
  kind: 'folder' | 'file'
  /** Git ignores it (a .env, node_modules). */
  ignored?: boolean
  /** A folder whose content was not listed (an ignored one, another repository): read when it is opened. */
  lazy?: boolean
  /** A link, or something that is no file: shown, never opened. */
  special?: boolean
  children?: TreeNode[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Folders first, then files, each by name as a person reads it (a2 before a10, case apart only on a tie). */
function order(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

/**
 * The tree of a repository's files. `loaded` holds what was read of the folders the listing only names (by path);
 * one not read yet is a `lazy` folder with no children.
 */
export function buildTree(listing: FileListing, loaded: Readonly<Record<string, readonly FolderEntry[]>> = {}): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }
  const folders = new Map<string, TreeNode>([['', root]])
  const folder = (path: string, ignored: boolean): TreeNode => {
    const known = folders.get(path)
    if (known) return known
    const cut = path.lastIndexOf('/')
    const parent = folder(cut < 0 ? '' : path.slice(0, cut), ignored)
    const node: TreeNode = { name: path.slice(cut + 1), path, kind: 'folder', children: [], ...(ignored ? { ignored: true } : {}) }
    parent.children!.push(node)
    folders.set(path, node)
    return node
  }
  const file = (path: string, ignored: boolean): void => {
    const cut = path.lastIndexOf('/')
    // A folder that only holds ignored files is not ignored itself.
    const parent = folder(cut < 0 ? '' : path.slice(0, cut), false)
    parent.children!.push({ name: path.slice(cut + 1), path, kind: 'file', ...(ignored ? { ignored: true } : {}) })
  }
  for (const path of listing.files) file(path, false)
  for (const path of listing.ignored) file(path, true)
  // What a folder not listed holds, as far as it was read: every folder inside it is one more to read.
  const fill = (node: TreeNode): void => {
    const entries = loaded[node.path]
    if (!entries) return
    node.children = entries.map((entry): TreeNode => {
      const path = `${node.path}/${entry.name}`
      if (entry.kind === 'folder') {
        const child: TreeNode = { name: entry.name, path, kind: 'folder', lazy: true, ...(node.ignored ? { ignored: true } : {}) }
        fill(child)
        return child
      }
      return { name: entry.name, path, kind: 'file', ...(node.ignored ? { ignored: true } : {}), ...(entry.kind !== 'file' ? { special: true } : {}) }
    })
  }
  const unlisted = (path: string, ignored: boolean): void => {
    if (folders.has(path)) return
    const cut = path.lastIndexOf('/')
    const parent = folder(cut < 0 ? '' : path.slice(0, cut), false)
    const node: TreeNode = { name: path.slice(cut + 1), path, kind: 'folder', lazy: true, ...(ignored ? { ignored: true } : {}) }
    fill(node)
    parent.children!.push(node)
    folders.set(path, node)
  }
  for (const path of listing.folders) unlisted(path, true)
  for (const path of listing.repositories) unlisted(path, false)
  const sort = (node: TreeNode): void => {
    if (!node.children) return
    node.children.sort(order)
    for (const child of node.children) sort(child)
  }
  sort(root)
  return root
}

export interface TreeRow {
  node: TreeNode
  depth: number
  /** A folder shown with its content. */
  open: boolean
}

/** The rows the tree shows: every folder in `open` with its content under it. */
export function visibleRows(root: TreeNode, open: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (node: TreeNode, depth: number): void => {
    for (const child of node.children ?? []) {
      const isOpen = child.kind === 'folder' && open.has(child.path)
      rows.push({ node: child, depth, open: isOpen })
      if (isOpen) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}

/** "a/b/c.ts" → ["a", "a/b"]: the folders to open so that a file shows. */
export function foldersAbove(path: string): string[] {
  const out: string[] = []
  for (let i = path.indexOf('/'); i >= 0; i = path.indexOf('/', i + 1)) out.push(path.slice(0, i))
  return out
}

/** The node at a path, or undefined. */
export function nodeAt(root: TreeNode, path: string): TreeNode | undefined {
  if (!path) return root
  let node: TreeNode | undefined = root
  let from = 0
  for (;;) {
    const cut = path.indexOf('/', from)
    const upTo = cut < 0 ? path : path.slice(0, cut)
    node = node?.children?.find((c) => c.path === upTo)
    if (!node || cut < 0) return node
    from = cut + 1
  }
}

/** What changed in the working tree, by path (as the list of changes tells it), and the folders that hold a change. */
export function changeMarks(status: WorkingStatus | null): { files: Map<string, FileStatusCode>; folders: Set<string> } {
  const files = new Map<string, FileStatusCode>()
  const folders = new Set<string>()
  if (!status) return { files, folders }
  const mark = (path: string, as: FileStatusCode): void => {
    // A file that is gone is not in the tree.
    if (as === 'deleted' || files.get(path) === 'conflicted') return
    files.set(path, as)
    for (const f of foldersAbove(path)) folders.add(f)
  }
  for (const f of status.staged) mark(f.path, f.status)
  for (const f of status.unstaged) mark(f.path, f.status)
  for (const f of status.conflicted) mark(f.path, 'conflicted')
  return { files, folders }
}

// ── Finding a file by name ─────────────────────────────────────────────────────────────────────────────────────────

export interface FoundFile {
  path: string
  ignored: boolean
  /** Indexes into `path` of the letters that matched. */
  indexes: number[]
  score: number
}

/**
 * The files whose name (or, failing that, whose path) has the query's letters in order, best first. A query with a
 * slash is read against the whole path. A match in the name counts for more than one in the folders, a tracked file
 * for more than an ignored one, and a shorter path wins a tie.
 */
export function findFiles(listing: Pick<FileListing, 'files' | 'ignored'>, query: string, limit = 50): FoundFile[] {
  const q = query.trim()
  if (!q) return []
  const whole = q.includes('/')
  const found: FoundFile[] = []
  const see = (path: string, ignored: boolean): void => {
    const cut = path.lastIndexOf('/') + 1
    const inName = whole ? null : fuzzyMatch(q, cut ? path.slice(cut) : path)
    if (inName) {
      found.push({ path, ignored, indexes: cut ? inName.indexes.map((i) => i + cut) : inName.indexes, score: inName.score + 100_000 - (ignored ? 20_000 : 0) })
      return
    }
    const inPath = fuzzyMatch(q, path)
    if (inPath) found.push({ path, ignored, indexes: inPath.indexes, score: inPath.score - (ignored ? 20_000 : 0) })
  }
  for (const path of listing.files) see(path, false)
  for (const path of listing.ignored) see(path, true)
  found.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1))
  return found.length > limit ? found.slice(0, limit) : found
}

// ── A file's text ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Indent {
  /** Indented with tabs. */
  tabs: boolean
  /** Spaces of one level; with tabs, how wide a tab is shown. */
  size: number
}

/**
 * How a file is indented, read from its first lines: with tabs when more lines start with one than with spaces, else
 * with the step most often found between a line and the next deeper one (2 or 4 as a rule). Two spaces when the file
 * does not say.
 */
export function detectIndent(text: string): Indent {
  let tabs = 0
  let spaces = 0
  const steps = new Map<number, number>()
  let previous = 0
  let line = 0
  for (let at = 0; at < text.length && line < 2000; line++) {
    let end = text.indexOf('\n', at)
    if (end < 0) end = text.length
    let i = at
    while (i < end && text.charCodeAt(i) === 32) i++
    const width = i - at
    const first = i < end ? text.charCodeAt(i) : 0
    if (width === 0 && first === 9) {
      tabs++
      previous = 0
    } else if (first && first !== 13) {
      // A line of text. " * " of a comment block is no indent of its own.
      if (width > 0 && first !== 42) {
        spaces++
        const step = width - previous
        if (step > 1 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1)
      }
      if (first !== 42) previous = width
    }
    at = end + 1
  }
  if (tabs > spaces) return { tabs: true, size: 4 }
  let size = 2
  let best = 0
  for (const [step, count] of steps) {
    if (count > best || (count === best && step < size)) {
      size = step
      best = count
    }
  }
  return { tabs: false, size: best ? size : 2 }
}

/** What the find bar asks the editor. */
export interface FindOptions {
  text: string
  replace: string
  matchCase: boolean
  regexp: boolean
  wholeWord: boolean
}

/** "1 of 12", "No results", "9999+": what the find bar says of a count. */
export function countLabel(count: { total: number; current: number; more: boolean } | null, text: string): string {
  if (!text || !count) return ''
  if (!count.total) return 'No results'
  const total = `${count.total}${count.more ? '+' : ''}`
  return count.current ? `${count.current} of ${total}` : total
}

/** Lines and columns as people count them, from where the cursor is in a line. */
export function positionLabel(line: number, column: number, selected: number, lines: number): string {
  const at = `Ln ${line}, Col ${column}`
  if (selected > 0) return `${at} (${selected} selected${lines > 1 ? `, ${lines} lines` : ''})`
  return at
}

/**
 * The line of the file (its new side) where a diff's change number `index` starts, counting the runs of added and
 * removed lines from 0; the first one when `index` is before it. A change that only removes lines is told by the line
 * after it. Undefined when the diff has no change.
 */
export function lineOfChange(hunks: readonly DiffHunk[], index: number): number | undefined {
  let seen = -1
  let first: number | undefined
  for (const hunk of hunks) {
    let inChange = false
    let before = Math.max(1, hunk.newStart)
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]
      if (line.type === 'context') {
        inChange = false
        if (line.newLine !== null) before = line.newLine + 1
        continue
      }
      if (inChange) continue
      inChange = true
      seen++
      // The first added line of the run, or where the lines removed were.
      let at: number | undefined
      for (let j = i; j < hunk.lines.length && hunk.lines[j].type !== 'context'; j++) {
        const added = hunk.lines[j].newLine
        if (hunk.lines[j].type === 'add' && added !== null) {
          at = added
          break
        }
      }
      at ??= before
      first ??= at
      if (seen === index) return at
    }
  }
  return first
}
