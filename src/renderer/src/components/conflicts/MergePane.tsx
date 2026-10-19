// One read-only side ("A — ours" / "B — theirs") of the merge tool. Rows are
// virtualised and aligned with the other side (see buildPaneRows) so both
// panes can scroll in lock-step.

import { forwardRef, memo, useCallback, useImperativeHandle, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChunkChoice, PaneRow, Side } from './conflictParser'
import { sideChecked } from './conflictParser'

export const PANE_ROW_H = 20

export interface MergePaneHandle {
  element: HTMLDivElement | null
  /** Scroll so that `row` sits about a third down the viewport. */
  revealRow(row: number, behavior?: ScrollBehavior): void
}

export interface MergePaneProps {
  side: Side
  /** "A" / "B" */
  letter: string
  label: string
  rows: PaneRow[]
  choices: ReadonlyArray<ChunkChoice | null | undefined>
  currentChunk: number
  /** Longest line in columns — sizes the horizontal scroll area (same for both panes). */
  columns: number
  /** Per-chunk tooltip with the common-ancestor lines (diff3), if any. */
  baseTitles?: ReadonlyArray<string | undefined>
  /** State of the "take all" checkbox in the header. */
  allState: 'all' | 'some' | 'none'
  chunkCount: number
  headerExtra?: ReactNode
  onToggle(chunk: number): void
  onToggleAll(): void
  onSelectChunk(chunk: number): void
  onChunkMenu(e: React.MouseEvent, chunk: number): void
  onScroll(side: Side, el: HTMLDivElement): void
}

export const MergePane = forwardRef<MergePaneHandle, MergePaneProps>(function MergePane(props, ref) {
  const { side, letter, label, rows, choices, currentChunk, columns, baseTitles, allState, chunkCount, headerExtra } = props
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PANE_ROW_H,
    overscan: 24
  })

  useImperativeHandle(
    ref,
    () => ({
      get element() {
        return scrollRef.current
      },
      revealRow(row: number, behavior: ScrollBehavior = 'auto') {
        const el = scrollRef.current
        if (!el) return
        el.scrollTo({ top: Math.max(0, row * PANE_ROW_H - el.clientHeight / 3), behavior })
      }
    }),
    []
  )

  const maxLineNo = rows.length ? lastLineNo(rows) : 1
  const gutterCh = Math.max(3, String(maxLineNo).length)
  const sizerWidth = `max(100%, calc(${columns + gutterCh + 4}ch + 34px))`

  const checkAllRef = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = allState === 'some'
    },
    [allState]
  )

  return (
    <section className={`cf-pane cf-pane-${side}`} aria-label={`${letter} — ${label}`}>
      <header className="cf-pane-header">
        <label className="cf-pane-checkall" title={chunkCount ? `Take every conflict from ${letter}` : 'No conflicts'}>
          <input
            ref={checkAllRef}
            type="checkbox"
            checked={allState === 'all'}
            disabled={!chunkCount}
            onChange={() => props.onToggleAll()}
          />
        </label>
        <span className="cf-pane-letter">{letter}</span>
        <span className="cf-pane-label" title={label}>
          {label}
        </span>
        <span className="cf-pane-header-spacer" />
        {headerExtra}
      </header>
      <div
        ref={scrollRef}
        className="cf-pane-scroll"
        onScroll={(e) => props.onScroll(side, e.currentTarget)}
        style={{ ['--cf-gutter-ch' as string]: gutterCh }}
      >
        <div className="cf-pane-sizer" style={{ height: virtualizer.getTotalSize(), width: sizerWidth }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]
            const chunk = row.kind === 'common' ? -1 : row.chunk
            return (
              <PaneRowView
                key={vi.index}
                row={row}
                side={side}
                top={vi.start}
                choice={chunk >= 0 ? (choices[chunk] ?? null) : null}
                current={chunk >= 0 && chunk === currentChunk}
                baseTitle={chunk >= 0 && row.kind !== 'common' && row.first ? baseTitles?.[chunk] : undefined}
                letter={letter}
                onToggle={props.onToggle}
                onSelectChunk={props.onSelectChunk}
                onChunkMenu={props.onChunkMenu}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
})

function lastLineNo(rows: PaneRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.kind !== 'filler') return r.lineNo
  }
  return 1
}

interface RowProps {
  row: PaneRow
  side: Side
  top: number
  choice: ChunkChoice | null
  current: boolean
  baseTitle?: string
  letter: string
  onToggle(chunk: number): void
  onSelectChunk(chunk: number): void
  onChunkMenu(e: React.MouseEvent, chunk: number): void
}

const PaneRowView = memo(function PaneRowView({ row, side, top, choice, current, baseTitle, letter, onToggle, onSelectChunk, onChunkMenu }: RowProps) {
  const style = { transform: `translateY(${top}px)`, height: PANE_ROW_H }
  if (row.kind === 'common') {
    return (
      <div className="cf-row" style={style}>
        <span className="cf-gutter">{row.lineNo}</span>
        <span className="cf-check" />
        <span className="cf-text">{row.text || ' '}</span>
      </div>
    )
  }

  const taken = sideChecked(choice, side)
  const other: Side = side === 'ours' ? 'theirs' : 'ours'
  const state = !choice ? 'cf-unresolved' : taken ? 'cf-taken' : sideChecked(choice, other) ? 'cf-rejected' : 'cf-neither'
  const cls = [
    'cf-row',
    'cf-row-chunk',
    state,
    row.first ? 'cf-chunk-first' : '',
    row.last ? 'cf-chunk-last' : '',
    row.kind === 'filler' ? 'cf-row-filler' : '',
    current ? 'cf-current' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={style}
      onMouseDown={() => onSelectChunk(row.chunk)}
      onContextMenu={(e) => {
        onSelectChunk(row.chunk)
        onChunkMenu(e, row.chunk)
      }}
      title={baseTitle}
    >
      <span className="cf-gutter">{row.kind === 'chunk' ? row.lineNo : ''}</span>
      <span className="cf-check">
        {row.first && (
          <input
            type="checkbox"
            checked={taken}
            aria-label={`Take conflict ${row.chunk + 1} from ${letter}`}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={() => {
              onSelectChunk(row.chunk)
              onToggle(row.chunk)
            }}
          />
        )}
      </span>
      {row.kind === 'chunk' ? (
        <span className="cf-text">{row.text || ' '}</span>
      ) : (
        <span className="cf-text cf-text-placeholder">{row.first && row.empty ? `No lines in ${letter}` : ''}</span>
      )}
    </div>
  )
})
