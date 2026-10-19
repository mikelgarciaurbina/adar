// Pixel geometry of the graph column and SVG path builders (pure).

import { laneColor } from '@renderer/lib/colors'
import type { Edge } from './layout'

/** Horizontal distance between lane centres. */
export const LANE_W = 18
/** Left padding before lane 0. */
export const GRAPH_PAD = 6
/** Outer radius of a commit node (avatar ring, ~20px). */
export const NODE_R = 10
/** Radius of the filled dot drawn for merge commits. */
export const MERGE_R = 4.5
/** Radius of the dashed WIP circle. */
export const WIP_R = 9
/** Dash pattern for virtual connectors; 7px period divides the 28px row so dashes line up across rows. */
export const DASH = '4 3'
export const DEFAULT_ROW_H = 28

/** X of a lane centre (integer, so 2px strokes stay crisp). */
export function laneX(lane: number): number {
  return GRAPH_PAD + lane * LANE_W + LANE_W / 2
}

/** Width needed to draw `lanes` lanes. */
export function graphContentWidth(lanes: number): number {
  return GRAPH_PAD * 2 + Math.max(1, lanes) * LANE_W
}

/** Message column width the auto-sized GRAPH column tries not to eat into. */
export const MIN_MSG_W = 200
/** Below this message width the optional columns (SHA, date, author) are hidden. */
export const MIN_MSG_HIDE_W = 150
/** The auto-sized GRAPH column is never narrower than this (≈7 lanes) when it has lanes to show. */
const AUTO_FLOOR_W = 140
const AUTO_MAX_W = 360

/**
 * Auto width of the GRAPH column: fits the lanes (up to a cap) but gives way to the
 * commit messages when `available` space is short, never dropping below ~7 lanes or
 * the lanes in `mustShow` (HEAD / WIP), so the checked-out branch stays visible.
 * Extra lanes are clipped; the column stays resizable.
 */
export function autoGraphWidth(lanes: number, available = Infinity, mustShow = 0): number {
  const want = Math.min(AUTO_MAX_W, graphContentWidth(lanes))
  const floor = Math.min(want, Math.max(AUTO_FLOOR_W, graphContentWidth(mustShow)))
  return Math.max(64, floor, Math.min(want, Math.floor(available)))
}

/** CSS colour for a colour index; negative indexes are neutral (stash connectors). */
export function colorOf(index: number): string {
  return index < 0 ? 'var(--text-3)' : laneColor(index)
}

/** SVG path for one edge inside a row of height h. Lane changes use rounded corners meeting the node horizontally. */
export function edgePath(e: Edge, h: number): string {
  const mid = h / 2
  const xf = laneX(e.from)
  const xt = laneX(e.to)
  if (e.type === 'pass') return `M${xf} 0V${h}`
  if (e.type === 'in') {
    if (e.from === e.to) return `M${xf} 0V${mid}`
    const dir = xt > xf ? 1 : -1
    const r = Math.min(mid, Math.abs(xt - xf))
    return `M${xf} 0V${mid - r}Q${xf} ${mid} ${xf + dir * r} ${mid}H${xt}`
  }
  if (e.from === e.to) return `M${xf} ${mid}V${h}`
  const dir = xt > xf ? 1 : -1
  const r = Math.min(mid, Math.abs(xt - xf))
  return `M${xf} ${mid}H${xt - dir * r}Q${xt} ${mid} ${xt} ${mid + r}V${h}`
}

export interface PathGroup {
  key: string
  color: number
  dashed: boolean
  d: string
}

/**
 * Merge a row's edges into one path per (colour, dashed) pair so each row renders
 * a handful of DOM nodes. Pass-through lines come first so lane changes paint on top.
 */
export function rowPaths(edges: readonly Edge[], h: number): PathGroup[] {
  const groups = new Map<string, PathGroup>()
  const add = (e: Edge) => {
    const dashed = !!e.dashed
    const key = `${e.color}|${dashed ? 1 : 0}`
    const d = edgePath(e, h)
    const g = groups.get(key)
    if (g) g.d += d
    else groups.set(key, { key, color: e.color, dashed, d })
  }
  for (const e of edges) if (e.type === 'pass') add(e)
  // Separate map so curves end up after (on top of) the straight lines.
  const passGroups = [...groups.values()]
  groups.clear()
  for (const e of edges) if (e.type !== 'pass') add(e)
  const curveGroups = [...groups.values()].map((g) => ({ ...g, key: `c${g.key}` }))
  return passGroups.concat(curveGroups)
}
