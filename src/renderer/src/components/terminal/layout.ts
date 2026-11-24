// The panes of one terminal tab, pure: a tree of splits (a row puts its two sides next to each other, a column
// one above the other), with what splitting, closing, resizing, moving between panes and moving a pane itself do to
// it; and the order of an owner's terminal tabs.

export type PaneTree =
  | { kind: 'pane'; id: string }
  /** `ratio` is the share of the first side (0…1). */
  | { kind: 'split'; dir: 'row' | 'column'; ratio: number; a: PaneTree; b: PaneTree }

export type Direction = 'left' | 'right' | 'up' | 'down'

export const MIN_RATIO = 0.1
export const MAX_RATIO = 0.9

export const pane = (id: string): PaneTree => ({ kind: 'pane', id })

/** The panes in reading order (left to right, top to bottom within each split). */
export function panesOf(tree: PaneTree): string[] {
  return tree.kind === 'pane' ? [tree.id] : [...panesOf(tree.a), ...panesOf(tree.b)]
}

export function hasPane(tree: PaneTree, id: string): boolean {
  return tree.kind === 'pane' ? tree.id === id : hasPane(tree.a, id) || hasPane(tree.b, id)
}

/** `target` shares its place with a new pane: to its right (row) or below it (column). */
export function splitPane(tree: PaneTree, target: string, added: string, dir: 'row' | 'column'): PaneTree {
  if (tree.kind === 'pane') return tree.id === target ? { kind: 'split', dir, ratio: 0.5, a: tree, b: pane(added) } : tree
  return { ...tree, a: splitPane(tree.a, target, added, dir), b: splitPane(tree.b, target, added, dir) }
}

/** The tree without a pane (its neighbour takes the room); null when it was the only one. */
export function removePane(tree: PaneTree, id: string): PaneTree | null {
  if (tree.kind === 'pane') return tree.id === id ? null : tree
  const a = removePane(tree.a, id)
  const b = removePane(tree.b, id)
  if (!a) return b
  if (!b) return a
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b }
}

/**
 * `id` leaves its place (its neighbour there takes the room) and takes the `side` half of `target`'s place.
 * Two panes that share a split and change places along it keep their sizes. The same tree when nothing moves.
 */
export function movePane(tree: PaneTree, id: string, target: string, side: Direction): PaneTree {
  if (id === target || !hasPane(tree, id) || !hasPane(tree, target)) return tree
  const dir = side === 'left' || side === 'right' ? 'row' : 'column'
  const first = side === 'left' || side === 'up'
  let ratio = 0.5
  const shared = splitOf(tree, id, target)
  if (shared && shared.dir === dir) {
    const wasFirst = shared.a.kind === 'pane' && shared.a.id === id
    if (wasFirst === first) return tree
    const share = wasFirst ? shared.ratio : 1 - shared.ratio
    ratio = first ? share : 1 - share
  }
  const rest = removePane(tree, id)
  if (!rest) return tree
  const moved = pane(id)
  const place = (t: PaneTree): PaneTree => {
    if (t.kind === 'pane') return t.id === target ? { kind: 'split', dir, ratio, a: first ? moved : t, b: first ? t : moved } : t
    return { ...t, a: place(t.a), b: place(t.b) }
  }
  return place(rest)
}

/** The split whose two sides are exactly these two panes, if there is one. */
function splitOf(tree: PaneTree, x: string, y: string): Extract<PaneTree, { kind: 'split' }> | null {
  if (tree.kind === 'pane') return null
  if (tree.a.kind === 'pane' && tree.b.kind === 'pane') {
    const ids = [tree.a.id, tree.b.id]
    return ids.includes(x) && ids.includes(y) ? tree : null
  }
  return splitOf(tree.a, x, y) ?? splitOf(tree.b, x, y)
}

/** The side of a box a point is nearest to; `x` and `y` are shares of its width and height (0…1). */
export function sideAt(x: number, y: number): Direction {
  const to: Array<[Direction, number]> = [
    ['left', x],
    ['right', 1 - x],
    ['up', y],
    ['down', 1 - y]
  ]
  return to.reduce((best, d) => (d[1] < best[1] ? d : best))[0]
}

/** A list with `id` moved to just before `before` (to the end when null); the same list when it is already there. */
export function moveBefore<T extends { id: string }>(list: readonly T[], id: string, before: string | null): readonly T[] {
  const from = list.findIndex((x) => x.id === id)
  if (from < 0 || before === id) return list
  const rest = list.filter((x) => x.id !== id)
  const at = before === null ? rest.length : rest.findIndex((x) => x.id === before)
  if (at < 0 || at === from) return list
  return [...rest.slice(0, at), list[from], ...rest.slice(at)]
}

/** Where a split is: the turns from the root (0 = first side, 1 = second). */
export type SplitPath = readonly number[]

export function setRatio(tree: PaneTree, at: SplitPath, ratio: number): PaneTree {
  if (tree.kind === 'pane') return tree
  if (!at.length) return { ...tree, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) }
  const [turn, ...rest] = at
  return turn === 0 ? { ...tree, a: setRatio(tree.a, rest, ratio) } : { ...tree, b: setRatio(tree.b, rest, ratio) }
}

/** Every pane of a run of splits in the same direction gets the same room. */
export function equalize(tree: PaneTree): PaneTree {
  if (tree.kind === 'pane') return tree
  const weight = (t: PaneTree): number => (t.kind === 'split' && t.dir === tree.dir ? weight(t.a) + weight(t.b) : 1)
  const wa = weight(tree.a)
  return { ...tree, ratio: wa / (wa + weight(tree.b)), a: equalize(tree.a), b: equalize(tree.b) }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Where each pane is, in a unit square. */
export function rectsOf(tree: PaneTree, box: Rect = { x: 0, y: 0, w: 1, h: 1 }): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const walk = (t: PaneTree, r: Rect) => {
    if (t.kind === 'pane') return void out.set(t.id, r)
    if (t.dir === 'row') {
      walk(t.a, { ...r, w: r.w * t.ratio })
      walk(t.b, { ...r, x: r.x + r.w * t.ratio, w: r.w * (1 - t.ratio) })
    } else {
      walk(t.a, { ...r, h: r.h * t.ratio })
      walk(t.b, { ...r, y: r.y + r.h * t.ratio, h: r.h * (1 - t.ratio) })
    }
  }
  walk(tree, box)
  return out
}

const EPS = 1e-6

/** The pane next to `id` in a direction: the one that touches it there and overlaps it most. */
export function neighbour(tree: PaneTree, id: string, dir: Direction): string | null {
  const rects = rectsOf(tree)
  const from = rects.get(id)
  if (!from) return null
  let best: string | null = null
  let bestOverlap = 0
  for (const [other, r] of rects) {
    if (other === id) continue
    const horizontal = dir === 'left' || dir === 'right'
    const touches =
      dir === 'left'
        ? Math.abs(r.x + r.w - from.x) < EPS
        : dir === 'right'
          ? Math.abs(r.x - (from.x + from.w)) < EPS
          : dir === 'up'
            ? Math.abs(r.y + r.h - from.y) < EPS
            : Math.abs(r.y - (from.y + from.h)) < EPS
    if (!touches) continue
    const overlap = horizontal ? Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y) : Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x)
    if (overlap > bestOverlap + EPS) {
      best = other
      bestOverlap = overlap
    }
  }
  return best
}

/** The pane after (1) or before (-1) `id` in reading order, going round. */
export function stepPane(tree: PaneTree, id: string, step: 1 | -1): string {
  const all = panesOf(tree)
  const i = all.indexOf(id)
  return i < 0 ? (all[0] ?? id) : all[(i + step + all.length) % all.length]
}

/**
 * Move the divider nearest to `id` in a direction by `amount` of its split (the innermost split around the pane
 * that divides along that axis). The same tree when there is none.
 */
export function nudge(tree: PaneTree, id: string, dir: Direction, amount = 0.05): PaneTree {
  const axis = dir === 'left' || dir === 'right' ? 'row' : 'column'
  const delta = dir === 'right' || dir === 'down' ? amount : -amount
  let done = false
  const walk = (t: PaneTree): PaneTree => {
    if (t.kind === 'pane') return t
    const inA = hasPane(t.a, id)
    if (!inA && !hasPane(t.b, id)) return t
    const child = walk(inA ? t.a : t.b)
    const next: PaneTree = inA ? { ...t, a: child } : { ...t, b: child }
    if (done || t.dir !== axis) return next
    done = true
    return { ...next, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, t.ratio + delta)) }
  }
  const next = walk(tree)
  return done ? next : tree
}

/** A tree read from storage, kept only when it is one (ids must be among `known`); else null. */
export function parseTree(raw: unknown, known: ReadonlySet<string>, depth = 0): PaneTree | null {
  if (!raw || typeof raw !== 'object' || depth > 12) return null
  const t = raw as Record<string, unknown>
  if (t.kind === 'pane') return typeof t.id === 'string' && known.has(t.id) ? pane(t.id) : null
  if (t.kind !== 'split' || (t.dir !== 'row' && t.dir !== 'column')) return null
  const a = parseTree(t.a, known, depth + 1)
  const b = parseTree(t.b, known, depth + 1)
  // A pane that is gone leaves its room to the other side.
  if (!a || !b) return a ?? b
  const ratio = typeof t.ratio === 'number' && Number.isFinite(t.ratio) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, t.ratio)) : 0.5
  return { kind: 'split', dir: t.dir, ratio, a, b }
}
