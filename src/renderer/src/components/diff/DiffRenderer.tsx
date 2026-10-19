// Virtualised text diff renderer shared by the diff view and file history:
// unified and side-by-side ("split") layouts, changed hunks only or the whole
// file, line numbers, syntax + word-level highlighting, hunk headers with
// stage/unstage/discard buttons (per change block in full-file mode) and gutter
// line selection (click, shift-click, drag) for partial staging.

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleSlash, Minus, Plus, Trash2 } from 'lucide-react'
import type { HunkSelection, PatchMode } from '@shared/patch'
import type { DiffLine, DiffViewMode, FileDiff } from '@shared/types'
import {
  anchorRow,
  blockRangeLabel,
  blockSelection,
  buildDiffModel,
  changeKeysInRange,
  hunkRangeLabel,
  lineKey,
  rowChangeKey,
  rowLines,
  type ChangeBlock,
  type DiffModel,
  type LineAnchor,
  type SelectSide,
  type SplitRow,
  type UnifiedRow
} from './diffModel'
import type { Token } from './highlight'
import { useSyntax } from './useSyntax'
import { wordDiff, type Range, type WordDiff } from './wordDiff'

const ROW_H = 20
const HUNK_H = 30

export interface DiffStaging {
  /** Which side of the index the diff shows. */
  kind: 'unstaged' | 'staged'
  /** Hunk / line level operations available (false → header-level actions only). */
  enabled: boolean
  /** Selected change lines as `${hunkIndex}:${lineIndex}` keys. */
  selected: ReadonlySet<string>
  onSelect(next: Set<string>): void
  onHunk(hunkIndex: number, mode: PatchMode): void
  /** Apply one change block (the per-block buttons of the full-file view). */
  onBlock(selection: HunkSelection, mode: PatchMode): void
  busy: boolean
}

export interface DiffRendererHandle {
  /** Scroll to the next / previous block of changes. */
  jumpChange(dir: 1 | -1): void
  focus(): void
}

export interface DiffRendererProps {
  diff: FileDiff
  /** Layout: one column or side by side. */
  mode: DiffViewMode
  /** `diff` holds the whole file (requested with full context): no hunk headers, per-block actions. */
  fullFile?: boolean
  /** Path used for language detection. */
  path: string
  staging?: DiffStaging | null
  handle?: MutableRefObject<DiffRendererHandle | null>
  /** New content: scroll back to the top (to the first change in full-file mode) whenever this changes. */
  resetKey?: string | number
  autoFocus?: boolean
}

type Row = UnifiedRow | SplitRow

const WHOLE_FILE_STATUS = new Set<FileDiff['status']>(['added', 'untracked', 'deleted'])

/** Rows of context kept above a change when scrolling to it. */
const LEAD_ROWS = 3

export function DiffRenderer({ diff, mode, fullFile = false, path, staging, handle, resetKey, autoFocus }: DiffRendererProps) {
  const split = mode === 'split'
  // A lone hunk that is the whole file (full-file mode, added / deleted files) needs no header.
  const wholeFile = fullFile || (diff.hunks.length === 1 && WHOLE_FILE_STATUS.has(diff.status))
  const model = useMemo(() => buildDiffModel(diff, { hunkHeaders: !wholeFile }), [diff, wholeFile])
  const rows: Row[] = split ? model.split : model.unified
  const rowBlock = split ? model.splitBlock : model.unifiedBlock
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewportW, setViewportW] = useState(0)
  /** Change block whose action buttons are hovered (its lines are highlighted). */
  const [hotBlock, setHotBlock] = useState(-1)
  /** Change block under the mouse (its action buttons show their labels). */
  const [hoverBlock, setHoverBlock] = useState(-1)
  const hoverRef = useRef(-1)

  // ── Syntax & word highlighting ────────────────────────────────────────────
  const blocks = useMemo(() => model.hunks.flatMap((h) => [h.oldText, h.newText]), [model])
  const lookup = useSyntax(path, blocks)
  const wordCache = useRef({ diff, map: new Map<string, WordDiff | null>() })
  if (wordCache.current.diff !== diff) wordCache.current = { diff, map: new Map() }

  const tokensFor = useCallback(
    (h: number, i: number, line: DiffLine): Token[] | null => {
      const hm = model.hunks[h]
      return line.type === 'del' ? lookup(2 * h, hm.oldPos[i]) : lookup(2 * h + 1, hm.newPos[i])
    },
    [model, lookup]
  )

  const wordsFor = useCallback(
    (h: number, i: number, line: DiffLine): Range[] | null => {
      if (line.type === 'context') return null
      const p = model.hunks[h].pair[i]
      if (p < 0) return null
      const key = `${h}:${Math.min(i, p)}`
      const cache = wordCache.current.map
      let wd = cache.get(key)
      if (wd === undefined) {
        const other = diff.hunks[h].lines[p]
        wd = line.type === 'del' ? wordDiff(line.content, other.content) : wordDiff(other.content, line.content)
        cache.set(key, wd)
      }
      if (!wd) return null
      return line.type === 'del' ? wd.a : wd.b
    },
    [model, diff]
  )

  /** "CRLF" / "LF" when a change only differs from its counterpart by the line ending. */
  const eolFor = useCallback(
    (h: number, i: number, line: DiffLine): string | null => {
      if (line.type === 'context') return null
      const p = model.hunks[h].pair[i]
      if (p < 0) return null
      const other = diff.hunks[h].lines[p]
      if (!other || other.content !== line.content || !!other.crlf === !!line.crlf) return null
      return line.crlf ? 'CRLF' : 'LF'
    },
    [model, diff]
  )

  // ── Virtualisation ────────────────────────────────────────────────────────
  // Keys encode the row identity so measured (split, wrapped) heights survive
  // reloads and positions are recomputed whenever the row structure changes.
  const getItemKey = useCallback((i: number) => rowKey(rows[i]), [rows])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'hunk' ? HUNK_H : ROW_H),
    getItemKey,
    overscan: 24,
    useFlushSync: false
  })

  // Starts of change blocks, for next/previous change navigation and "scroll to the first change".
  const changeStarts = useMemo(() => model.blocks.map((b) => (split ? b.splitRow : b.unifiedRow)), [model, split])

  // ── Scroll position across layout / full-file switches ────────────────────
  // The first line on screen is tracked while scrolling; when the layout or the
  // amount of context changes the view scrolls back to that line. New content
  // (resetKey), or a switch to the full file while at the top, starts at the
  // first change in full-file mode (at the top otherwise).
  const view = useRef({ rows, model })
  view.current = { rows, model }
  const anchor = useRef<LineAnchor | null>(null)
  const recordAnchor = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { rows: rs, model: m } = view.current
    let idx = virtualizer.getVirtualItemForOffset(el.scrollTop + 1)?.index ?? -1
    if (idx < 0) return
    if (el.scrollTop <= 0) {
      anchor.current = null
      return
    }
    while (idx < rs.length && rs[idx].kind === 'hunk') idx++
    anchor.current = rowLines(m, rs[idx]) ?? anchor.current
  }, [virtualizer])

  const shown = useRef<{ split: boolean; fullFile: boolean; resetKey: unknown } | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const prev = shown.current
    shown.current = { split, fullFile, resetKey }
    if (!el || (prev && prev.split === split && prev.fullFile === fullFile && prev.resetKey === resetKey)) return
    const offsetOf = (idx: number) => virtualizer.measurementsCache[idx]?.start ?? idx * ROW_H
    const toRow = (idx: number) => virtualizer.scrollToOffset(Math.max(0, offsetOf(idx) - ROW_H * LEAD_ROWS))
    const toFirstChange = () => (changeStarts.length ? toRow(changeStarts[0]) : virtualizer.scrollToOffset(0))
    if (!prev || prev.resetKey !== resetKey) {
      anchor.current = null
      if (fullFile) toFirstChange()
      else virtualizer.scrollToOffset(0)
    } else if (anchor.current) {
      // Same file, other layout / context: stay on the line that was at the top.
      const idx = anchorRow(model, rows, anchor.current)
      if (idx >= 0) virtualizer.scrollToOffset(Math.max(0, offsetOf(idx) - (rows[idx - 1]?.kind === 'hunk' ? HUNK_H : 0)))
      else virtualizer.scrollToOffset(0)
    } else if (fullFile) {
      // Was at the top: the full file starts at its first change rather than at line 1.
      toFirstChange()
    } else {
      virtualizer.scrollToOffset(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, resetKey])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), recordAnchor()))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [recordAnchor])

  useEffect(() => {
    virtualizer.measure()
  }, [split, virtualizer])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth))
    ro.observe(el)
    setViewportW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (autoFocus) scrollRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  useEffect(() => {
    if (!handle) return
    handle.current = {
      jumpChange(dir) {
        const el = scrollRef.current
        if (!el || !changeStarts.length) return
        const top = el.scrollTop
        const offsetOf = (idx: number) => virtualizer.measurementsCache[idx]?.start ?? 0
        let target: number | undefined
        const lead = ROW_H * LEAD_ROWS
        if (dir > 0) target = changeStarts.find((idx) => offsetOf(idx) - lead > top + 1)
        else target = [...changeStarts].reverse().find((idx) => offsetOf(idx) - lead < top - 1)
        if (target === undefined) return
        virtualizer.scrollToOffset(Math.max(0, offsetOf(target) - lead))
      },
      focus() {
        scrollRef.current?.focus({ preventScroll: true })
      }
    }
    return () => {
      if (handle.current) handle.current = null
    }
  }, [handle, changeStarts, virtualizer])

  // ── Line selection ────────────────────────────────────────────────────────
  const stagingRef = useRef(staging)
  stagingRef.current = staging
  const selAnchor = useRef<{ row: number; side: SelectSide } | null>(null)
  const drag = useRef<{ side: SelectSide; row: number; adding: boolean; base: Set<string>; y: number; raf: number } | null>(null)
  useEffect(() => {
    selAnchor.current = null
  }, [diff])

  const rowAtClientY = useCallback(
    (clientY: number): number | null => {
      const el = scrollRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const y = Math.max(0, Math.min(el.scrollHeight - 1, clientY - rect.top + el.scrollTop))
      return virtualizer.getVirtualItemForOffset(y)?.index ?? null
    },
    [virtualizer]
  )

  const applyDrag = useCallback(
    (row: number) => {
      const d = drag.current
      const st = stagingRef.current
      if (!d || !st) return
      const next = new Set(d.base)
      for (const k of changeKeysInRange(diff, rows, d.row, row, d.side)) {
        if (d.adding) next.add(k)
        else next.delete(k)
      }
      st.onSelect(next)
    },
    [diff, rows]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const st = stagingRef.current
      if (!st?.enabled || st.busy || e.button !== 0) return
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-sel]')
      if (!cell) return
      const row = Number(cell.dataset.row)
      const side = cell.dataset.sel as SelectSide
      const key = rowChangeKey(diff, rows[row], side)
      if (!key) return
      e.preventDefault()
      scrollRef.current?.focus({ preventScroll: true })
      const next = new Set(st.selected)
      if (e.shiftKey && selAnchor.current && selAnchor.current.side === side) {
        for (const k of changeKeysInRange(diff, rows, selAnchor.current.row, row, side)) next.add(k)
        st.onSelect(next)
        return
      }
      // Plain click toggles the line; dragging applies the same to the whole range.
      const adding = !next.has(key)
      selAnchor.current = { row, side }
      const base = new Set(next)
      drag.current = { side, row, adding, base, y: e.clientY, raf: 0 }
      applyDrag(row)

      const el = scrollRef.current
      const tick = () => {
        const d = drag.current
        if (!d || !el) return
        const rect = el.getBoundingClientRect()
        const edge = 28
        let dy = 0
        if (d.y < rect.top + edge) dy = -Math.ceil((rect.top + edge - d.y) / 2)
        else if (d.y > rect.bottom - edge) dy = Math.ceil((d.y - (rect.bottom - edge)) / 2)
        if (dy) {
          el.scrollTop += dy
          const r = rowAtClientY(d.y)
          if (r !== null) applyDrag(r)
        }
        d.raf = requestAnimationFrame(tick)
      }
      drag.current.raf = requestAnimationFrame(tick)

      const move = (ev: MouseEvent) => {
        const d = drag.current
        if (!d) return
        d.y = ev.clientY
        const r = rowAtClientY(ev.clientY)
        if (r !== null) applyDrag(r)
      }
      const up = () => {
        if (drag.current) cancelAnimationFrame(drag.current.raf)
        drag.current = null
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [diff, rows, applyDrag, rowAtClientY]
  )

  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.raf)
      drag.current = null
    },
    []
  )

  // ── Render ────────────────────────────────────────────────────────────────
  const digits = Math.max(2, String(model.maxLineNo || 1).length)
  const selectable = !!staging?.enabled
  const selected = staging?.selected
  const blockActions = fullFile && selectable && !!staging
  const hot = blockActions ? hotBlock : -1
  const trackHover = (b: number) => {
    if (hoverRef.current === b) return
    hoverRef.current = b
    setHoverBlock(b)
  }
  const onMouseMove = blockActions
    ? (e: React.MouseEvent) => {
        const r = rowAtClientY(e.clientY)
        trackHover(r === null ? -1 : (rowBlock[r] ?? -1))
      }
    : undefined
  const items = virtualizer.getVirtualItems()
  const rootStyle = { '--diff-digits': digits, '--diff-vw': viewportW ? `${viewportW}px` : '100%' } as CSSProperties
  const sizerStyle: CSSProperties = split
    ? { height: virtualizer.getTotalSize() }
    : { height: virtualizer.getTotalSize(), minWidth: `calc(${digits * 2}ch + 72px + ${model.maxCols}ch)` }

  return (
    <div
      ref={scrollRef}
      className={`diff-scroll${split ? ' diff-split' : ' diff-unified'}${selectable ? ' diff-selectable' : ''}${fullFile ? ' diff-full' : ''}`}
      style={rootStyle}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={blockActions ? () => trackHover(-1) : undefined}
    >
      <div className="diff-sizer" style={sizerStyle}>
        {items.flatMap((v) => {
          const row = rows[v.index]
          const style: CSSProperties = { transform: `translateY(${v.start}px)` }
          if (row.kind === 'hunk') {
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={split ? virtualizer.measureElement : undefined}
                className="diff-row diff-hunk-row"
                style={{ ...style, height: split ? undefined : HUNK_H }}
              >
                <HunkHeader diff={diff} hunkIndex={row.hunkIndex} staging={staging ?? null} />
              </div>
            )
          }
          const blockIndex = rowBlock[v.index] ?? -1
          const isHot = blockIndex >= 0 && blockIndex === hot
          const actions =
            blockActions && blockIndex >= 0 && model.blocks[blockIndex] && (split ? model.blocks[blockIndex].splitRow : model.blocks[blockIndex].unifiedRow) === v.index ? (
              <BlockActions
                key={`b:${blockIndex}`}
                top={v.start}
                model={model}
                block={model.blocks[blockIndex]}
                index={blockIndex}
                staging={staging!}
                expanded={blockIndex === hoverBlock || blockIndex === hot}
                onHot={setHotBlock}
              />
            ) : null
          if (row.kind === 'line') {
            const line = diff.hunks[row.hunkIndex].lines[row.lineIndex]
            const nums = model.hunks[row.hunkIndex].numbers[row.lineIndex]
            const key = lineKey(row.hunkIndex, row.lineIndex)
            const isSel = line.type !== 'context' && !!selected?.has(key)
            const el = (
              <UnifiedLine
                key={v.key}
                style={style}
                rowIndex={v.index}
                line={line}
                oldNo={nums.old}
                newNo={nums.new}
                tokens={tokensFor(row.hunkIndex, row.lineIndex, line)}
                ranges={wordsFor(row.hunkIndex, row.lineIndex, line)}
                eol={eolFor(row.hunkIndex, row.lineIndex, line)}
                selectable={selectable && line.type !== 'context'}
                selected={isSel}
                hot={isHot}
              />
            )
            return actions ? [el, actions] : el
          }
          const hunk = diff.hunks[row.hunkIndex]
          const hm = model.hunks[row.hunkIndex]
          const left = row.left !== null ? hunk.lines[row.left] : null
          const right = row.right !== null ? hunk.lines[row.right] : null
          const cell = (side: 'left' | 'right', idx: number | null, line: DiffLine | null) => {
            if (idx === null || !line) return <div className="diff-s-cell diff-s-empty" />
            const no = side === 'left' ? hm.numbers[idx].old : hm.numbers[idx].new
            const change = line.type !== 'context'
            return (
              <SplitCell
                side={side}
                rowIndex={v.index}
                line={line}
                no={no}
                tokens={tokensFor(row.hunkIndex, idx, line)}
                ranges={wordsFor(row.hunkIndex, idx, line)}
                eol={eolFor(row.hunkIndex, idx, line)}
                selectable={selectable && change}
                selected={change && !!selected?.has(lineKey(row.hunkIndex, idx))}
                hot={isHot && change}
              />
            )
          }
          const el = (
            <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="diff-row diff-s-row" style={style}>
              {cell('left', row.left, left)}
              {cell('right', row.right, right)}
            </div>
          )
          return actions ? [el, actions] : el
        })}
      </div>
    </div>
  )
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function rowKey(row: Row | undefined): string {
  if (!row) return ''
  if (row.kind === 'hunk') return `h:${row.hunkIndex}`
  if (row.kind === 'line') return `l:${row.hunkIndex}:${row.lineIndex}`
  return `p:${row.hunkIndex}:${row.left ?? '-'}:${row.right ?? '-'}`
}

const MARK: Record<DiffLine['type'], string> = { add: '+', del: '-', context: ' ' }

interface UnifiedLineProps {
  style: CSSProperties
  rowIndex: number
  line: DiffLine
  oldNo: number | null
  newNo: number | null
  tokens: Token[] | null
  ranges: Range[] | null
  eol: string | null
  selectable: boolean
  selected: boolean
  /** Part of the change block whose action buttons are hovered. */
  hot: boolean
}

const UnifiedLine = memo(function UnifiedLine({
  style,
  rowIndex,
  line,
  oldNo,
  newNo,
  tokens,
  ranges,
  eol,
  selectable,
  selected,
  hot
}: UnifiedLineProps) {
  return (
    <div className={`diff-row diff-line diff-${line.type}${selected ? ' diff-sel' : ''}${hot ? ' diff-hot' : ''}`} style={style}>
      <div
        className={`diff-gutter${selectable ? ' diff-gutter-sel' : ''}`}
        data-sel={selectable ? 'unified' : undefined}
        data-row={rowIndex}
        title={
          selectable
            ? selected
              ? 'Click to deselect · drag or shift-click for ranges'
              : 'Click to select this line · drag or shift-click for ranges'
            : undefined
        }
      >
        <span className="diff-num">{oldNo ?? ''}</span>
        <span className="diff-num">{newNo ?? ''}</span>
        <span className="diff-mark">{MARK[line.type]}</span>
      </div>
      <Code text={line.content} tokens={tokens} ranges={ranges} type={line.type} noNewline={!!line.noNewline} eol={eol} />
    </div>
  )
}, sameRowProps)

interface SplitCellProps {
  side: 'left' | 'right'
  rowIndex: number
  line: DiffLine
  no: number | null
  tokens: Token[] | null
  ranges: Range[] | null
  eol: string | null
  selectable: boolean
  selected: boolean
  hot: boolean
}

const SplitCell = memo(function SplitCell({ side, rowIndex, line, no, tokens, ranges, eol, selectable, selected, hot }: SplitCellProps) {
  return (
    <div className={`diff-s-cell diff-${line.type}${selected ? ' diff-sel' : ''}${hot ? ' diff-hot' : ''}`}>
      <div className={`diff-gutter${selectable ? ' diff-gutter-sel' : ''}`} data-sel={selectable ? side : undefined} data-row={rowIndex}>
        <span className="diff-num">{no ?? ''}</span>
        <span className="diff-mark">{MARK[line.type]}</span>
      </div>
      <Code text={line.content} tokens={tokens} ranges={ranges} type={line.type} noNewline={!!line.noNewline} eol={eol} />
    </div>
  )
})

function sameRowProps(a: UnifiedLineProps, b: UnifiedLineProps): boolean {
  return (
    a.style.transform === b.style.transform &&
    a.rowIndex === b.rowIndex &&
    a.line === b.line &&
    a.oldNo === b.oldNo &&
    a.newNo === b.newNo &&
    a.tokens === b.tokens &&
    a.ranges === b.ranges &&
    a.eol === b.eol &&
    a.selectable === b.selectable &&
    a.selected === b.selected &&
    a.hot === b.hot
  )
}

interface CodeProps {
  text: string
  tokens: Token[] | null
  ranges: Range[] | null
  type: DiffLine['type']
  noNewline: boolean
  /** Line-ending marker for changes that only differ by CRLF / LF. */
  eol?: string | null
}

/** Line content: syntax tokens split at word-diff boundaries. */
export const Code = memo(function Code({ text, tokens, ranges, type, noNewline, eol }: CodeProps) {
  return (
    <span className="diff-code">
      {renderSegments(text, tokens, ranges, type === 'add' ? 'diff-w-add' : 'diff-w-del')}
      {eol && (
        <span className="diff-eol" title={`Only the line ending differs: this side ends with ${eol}`}>
          {eol}
        </span>
      )}
      {noNewline && (
        <span className="diff-nonl" title="No newline at end of file">
          <CircleSlash size={11} />
        </span>
      )}
    </span>
  )
})

function renderSegments(text: string, tokens: Token[] | null, ranges: Range[] | null, wordClass: string): ReactNode {
  let toks: Token[] = tokens && tokens.length ? tokens : [{ text, cls: '' }]
  if (tokens && tokens.length) {
    let len = 0
    for (const t of tokens) len += t.text.length
    if (len !== text.length) toks = [{ text, cls: '' }]
  }
  if (!text) return null
  if (!ranges || !ranges.length) {
    if (toks.length === 1 && !toks[0].cls) return text
    return toks.map((t, i) =>
      t.cls ? (
        <span key={i} className={t.cls}>
          {t.text}
        </span>
      ) : (
        t.text
      )
    )
  }
  const out: ReactNode[] = []
  let pos = 0
  let r = 0
  for (const t of toks) {
    let s = 0
    while (s < t.text.length) {
      const abs = pos + s
      while (r < ranges.length && ranges[r][1] <= abs) r++
      const inRange = r < ranges.length && ranges[r][0] <= abs
      const boundary = inRange ? ranges[r][1] : r < ranges.length ? ranges[r][0] : Number.POSITIVE_INFINITY
      const e = Math.min(t.text.length, boundary - pos)
      const piece = t.text.slice(s, e)
      const cls = inRange ? (t.cls ? `${t.cls} ${wordClass}` : wordClass) : t.cls
      out.push(
        cls ? (
          <span key={out.length} className={cls}>
            {piece}
          </span>
        ) : (
          piece
        )
      )
      s = e
    }
    pos += t.text.length
  }
  return out
}

// ── Hunk header ──────────────────────────────────────────────────────────────

function HunkHeader({ diff, hunkIndex, staging }: { diff: FileDiff; hunkIndex: number; staging: DiffStaging | null }) {
  const hunk = diff.hunks[hunkIndex]
  const section = /^@@[^@]*@@\s?(.*)$/.exec(hunk.header)?.[1] ?? ''
  const showActions = !!staging?.enabled
  return (
    <div className="diff-hunk-inner" title={hunk.header}>
      <span className="diff-hunk-title">
        Hunk {hunkIndex + 1}
        <span className="diff-hunk-sep">:</span>
        {hunkRangeLabel(diff, hunkIndex)}
      </span>
      {section && <span className="diff-hunk-section">{section}</span>}
      <span className="diff-hunk-spacer" />
      {showActions && staging.kind === 'unstaged' && (
        <>
          <button
            className="diff-hunk-btn diff-hunk-btn-danger"
            disabled={staging.busy}
            onClick={() => staging.onHunk(hunkIndex, 'discard')}
          >
            <Trash2 size={12} />
            Discard Hunk
          </button>
          <button
            className="diff-hunk-btn diff-hunk-btn-primary"
            disabled={staging.busy}
            onClick={() => staging.onHunk(hunkIndex, 'stage')}
          >
            <Plus size={12} />
            Stage Hunk
          </button>
        </>
      )}
      {showActions && staging.kind === 'staged' && (
        <button className="diff-hunk-btn" disabled={staging.busy} onClick={() => staging.onHunk(hunkIndex, 'unstage')}>
          <Minus size={12} />
          Unstage Hunk
        </button>
      )}
    </div>
  )
}

// ── Change block actions (full-file view) ────────────────────────────────────

interface BlockActionsProps {
  top: number
  model: DiffModel
  block: ChangeBlock
  index: number
  staging: DiffStaging
  /** Show labels (the mouse is over the block); icons only otherwise, to cover less code. */
  expanded: boolean
  onHot(index: number): void
}

/**
 * Stage / unstage / discard buttons pinned to the right edge of the viewport on
 * the first row of a change block. Hovering them highlights the block's lines.
 */
function BlockActions({ top, model, block, index, staging, expanded, onHot }: BlockActionsProps) {
  const range = blockRangeLabel(model, block)
  const run = (mode: PatchMode) => {
    onHot(-1)
    staging.onBlock(blockSelection(block), mode)
  }
  const n = block.adds + block.dels
  const what = `${n === 1 ? 'this changed line' : `these ${n} changed lines`}${range ? ` (${range.toLowerCase()})` : ''}`
  return (
    <div className="diff-block-anchor" style={{ transform: `translateY(${top}px)` }}>
      <div className="diff-block-sticky">
        <div
          className={`diff-block-actions${expanded ? ' diff-block-expanded' : ''}`}
          role="toolbar"
          aria-label={`Change block ${index + 1}`}
          onMouseEnter={() => onHot(index)}
          onMouseLeave={() => onHot(-1)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {staging.kind === 'unstaged' ? (
            <>
              <button
                type="button"
                className="diff-block-btn diff-block-btn-danger"
                disabled={staging.busy}
                title={`Discard ${what}`}
                onClick={() => run('discard')}
              >
                <Trash2 size={11} />
                {expanded && <span>Discard</span>}
              </button>
              <button
                type="button"
                className="diff-block-btn diff-block-btn-primary"
                disabled={staging.busy}
                title={`Stage ${what}`}
                onClick={() => run('stage')}
              >
                <Plus size={12} />
                {expanded && <span>Stage</span>}
              </button>
            </>
          ) : (
            <button type="button" className="diff-block-btn" disabled={staging.busy} title={`Unstage ${what}`} onClick={() => run('unstage')}>
              <Minus size={12} />
              {expanded && <span>Unstage</span>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
