import { describe, expect, it } from 'vitest'
import type { DiffTarget, FileChange, WorkingStatus } from '@shared/types'
import { nextChangedSibling, sameTarget, stillChanged, viewShowsTarget } from './targets'

const change = (path: string): FileChange => ({ path, status: 'modified' }) as FileChange

const status = (unstaged: string[], staged: string[] = []): WorkingStatus => ({
  unstaged: unstaged.map(change),
  staged: staged.map(change),
  conflicted: [],
  branch: 'main',
  upstream: null,
  ahead: 0,
  behind: 0
})

const u = (path: string): DiffTarget => ({ kind: 'unstaged', path })
const s = (path: string): DiffTarget => ({ kind: 'staged', path })

describe('sameTarget', () => {
  it('compares kind, path and the revision fields', () => {
    expect(sameTarget(u('a'), u('a'))).toBe(true)
    expect(sameTarget(u('a'), s('a'))).toBe(false)
    expect(sameTarget({ kind: 'commit', sha: 'abc', path: 'a' }, { kind: 'commit', sha: 'abd', path: 'a' })).toBe(false)
  })
})

describe('viewShowsTarget', () => {
  it('is true only while the centre view is a diff of that exact target', () => {
    expect(viewShowsTarget({ kind: 'diff', target: u('a.ts') }, u('a.ts'))).toBe(true)
    expect(viewShowsTarget({ kind: 'diff', target: { ...u('a.ts') } }, u('a.ts'))).toBe(true)
  })

  it('is false once the user moved on (staged copy, another file, the graph, nothing)', () => {
    // The right panel staged the open file and opened its staged copy.
    expect(viewShowsTarget({ kind: 'diff', target: s('a.ts') }, u('a.ts'))).toBe(false)
    expect(viewShowsTarget({ kind: 'diff', target: u('b.ts') }, u('a.ts'))).toBe(false)
    expect(viewShowsTarget({ kind: 'graph' }, u('a.ts'))).toBe(false)
    expect(viewShowsTarget({ kind: 'history', path: 'a.ts' } as { kind: string }, u('a.ts'))).toBe(false)
    expect(viewShowsTarget(undefined, u('a.ts'))).toBe(false)
  })
})

describe('stillChanged', () => {
  it('looks up staged / unstaged targets in the status', () => {
    const st = status(['a'], ['b'])
    expect(stillChanged(st, u('a'))).toBe(true)
    expect(stillChanged(st, u('b'))).toBe(false)
    expect(stillChanged(st, s('b'))).toBe(true)
    expect(stillChanged(st, s('a'))).toBe(false)
  })

  it('assumes changes when unknown or not a working-tree target', () => {
    expect(stillChanged(null, u('a'))).toBe(true)
    expect(stillChanged(status([]), { kind: 'commit', sha: 'abc', path: 'a' })).toBe(true)
  })
})

describe('nextChangedSibling', () => {
  const sibs = [u('a'), u('b'), u('c'), u('d')]

  it('prefers the next sibling that still has changes', () => {
    expect(nextChangedSibling(sibs, u('b'), status(['a', 'c', 'd']))).toEqual(u('c'))
    expect(nextChangedSibling(sibs, u('b'), status(['a', 'd']))).toEqual(u('d'))
  })

  it('falls back to the closest previous one', () => {
    expect(nextChangedSibling(sibs, u('d'), status(['a', 'b']))).toEqual(u('b'))
  })

  it('returns null when nothing is left (back to the graph)', () => {
    expect(nextChangedSibling(sibs, u('b'), status([]))).toBeNull()
    expect(nextChangedSibling(undefined, u('b'), status(['a']))).toBeNull()
    expect(nextChangedSibling([u('b')], u('b'), status(['b']))).toBeNull()
  })

  it('searches the whole list when the current file is not among the siblings', () => {
    expect(nextChangedSibling(sibs, u('z'), status(['c']))).toEqual(u('c'))
  })
})
