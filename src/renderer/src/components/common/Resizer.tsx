import { useCallback, useRef } from 'react'

export interface ResizerProps {
  /** 'left' = dragging right grows the panel on the left; 'right' = dragging left grows the panel on the right. */
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  onResize: (width: number) => void
}

/** Vertical drag handle between panels. */
export function Resizer({ side, width, min, max, onResize }: ResizerProps) {
  const start = useRef<{ x: number; w: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      start.current = { x: e.clientX, w: width }
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      document.body.classList.add('ui-resizing')
      const move = (ev: PointerEvent) => {
        if (!start.current) return
        const dx = ev.clientX - start.current.x
        const next = side === 'left' ? start.current.w + dx : start.current.w - dx
        onResize(Math.round(Math.max(min, Math.min(max, next))))
      }
      const up = () => {
        start.current = null
        document.body.classList.remove('ui-resizing')
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', up)
        target.removeEventListener('pointercancel', up)
      }
      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', up)
      target.addEventListener('pointercancel', up)
    },
    [width, side, min, max, onResize]
  )

  return <div className="ui-resizer" onPointerDown={onPointerDown} role="separator" aria-orientation="vertical" />
}
