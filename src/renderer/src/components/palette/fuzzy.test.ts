import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyMatch, highlightSegments } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches everything with an empty query', () => {
    expect(fuzzyMatch('', 'Push')).toEqual({ score: 0, indexes: [] })
    expect(fuzzyMatch('   ', 'Push')).toEqual({ score: 0, indexes: [] })
  })

  it('requires an in-order subsequence', () => {
    expect(fuzzyMatch('psh', 'Push')).not.toBeNull()
    expect(fuzzyMatch('hsp', 'Push')).toBeNull()
    expect(fuzzyMatch('pushx', 'Push')).toBeNull()
    expect(fuzzyMatch('x', '')).toBeNull()
  })

  it('is case-insensitive and ignores whitespace in the query', () => {
    expect(fuzzyMatch('PUSH', 'push')?.indexes).toEqual([0, 1, 2, 3])
    expect(fuzzyMatch('co ma', 'Checkout main')).not.toBeNull()
  })

  it('returns matched indexes for highlighting', () => {
    expect(fuzzyMatch('pull', 'Pull (rebase)')?.indexes).toEqual([0, 1, 2, 3])
    expect(fuzzyMatch('reb', 'Pull (rebase)')?.indexes).toEqual([6, 7, 8])
  })

  it('prefers word starts over mid-word matches', () => {
    // "fa" should align with "Fetch All", not the "a" inside "Fetch".
    const m = fuzzyMatch('fa', 'Fetch All')!
    expect(m.indexes).toEqual([0, 6])
    expect(fuzzyMatch('sb', 'feature/sub-branch')!.indexes).toEqual([8, 12])
  })

  it('prefers camelCase humps', () => {
    expect(fuzzyMatch('gc', 'openGitConsole')!.indexes).toEqual([4, 7])
  })

  it('prefers contiguous runs', () => {
    const contiguous = fuzzyMatch('stash', 'Stash Changes')!
    const scattered = fuzzyMatch('stash', 'Set upstream branch: Ash')!
    expect(contiguous.score).toBeGreaterThan(scattered.score)
    expect(fuzzyMatch('main', 'remain main')!.indexes).toEqual([7, 8, 9, 10])
  })

  it('ranks prefix and exact matches highest', () => {
    const exact = fuzzyMatch('push', 'Push')!
    const prefix = fuzzyMatch('push', 'Push to origin')!
    const inner = fuzzyMatch('push', 'Force Push (with lease)')!
    expect(exact.score).toBeGreaterThan(prefix.score)
    expect(prefix.score).toBeGreaterThan(inner.score)
  })

  it('handles long texts with the greedy fallback', () => {
    const long = 'a'.repeat(600) + 'needle'
    const m = fuzzyMatch('needle', long)!
    expect(m.indexes).toEqual([600, 601, 602, 603, 604, 605])
  })

  it('produces strictly increasing indexes', () => {
    const m = fuzzyMatch('srcmain', 'src/renderer/src/main.tsx')!
    for (let i = 1; i < m.indexes.length; i++) expect(m.indexes[i]).toBeGreaterThan(m.indexes[i - 1])
    expect(m.indexes.length).toBe(7)
  })
})

describe('fuzzyFilter', () => {
  const items = ['Fetch All', 'Pull', 'Push', 'Pull (rebase)', 'Stash Changes', 'Pop Stash']

  it('returns items in original order for an empty query (respecting limit)', () => {
    expect(fuzzyFilter(items, '', (s) => s).map((r) => r.item)).toEqual(items)
    expect(fuzzyFilter(items, '', (s) => s, 2).map((r) => r.item)).toEqual(['Fetch All', 'Pull'])
  })

  it('sorts by score and drops non-matches', () => {
    const res = fuzzyFilter(items, 'pu', (s) => s).map((r) => r.item)
    expect(res.slice(0, 3)).toEqual(['Pull', 'Push', 'Pull (rebase)'])
    expect(res).not.toContain('Fetch All')
  })

  it('keeps original order on ties', () => {
    const res = fuzzyFilter(['b-one', 'a-one'], 'one', (s) => s).map((r) => r.item)
    expect(res).toEqual(['b-one', 'a-one'])
  })

  it('applies the limit after sorting', () => {
    const res = fuzzyFilter(['xx stash', 'Stash'], 'stash', (s) => s, 1)
    expect(res.map((r) => r.item)).toEqual(['Stash'])
  })
})

describe('highlightSegments', () => {
  it('splits text into matched and unmatched runs', () => {
    expect(highlightSegments('Pull (rebase)', [0, 1, 6])).toEqual([
      { text: 'Pu', match: true },
      { text: 'll (', match: false },
      { text: 'r', match: true },
      { text: 'ebase)', match: false }
    ])
  })

  it('handles no matches and empty text', () => {
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', match: false }])
    expect(highlightSegments('', [])).toEqual([])
  })

  it('handles a match at the end', () => {
    expect(highlightSegments('abc', [2])).toEqual([
      { text: 'ab', match: false },
      { text: 'c', match: true }
    ])
  })
})
