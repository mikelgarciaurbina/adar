import { describe, expect, it } from 'vitest'
import type { DiffHunk, FileDiff } from '@shared/types'
import { countSelected, discardPrompt, historyLabel } from './staging'

const hunk: DiffHunk = {
  header: '@@ -1,3 +1,3 @@',
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 3,
  lines: [
    { type: 'context', content: 'a', oldLine: 1, newLine: 1 },
    { type: 'del', content: 'b', oldLine: 2, newLine: null },
    { type: 'add', content: 'B', oldLine: null, newLine: 2 },
    { type: 'context', content: 'c', oldLine: 3, newLine: 3 }
  ]
}
const diff: FileDiff = { path: 'src/a.ts', status: 'modified', binary: false, isImage: false, hunks: [hunk], additions: 1, deletions: 1 }

describe('partial staging helpers', () => {
  it('counts the change lines a selection covers', () => {
    expect(countSelected(diff, [{ hunkIndex: 0 }])).toBe(2)
    expect(countSelected(diff, [{ hunkIndex: 0, lineIndexes: [0, 2] }])).toBe(1)
    expect(countSelected(diff, [{ hunkIndex: 5 }])).toBe(0)
  })

  it('words discard confirmations per unit', () => {
    expect(discardPrompt('hunk', 2, 'a.ts')).toMatchObject({ title: 'Discard this hunk?', confirmLabel: 'Discard Hunk' })
    expect(discardPrompt('block', 3, 'a.ts')).toMatchObject({ title: 'Discard these 3 changed lines?', confirmLabel: 'Discard Changes' })
    expect(discardPrompt('block', 1, 'a.ts').title).toBe('Discard this changed line?')
    expect(discardPrompt('lines', 1, 'a.ts')).toMatchObject({ title: 'Discard 1 selected line?', confirmLabel: 'Discard Lines' })
    expect(discardPrompt('lines', 1, 'src/a.ts').message).toContain('src/a.ts')
  })

  it('labels undo history entries with the file name', () => {
    expect(historyLabel('stage', 'hunk', 4, 'src/a.ts')).toBe('Stage hunk in a.ts')
    expect(historyLabel('unstage', 'block', 4, 'src/a.ts')).toBe('Unstage change in a.ts')
    expect(historyLabel('discard', 'lines', 1, 'a.ts')).toBe('Discard line in a.ts')
    expect(historyLabel('stage', 'lines', 3, 'dir/b.ts')).toBe('Stage 3 lines in b.ts')
  })
})
