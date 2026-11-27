// The tree of a repository's files, to find the one to edit: folders that open and close, the files git ignores
// (a .env) dimmed among the others, what changed marked as in the list of changes, and a field that finds a file by
// name. It finds and opens: creating, renaming and moving files is not done here.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, ClipboardCopy, Copy, ExternalLink, File, FileSymlink, Folder, FolderGit2, FolderOpen, RefreshCw, RotateCcwClock, ScanText, Search, SquarePen, X } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { isMac } from '@renderer/api/client'
import { Spinner } from '@renderer/components/common/Button'
import { showContextMenu, type MenuItem } from '@renderer/components/common/ContextMenu'
import { highlightSegments } from '@renderer/components/palette/fuzzy'
import { STATUS_LETTER, statusColor } from '@renderer/lib/format'
import type { WorkingStatus } from '@shared/types'
import { loadFiles, loadFolder, setOpenFolders, shapeOf, useFiles } from './fileList'
import { buildTree, changeMarks, findFiles, foldersAbove, visibleRows, type FoundFile, type TreeNode, type TreeRow } from './model'

const ROW = 26
const FOLDER = isMac ? 'Show in Finder' : 'Show in folder'

export interface FileTreeProps {
  repo: string
  status: WorkingStatus | null
  /** The file being edited (relative to the repository). */
  current?: string
  /** The file being edited has text that was not saved. */
  unsaved?: boolean
  onOpen(path: string): void
}

type Row = { kind: 'node'; row: TreeRow } | { kind: 'found'; file: FoundFile }
const pathOf = (r: Row): string => (r.kind === 'node' ? r.row.node.path : r.file.path)

export function FileTree({ repo, status, current, unsaved, onOpen }: FileTreeProps) {
  const listed = useFiles(repo, shapeOf(status))
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  const root = useMemo(() => (listed.listing ? buildTree(listed.listing, listed.folders) : null), [listed.listing, listed.folders])
  const open = useMemo(() => new Set(listed.open), [listed.open])
  const marks = useMemo(() => changeMarks(status), [status])
  // Typing stays quick in a very large repository: the list follows a moment behind.
  const sought = useDeferredValue(query)
  const rows = useMemo<Row[]>(() => {
    if (!listed.listing || !root) return []
    if (sought.trim()) return findFiles(listed.listing, sought, 200).map((file) => ({ kind: 'found', file }))
    return visibleRows(root, open).map((row) => ({ kind: 'node', row }))
  }, [listed.listing, root, open, sought])

  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 14 })

  // The file being edited shows in the tree: its folders open, its row in view.
  const revealed = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!current || !root || revealed.current === current) return
    revealed.current = current
    const above = foldersAbove(current).filter((f) => !open.has(f))
    if (above.length) setOpenFolders(repo, [...listed.open, ...above])
    setActive(current)
  }, [current, root])
  useEffect(() => {
    if (!active) return
    const index = rows.findIndex((r) => pathOf(r) === active)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
  }, [active, rows.length])

  const toggle = (node: TreeNode): void => {
    const isOpen = open.has(node.path)
    setOpenFolders(repo, isOpen ? listed.open.filter((p) => p !== node.path) : [...listed.open, node.path])
    if (!isOpen && node.lazy) void loadFolder(repo, node.path)
  }

  const choose = (r: Row): void => {
    setActive(pathOf(r))
    if (r.kind === 'found') return onOpen(r.file.path)
    const node = r.row.node
    if (node.kind === 'folder') toggle(node)
    else if (!node.special) onOpen(node.path)
  }

  const menu = (e: React.MouseEvent, r: Row): void => {
    setActive(pathOf(r))
    const path = pathOf(r)
    const abs = git.absPath(repo, path)
    const isFolder = r.kind === 'node' && r.row.node.kind === 'folder'
    const tracked = r.kind === 'found' ? !r.file.ignored : !r.row.node.ignored && !marks.files.has(path)
    const items: MenuItem[] = isFolder
      ? [
          { label: FOLDER, icon: <FolderOpen size={14} />, onClick: () => git.showInFolder(abs) },
          { type: 'separator' },
          { label: 'Copy path', icon: <Copy size={14} />, onClick: () => git.copyText(path, 'Path copied') },
          { label: 'Copy full path', icon: <ClipboardCopy size={14} />, onClick: () => git.copyText(abs, 'Full path copied') },
          { type: 'separator' },
          { label: 'Close every folder', disabled: !listed.open.length, onClick: () => setOpenFolders(repo, []) }
        ]
      : [
          { label: 'Edit', icon: <SquarePen size={14} />, onClick: () => onOpen(path) },
          { type: 'separator' },
          { label: 'File history', icon: <RotateCcwClock size={14} />, disabled: !tracked, onClick: () => git.openFileHistory(repo, path) },
          { label: 'Blame', icon: <ScanText size={14} />, disabled: !tracked, onClick: () => git.openBlame(repo, path) },
          { type: 'separator' },
          { label: 'Open in your editor', icon: <ExternalLink size={14} />, onClick: () => void git.openInEditor(abs) },
          { label: FOLDER, icon: <FolderOpen size={14} />, onClick: () => git.showInFolder(abs) },
          { type: 'separator' },
          { label: 'Copy path', icon: <Copy size={14} />, onClick: () => git.copyText(path, 'Path copied') },
          { label: 'Copy full path', icon: <ClipboardCopy size={14} />, onClick: () => git.copyText(abs, 'Full path copied') }
        ]
    showContextMenu(e, items)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!rows.length) return
    const index = active ? rows.findIndex((r) => pathOf(r) === active) : -1
    const go = (to: number): void => setActive(pathOf(rows[Math.max(0, Math.min(rows.length - 1, to))]))
    const at = index >= 0 ? rows[index] : null
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        go(index + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        go(index < 0 ? 0 : index - 1)
        break
      case 'Home':
        e.preventDefault()
        go(0)
        break
      case 'End':
        e.preventDefault()
        go(rows.length - 1)
        break
      case 'ArrowRight':
        if (at?.kind !== 'node' || at.row.node.kind !== 'folder') break
        e.preventDefault()
        if (!at.row.open) toggle(at.row.node)
        else go(index + 1)
        break
      case 'ArrowLeft': {
        if (at?.kind !== 'node') break
        e.preventDefault()
        if (at.row.node.kind === 'folder' && at.row.open) toggle(at.row.node)
        else {
          const cut = at.row.node.path.lastIndexOf('/')
          if (cut >= 0) setActive(at.row.node.path.slice(0, cut))
        }
        break
      }
      case 'Enter':
        if (!at) break
        e.preventDefault()
        choose(at)
        break
      case 'Escape':
        if (query) {
          e.preventDefault()
          e.stopPropagation()
          setQuery('')
        }
        break
    }
  }

  const count = listed.listing ? listed.listing.files.length + listed.listing.ignored.length : 0

  return (
    <div className="ed-tree" onKeyDown={onKeyDown}>
      <div className="ed-tree-head">
        <Search size={13} className="ed-tree-search" />
        <input
          ref={field}
          className="ed-tree-field"
          placeholder="Find a file"
          aria-label="Find a file by name"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(null)
          }}
          data-file-filter
        />
        {query ? (
          <button type="button" className="ed-tree-tool" title="Clear" aria-label="Clear" onClick={() => (setQuery(''), field.current?.focus())}>
            <X size={13} />
          </button>
        ) : (
          <button type="button" className="ed-tree-tool" title="List the files again" aria-label="List the files again" onClick={() => void loadFiles(repo)}>
            {listed.loading ? <Spinner size="sm" /> : <RefreshCw size={13} />}
          </button>
        )}
      </div>
      <div className="ed-tree-rows" ref={scroller} tabIndex={0} role="tree" aria-label="Files">
        {!listed.listing && listed.loading && (
          <div className="ed-tree-note">
            <Spinner size="sm" /> Listing the files…
          </div>
        )}
        {listed.error && !listed.listing && <div className="ed-tree-note ed-tree-failed">{listed.error}</div>}
        {listed.listing && !rows.length && <div className="ed-tree-note">{query ? 'No file by that name' : 'No files here yet'}</div>}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const r = rows[item.index]
            const path = pathOf(r)
            const isCurrent = path === current
            const className = `ed-row${isCurrent ? ' ed-row-current' : ''}${path === active ? ' ed-row-active' : ''}`
            const style = { transform: `translateY(${item.start}px)`, height: ROW }
            if (r.kind === 'found') {
              const cut = r.file.path.lastIndexOf('/') + 1
              const mark = marks.files.get(path)
              return (
                <div key={path} className={`${className}${r.file.ignored ? ' ed-row-ignored' : ''}`} style={style} role="treeitem" aria-selected={isCurrent} title={path} onClick={() => choose(r)} onContextMenu={(e) => menu(e, r)}>
                  <File size={14} className="ed-row-icon" />
                  <span className="ed-row-name">
                    {highlightSegments(r.file.path.slice(cut), r.file.indexes.filter((i) => i >= cut).map((i) => i - cut)).map((seg, i) => (seg.match ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>))}
                  </span>
                  <span className="ed-row-folder">{cut ? r.file.path.slice(0, cut - 1) : ''}</span>
                  {mark && (
                    <span className="ed-row-mark" style={{ color: statusColor(mark) }}>
                      {STATUS_LETTER[mark]}
                    </span>
                  )}
                </div>
              )
            }
            const { node, depth } = r.row
            const isFolder = node.kind === 'folder'
            const mark = isFolder ? undefined : marks.files.get(path)
            const holdsChange = isFolder && marks.folders.has(path)
            const reading = isFolder && listed.reading.includes(path)
            return (
              <div
                key={path}
                className={`${className}${node.ignored ? ' ed-row-ignored' : ''}${node.special ? ' ed-row-special' : ''}`}
                style={{ ...style, paddingLeft: 8 + depth * 14 }}
                role="treeitem"
                aria-expanded={isFolder ? r.row.open : undefined}
                aria-selected={isCurrent}
                title={node.special ? `${path} is a link: Adar does not follow one` : path}
                onClick={() => choose(r)}
                onContextMenu={(e) => menu(e, r)}
              >
                {isFolder ? (
                  <>
                    <span className="ed-row-twist">{r.row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                    {node.lazy && !node.ignored ? <FolderGit2 size={14} className="ed-row-icon" /> : r.row.open ? <FolderOpen size={14} className="ed-row-icon" /> : <Folder size={14} className="ed-row-icon" />}
                  </>
                ) : (
                  <>
                    <span className="ed-row-twist" />
                    {node.special ? <FileSymlink size={14} className="ed-row-icon" /> : <File size={14} className="ed-row-icon" />}
                  </>
                )}
                <span className="ed-row-name" style={mark ? { color: statusColor(mark) } : undefined}>
                  {node.name}
                </span>
                {reading && <Spinner size="sm" />}
                {isCurrent && unsaved && <span className="ed-row-unsaved" role="img" aria-label="Not saved" title="Not saved" />}
                {mark && (
                  <span className="ed-row-mark" style={{ color: statusColor(mark) }}>
                    {STATUS_LETTER[mark]}
                  </span>
                )}
                {holdsChange && <span className="ed-row-holds" title="Holds changes" />}
              </div>
            )
          })}
        </div>
      </div>
      {listed.listing && (
        <div className="ed-tree-foot">
          {count.toLocaleString()} {count === 1 ? 'file' : 'files'}
          {listed.listing.truncated && <span title="A very large repository: the tree shows the first files only. Find one by name in the palette."> · not all listed</span>}
        </div>
      )}
    </div>
  )
}
