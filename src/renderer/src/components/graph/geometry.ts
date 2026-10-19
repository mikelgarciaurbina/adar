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

/**
 * Lanes whose node fits entirely inside a GRAPH column `width` px wide
 * (inverse of graphContentWidth: graphContentWidth(n) fits exactly n lanes).
 */
export function lanesFitting(width: number): number {
  return Math.max(0, Math.floor((width - GRAPH_PAD - LANE_W / 2 - NODE_R) / LANE_W) + 1)
}

/** Lanes (out of `lanes`) a GRAPH column `width` px wide cannot show. */
export function hiddenLanes(lanes: number, width: number): number {
  return Math.max(0, lanes - lanesFitting(width))
}

/** Gap between a pinned node and the GRAPH column's right edge. */
const PIN_GAP = 3

/**
 * Centre x of a node pinned to the right edge of a GRAPH column `colW` px wide,
 * or null when the node of `lane` fits in place (or the width is unknown).
 */
export function pinnedNodeX(lane: number, colW: number): number | null {
  if (!(colW > 0)) return null
  if (laneX(lane) + NODE_R <= colW) return null
  return Math.max(NODE_R, colW - NODE_R - PIN_GAP)
}

/** Below this message width the optional columns (SHA, date, author) are hidden and the auto GRAPH column stops growing. */
export const MIN_MSG_HIDE_W = 150
/** Message column minimum in CSS (.gr-c-msg); an explicit "fit the lanes" may squeeze the messages down to it. */
export const MIN_MSG_CSS_W = 120

/**
 * Width for an explicit "fit the lanes in view" (the "+N" badge): the lanes'
 * width, bounded by the room left after the BRANCH / TAG column and the minimum
 * message width — but never narrower than the column already is.
 */
export function fitGraphWidth(lanes: number, current: number, inner: number, refsW: number): number {
  const room = Number.isFinite(inner) ? inner - refsW - MIN_MSG_CSS_W : Infinity
  return Math.max(current, Math.min(graphContentWidth(lanes), room))
}

/** The auto-sized GRAPH column is never narrower than this (≈7 lanes) when it has lanes to show. */
const AUTO_FLOOR_W = 140
/** Narrowest auto GRAPH column. */
const AUTO_MIN_W = 64
/** Cap of the auto GRAPH column as a fraction of the centre panel width. */
export const AUTO_CAP_RATIO = 0.45
/** Cap used before the panel has been measured. */
const AUTO_MAX_W = 360

/**
 * Widest the auto GRAPH column may grow in a centre panel `inner` px wide: 45%
 * (at least ≈7 lanes), and never more than what is left after `reserved` px (the
 * BRANCH / TAG column + the message column's CSS minimum), so the columns never
 * overflow the row and get squeezed by flex.
 */
export function autoGraphCap(inner: number, reserved = 0): number {
  if (!Number.isFinite(inner) || inner <= 0) return AUTO_MAX_W
  const share = Math.max(AUTO_FLOOR_W, Math.floor(inner * AUTO_CAP_RATIO))
  return Math.min(share, Math.max(AUTO_MIN_W, Math.floor(inner - reserved)))
}

export interface AutoWidthOptions {
  /** Room left for the graph after the other columns and the minimum message width. */
  available?: number
  /** Lanes that must stay visible even when `available` is short (selection, HEAD, WIP). */
  mustShow?: number
  /** Upper bound (see autoGraphCap). */
  cap?: number
}

/**
 * Auto width of the GRAPH column: fits `lanes` (the lanes of the rows in view)
 * up to `cap`, but gives way to the commit messages when `available` space is
 * short, never dropping below ~7 lanes or the `mustShow` lanes (still bounded by
 * `cap`). Lanes beyond it are clipped (CommitGraph then shows a "+N" hint).
 */
export function autoGraphWidth(lanes: number, opts: AutoWidthOptions = {}): number {
  const { available = Infinity, mustShow = 0, cap = AUTO_MAX_W } = opts
  const want = Math.min(cap, graphContentWidth(lanes))
  const floor = Math.min(want, Math.max(AUTO_FLOOR_W, graphContentWidth(mustShow)))
  return Math.max(AUTO_MIN_W, floor, Math.min(want, Math.floor(available)))
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
