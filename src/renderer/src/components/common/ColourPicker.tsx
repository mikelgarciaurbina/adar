// A colour picker without dependencies: a square for saturation × brightness and a hue bar (both
// follow the pointer and the arrow keys, Shift for bigger steps), and a hex field that takes
// #rrggbb, rrggbb or #rgb. The value is always a lower-case #rrggbb.

import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { hexToHsv, hsvToHex, normalizeHexColor } from '@shared/groupColor'
import type { CustomGroupColor } from '@shared/types'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Pointer handlers that report where in the element (0…1 across, 0…1 down) it was pressed or dragged to. */
function dragHandlers(apply: (x: number, y: number) => void) {
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    apply(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height))
  }
  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // A pointer that is already gone: the press still picks the colour.
      }
      e.currentTarget.focus()
      at(e)
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e)
    }
  }
}

/** Arrow keys: [dx, dy] for one press (Shift: ten). */
function arrow(e: KeyboardEvent): [number, number] | null {
  const step = e.shiftKey ? 10 : 1
  switch (e.key) {
    case 'ArrowLeft':
      return [-step, 0]
    case 'ArrowRight':
      return [step, 0]
    case 'ArrowUp':
      return [0, step]
    case 'ArrowDown':
      return [0, -step]
    default:
      return null
  }
}

export function ColourPicker({ value, onChange, className }: { value: CustomGroupColor; onChange(color: CustomGroupColor): void; className?: string }) {
  // The hue is kept apart: greys and black have none, and dragging into them must not lose it.
  const [hue, setHue] = useState(() => hexToHsv(value).h)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    const next = hexToHsv(value)
    if (next.s > 0 && next.v > 0) setHue(next.h)
  }
  const { s, v } = hexToHsv(value)
  const emit = (h: number, sat: number, val: number) => {
    const hex = hsvToHex({ h, s: sat, v: val })
    setHue(h)
    setSeen(hex)
    onChange(hex)
  }

  return (
    <div className={`ui-colour${className ? ` ${className}` : ''}`} style={{ '--hue': hue } as React.CSSProperties}>
      <div
        className="ui-colour-sv"
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s * 100)}
        aria-valuetext={`${Math.round(s * 100)}% saturation, ${Math.round(v * 100)}% brightness`}
        {...dragHandlers((x, y) => emit(hue, x, 1 - y))}
        onKeyDown={(e) => {
          const d = arrow(e)
          if (!d) return
          e.preventDefault()
          emit(hue, clamp01(s + d[0] / 100), clamp01(v + d[1] / 100))
        }}
      >
        <span className="ui-colour-knob" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <div
        className="ui-colour-hue"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hue)}
        {...dragHandlers((x) => emit(x * 360, s, v))}
        onKeyDown={(e) => {
          const d = arrow(e)
          if (!d) return
          e.preventDefault()
          emit((hue + d[0] + d[1] + 360) % 360, s, v)
        }}
      >
        <span className="ui-colour-knob" style={{ left: `${(hue / 360) * 100}%`, top: '50%', background: `hsl(${hue} 100% 50%)` }} />
      </div>
    </div>
  )
}

/** "#" and six hex digits; a colour reaches onChange as soon as what is typed is one. */
export function HexField({ value, onChange, onSubmit }: { value: CustomGroupColor; onChange(color: CustomGroupColor): void; onSubmit?(): void }) {
  const shown = (c: CustomGroupColor) => c.slice(1).toUpperCase()
  const [text, setText] = useState(() => shown(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    if (normalizeHexColor(text) !== value) setText(shown(value))
  }
  const valid = normalizeHexColor(text) !== null
  return (
    <label className={`ui-colour-hex${valid ? '' : ' ui-invalid'}`}>
      <span aria-hidden="true">#</span>
      <input
        aria-label="Hex colour"
        value={text}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          const t = e.target.value.replace(/^#/, '')
          setText(t)
          const c = normalizeHexColor(t)
          if (c) {
            setSeen(c)
            onChange(c)
          }
        }}
        onBlur={() => setText(shown(value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
    </label>
  )
}
