// BRANCH / TAG cell: ref pills (local, remote, merged local+remote, tag, detached
// HEAD), a "+N" overflow badge with a popover, and the thin connector line that
// links the label area to the commit node. Pills are drag sources and drop targets.

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleDot, Cloud, FolderGit2, Monitor, Tag } from 'lucide-react'
import { PullChip } from '@renderer/components/pulls/PullChip'
import { usePullForRefs } from '@renderer/components/pulls/pullStore'
import { getRefDragData, hasRefDragData, setRefDragData } from '@renderer/lib/dnd'
import { pillTitle, type Pill } from './model'
import type { GraphCtx } from './types'

const ICON = 12

function PillIcons({ pill }: { pill: Pill }) {
  switch (pill.kind) {
    case 'remote':
      return <Cloud size={ICON} className="gr-pill-icon" />
    case 'tag':
      return <Tag size={ICON} className="gr-pill-icon" />
    case 'detached':
      return <CircleDot size={ICON} className="gr-pill-icon" />
    default:
      return (
        <>
          {pill.isHead ? (
            <Check size={ICON} strokeWidth={3} className="gr-pill-check" />
          ) : pill.ref.worktree ? (
            <FolderGit2 size={ICON} className="gr-pill-icon" />
          ) : (
            <Monitor size={ICON} className="gr-pill-icon" />
          )}
          {pill.remotes.length > 0 && <Cloud size={ICON} className="gr-pill-icon" />}
        </>
      )
  }
}

export function PillView({ pill, ctx, onDragState }: { pill: Pill; ctx: GraphCtx; onDragState?: (dragging: boolean) => void }) {
  const draggable = pill.kind !== 'detached'
  const droppable = pill.kind !== 'detached'
  return (
    <span
      className={`gr-pill gr-pill-${pill.kind}${pill.isHead ? ' gr-pill-head' : ''}`}
      title={pillTitle(pill)}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.stopPropagation()
              setRefDragData(e, pill.ref)
              onDragState?.(true)
            }
          : undefined
      }
      onDragEnd={draggable ? () => onDragState?.(false) : undefined}
      onDragOver={
        droppable
          ? (e) => {
              if (!hasRefDragData(e)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              e.currentTarget.classList.add('gr-drop-over')
            }
          : undefined
      }
      onDragLeave={
        droppable
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.classList.remove('gr-drop-over')
            }
          : undefined
      }
      onDrop={
        droppable
          ? (e) => {
              e.currentTarget.classList.remove('gr-drop-over')
              const source = getRefDragData(e)
              if (!source) return
              e.preventDefault()
              ctx.onRefDrop(source, pill, { clientX: e.clientX, clientY: e.clientY })
            }
          : undefined
      }
      onDoubleClick={(e) => {
        e.stopPropagation()
        ctx.onPillDoubleClick(pill)
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        ctx.onPillContextMenu(e, pill)
      }}
    >
      <PillIcons pill={pill} />
      <span className="gr-pill-label">{pill.label}</span>
    </span>
  )
}

function MoreBadge({ pills, ctx, color }: { pills: readonly Pill[]; ctx: GraphCtx; color: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const pinned = useRef(false)
  const dragging = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const badge = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  const close = () => {
    pinned.current = false
    clearTimeout(timer.current)
    setOpen(false)
  }
  const openSoon = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 120)
  }
  const closeSoon = () => {
    if (pinned.current || dragging.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 200)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    if (!open) return
    // Follow the badge while open: its row can move (refresh, solo/hide, new commits)
    // without this component re-rendering. Close when the badge goes away.
    let raf = 0
    let last = ''
    const place = () => {
      const el = badge.current
      if (!el || !el.isConnected || el.getClientRects().length === 0) {
        close()
        return
      }
      const r = el.getBoundingClientRect()
      const w = pop.current?.offsetWidth ?? 240
      const h = pop.current?.offsetHeight ?? 0
      const left = Math.max(4, Math.min(r.left, window.innerWidth - w - 8))
      const top = r.bottom + 4 + h > window.innerHeight - 4 ? Math.max(4, r.top - 4 - h) : r.bottom + 4
      const key = `${left}|${top}`
      if (key !== last) {
        last = key
        setPos({ left, top })
      }
      raf = requestAnimationFrame(place)
    }
    place()
    return () => cancelAnimationFrame(raf)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (badge.current?.contains(t) || pop.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onScroll = (e: Event) => {
      if (pop.current?.contains(e.target as Node)) return
      if (!dragging.current) close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', close)
    }
  }, [open])

  return (
    <>
      <span
        ref={badge}
        className={`gr-pill-more${open ? ' gr-open' : ''}`}
        title={pills.map((p) => p.label).join('\n')}
        onMouseEnter={openSoon}
        onMouseLeave={closeSoon}
        onClick={() => {
          pinned.current = !pinned.current || !open
          clearTimeout(timer.current)
          setOpen(pinned.current)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        +{pills.length}
      </span>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="gr-pop"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--gr-lane' as string]: color } as CSSProperties}
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={closeSoon}
            onContextMenu={(e) => e.preventDefault()}
          >
            {pills.map((p) => (
              <PillView
                key={p.key}
                pill={p}
                ctx={ctx}
                onDragState={(d) => {
                  dragging.current = d
                  if (!d) close()
                }}
              />
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

export interface RefPillsProps {
  pills: readonly Pill[] | undefined
  ctx: GraphCtx
  /** CSS colour of the commit's lane (for the popover, which lives outside the row). */
  color: string
}

const NO_PILLS: readonly Pill[] = []

/** Branch refs of a row's pills, checked for a pull request (local branches first). */
function branchRefs(pills: readonly Pill[]) {
  const out = []
  for (const p of pills) if (p.kind === 'branch') out.push(p.ref, ...p.remotes)
  for (const p of pills) if (p.kind === 'remote') out.push(p.ref)
  return out
}

export const RefPills = memo(function RefPills({ pills, ctx, color }: RefPillsProps) {
  const pr = usePullForRefs(branchRefs(pills ?? NO_PILLS))
  if (!pills || pills.length === 0) return null
  const [first, ...rest] = pills
  return (
    <div className="gr-refs">
      <PillView pill={first} ctx={ctx} />
      {pr && <PullChip pr={pr} onClick={() => ctx.onPullClick(pr.number)} />}
      {rest.length > 0 && <MoreBadge pills={rest} ctx={ctx} color={color} />}
      <span className="gr-refs-line" />
    </div>
  )
})
