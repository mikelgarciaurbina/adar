import { useEffect, useState } from 'react'

/** Current time (ms) that re-renders the caller every `intervalMs` (for relative labels). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Close a popover on outside pointer-down, Escape, window blur or resize. */
export function useDismiss(active: boolean, isInside: (target: Node) => boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) onDismiss()
    }
    const onBlur = () => onDismiss()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [active, isInside, onDismiss])
}
