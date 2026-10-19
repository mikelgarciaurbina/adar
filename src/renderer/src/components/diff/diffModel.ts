// Pure view model for the diff renderer: rows for the unified and split layouts
// (changed hunks only, or the whole file as one hunk), line numbers, del/add
// pairing for word diffs, per-side text blocks for syntax highlighting, change
// blocks (runs of consecutive changed lines) and line-selection helpers for
// partial staging.

import { hunkLineNumbers, isChange, remapSelection, type HunkSelection } from '@shared/patch'
import type { FileDiff } from '@shared/types'

export type UnifiedRow = { kind: 'hunk'; hunkIndex: number } | { kind: 'line'; hunkIndex: number; lineIndex: number }

export type SplitRow =
  | { kind: 'hunk'; hunkIndex: number }
  /** left: line index of a context/del line; right: line index of a context/add line (null = filler). */
  | { kind: 'pair'; hunkIndex: number; left: number | null; right: number | null }

export interface HunkModel {
  numbers: Array<{ old: number | null; new: number | null }>
  /** For each line: index of the paired del/add line in the same change block, or -1. */
  pair: Int32Array
  /** For each line: position in the old-side block (context + del), or -1. */
  oldPos: Int32Array
  /** For each line: position in the new-side block (context + add), or -1. */
  newPos: Int32Array
  oldText: string[]
  newText: string[]
  changes: number
}

/** A run of consecutive changed (del / add) lines inside one hunk. */
export interface ChangeBlock {
  hunkIndex: number
  /** First and last (inclusive) indexes into hunk.lines. */
  start: number
  end: number
  /** Index of the block's first row in DiffModel.unified / DiffModel.split. */
  unifiedRow: number
  splitRow: number
  dels: number
  adds: number
}

export interface DiffModel {
  hunks: HunkModel[]
  unified: UnifiedRow[]
  split: SplitRow[]
  blocks: ChangeBlock[]
  /** For each unified / split row: index into `blocks` of the change block it shows, or -1. */
  unifiedBlock: Int32Array
  splitBlock: Int32Array
  /** Widest line in columns (tabs expanded to 4). */
  maxCols: number
  /** Largest line number (for gutter width). */
  maxLineNo: number
  changeCount: number
}

export const TAB_SIZE = 4

/** Visual width of a line in columns, expanding tabs. */
export function visualWidth(s: string): number {
  if (s.indexOf('\t') < 0) return s.length
  let col = 0
  for (let i = 0; i < s.length; i++) col = s.charCodeAt(i) === 9 ? col + TAB_SIZE - (col % TAB_SIZE) : col + 1
  return col
}

export function buildDiffModel(diff: FileDiff, opts: { hunkHeaders: boolean }): DiffModel {
  const unified: UnifiedRow[] = []
  const split: SplitRow[] = []
  const hunks: HunkModel[] = []
  const blocks: ChangeBlock[] = []
  const unifiedBlockList: number[] = []
  const splitBlockList: number[] = []
  let maxCols = 0
  let maxLineNo = 0
  let changeCount = 0
  const showHeaders = opts.hunkHeaders || diff.hunks.length > 1

  diff.hunks.forEach((hunk, hunkIndex) => {
    const n = hunk.lines.length
    const numbers = hunkLineNumbers(hunk)
    const pair = new Int32Array(n).fill(-1)
    const oldPos = new Int32Array(n).fill(-1)
    const newPos = new Int32Array(n).fill(-1)
    const oldText: string[] = []
    const newText: string[] = []
    let changes = 0

    if (showHeaders) {
      unified.push({ kind: 'hunk', hunkIndex })
      split.push({ kind: 'hunk', hunkIndex })
      unifiedBlockList.push(-1)
      splitBlockList.push(-1)
    }

    let i = 0
    while (i < n) {
      const line = hunk.lines[i]
      if (!isChange(line)) {
        oldPos[i] = oldText.push(line.content) - 1
        newPos[i] = newText.push(line.content) - 1
        unified.push({ kind: 'line', hunkIndex, lineIndex: i })
        split.push({ kind: 'pair', hunkIndex, left: i, right: i })
        unifiedBlockList.push(-1)
        splitBlockList.push(-1)
        const w = visualWidth(line.content)
        if (w > maxCols) maxCols = w
        i++
        continue
      }
      // Change block: consecutive del/add lines.
      const dels: number[] = []
      const adds: number[] = []
      const blockIndex = blocks.length
      const block: ChangeBlock = { hunkIndex, start: i, end: i, unifiedRow: unified.length, splitRow: split.length, dels: 0, adds: 0 }
      blocks.push(block)
      while (i < n && isChange(hunk.lines[i])) {
        const l = hunk.lines[i]
        if (l.type === 'del') {
          dels.push(i)
          oldPos[i] = oldText.push(l.content) - 1
        } else {
          adds.push(i)
          newPos[i] = newText.push(l.content) - 1
        }
        unified.push({ kind: 'line', hunkIndex, lineIndex: i })
        unifiedBlockList.push(blockIndex)
        const w = visualWidth(l.content)
        if (w > maxCols) maxCols = w
        changes++
        i++
      }
      block.end = i - 1
      block.dels = dels.length
      block.adds = adds.length
      const rows = Math.max(dels.length, adds.length)
      for (let k = 0; k < rows; k++) {
        const d = dels[k] ?? null
        const a = adds[k] ?? null
        if (d !== null && a !== null) {
          pair[d] = a
          pair[a] = d
        }
        split.push({ kind: 'pair', hunkIndex, left: d, right: a })
        splitBlockList.push(blockIndex)
      }
    }

    for (const num of numbers) {
      if (num.old !== null && num.old > maxLineNo) maxLineNo = num.old
      if (num.new !== null && num.new > maxLineNo) maxLineNo = num.new
    }
    changeCount += changes
    hunks.push({ numbers, pair, oldPos, newPos, oldText, newText, changes })
  })

  return {
    hunks,
    unified,
    split,
    blocks,
    unifiedBlock: Int32Array.from(unifiedBlockList),
    splitBlock: Int32Array.from(splitBlockList),
    maxCols,
    maxLineNo,
    changeCount
  }
}

// ── Change blocks ────────────────────────────────────────────────────────────

/** buildPartialPatch selection covering exactly one change block. */
export function blockSelection(block: ChangeBlock): HunkSelection {
  const lineIndexes: number[] = []
  for (let i = block.start; i <= block.end; i++) lineIndexes.push(i)
  return { hunkIndex: block.hunkIndex, lineIndexes }
}

/** "Line 12" / "Lines 12-18" of a block on the new side (old side for pure deletions). */
export function blockRangeLabel(model: DiffModel, block: ChangeBlock): string {
  const nums = model.hunks[block.hunkIndex]?.numbers
  if (!nums) return ''
  const useNew = block.adds > 0
  let first: number | null = null
  let last: number | null = null
  for (let i = block.start; i <= block.end; i++) {
    const n = useNew ? nums[i]?.new : nums[i]?.old
    if (n === null || n === undefined) continue
    if (first === null) first = n
    last = n
  }
  if (first === null || last === null) return ''
  return first === last ? `Line ${first}` : `Lines ${first}-${last}`
}

// ── Scroll anchoring ─────────────────────────────────────────────────────────

export interface LineAnchor {
  old: number | null
  new: number | null
}

/** Old / new file line numbers shown by a row (null for hunk headers). */
export function rowLines(model: DiffModel, row: UnifiedRow | SplitRow | undefined): LineAnchor | null {
  if (!row || row.kind === 'hunk') return null
  const nums = model.hunks[row.hunkIndex]?.numbers
  if (!nums) return null
  if (row.kind === 'line') return nums[row.lineIndex] ?? null
  return { old: row.left !== null ? (nums[row.left]?.old ?? null) : null, new: row.right !== null ? (nums[row.right]?.new ?? null) : null }
}

/**
 * Row to scroll to so that a view showing the same file in another layout (or
 * with more / less context) starts where `anchor` was: the first row at or after
 * the anchor's new-side line (old side when it has none). -1 when nothing matches.
 */
export function anchorRow(model: DiffModel, rows: ReadonlyArray<UnifiedRow | SplitRow>, anchor: LineAnchor): number {
  const useNew = anchor.new !== null
  const want = useNew ? anchor.new! : anchor.old
  if (want === null) return -1
  let best = -1
  for (let r = 0; r < rows.length; r++) {
    const l = rowLines(model, rows[r])
    if (!l) continue
    const n = useNew ? l.new : l.old
    if (n === null) continue
    if (n >= want) return r
    best = r
  }
  return best
}

// ── Line selection (partial staging) ─────────────────────────────────────────

export const lineKey = (hunkIndex: number, lineIndex: number): string => `${hunkIndex}:${lineIndex}`

export function parseLineKey(key: string): { hunkIndex: number; lineIndex: number } {
  const i = key.indexOf(':')
  return { hunkIndex: Number(key.slice(0, i)), lineIndex: Number(key.slice(i + 1)) }
}

/** Group selected line keys into a buildPartialPatch selection. */
export function selectionFromKeys(keys: Iterable<string>): HunkSelection[] {
  const byHunk = new Map<number, number[]>()
  for (const k of keys) {
    const { hunkIndex, lineIndex } = parseLineKey(k)
    const list = byHunk.get(hunkIndex) ?? []
    list.push(lineIndex)
    byHunk.set(hunkIndex, list)
  }
  return [...byHunk.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hunkIndex, lineIndexes]) => ({ hunkIndex, lineIndexes: lineIndexes.sort((a, b) => a - b) }))
}

/** Keys of selected lines that still are changes in `diff` (drops stale keys). */
export function validKeys(diff: FileDiff, keys: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const k of keys) {
    const { hunkIndex, lineIndex } = parseLineKey(k)
    const line = diff.hunks[hunkIndex]?.lines[lineIndex]
    if (line && isChange(line)) out.add(k)
  }
  return out
}

/** Carry a line selection over to a reloaded diff of the same file (by line number + content). */
export function remapKeys(from: FileDiff, keys: ReadonlySet<string>, to: FileDiff): Set<string> {
  const out = new Set<string>()
  if (!keys.size) return out
  const { selection } = remapSelection(from, selectionFromKeys(keys), to)
  for (const s of selection) for (const i of s.lineIndexes ?? []) out.add(lineKey(s.hunkIndex, i))
  return out
}

export type SelectSide = 'unified' | 'left' | 'right'

/** The selectable change line of a row on a side, as a key (null when the cell holds no change). */
export function rowChangeKey(diff: FileDiff, row: UnifiedRow | SplitRow, side: SelectSide): string | null {
  if (row.kind === 'hunk') return null
  let lineIndex: number | null
  if (row.kind === 'line') lineIndex = row.lineIndex
  else lineIndex = side === 'right' ? row.right : row.left
  if (lineIndex === null) return null
  const line = diff.hunks[row.hunkIndex]?.lines[lineIndex]
  if (!line || !isChange(line)) return null
  if (side === 'left' && line.type !== 'del') return null
  if (side === 'right' && line.type !== 'add') return null
  return lineKey(row.hunkIndex, lineIndex)
}

/** Keys of the change lines between two row indexes (inclusive) on a side. */
export function changeKeysInRange(
  diff: FileDiff,
  rows: ReadonlyArray<UnifiedRow | SplitRow>,
  from: number,
  to: number,
  side: SelectSide
): string[] {
  const lo = Math.max(0, Math.min(from, to))
  const hi = Math.min(rows.length - 1, Math.max(from, to))
  const out: string[] = []
  for (let r = lo; r <= hi; r++) {
    const k = rowChangeKey(diff, rows[r], side)
    if (k) out.push(k)
  }
  return out
}

/** All change keys of one hunk. */
export function hunkChangeKeys(diff: FileDiff, hunkIndex: number): string[] {
  const hunk = diff.hunks[hunkIndex]
  if (!hunk) return []
  const out: string[] = []
  hunk.lines.forEach((l, i) => {
    if (isChange(l)) out.push(lineKey(hunkIndex, i))
  })
  return out
}

/** "Lines 10-18" style range of a hunk on the new side (old side when the new side is empty). */
export function hunkRangeLabel(diff: FileDiff, hunkIndex: number): string {
  const h = diff.hunks[hunkIndex]
  if (!h) return ''
  const useNew = h.newLines > 0
  const start = useNew ? h.newStart : h.oldStart
  const count = useNew ? h.newLines : h.oldLines
  if (count <= 1) return `Line ${start}`
  return `Lines ${start}-${start + count - 1}`
}
