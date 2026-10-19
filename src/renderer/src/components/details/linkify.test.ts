import { describe, expect, it } from 'vitest'
import { linkify } from './linkify'

describe('linkify', () => {
  it('returns plain text untouched', () => {
    expect(linkify('no links here')).toEqual([{ kind: 'text', text: 'no links here' }])
    expect(linkify('')).toEqual([])
  })

  it('extracts http(s) URLs', () => {
    expect(linkify('See https://example.com/a?b=1#c for details')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'url', text: 'https://example.com/a?b=1#c', href: 'https://example.com/a?b=1#c' },
      { kind: 'text', text: ' for details' }
    ])
  })

  it('drops trailing punctuation and unbalanced parentheses', () => {
    expect(linkify('Fixes (https://github.com/o/r/issues/1).')).toEqual([
      { kind: 'text', text: 'Fixes (' },
      { kind: 'url', text: 'https://github.com/o/r/issues/1', href: 'https://github.com/o/r/issues/1' },
      { kind: 'text', text: ').' }
    ])
  })

  it('keeps balanced parentheses inside URLs', () => {
    const segs = linkify('https://en.wikipedia.org/wiki/Foo_(bar) ok')
    expect(segs[0]).toEqual({ kind: 'url', text: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' })
  })

  it('prefixes www. links with https', () => {
    expect(linkify('www.example.org')).toEqual([{ kind: 'url', text: 'www.example.org', href: 'https://www.example.org' }])
  })

  it('handles several URLs across lines', () => {
    const segs = linkify('a http://x.io\nb https://y.io/z,')
    expect(segs.filter((s) => s.kind === 'url').map((s) => s.text)).toEqual(['http://x.io', 'https://y.io/z'])
    expect(segs.map((s) => s.text).join('')).toBe('a http://x.io\nb https://y.io/z,')
  })
})
