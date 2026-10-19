import { useEffect, useState } from 'react'
import { isFullscreenWindow } from './chrome'

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

function windowIsFullscreen(zoom: number): boolean {
  if (typeof window === 'undefined') return false
  return isFullscreenWindow({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    zoom,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    htmlFullscreen: typeof document !== 'undefined' && !!document.fullscreenElement
  })
}

/**
 * Whether the window is in full screen (native or HTML), given the current UI zoom factor.
 * Re-evaluated on resize and fullscreenchange, plus once more after the macOS full-screen
 * animation settles. Returns false when `enabled` is false (no listeners are installed then).
 */
export function useWindowFullscreen(enabled: boolean, zoom: number): boolean {
  const [fullscreen, setFullscreen] = useState(() => enabled && windowIsFullscreen(zoom))
  useEffect(() => {
    if (!enabled) {
      setFullscreen(false)
      return
    }
    let settle: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      setFullscreen(windowIsFullscreen(zoom))
      clearTimeout(settle)
      settle = setTimeout(() => setFullscreen(windowIsFullscreen(zoom)), 400)
    }
    update()
    window.addEventListener('resize', update)
    document.addEventListener('fullscreenchange', update)
    return () => {
      clearTimeout(settle)
      window.removeEventListener('resize', update)
      document.removeEventListener('fullscreenchange', update)
    }
  }, [enabled, zoom])
  return fullscreen
}
