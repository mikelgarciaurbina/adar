// Reusable file list of the right panel: Path view (flat, directory dimmed +
// file name) or Tree view (collapsible folders). Keyboard friendly (arrows,
// Home/End, Left/Right to collapse/expand, Enter/Space to activate, Cmd+A,
// context-menu key) and virtualised for long lists.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  Minus,
  Pencil,
  Plus,
  Replace,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import { STATUS_LETTER, statusColor } from '@renderer/lib/format'
import { isMod } from '@renderer/lib/keys'
import type { FileChange, FileStatusCode } from '@shared/types'
import { buildRows, fileBaseName, fileDirName, type FileRow, type FileViewMode } from './fileTree'

export const ROW_HEIGHT = 24
export const VIRTUALIZE_THRESHOLD = 300
/** How long after an arrow-key move the list takes its focus back from a diff view that grabbed it. */
const KEY_NAV_FOCUS_MS = 2500

const STATUS_ICON: Record<FileStatusCode, LucideIcon> = {
  added: Plus,
  untracked: Plus,
  modified: Pencil,
  deleted: Minus,
  renamed: ArrowRight,
  copied: Copy,
  typechange: Replace,
  conflicted: TriangleAlert
}

const STATUS_LABEL: Record<FileStatusCode, string> = {
  added: 'Added',
  untracked: 'Untracked',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  typechange: 'Type changed',
  conflicted: 'Conflicted'
}

export function StatusIcon({ status }: { status: FileStatusCode }) {
  const Icon = STATUS_ICON[status] ?? Pencil
  return (
    <span className="det-status" style={{ color: statusColor(status) }} title={`${STATUS_LABEL[status] ?? status} (${STATUS_LETTER[status] ?? '?'})`}>
      <Icon size={10} strokeWidth={3} />
    </span>
  )
}

/** Position-only event used to open context menus from the keyboard. */
export interface MenuAnchor {
  clientX: number
  clientY: number
  preventDefault?: () => void
  stopPropagation?: () => void
}

export interface FileListProps {
  files: readonly FileChange[]
  mode: FileViewMode
  ariaLabel: string
  /** File whose diff is currently open (highlighted). */
  activePath?: string | null
  /** Multi-selection (staging area). */
  selected?: ReadonlySet<string>
  /** Rows with an operation in flight (dimmed). */
  pending?: ReadonlySet<string>
  multiselectable?: boolean
  className?: string
  /** Extra text after the file name (e.g. conflict kind). */
  renderMeta?: (file: FileChange) => ReactNode
  /** Buttons revealed on hover / keyboard focus. */
  renderActions?: (file: FileChange) => ReactNode
  renderDirActions?: (dir: string) => ReactNode
  onRowClick: (file: FileChange, e: React.MouseEvent) => void
  onRowDoubleClick?: (file: FileChange, e: React.MouseEvent) => void
  onRowContextMenu?: (file: FileChange, e: MenuAnchor) => void
  onDirContextMenu?: (dir: string, e: MenuAnchor) => void
  /** Keyboard focus moved onto a file with the arrow keys. */
  onFocusFile?: (file: FileChange, e: React.KeyboardEvent) => void
  /** Enter / Space on a file row. */
  onActivate?: (file: FileChange, e: React.KeyboardEvent) => void
  onSelectAll?: () => void
}

interface RowCallbacks {
  click(row: FileRow, e: React.MouseEvent): void
  doubleClick(row: FileRow, e: React.MouseEvent): void
  contextMenu(row: FileRow, e: React.MouseEvent): void
}

export function FileList(props: FileListProps) {
  const { files, mode, activePath, selected, pending, ariaLabel, multiselectable, className } = props
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [hasFocus, setHasFocus] = useState(false)
  /** Keyboard focus ring only after keyboard interaction (like :focus-visible). */
  const [keyboardMode, setKeyboardMode] = useState(false)
  const lastIndex = useRef(-1)
  /** Time of the last keyboard move that may have opened a diff (see onBlur). */
  const keyNavAt = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Also kept in state: the virtualizer mounts before this element's ref is attached and
  // must re-render once it exists, or a long list renders no rows at all.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    setScrollEl(el)
  }, [])
  const virtRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const rows = useMemo(() => buildRows(files, mode, collapsed), [files, mode, collapsed])

  // A click anywhere ends the "keep focus after arrowing" window (the user chose a new target).
  useEffect(() => {
    const reset = () => {
      keyNavAt.current = 0
    }
    document.addEventListener('pointerdown', reset, true)
    return () => document.removeEventListener('pointerdown', reset, true)
  }, [])
  const virtual = rows.length > VIRTUALIZE_THRESHOLD

  const focusIndex = useMemo(() => (focusKey ? rows.findIndex((r) => r.key === focusKey) : -1), [rows, focusKey])
  if (focusIndex >= 0) lastIndex.current = focusIndex

  // When the focused row disappears (e.g. the file was staged), keep focus at the same position.
  useEffect(() => {
    if (focusKey && focusIndex < 0 && rows.length && lastIndex.current >= 0) {
      setFocusKey(rows[Math.min(lastIndex.current, rows.length - 1)].key)
    }
  }, [focusKey, focusIndex, rows])

  const scrollToIndex = useCallback((index: number) => {
    if (index < 0) return
    if (virtRef.current) {
      virtRef.current.scrollToIndex(index, { align: 'auto' })
      return
    }
    // Scroll only the list itself (scrollIntoView would also move overflow:hidden ancestors).
    const container = scrollRef.current
    const el = container?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
    if (!container || !el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (top < container.scrollTop) container.scrollTop = top
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight
  }, [])

  // Follow the open diff (e.g. prev/next navigation in the diff view).
  useLayoutEffect(() => {
    if (!activePath) return
    const key = `f:${activePath}`
    const idx = rows.findIndex((r) => r.key === key)
    if (idx >= 0) {
      setFocusKey(key)
      scrollToIndex(idx)
    }
    // Only when the active file changes, not on every row rebuild.
  }, [activePath])

  const toggleDir = useCallback((path: string, force?: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      const shouldCollapse = force ?? !next.has(path)
      if (shouldCollapse) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  const callbacks = useMemo<RowCallbacks>(
    () => ({
      click(row, e) {
        setFocusKey(row.key)
        if (row.kind === 'dir') toggleDir(row.path)
        else propsRef.current.onRowClick(row.file, e)
      },
      doubleClick(row, e) {
        if (row.kind === 'file') propsRef.current.onRowDoubleClick?.(row.file, e)
      },
      contextMenu(row, e) {
        setFocusKey(row.key)
        if (row.kind === 'file') {
          if (propsRef.current.onRowContextMenu) propsRef.current.onRowContextMenu(row.file, e)
        } else if (propsRef.current.onDirContextMenu) propsRef.current.onDirContextMenu(row.path, e)
      }
    }),
    [toggleDir]
  )

  const focusRow = (index: number, e: React.KeyboardEvent) => {
    const row = rows[index]
    if (!row) return
    keyNavAt.current = Date.now()
    setFocusKey(row.key)
    scrollToIndex(index)
    if (row.kind === 'file') props.onFocusFile?.(row.file, e)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Tabbing away is a deliberate focus move: do not pull the focus back (see onBlur).
    if (e.key === 'Tab') keyNavAt.current = 0
    // Ignore keys typed on the row action buttons (they handle Enter/Space themselves).
    if (e.target !== e.currentTarget || !rows.length) return
    if (handleKey(e)) {
      e.preventDefault()
      // Keep global handlers (e.g. graph arrow navigation) from reacting too.
      e.stopPropagation()
      if (!keyboardMode) setKeyboardMode(true)
    }
  }

  /** Returns true when the key was handled. */
  const handleKey = (e: React.KeyboardEvent): boolean => {
    const idx = focusIndex
    const row = idx >= 0 ? rows[idx] : undefined
    switch (e.key) {
      case 'ArrowDown':
        focusRow(idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1), e)
        return true
      case 'ArrowUp':
        focusRow(idx < 0 ? rows.length - 1 : Math.max(0, idx - 1), e)
        return true
      case 'Home':
        focusRow(0, e)
        return true
      case 'End':
        focusRow(rows.length - 1, e)
        return true
      case 'PageDown':
      case 'PageUp': {
        const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 240) / ROW_HEIGHT) - 1)
        const base = idx < 0 ? 0 : idx
        focusRow(e.key === 'PageDown' ? Math.min(rows.length - 1, base + page) : Math.max(0, base - page), e)
        return true
      }
      case 'ArrowLeft': {
        if (!row) return false
        if (row.kind === 'dir' && !row.collapsed) {
          toggleDir(row.path, true)
          return true
        }
        for (let i = idx - 1; i >= 0; i--) {
          const r = rows[i]
          if (r.kind === 'dir' && r.depth < row.depth) {
            setFocusKey(r.key)
            scrollToIndex(i)
            break
          }
        }
        return true
      }
      case 'ArrowRight': {
        if (!row || row.kind !== 'dir') return false
        if (row.collapsed) toggleDir(row.path, false)
        else if (rows[idx + 1]) focusRow(idx + 1, e)
        return true
      }
      case 'Enter':
      case ' ': {
        if (!row) return false
        if (row.kind === 'dir') toggleDir(row.path)
        else props.onActivate?.(row.file, e)
        return true
      }
      case 'ContextMenu':
      case 'F10': {
        if ((e.key === 'F10' && !e.shiftKey) || !row) return false
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${idx}"]`)
        const r = el?.getBoundingClientRect()
        const anchor: MenuAnchor = { clientX: (r?.left ?? 0) + 24, clientY: r?.bottom ?? 0 }
        if (row.kind === 'file') props.onRowContextMenu?.(row.file, anchor)
        else props.onDirContextMenu?.(row.path, anchor)
        return true
      }
      default:
        if (e.key.toLowerCase() === 'a' && isMod(e) && !e.shiftKey && !e.altKey && props.onSelectAll) {
          props.onSelectAll()
          return true
        }
        return false
    }
  }

  const renderRow = (row: FileRow, index: number, style?: React.CSSProperties) => {
    const isFile = row.kind === 'file'
    const path = isFile ? row.file.path : row.path
    return (
      <Row
        key={row.key}
        row={row}
        index={index}
        mode={mode}
        style={style}
        active={isFile && activePath === path}
        selected={isFile && !!selected?.has(path)}
        focused={hasFocus && keyboardMode && index === focusIndex}
        pending={isFile && !!pending?.has(path)}
        callbacks={callbacks}
        meta={isFile ? props.renderMeta?.(row.file) : undefined}
        actions={isFile ? props.renderActions?.(row.file) : props.renderDirActions?.(row.path)}
      />
    )
  }

  return (
    <div
      ref={attachScroll}
      className={`det-list${className ? ' ' + className : ''}`}
      role="listbox"
      aria-label={ariaLabel}
      aria-multiselectable={multiselectable || undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={() => {
        if (keyboardMode) setKeyboardMode(false)
      }}
      onFocus={() => setHasFocus(true)}
      onBlur={(e) => {
        const next = e.relatedTarget as HTMLElement | null
        if (e.currentTarget.contains(next)) return
        // The diff view focuses itself when it opens. When that diff was opened by arrowing
        // through this list, keep the focus here so the next arrow key moves to the next file.
        if (next?.closest('.diff-scroll') && Date.now() - keyNavAt.current < KEY_NAV_FOCUS_MS) {
          const list = e.currentTarget
          requestAnimationFrame(() => list.focus({ preventScroll: true }))
          return
        }
        setHasFocus(false)
      }}
    >
      {virtual ? (
        <VirtualRows scrollEl={scrollEl} virtRef={virtRef} rows={rows} renderRow={renderRow} />
      ) : (
        rows.map((row, i) => renderRow(row, i))
      )}
    </div>
  )
}

function VirtualRows({
  scrollEl,
  virtRef,
  rows,
  renderRow
}: {
  scrollEl: HTMLDivElement | null
  virtRef: React.RefObject<Virtualizer<HTMLDivElement, Element> | null>
  rows: FileRow[]
  renderRow: (row: FileRow, index: number, style?: React.CSSProperties) => ReactNode
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: 16
  })
  useLayoutEffect(() => {
    virtRef.current = virtualizer
    return () => {
      virtRef.current = null
    }
  }, [virtualizer, virtRef])

  return (
    <div className="det-list-virtual" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const row = rows[vi.index]
        if (!row) return null
        return renderRow(row, vi.index, { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` })
      })}
    </div>
  )
}

interface RowProps {
  row: FileRow
  index: number
  mode: FileViewMode
  style?: React.CSSProperties
  active: boolean
  selected: boolean
  focused: boolean
  pending: boolean
  callbacks: RowCallbacks
  meta?: ReactNode
  actions?: ReactNode
}

const Row = memo(function Row({ row, index, mode, style, active, selected, focused, pending, callbacks, meta, actions }: RowProps) {
  const indent = mode === 'tree' ? 8 + row.depth * 14 : 8
  const cls =
    'det-row' +
    (row.kind === 'dir' ? ' det-row-dir-node' : '') +
    (active ? ' det-row-active' : '') +
    (selected ? ' det-row-selected' : '') +
    (focused ? ' det-row-focus' : '') +
    (pending ? ' det-row-pending' : '')

  if (row.kind === 'dir') {
    return (
      <div
        className={cls}
        style={{ ...style, paddingLeft: indent }}
        data-row-index={index}
        role="option"
        aria-selected={false}
        aria-expanded={!row.collapsed}
        title={row.path}
        onClick={(e) => callbacks.click(row, e)}
        onContextMenu={(e) => callbacks.contextMenu(row, e)}
      >
        <span className="det-row-chevron">{row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
        <span className="det-row-folder">{row.collapsed ? <Folder size={13} /> : <FolderOpen size={13} />}</span>
        <span className="det-row-label">
          <span className="det-row-name det-row-dirname">{row.name}</span>
        </span>
        <span className="det-row-count">{row.count}</span>
        {actions && <span className="det-row-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>{actions}</span>}
      </div>
    )
  }

  const f = row.file
  const renamed = !!f.oldPath && f.oldPath !== f.path
  const name = fileBaseName(f.path)
  const dir = fileDirName(f.path)
  const oldName = renamed ? fileBaseName(f.oldPath!) : ''
  const oldDir = renamed ? fileDirName(f.oldPath!) : ''
  const sameDir = renamed && oldDir === dir
  const title = renamed ? `${f.oldPath} → ${f.path}` : f.path

  let label: ReactNode
  if (mode === 'tree') {
    label = renamed ? (
      <>
        <span className="det-row-old">{sameDir ? oldName : f.oldPath}</span>
        <span className="det-row-arrow">→</span>
        <span className="det-row-name">{name}</span>
      </>
    ) : (
      <span className="det-row-name">{name}</span>
    )
  } else if (renamed && !sameDir) {
    label = (
      <>
        <span className="det-row-old">{f.oldPath}</span>
        <span className="det-row-arrow">→</span>
        {dir && (
          <span className="det-row-dir">
            <bdi>{dir}/</bdi>
          </span>
        )}
        <span className="det-row-name">{name}</span>
      </>
    )
  } else {
    label = (
      <>
        {dir && (
          <span className="det-row-dir">
            <bdi>{dir}/</bdi>
          </span>
        )}
        {renamed && (
          <>
            <span className="det-row-old">{oldName}</span>
            <span className="det-row-arrow">→</span>
          </>
        )}
        <span className="det-row-name">{name}</span>
      </>
    )
  }

  const hasStats = f.binary || f.additions !== undefined || f.deletions !== undefined
  return (
    <div
      className={cls}
      style={{ ...style, paddingLeft: mode === 'tree' ? indent + 16 : indent }}
      data-row-index={index}
      role="option"
      aria-selected={selected || active}
      title={title}
      onClick={(e) => callbacks.click(row, e)}
      onDoubleClick={(e) => callbacks.doubleClick(row, e)}
      onContextMenu={(e) => callbacks.contextMenu(row, e)}
    >
      <StatusIcon status={f.status} />
      <span className="det-row-label">{label}</span>
      {meta && <span className="det-row-meta">{meta}</span>}
      {hasStats && (
        <span className="det-row-stats">
          {f.binary ? (
            <span className="det-row-bin">BIN</span>
          ) : (
            <>
              {!!f.additions && <span className="det-add">+{f.additions}</span>}
              {!!f.deletions && <span className="det-del">−{f.deletions}</span>}
            </>
          )}
        </span>
      )}
      {actions && (
        <span className="det-row-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </div>
  )
})
