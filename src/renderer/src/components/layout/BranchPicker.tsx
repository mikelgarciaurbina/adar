// Toolbar "branch" popover: filterable list of local branches (and untracked remote
// branches) to checkout, plus "Create branch…". Virtualised for repos with many refs.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Cloud, GitBranch, GitBranchPlus, Search } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { fuzzyFilter, highlightSegments } from '@renderer/components/palette/fuzzy'
import type { RepoTab } from '@renderer/store/appStore'
import type { Ref } from '@shared/types'
import { useDismiss } from './hooks'

type Row =
  | { kind: 'header'; label: string }
  | { kind: 'local'; ref: Ref; indexes: number[] }
  | { kind: 'remote'; ref: Ref; indexes: number[] }
  | { kind: 'create' }
  | { kind: 'empty'; label: string }

const ROW_H = 28
const HEADER_H = 24
const LOCAL_LIMIT = 1000
const REMOTE_LIMIT = 300

function isSelectable(r: Row | undefined): boolean {
  return !!r && (r.kind === 'local' || r.kind === 'remote' || r.kind === 'create')
}

export function BranchPicker({ tab, anchor, onClose }: { tab: RepoTab; anchor: HTMLElement; onClose: () => void }) {
  const repo = tab.path
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect()
    const width = 340
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    const top = r.bottom + 4
    return { left, top, width, maxHeight: Math.max(200, Math.min(460, window.innerHeight - top - 16)) }
  })

  const isInside = useCallback((t: Node) => !!panelRef.current?.contains(t) || anchor.contains(t), [anchor])
  useDismiss(true, isInside, onClose)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const rows = useMemo<Row[]>(() => {
    const refs = tab.refs
    if (!refs) return [{ kind: 'empty', label: 'Loading branches…' }]
    const locals = [...refs.branches].sort((a, b) => (a.isHead === b.isHead ? 0 : a.isHead ? -1 : 1))
    const tracked = new Set(refs.branches.map((b) => b.upstream).filter(Boolean) as string[])
    const remotes = refs.remotes.filter((r) => !r.isSymbolic && !tracked.has(r.name))
    const localRes = fuzzyFilter(locals, query, (b) => b.name, LOCAL_LIMIT)
    const remoteRes = fuzzyFilter(remotes, query, (b) => b.name, REMOTE_LIMIT)
    const out: Row[] = [{ kind: 'header', label: `Local (${refs.branches.length})` }]
    if (localRes.length) for (const r of localRes) out.push({ kind: 'local', ref: r.item, indexes: r.indexes })
    else out.push({ kind: 'empty', label: query ? 'No matching local branches' : 'No local branches yet' })
    if (remoteRes.length) {
      out.push({ kind: 'header', label: query ? 'Remote' : `Remote (${remotes.length} not checked out)` })
      for (const r of remoteRes) out.push({ kind: 'remote', ref: r.item, indexes: r.indexes })
    }
    out.push({ kind: 'create' })
    return out
  }, [tab.refs, query])

  // Reset the active row when the filter changes (first match while filtering,
  // otherwise the first branch not checked out). A background refs refresh keeps
  // the current position unless it no longer points at a selectable row.
  const lastQuery = useRef<string | null>(null)
  useEffect(() => {
    if (lastQuery.current === query && isSelectable(rows[active])) return
    lastQuery.current = query
    const preferred = query ? -1 : rows.findIndex((r) => r.kind === 'local' && !r.ref.isHead)
    setActive(preferred >= 0 ? preferred : rows.findIndex(isSelectable))
    // `active` is intentionally read but not a dependency.
  }, [rows, query])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? HEADER_H : ROW_H),
    overscan: 10
  })

  useLayoutEffect(() => {
    if (active >= 0) virtualizer.scrollToIndex(active, { align: 'auto' })
  }, [active, virtualizer])

  const run = (row: Row | undefined) => {
    if (!row) return
    if (row.kind === 'local') {
      onClose()
      if (!row.ref.isHead) void git.checkout(repo, row.ref.name)
    } else if (row.kind === 'remote') {
      onClose()
      void git.checkoutRemote(repo, row.ref)
    } else if (row.kind === 'create') {
      onClose()
      void git.createBranch(repo)
    }
  }

  const move = (dir: 1 | -1) => {
    if (!rows.some(isSelectable)) return
    let i = active
    for (let n = 0; n < rows.length; n++) {
      i = (i + dir + rows.length) % rows.length
      if (isSelectable(rows[i])) break
    }
    setActive(i)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(rows[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  const listHeight = Math.min(virtualizer.getTotalSize(), pos.maxHeight - 48)

  return createPortal(
    <div
      ref={panelRef}
      className="tb-popover tb-branch-picker"
      style={{ left: pos.left, top: pos.top, width: pos.width }}
      role="dialog"
      aria-label="Switch branch"
      onKeyDown={onKeyDown}
    >
      <div className="tb-popover-search">
        <Search size={13} />
        <input
          ref={inputRef}
          className="tb-popover-input"
          placeholder="Filter branches…"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter branches"
        />
      </div>
      <div ref={listRef} className="tb-popover-list" style={{ height: listHeight }} role="listbox">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]
            const style: React.CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }
            if (row.kind === 'header')
              return (
                <div key={vi.key} className="tb-popover-header" style={style}>
                  {row.label}
                </div>
              )
            if (row.kind === 'empty')
              return (
                <div key={vi.key} className="tb-popover-empty" style={style}>
                  {row.label}
                </div>
              )
            const isActive = vi.index === active
            const common = {
              style,
              role: 'option',
              'aria-selected': isActive,
              className: `tb-popover-item${isActive ? ' tb-active' : ''}`,
              onMouseMove: () => active !== vi.index && setActive(vi.index),
              onClick: () => run(row)
            }
            if (row.kind === 'create')
              return (
                <div key={vi.key} {...common} className={`${common.className} tb-popover-create`}>
                  <GitBranchPlus size={14} />
                  <span className="tb-popover-name">Create branch…</span>
                </div>
              )
            const ref = row.ref
            return (
              <div key={vi.key} {...common} title={ref.upstream ? `${ref.name} → ${ref.upstream}` : ref.name}>
                <span className="tb-popover-icon">
                  {row.kind === 'local' ? ref.isHead ? <Check size={14} className="tb-head-check" /> : <GitBranch size={14} /> : <Cloud size={14} />}
                </span>
                <span className={`tb-popover-name${ref.isHead ? ' tb-popover-current' : ''}`}>
                  {highlightSegments(ref.name, row.indexes).map((s, i) =>
                    s.match ? (
                      <mark key={i} className="tb-match">
                        {s.text}
                      </mark>
                    ) : (
                      <span key={i}>{s.text}</span>
                    )
                  )}
                </span>
                {row.kind === 'local' && (
                  <span className="tb-popover-meta">
                    {ref.upstreamGone && <span className="tb-gone">gone</span>}
                    {!!ref.ahead && <span className="tb-ab">↑{ref.ahead}</span>}
                    {!!ref.behind && <span className="tb-ab">↓{ref.behind}</span>}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}
