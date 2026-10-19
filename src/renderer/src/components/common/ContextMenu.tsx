// Imperative context menus:
//   onContextMenu={(e) => showContextMenu(e, [
//     { label: 'Checkout', icon: <GitBranch size={14}/>, onClick: () => ... },
//     { type: 'separator' },
//     { label: 'Reset', submenu: [...] },
//   ])}
// <ContextMenuHost/> is mounted once in App.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { create } from 'zustand'

export type MenuItem =
  | {
      type?: 'item'
      label: string
      icon?: ReactNode
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      checked?: boolean
      onClick?: () => unknown
      submenu?: MenuItem[]
    }
  | { type: 'separator' }
  | { type: 'header'; label: string }

interface MenuState {
  open: { x: number; y: number; items: MenuItem[] } | null
  show(x: number, y: number, items: MenuItem[]): void
  hide(): void
}

const useMenu = create<MenuState>((set) => ({
  open: null,
  show: (x, y, items) => set({ open: { x, y, items } }),
  hide: () => set({ open: null })
}))

export function showContextMenu(
  e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void },
  items: MenuItem[]
): void {
  e.preventDefault?.()
  e.stopPropagation?.()
  const cleaned = cleanSeparators(items)
  if (cleaned.length) useMenu.getState().show(e.clientX, e.clientY, cleaned)
}

/** Show a menu anchored below an element (for dropdown buttons). */
export function showMenuBelow(el: HTMLElement, items: MenuItem[]): void {
  const r = el.getBoundingClientRect()
  const cleaned = cleanSeparators(items)
  if (cleaned.length) useMenu.getState().show(r.left, r.bottom + 2, cleaned)
}

export function hideContextMenu(): void {
  useMenu.getState().hide()
}

function cleanSeparators(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = []
  for (const it of items) {
    if (it.type === 'separator' && (out.length === 0 || out[out.length - 1].type === 'separator')) continue
    out.push(it)
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop()
  return out
}

export function ContextMenuHost() {
  const open = useMenu((s) => s.open)
  const hide = useMenu((s) => s.hide)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.ui-menu')) hide()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    const onBlur = () => hide()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [open, hide])

  if (!open) return null
  return createPortal(<MenuPanel x={open.x} y={open.y} items={open.items} onDone={hide} />, document.body)
}

function MenuPanel({ x, y, items, onDone, isSub }: { x: number; y: number; items: MenuItem[]; onDone: () => void; isSub?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)
  const [active, setActive] = useState(-1)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (nx + r.width > window.innerWidth - 4) nx = isSub ? x - r.width - 200 : window.innerWidth - r.width - 4
    if (ny + r.height > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4)
    setPos({ x: Math.max(4, nx), y: ny })
  }, [x, y, isSub])

  useEffect(() => {
    if (isSub) return
    const onKey = (e: KeyboardEvent) => {
      const enabled = items.map((it, i) => (it.type === 'separator' || it.type === 'header' || it.disabled ? -1 : i)).filter((i) => i >= 0)
      if (!enabled.length) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const cur = enabled.indexOf(active)
        const next = e.key === 'ArrowDown' ? enabled[(cur + 1) % enabled.length] : enabled[(cur - 1 + enabled.length) % enabled.length]
        setActive(next)
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault()
        const it = items[active]
        if (it && it.type !== 'separator' && it.type !== 'header' && !it.submenu) {
          onDone()
          void it.onClick?.()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, active, onDone, isSub])

  return (
    <div ref={ref} className="ui-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.type === 'separator') return <div key={i} className="ui-menu-sep" />
        if (it.type === 'header') return <div key={i} className="ui-menu-header">{it.label}</div>
        return (
          <div
            key={i}
            className={`ui-menu-item${it.disabled ? ' ui-disabled' : ''}${it.danger ? ' ui-danger' : ''}${active === i ? ' ui-active' : ''}`}
            onMouseEnter={(e) => {
              setActive(i)
              if (it.submenu && !it.disabled) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setSub({ index: i, x: r.right - 2, y: r.top - 4 })
              } else setSub(null)
            }}
            onClick={() => {
              if (it.disabled || it.submenu) return
              onDone()
              void it.onClick?.()
            }}
          >
            <span className="ui-menu-icon">{it.checked ? '✓' : it.icon}</span>
            <span className="ui-menu-label">{it.label}</span>
            {it.shortcut && <span className="ui-menu-shortcut">{it.shortcut}</span>}
            {it.submenu && <ChevronRight size={12} className="ui-menu-chevron" />}
          </div>
        )
      })}
      {sub && items[sub.index] && (items[sub.index] as { submenu?: MenuItem[] }).submenu && (
        <MenuPanel x={sub.x} y={sub.y} items={(items[sub.index] as { submenu: MenuItem[] }).submenu} onDone={onDone} isSub />
      )}
    </div>
  )
}
