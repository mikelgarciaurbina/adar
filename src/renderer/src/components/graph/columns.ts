// Graph column widths, persisted per user in localStorage.

export interface ColumnWidths {
  refs: number
  /** null = auto (fits the lanes). */
  graph: number | null
  author: number
  date: number
  sha: number
}

export type ColumnId = keyof ColumnWidths

export const DEFAULT_WIDTHS: ColumnWidths = { refs: 170, graph: null, author: 130, date: 104, sha: 80 }

export const COLUMN_LIMITS: Record<ColumnId, { min: number; max: number }> = {
  refs: { min: 60, max: 520 },
  graph: { min: 40, max: 900 },
  author: { min: 60, max: 360 },
  date: { min: 60, max: 260 },
  sha: { min: 52, max: 200 }
}

const STORAGE_KEY = 'adar.graph.columns.v1'

function clampWidth(id: ColumnId, v: number): number {
  const { min, max } = COLUMN_LIMITS[id]
  return Math.round(Math.max(min, Math.min(max, v)))
}

/** Validate untrusted persisted data; unknown or invalid values fall back to defaults. */
export function sanitizeWidths(raw: unknown): ColumnWidths {
  const out: ColumnWidths = { ...DEFAULT_WIDTHS }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const id of Object.keys(DEFAULT_WIDTHS) as ColumnId[]) {
    const v = r[id]
    if (id === 'graph' && v === null) out.graph = null
    else if (typeof v === 'number' && Number.isFinite(v)) out[id] = clampWidth(id, v)
  }
  return out
}

export type OptionalColumn = 'author' | 'date' | 'sha'
type Shown = Record<OptionalColumn, boolean>

/**
 * Optional columns that fit in `room` px (the width left after the BRANCH/TAG,
 * GRAPH and minimum message columns): drops SHA, then date, then author while
 * the enabled ones would not fit, so a narrow panel keeps readable messages.
 */
export function fitColumns(enabled: Shown, widths: ColumnWidths, room: number): Shown {
  const out = { ...enabled }
  const used = () => (out.author ? widths.author : 0) + (out.date ? widths.date : 0) + (out.sha ? widths.sha : 0)
  for (const id of ['sha', 'date', 'author'] as const) {
    if (used() <= room) break
    out[id] = false
  }
  return out
}

export function setWidth(widths: ColumnWidths, id: ColumnId, value: number | null): ColumnWidths {
  if (value === null) return id === 'graph' ? { ...widths, graph: null } : { ...widths, [id]: DEFAULT_WIDTHS[id] }
  return { ...widths, [id]: clampWidth(id, value) }
}

export function loadWidths(): ColumnWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return sanitizeWidths(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_WIDTHS }
  }
}

export function saveWidths(widths: ColumnWidths): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    /* storage unavailable (private mode, quota) — widths just are not remembered */
  }
}
