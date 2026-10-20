import { describe, expect, it } from 'vitest'
import { summarizeList } from './format'

describe('summarizeList', () => {
  it('joins short lists and counts the rest of long ones', () => {
    expect(summarizeList([])).toBe('')
    expect(summarizeList(['a'])).toBe('a')
    expect(summarizeList(['a', 'b'])).toBe('a and b')
    expect(summarizeList(['a', 'b', 'c'])).toBe('a, b and c')
    expect(summarizeList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more')
    expect(summarizeList(['a', 'b', 'c'], 2)).toBe('a, b and 1 more')
  })
})
