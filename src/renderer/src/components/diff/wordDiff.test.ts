import { describe, expect, it } from 'vitest'
import { tokenize, wordDiff, type Range } from './wordDiff'

const pick = (s: string, ranges: Range[]) => ranges.map(([a, b]) => s.slice(a, b))

describe('wordDiff', () => {
  it('tokenizes words, blanks and punctuation', () => {
    expect(tokenize('foo(bar, 42)  ü_x')).toEqual(['foo', '(', 'bar', ',', ' ', '42', ')', '  ', 'ü_x'])
  })

  it('highlights only the changed words', () => {
    const a = 'const value = computeTotal(items, tax)'
    const b = 'const value = computeSum(items, taxRate)'
    const d = wordDiff(a, b)!
    expect(pick(a, d.a)).toEqual(['computeTotal', 'tax'])
    expect(pick(b, d.b)).toEqual(['computeSum', 'taxRate'])
  })

  it('handles pure insertions and deletions', () => {
    const d = wordDiff('foo(a)', 'foo(a, b)')!
    expect(d.a).toEqual([])
    expect(pick('foo(a, b)', d.b)).toEqual([', b'])
  })

  it('merges changed words separated only by blanks', () => {
    const a = 'const total = one two three;'
    const b = 'const total = uno dos tres;'
    const d = wordDiff(a, b)!
    expect(pick(a, d.a)).toEqual(['one two three'])
    expect(pick(b, d.b)).toEqual(['uno dos tres'])
  })

  it('returns empty ranges for identical lines', () => {
    expect(wordDiff('same', 'same')).toEqual({ a: [], b: [] })
  })

  it('gives up on unrelated lines and on very long lines', () => {
    expect(wordDiff('import React from "react"', '}')).toBeNull()
    expect(wordDiff('x'.repeat(5000), 'y' + 'x'.repeat(4999))).toBeNull()
  })

  it('stays correct when the LCS table would be too large (middle marked as changed)', () => {
    const a = 'start ' + Array.from({ length: 400 }, (_, i) => `a${i}`).join(' ') + ' end'
    const b = 'start ' + Array.from({ length: 400 }, (_, i) => `b${i}`).join(' ') + ' end'
    const d = wordDiff(a, b)
    // Unrelated middles → below the similarity threshold.
    expect(d).toBeNull()
    const c = 'prefix ' + 'same '.repeat(300) + 'X'
    const e = 'prefix ' + 'same '.repeat(300) + 'Y'
    const d2 = wordDiff(c, e)!
    expect(pick(c, d2.a)).toEqual(['X'])
    expect(pick(e, d2.b)).toEqual(['Y'])
  })
})
