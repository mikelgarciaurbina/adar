import { describe, expect, it } from 'vitest'
import type { DiffTarget, FileChange } from '@shared/types'
import {
  activePathIn,
  blameRev,
  makeTarget,
  oldestFirst,
  orderPair,
  sameScope,
  sameTarget,
  statBlocks,
  sumStats,
  uniquePathCount,
  withRenameSources
} from './targets'

const commits = [{ sha: 'c3' }, { sha: 'c2' }, { sha: 'c1' }] // newest first

describe('sameScope / sameTarget', () => {
  it('compares kind and revision, and path for sameTarget', () => {
    const a: DiffTarget = { kind: 'commit', sha: 'x', path: 'a.ts' }
    expect(sameScope(a, { kind: 'commit', sha: 'x', path: 'b.ts' })).toBe(true)
    expect(sameScope(a, { kind: 'commit', sha: 'y', path: 'a.ts' })).toBe(false)
    expect(sameScope(a, { kind: 'staged', path: 'a.ts' })).toBe(false)
    expect(sameTarget(a, { kind: 'commit', sha: 'x', path: 'a.ts', oldPath: 'old.ts' })).toBe(true)
    expect(sameTarget(a, { kind: 'commit', sha: 'x', path: 'b.ts' })).toBe(false)
    expect(sameTarget(null, a)).toBe(false)
  })

  it('handles every target kind', () => {
    expect(sameScope({ kind: 'unstaged', path: 'a' }, { kind: 'unstaged', path: 'b' })).toBe(true)
    expect(sameScope({ kind: 'staged', path: 'a' }, { kind: 'unstaged', path: 'a' })).toBe(false)
    expect(sameScope({ kind: 'compare', from: 'a', to: 'b', path: 'p' }, { kind: 'compare', from: 'a', to: 'b', path: 'q' })).toBe(true)
    expect(sameScope({ kind: 'compare', from: 'a', to: 'b', path: 'p' }, { kind: 'compare', from: 'b', to: 'a', path: 'p' })).toBe(false)
    expect(sameScope({ kind: 'stash', index: 0, path: 'p' }, { kind: 'stash', index: 1, path: 'p' })).toBe(false)
  })

  it('activePathIn returns the open path only for the same list', () => {
    const sample: DiffTarget = { kind: 'stash', index: 2, path: '' }
    expect(activePathIn({ kind: 'stash', index: 2, path: 'x' }, sample)).toBe('x')
    expect(activePathIn({ kind: 'stash', index: 0, path: 'x' }, sample)).toBeNull()
    expect(activePathIn(undefined, sample)).toBeNull()
  })
})

describe('orderPair', () => {
  it('returns [older, newer] by graph position', () => {
    expect(orderPair(commits, 'c3', 'c1')).toEqual(['c1', 'c3'])
    expect(orderPair(commits, 'c1', 'c3')).toEqual(['c1', 'c3'])
    expect(orderPair(commits, 'c2', 'c3')).toEqual(['c2', 'c3'])
  })

  it('treats unknown commits as older and keeps order for ties', () => {
    expect(orderPair(commits, 'c3', 'zz')).toEqual(['zz', 'c3'])
    expect(orderPair(commits, 'x', 'y')).toEqual(['x', 'y'])
  })
})

describe('oldestFirst', () => {
  it('sorts by reverse graph order', () => {
    expect(oldestFirst(commits, ['c3', 'c1', 'c2'])).toEqual(['c1', 'c2', 'c3'])
  })
  it('puts unknown shas first (oldest)', () => {
    expect(oldestFirst(commits, ['c3', 'zz'])).toEqual(['zz', 'c3'])
  })
})

describe('statBlocks', () => {
  it('is all neutral without changes', () => {
    expect(statBlocks(0, 0)).toEqual({ add: 0, del: 0, neutral: 5 })
  })
  it('always totals the block count', () => {
    for (const [a, d] of [
      [1, 0],
      [0, 1],
      [5, 5],
      [100, 3],
      [3, 1000],
      [123456, 654321]
    ]) {
      const b = statBlocks(a, d)
      expect(b.add + b.del + b.neutral).toBe(5)
      if (a > 0) expect(b.add).toBeGreaterThan(0)
      if (d > 0 && a + d > 10) expect(b.del).toBeGreaterThan(0)
    }
  })
  it('fills more blocks for bigger changes', () => {
    expect(statBlocks(1, 0).neutral).toBeGreaterThan(statBlocks(1000, 0).neutral)
    expect(statBlocks(1000, 0)).toEqual({ add: 5, del: 0, neutral: 0 })
    expect(statBlocks(0, 1000)).toEqual({ add: 0, del: 5, neutral: 0 })
  })
})

describe('sumStats / uniquePathCount', () => {
  it('sums additions and deletions, treating missing values as 0', () => {
    const files: FileChange[] = [
      { path: 'a', status: 'modified', additions: 3, deletions: 1 },
      { path: 'b', status: 'added' },
      { path: 'c', status: 'deleted', deletions: 10 }
    ]
    expect(sumStats(files)).toEqual({ additions: 3, deletions: 11 })
  })
  it('counts each path once across lists', () => {
    expect(uniquePathCount([{ path: 'a' }, { path: 'b' }], [{ path: 'a' }], [])).toBe(2)
    expect(uniquePathCount()).toBe(0)
  })
})

describe('makeTarget / blameRev', () => {
  it('builds diff targets for each scope', () => {
    expect(makeTarget({ kind: 'commit', sha: 's' }, { path: 'a' })).toEqual({ kind: 'commit', sha: 's', path: 'a' })
    expect(makeTarget({ kind: 'commit', sha: 's' }, { path: 'b', oldPath: 'a' })).toEqual({ kind: 'commit', sha: 's', path: 'b', oldPath: 'a' })
    expect(makeTarget({ kind: 'compare', from: 'x', to: 'y' }, { path: 'a' })).toEqual({ kind: 'compare', from: 'x', to: 'y', path: 'a' })
    expect(makeTarget({ kind: 'stash', index: 1, sha: 's', baseSha: 'b' }, { path: 'a', oldPath: 'z' })).toEqual({ kind: 'stash', index: 1, path: 'a' })
  })

  it('blames deleted files on the side that still has them', () => {
    expect(blameRev({ kind: 'commit', sha: 's' }, { status: 'modified' })).toBe('s')
    expect(blameRev({ kind: 'commit', sha: 's' }, { status: 'deleted' })).toBe('s^')
    expect(blameRev({ kind: 'compare', from: 'x', to: 'y' }, { status: 'added' })).toBe('y')
    expect(blameRev({ kind: 'compare', from: 'x', to: 'y' }, { status: 'deleted' })).toBe('x')
    expect(blameRev({ kind: 'stash', index: 0, sha: 's', baseSha: 'b' }, { status: 'deleted' })).toBe('b')
    expect(blameRev({ kind: 'stash', index: 0, sha: 's', baseSha: 'b' }, { status: 'modified' })).toBe('s')
  })
})

describe('withRenameSources', () => {
  const files = [
    { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed' as const },
    { path: 'src/copy.ts', oldPath: 'src/orig.ts', status: 'copied' as const },
    { path: 'README.md', status: 'modified' as const }
  ]
  it('adds the original path of selected renames', () => {
    expect(withRenameSources(['src/new.ts', 'README.md'], files)).toEqual(['src/new.ts', 'README.md', 'src/old.ts'])
  })
  it('leaves copies and unrelated entries alone, without duplicates', () => {
    expect(withRenameSources(['src/copy.ts'], files)).toEqual(['src/copy.ts'])
    expect(withRenameSources(['src/new.ts', 'src/old.ts'], files)).toEqual(['src/new.ts', 'src/old.ts'])
    expect(withRenameSources(['README.md'], files)).toEqual(['README.md'])
  })
})
