import { describe, expect, it } from 'vitest'
import type { DiffHunk, DiffLine, FileDiff } from '@shared/types'
import {
  anchorRow,
  blockBarLift,
  blockRangeLabel,
  blockSelection,
  buildDiffModel,
  changeKeysInRange,
  hunkChangeKeys,
  hunkRangeLabel,
  lineKey,
  parseLineKey,
  remapKeys,
  rowChangeKey,
  rowLines,
  selectionFromKeys,
  validKeys,
  visualWidth
} from './diffModel'

function h(header: string, rows: string[]): DiffHunk {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)!
  const lines: DiffLine[] = rows.map((r) => ({
    type: r[0] === '+' ? 'add' : r[0] === '-' ? 'del' : 'context',
    content: r.slice(1),
    oldLine: null,
    newLine: null
  }))
  return { header, oldStart: +m[1], oldLines: m[2] ? +m[2] : 1, newStart: +m[3], newLines: m[4] ? +m[4] : 1, lines }
}

const fd = (hunks: DiffHunk[]): FileDiff => ({
  path: 'f.ts',
  status: 'modified',
  binary: false,
  isImage: false,
  hunks,
  additions: 0,
  deletions: 0
})

const diff = fd([h('@@ -1,4 +1,5 @@ fn', [' a', '-b', '-c', '+B', '+C', '+D', ' e']), h('@@ -20,2 +21,1 @@', [' x', '-y'])])

describe('buildDiffModel', () => {
  const m = buildDiffModel(diff, { hunkHeaders: true })

  it('builds unified rows with hunk headers', () => {
    expect(m.unified).toEqual([
      { kind: 'hunk', hunkIndex: 0 },
      ...[0, 1, 2, 3, 4, 5, 6].map((lineIndex) => ({ kind: 'line', hunkIndex: 0, lineIndex })),
      { kind: 'hunk', hunkIndex: 1 },
      { kind: 'line', hunkIndex: 1, lineIndex: 0 },
      { kind: 'line', hunkIndex: 1, lineIndex: 1 }
    ])
  })

  it('aligns split rows: context on both sides, del/add blocks paired with fillers', () => {
    expect(m.split).toEqual([
      { kind: 'hunk', hunkIndex: 0 },
      { kind: 'pair', hunkIndex: 0, left: 0, right: 0 },
      { kind: 'pair', hunkIndex: 0, left: 1, right: 3 },
      { kind: 'pair', hunkIndex: 0, left: 2, right: 4 },
      { kind: 'pair', hunkIndex: 0, left: null, right: 5 },
      { kind: 'pair', hunkIndex: 0, left: 6, right: 6 },
      { kind: 'hunk', hunkIndex: 1 },
      { kind: 'pair', hunkIndex: 1, left: 0, right: 0 },
      { kind: 'pair', hunkIndex: 1, left: 1, right: null }
    ])
  })

  it('pairs deleted and added lines for word diffs', () => {
    expect([...m.hunks[0].pair]).toEqual([-1, 3, 4, 1, 2, -1, -1])
    expect([...m.hunks[1].pair]).toEqual([-1, -1])
  })

  it('computes line numbers, side blocks and stats', () => {
    expect(m.hunks[0].numbers[5]).toEqual({ old: null, new: 4 })
    expect(m.hunks[0].oldText).toEqual(['a', 'b', 'c', 'e'])
    expect(m.hunks[0].newText).toEqual(['a', 'B', 'C', 'D', 'e'])
    expect([...m.hunks[0].oldPos]).toEqual([0, 1, 2, -1, -1, -1, 3])
    expect([...m.hunks[0].newPos]).toEqual([0, -1, -1, 1, 2, 3, 4])
    expect(m.maxLineNo).toBe(21)
    expect(m.changeCount).toBe(6)
  })

  it('omits hunk headers for a single-hunk full-file diff', () => {
    const one = fd([h('@@ -1,2 +1,2 @@', [' a', '-b', '+c'])])
    expect(buildDiffModel(one, { hunkHeaders: false }).unified.some((r) => r.kind === 'hunk')).toBe(false)
    // Several hunks keep their separators even inline.
    expect(buildDiffModel(diff, { hunkHeaders: false }).unified.filter((r) => r.kind === 'hunk')).toHaveLength(2)
  })

  it('measures visual width with tabs', () => {
    expect(visualWidth('abc')).toBe(3)
    expect(visualWidth('\tx')).toBe(5)
    expect(visualWidth('ab\tx')).toBe(5)
    const wide = fd([h('@@ -1,1 +1,1 @@', ['-\t\tlong line', '+short'])])
    expect(buildDiffModel(wide, { hunkHeaders: true }).maxCols).toBe(17)
  })
})

describe('selection helpers', () => {
  const m = buildDiffModel(diff, { hunkHeaders: true })

  it('round-trips keys and groups them per hunk', () => {
    expect(parseLineKey(lineKey(3, 14))).toEqual({ hunkIndex: 3, lineIndex: 14 })
    expect(selectionFromKeys(['1:1', '0:4', '0:1'])).toEqual([
      { hunkIndex: 0, lineIndexes: [1, 4] },
      { hunkIndex: 1, lineIndexes: [1] }
    ])
  })

  it('returns change keys of rows by side', () => {
    expect(rowChangeKey(diff, m.unified[0], 'unified')).toBeNull() // hunk header
    expect(rowChangeKey(diff, m.unified[1], 'unified')).toBeNull() // context
    expect(rowChangeKey(diff, m.unified[2], 'unified')).toBe('0:1')
    expect(rowChangeKey(diff, m.split[2], 'left')).toBe('0:1')
    expect(rowChangeKey(diff, m.split[2], 'right')).toBe('0:3')
    expect(rowChangeKey(diff, m.split[4], 'left')).toBeNull() // filler
    expect(rowChangeKey(diff, m.split[1], 'right')).toBeNull() // context
  })

  it('collects change keys in a row range, across hunks, on one side', () => {
    expect(changeKeysInRange(diff, m.unified, 10, 1, 'unified')).toEqual(['0:1', '0:2', '0:3', '0:4', '0:5', '1:1'])
    expect(changeKeysInRange(diff, m.split, 1, 8, 'right')).toEqual(['0:3', '0:4', '0:5'])
    expect(changeKeysInRange(diff, m.split, 1, 8, 'left')).toEqual(['0:1', '0:2', '1:1'])
  })

  it('lists hunk change keys and drops stale keys', () => {
    expect(hunkChangeKeys(diff, 1)).toEqual(['1:1'])
    expect([...validKeys(diff, ['0:0', '0:1', '7:1', '1:1'])]).toEqual(['0:1', '1:1'])
  })

  it('remaps a selection onto a reloaded diff', () => {
    // Same changes with more context and an earlier, unrelated hunk: indexes shift, identity (line number + content) does not.
    const reloaded = fd([h('@@ -0,0 +1,1 @@', ['+top']), h('@@ -1,5 +2,6 @@ fn', [' a', '-b', '-c', '+B', '+C', '+D', ' e', ' f'])])
    // "-b" (old line 2) and "+D" (new line 4 → 5 after the inserted top line) — only "-b" keeps its identity.
    expect([...remapKeys(diff, new Set(['0:1', '0:5']), reloaded)]).toEqual(['1:1'])
    const widened = fd([h('@@ -1,5 +1,6 @@ fn', [' a', '-b', '-c', '+B', '+C', '+D', ' e', ' f'])])
    expect([...remapKeys(diff, new Set(['0:1', '0:5']), widened)]).toEqual(['0:1', '0:5'])
    expect(remapKeys(diff, new Set(), widened).size).toBe(0)
  })

  it('labels hunk ranges', () => {
    expect(hunkRangeLabel(diff, 0)).toBe('Lines 1-5')
    expect(hunkRangeLabel(diff, 1)).toBe('Line 21')
  })
})

describe('change blocks', () => {
  // Whole file as one hunk (what git emits with a huge -U): two separate change blocks.
  const full = fd([h('@@ -1,6 +1,7 @@', [' a', '-b', '+B', '+B2', ' c', ' d', '-e', ' f', '+g'])])
  const m = buildDiffModel(full, { hunkHeaders: false })

  it('finds runs of consecutive changes with their first rows in both layouts', () => {
    expect(m.blocks).toEqual([
      { hunkIndex: 0, start: 1, end: 3, unifiedRow: 1, splitRow: 1, dels: 1, adds: 2 },
      { hunkIndex: 0, start: 6, end: 6, unifiedRow: 6, splitRow: 5, dels: 1, adds: 0 },
      { hunkIndex: 0, start: 8, end: 8, unifiedRow: 8, splitRow: 7, dels: 0, adds: 1 }
    ])
    expect([...m.unifiedBlock]).toEqual([-1, 0, 0, 0, -1, -1, 1, -1, 2])
    // Split: "-b"/"+B" paired, "+B2" with a filler on the left.
    expect([...m.splitBlock]).toEqual([-1, 0, 0, -1, -1, 1, -1, 2])
    expect(m.split[2]).toEqual({ kind: 'pair', hunkIndex: 0, left: null, right: 3 })
  })

  it('accounts for hunk header rows', () => {
    const withHeaders = buildDiffModel(diff, { hunkHeaders: true })
    expect(withHeaders.blocks.map((b) => [b.hunkIndex, b.unifiedRow, b.splitRow])).toEqual([
      [0, 2, 2],
      [1, 10, 8]
    ])
    expect(withHeaders.unifiedBlock[0]).toBe(-1)
  })

  it('selects exactly the lines of a block', () => {
    expect(blockSelection(m.blocks[0])).toEqual({ hunkIndex: 0, lineIndexes: [1, 2, 3] })
    expect(blockSelection(m.blocks[1])).toEqual({ hunkIndex: 0, lineIndexes: [6] })
  })

  it('labels block ranges on the new side, the old side for pure deletions', () => {
    expect(blockRangeLabel(m, m.blocks[0])).toBe('Lines 2-3')
    expect(blockRangeLabel(m, m.blocks[1])).toBe('Line 5')
    expect(blockRangeLabel(m, m.blocks[2])).toBe('Line 7')
  })
})

describe('scroll anchoring', () => {
  const full = fd([h('@@ -1,6 +1,7 @@', [' a', '-b', '+B', '+B2', ' c', ' d', '-e', ' f', '+g'])])
  const fm = buildDiffModel(full, { hunkHeaders: false })
  const hm = buildDiffModel(diff, { hunkHeaders: true })

  it('reports the line numbers a row shows', () => {
    expect(rowLines(fm, fm.unified[0])).toEqual({ old: 1, new: 1 })
    expect(rowLines(fm, fm.unified[1])).toEqual({ old: 2, new: null })
    expect(rowLines(fm, fm.split[1])).toEqual({ old: 2, new: 2 })
    expect(rowLines(fm, fm.split[2])).toEqual({ old: null, new: 3 })
    expect(rowLines(hm, hm.unified[0])).toBeNull()
    expect(rowLines(hm, undefined)).toBeNull()
  })

  it('finds the row at or after an anchor line in another layout', () => {
    // "c" is new line 4: unified row 4, split row 3.
    expect(anchorRow(fm, fm.unified, { old: 3, new: 4 })).toBe(4)
    expect(anchorRow(fm, fm.split, { old: 3, new: 4 })).toBe(3)
    // Old-side only anchor (a deleted line).
    expect(anchorRow(fm, fm.split, { old: 5, new: null })).toBe(5)
    // Past the end: the last row with a number.
    expect(anchorRow(fm, fm.unified, { old: null, new: 99 })).toBe(8)
    expect(anchorRow(fm, fm.unified, { old: null, new: null })).toBe(-1)
    // From the full file to the hunks view: the next shown line.
    expect(anchorRow(hm, hm.unified, { old: 10, new: 11 })).toBe(9)
  })
})

describe('blockBarLift (full-file block buttons in the gutter lane)', () => {
  // Whole file as one hunk: 1-row block at the top, 2-row block in the middle, 1-row block at the very end.
  const full = fd([h('@@ -1,6 +1,6 @@', ['-a', '+A', ' b', '-c', '-d', ' e', '+f'])])
  const m = buildDiffModel(full, { hunkHeaders: false })
  const [first, middle, last] = m.blocks

  it('keeps a stack that fits in its block (or spills into the context row below) in place', () => {
    expect(blockBarLift(middle, false, m.unified.length, 2)).toBe(0)
    expect(blockBarLift(first, false, m.unified.length, 2)).toBe(0)
    expect(blockBarLift(last, false, m.unified.length, 1)).toBe(0)
  })

  it('lifts a stack that would hang past the last row', () => {
    expect(last.unifiedRow).toBe(m.unified.length - 1)
    expect(blockBarLift(last, false, m.unified.length, 2)).toBe(1)
    expect(blockBarLift(last, true, m.split.length, 2)).toBe(1)
  })

  it('counts split rows (paired del/add) rather than lines', () => {
    // "-a +A" is two lines but a single split row.
    expect(blockBarLift(first, true, m.split.length, 2)).toBe(0)
    const tiny = buildDiffModel(fd([h('@@ -1,1 +1,1 @@', ['-a', '+A'])]), { hunkHeaders: false })
    expect(blockBarLift(tiny.blocks[0], false, tiny.unified.length, 2)).toBe(0)
    // Nowhere to go: a one-row file keeps the stack at the top.
    expect(blockBarLift(tiny.blocks[0], true, tiny.split.length, 2)).toBe(0)
  })
})
