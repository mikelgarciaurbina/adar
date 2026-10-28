// A tab group's "Custom Colour…" picker: opens under the group's label with the eight Basoa colours,
// the picker, the Recent row and the group as each theme draws it. The tab bar shows the colour as it
// changes (onPreview); Done, Enter or a click elsewhere keeps it, Cancel and Esc put the old one back.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { setGroupColor } from '@renderer/actions/groups'
import { Button } from '@renderer/components/common/Button'
import { ColourPicker, HexField } from '@renderer/components/common/ColourPicker'
import { GROUP_COLOR_LABELS, groupColorLabel, groupLine, recentColorChoices } from '@renderer/lib/groupColors'
import { useApp } from '@renderer/store/appStore'
import { groupColorVariants, isCustomGroupColor, normalizeHexColor } from '@shared/groupColor'
import { TAB_GROUP_COLORS, type CustomGroupColor, type GroupColor, type TabGroup } from '@shared/types'
import { GroupTrayPreview } from './GroupTray'

/** Where a custom colour starts: the group's colour as this theme shows it, else the last one picked. */
function startingColor(color: GroupColor, recent: readonly CustomGroupColor[]): CustomGroupColor {
  if (isCustomGroupColor(color)) return color
  const shown = normalizeHexColor(getComputedStyle(document.documentElement).getPropertyValue(`--group-${color}`))
  return shown ?? recent[0] ?? '#e8559a'
}

const WIDTH = 296

export function GroupColourPopover(props: { group: TabGroup; anchor: DOMRect; onPreview(color: GroupColor | null): void; onClose(): void }) {
  const { group, anchor, onPreview, onClose } = props
  const groups = useApp((s) => s.settings.tabGroups)
  const recent = useApp((s) => s.settings.recentGroupColors)
  const [color, setColor] = useState<GroupColor>(group.color)
  const [custom, setCustom] = useState<CustomGroupColor>(() => startingColor(group.color, recent))
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 })
  const name = group.name || 'Unnamed group'

  const pick = (c: GroupColor) => {
    setColor(c)
    if (isCustomGroupColor(c)) setCustom(c)
    onPreview(c)
  }
  const done = () => {
    onPreview(null)
    onClose()
    if (color !== group.color) setGroupColor(group.id, color)
  }
  const cancel = () => {
    onPreview(null)
    onClose()
  }
  const latest = useRef({ done, cancel })
  latest.current = { done, cancel }

  // Stay inside the window (the label can be near its right edge).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - el.offsetWidth - 8))
    const top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - el.offsetHeight - 8))
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.ui-colour-sv')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      latest.current.cancel()
    }
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) latest.current.done()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [])

  const choices = recentColorChoices(
    groups.filter((g) => g.id !== group.id),
    recent
  )
  if (isCustomGroupColor(group.color) && !choices.some((c) => c.color === group.color)) choices.unshift({ color: group.color })
  const variants = isCustomGroupColor(color) ? groupColorVariants(color) : null

  // On <body>: the tab bar's stacking context would put the graph and the panels on top of it.
  return createPortal(
    <div
      ref={ref}
      className="tb-colour"
      role="dialog"
      aria-label={`Colour of ${name}`}
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault()
          done()
        }
      }}
    >
      <div className="tb-colour-head">
        <span className="tb-colour-title">Colour of {name}</span>
        <span className="tb-colour-kind">{isCustomGroupColor(color) ? 'custom' : GROUP_COLOR_LABELS[color]}</span>
      </div>
      <div className="tb-colour-swatches" role="radiogroup" aria-label="Basoa colours">
        {TAB_GROUP_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={GROUP_COLOR_LABELS[c]}
            title={GROUP_COLOR_LABELS[c]}
            className={`tb-colour-swatch${color === c ? ' tb-colour-swatch-on' : ''}`}
            style={{ '--swatch': groupLine(c) } as React.CSSProperties}
            onClick={() => pick(c)}
          />
        ))}
      </div>
      <ColourPicker value={custom} onChange={pick} />
      <div className="tb-colour-hexrow">
        <span className="tb-colour-sample" style={{ background: custom }} aria-hidden="true" />
        <HexField value={custom} onChange={pick} onSubmit={done} />
      </div>
      {choices.length > 0 && (
        <div className="tb-colour-section">
          <span className="tb-colour-label">Recent</span>
          <div className="tb-colour-swatches">
            {choices.map((c) => (
              <button
                key={c.color}
                type="button"
                aria-label={c.group ? `${c.color.toUpperCase()}, ${c.group}` : c.color.toUpperCase()}
                title={c.group ? `${c.color.toUpperCase()} · ${c.group}` : c.color.toUpperCase()}
                className={`tb-colour-swatch${color === c.color ? ' tb-colour-swatch-on' : ''}`}
                style={{ '--swatch': c.color } as React.CSSProperties}
                onClick={() => pick(c.color)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="tb-colour-section">
        <span className="tb-colour-label">In each theme</span>
        <div className="tb-colour-themes">
          <div className="tb-colour-theme" data-theme="dark">
            <GroupTrayPreview name={name} color={color} tab="Gaua" />
            {variants && <span className="tb-colour-hex">{variants.night.toUpperCase()}</span>}
          </div>
          <div className="tb-colour-theme" data-theme="light">
            <GroupTrayPreview name={name} color={color} tab="Eguna" />
            {variants && <span className="tb-colour-hex">{variants.day.toUpperCase()}</span>}
          </div>
        </div>
      </div>
      <div className="tb-colour-actions">
        <span className="tb-colour-picked">{groupColorLabel(color)}</span>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={done}>
          Done
        </Button>
      </div>
    </div>,
    document.body
  )
}
