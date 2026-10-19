// One virtualised row of the graph (commit, stash pseudo-row or the WIP row).
// Memoised: a row re-renders only when its own data, selection, search state or
// the shared geometry changes.

import { memo, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, Minus, Pencil, Plus } from 'lucide-react'
import { absoluteTime, relativeTime } from '@renderer/lib/format'
import { colorOf } from './geometry'
import { GraphCell } from './GraphCell'
import { highlightRanges, type DisplayRow, type Pill } from './model'
import { RefPills } from './RefPills'
import type { GraphCtx, WipInfo } from './types'

export interface GraphRowProps {
  row: DisplayRow
  /** Display index (for aria / data attributes). */
  index: number
  /** translateY offset from the virtualiser. */
  start: number
  h: number
  /** Drawing width of the graph (lanes). */
  graphWidth: number
  pills: readonly Pill[] | undefined
  selected: boolean
  multi: boolean
  /** 0 = not a search match, 1 = match, 2 = current match. */
  match: 0 | 1 | 2
  dim: boolean
  /** Text to highlight and where. */
  hl: string
  hlField: 'message' | 'author' | null
  dateMode: 'relative' | 'absolute'
  /** Minute tick so relative dates refresh. */
  now: number
  wip?: WipInfo
  ctx: GraphCtx
}

function Highlighted({ text, query }: { text: string; query: string }): ReactNode {
  const ranges = query ? highlightRanges(text, query) : []
  if (!ranges.length) return text
  const out: ReactNode[] = []
  let at = 0
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a))
    out.push(
      <mark key={i} className="gr-hl">
        {text.slice(a, b)}
      </mark>
    )
    at = b
  })
  if (at < text.length) out.push(text.slice(at))
  return out
}

function WipCounters({ wip }: { wip: WipInfo }) {
  const { modified, added, deleted, conflicts } = wip.counts
  return (
    <span className="gr-wip-counts">
      {conflicts > 0 && (
        <span className="gr-wip-count gr-wip-conflict" title={`${conflicts} conflicted`}>
          <AlertTriangle size={11} />
          {conflicts}
        </span>
      )}
      {modified > 0 && (
        <span className="gr-wip-count gr-wip-modified" title={`${modified} modified`}>
          <Pencil size={11} />
          {modified}
        </span>
      )}
      {added > 0 && (
        <span className="gr-wip-count gr-wip-added" title={`${added} added`}>
          <Plus size={11} />
          {added}
        </span>
      )}
      {deleted > 0 && (
        <span className="gr-wip-count gr-wip-deleted" title={`${deleted} deleted`}>
          <Minus size={11} />
          {deleted}
        </span>
      )}
    </span>
  )
}

function dateText(ts: number, mode: 'relative' | 'absolute', now: number): string {
  return mode === 'relative' ? relativeTime(ts, now) : absoluteTime(ts)
}

export const GraphRow = memo(function GraphRow(props: GraphRowProps) {
  const { row, index, start, h, graphWidth, pills, selected, multi, match, dim, hl, hlField, dateMode, now, wip, ctx } = props
  const color = colorOf(row.color)
  const cls =
    'gr-row' +
    ` gr-row-${row.kind}` +
    (selected ? ' gr-selected' : '') +
    (multi ? ' gr-multi' : '') +
    (match === 2 ? ' gr-match gr-match-current' : match === 1 ? ' gr-match' : '') +
    (dim ? ' gr-dim' : '') +
    (row.kind === 'commit' && row.isMerge ? ' gr-row-merge' : '')

  let message: ReactNode = null
  let author: ReactNode = null
  let date: ReactNode = null
  let sha: ReactNode = null
  let title: string | undefined

  if (row.kind === 'commit') {
    const c = row.commit
    message = (
      <span className="gr-subject">
        <Highlighted text={c.subject} query={hlField === 'message' ? hl : ''} />
      </span>
    )
    author = <Highlighted text={c.authorName} query={hlField === 'author' ? hl : ''} />
    date = <span title={absoluteTime(c.authorDate)}>{dateText(c.authorDate, dateMode, now)}</span>
    sha = c.shortSha || c.sha.slice(0, 7)
    title = c.body.trim() ? `${c.subject}\n\n${c.body.trim()}` : undefined
  } else if (row.kind === 'stash') {
    const s = row.stash
    message = (
      <>
        <span className="gr-stash-ref">{s.ref}</span>
        <span className="gr-stash-msg">{s.message}</span>
      </>
    )
    date = <span title={absoluteTime(s.date)}>{dateText(s.date, dateMode, now)}</span>
    sha = s.sha.slice(0, 7)
  } else {
    message = (
      <>
        <span className={`gr-wip-label${wip?.summary ? ' gr-wip-draft' : ''}`}>{wip?.summary || '// WIP'}</span>
        {wip && <WipCounters wip={wip} />}
      </>
    )
  }

  return (
    <div
      role="row"
      aria-selected={selected || multi}
      aria-rowindex={index + 1}
      className={cls}
      style={{ transform: `translateY(${start}px)`, height: h, ['--gr-lane' as string]: color } as CSSProperties}
      onClick={(e) => ctx.onRowClick(e, row)}
      onDoubleClick={(e) => ctx.onRowDoubleClick(e, row)}
      onContextMenu={(e) => ctx.onRowContextMenu(e, row)}
    >
      <div className="gr-cell gr-c-refs">{row.kind === 'commit' && <RefPills pills={pills} ctx={ctx} color={color} />}</div>
      <div className="gr-cell gr-c-graph">
        <GraphCell row={row} h={h} width={graphWidth} connector={row.kind === 'commit' && !!pills?.length} />
      </div>
      <div className="gr-cell gr-c-msg" title={title}>
        {message}
      </div>
      <div className="gr-cell gr-c-author">{author}</div>
      <div className="gr-cell gr-c-date">{date}</div>
      <div className="gr-cell gr-c-sha">{sha}</div>
    </div>
  )
})
