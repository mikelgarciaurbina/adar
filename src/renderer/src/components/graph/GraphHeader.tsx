// Sticky column header of the graph with resizable columns and a context menu
// (column visibility, what the graph shows, reset widths).

import { memo, useCallback } from 'react'
import { Spinner } from '@renderer/components/common/Button'
import { COLUMN_LIMITS, type ColumnId } from './columns'

interface ColResizerProps {
  id: ColumnId
  /** 'end': handle on the right edge, dragging right grows. 'start': left edge, dragging left grows. */
  side: 'end' | 'start'
  width: number
  onResize(id: ColumnId, width: number | null): void
}

function ColResizer({ id, side, width, onResize }: ColResizerProps) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const el = e.currentTarget
      const startX = e.clientX
      const startW = width
      const { min, max } = COLUMN_LIMITS[id]
      el.setPointerCapture(e.pointerId)
      document.body.classList.add('ui-resizing')
      el.classList.add('gr-active')
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const next = side === 'end' ? startW + dx : startW - dx
        onResize(id, Math.max(min, Math.min(max, next)))
      }
      const up = () => {
        document.body.classList.remove('ui-resizing')
        el.classList.remove('gr-active')
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    },
    [id, side, width, onResize]
  )
  return (
    <div
      className={`gr-col-resizer gr-col-resizer-${side}`}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onResize(id, null)
      }}
    />
  )
}

export interface GraphHeaderProps {
  widths: { refs: number; graph: number; author: number; date: number; sha: number }
  /** Right padding matching the body's vertical scrollbar. */
  scrollbar: number
  loading: boolean
  onResize(id: ColumnId, width: number | null): void
  onContextMenu(e: React.MouseEvent): void
}

export const GraphHeader = memo(function GraphHeader({ widths, scrollbar, loading, onResize, onContextMenu }: GraphHeaderProps) {
  return (
    <div className="gr-header" role="row" style={{ paddingRight: scrollbar }} onContextMenu={onContextMenu}>
      <div className="gr-hcell gr-c-refs" role="columnheader">
        <span className="gr-hlabel">Branch / Tag</span>
        <ColResizer id="refs" side="end" width={widths.refs} onResize={onResize} />
      </div>
      <div className="gr-hcell gr-c-graph" role="columnheader">
        <span className="gr-hlabel">Graph</span>
        {loading && <Spinner size="sm" />}
        <ColResizer id="graph" side="end" width={widths.graph} onResize={onResize} />
      </div>
      <div className="gr-hcell gr-c-msg" role="columnheader">
        <span className="gr-hlabel">Commit message</span>
      </div>
      <div className="gr-hcell gr-c-author" role="columnheader">
        <ColResizer id="author" side="start" width={widths.author} onResize={onResize} />
        <span className="gr-hlabel">Author</span>
      </div>
      <div className="gr-hcell gr-c-date" role="columnheader">
        <ColResizer id="date" side="start" width={widths.date} onResize={onResize} />
        <span className="gr-hlabel">Date</span>
      </div>
      <div className="gr-hcell gr-c-sha" role="columnheader">
        <ColResizer id="sha" side="start" width={widths.sha} onResize={onResize} />
        <span className="gr-hlabel">SHA</span>
      </div>
    </div>
  )
})
