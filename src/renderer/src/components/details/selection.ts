// Multi-selection model for the staging area file lists (Cmd/Ctrl-click
// toggles, Shift-click selects a range from the anchor, Shift+Arrow extends).

export interface PathSelection {
  /** Selected paths, in the order they were added. */
  paths: string[]
  /** Anchor for range selection (last plain/toggle click). */
  anchor: string | null
}

export const EMPTY_SELECTION: PathSelection = { paths: [], anchor: null }

export interface ClickModifiers {
  /** Cmd (mac) / Ctrl (others). */
  toggle?: boolean
  /** Shift. */
  range?: boolean
}

function rangeBetween(order: readonly string[], a: string, b: string): string[] | null {
  const ia = order.indexOf(a)
  const ib = order.indexOf(b)
  if (ia < 0 || ib < 0) return null
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia]
  return order.slice(lo, hi + 1)
}

/** New selection after clicking `path` with the given modifiers. `order` is the display order of the list. */
export function applyClick(order: readonly string[], sel: PathSelection, path: string, mods: ClickModifiers = {}): PathSelection {
  if (mods.range && sel.anchor) {
    const range = rangeBetween(order, sel.anchor, path)
    if (range) {
      if (mods.toggle) {
        const merged = [...sel.paths]
        for (const p of range) if (!merged.includes(p)) merged.push(p)
        return { paths: merged, anchor: sel.anchor }
      }
      return { paths: range, anchor: sel.anchor }
    }
  }
  if (mods.toggle) {
    if (sel.paths.includes(path)) {
      const paths = sel.paths.filter((p) => p !== path)
      return { paths, anchor: paths.length ? path : null }
    }
    return { paths: [...sel.paths, path], anchor: path }
  }
  return { paths: [path], anchor: path }
}

/** Keep only paths that still exist in the list. */
export function pruneSelection(sel: PathSelection, existing: ReadonlySet<string>): PathSelection {
  const paths = sel.paths.filter((p) => existing.has(p))
  if (paths.length === sel.paths.length && (!sel.anchor || existing.has(sel.anchor))) return sel
  return { paths, anchor: sel.anchor && existing.has(sel.anchor) ? sel.anchor : (paths[paths.length - 1] ?? null) }
}

/**
 * Paths an action should apply to when invoked on `path`: the whole selection
 * if `path` is part of it, otherwise just `path` (Finder/GitKraken behaviour).
 */
export function targetsOf(sel: PathSelection, path: string, order?: readonly string[]): string[] {
  if (!sel.paths.includes(path)) return [path]
  if (!order) return [...sel.paths]
  const set = new Set(sel.paths)
  return order.filter((p) => set.has(p))
}

/** Select every path of the list. */
export function selectAll(order: readonly string[]): PathSelection {
  return { paths: [...order], anchor: order[0] ?? null }
}
