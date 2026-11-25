// Holding a letter in a terminal: the accents the Mac offers for it, and what each key does while they are offered.

import { describe, expect, it } from 'vitest'
import { ACCENTS, accentsOf, accentStep, type AccentMenu } from './accents'

const key = (k: string, over: Partial<Record<'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing', boolean>> & { type?: string } = {}) => ({
  type: 'keydown',
  key: k,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  ...over
})

describe('accents of a held letter', () => {
  it('offers the Mac’s accents, in its order', () => {
    // The ones Spanish needs, at the numbers the Mac gives them: n 1, a 2, e 2, i 3, o 4, u 4, ü 2.
    expect(accentsOf('n')[0]).toBe('ñ')
    expect(accentsOf('a')[1]).toBe('á')
    expect(accentsOf('e')[1]).toBe('é')
    expect(accentsOf('i')[2]).toBe('í')
    expect(accentsOf('o')[3]).toBe('ó')
    expect(accentsOf('u')[3]).toBe('ú')
    expect(accentsOf('u')[1]).toBe('ü')
    expect(accentsOf('N')).toEqual(['Ñ', 'Ń'])
    expect(accentsOf('x')).toEqual([])
    expect(accentsOf('constructor')).toEqual([])
    // Each is one character, none twice; an uppercase letter offers the uppercase of its lowercase one's (ß has none).
    for (const [k, list] of Object.entries(ACCENTS)) {
      const chars = [...list]
      expect(chars.every((ch) => ch.length === 1 && ch.normalize('NFC') === ch)).toBe(true)
      expect(new Set(chars).size).toBe(chars.length)
      if (k === k.toLowerCase() && k !== 's') expect([...ACCENTS[k.toUpperCase()]]).toEqual(chars.map((ch) => ch.toUpperCase()))
    }
  })

  it('offers them on the repeat of a held letter, and only then', () => {
    expect(accentStep(null, 't1', key('n', { repeat: true }), true)).toEqual({ kind: 'open', menu: { id: 't1', base: 'n', options: ['ñ', 'ń'], at: -1 } })
    // The first press types the letter; with the setting off, or a key without accents, a held key repeats.
    expect(accentStep(null, 't1', key('n'), true)).toEqual({ kind: 'pass' })
    expect(accentStep(null, 't1', key('n', { repeat: true }), false)).toEqual({ kind: 'pass' })
    expect(accentStep(null, 't1', key('j', { repeat: true }), true)).toEqual({ kind: 'pass' })
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'isComposing'] as const) {
      expect(accentStep(null, 't1', key('n', { repeat: true, [mod]: true }), true)).toEqual({ kind: 'pass' })
    }
    expect(accentStep(null, 't1', key('n', { type: 'keyup' }), true)).toEqual({ kind: 'pass' })
  })

  it('chooses by number, or by the arrows and Enter; Esc or any other key leave the letter', () => {
    const menu: AccentMenu = { id: 't1', base: 'a', options: [...ACCENTS.a], at: -1 }
    // The held key goes on repeating: nothing more is typed.
    expect(accentStep(menu, 't1', key('a', { repeat: true }), true)).toEqual({ kind: 'swallow' })
    expect(accentStep(menu, 't1', key('2'), true)).toEqual({ kind: 'choose', text: 'á' })
    expect(accentStep(menu, 't1', key('9'), true)).toEqual({ kind: 'close', pass: true })
    expect(accentStep(menu, 't1', key('ArrowRight'), true)).toEqual({ kind: 'move', at: 0 })
    expect(accentStep(menu, 't1', key('ArrowLeft'), true)).toEqual({ kind: 'move', at: 7 })
    expect(accentStep({ ...menu, at: 7 }, 't1', key('ArrowRight'), true)).toEqual({ kind: 'move', at: 0 })
    expect(accentStep({ ...menu, at: 1 }, 't1', key('Enter'), true)).toEqual({ kind: 'choose', text: 'á' })
    // Enter with none reached is a new line; Esc only closes.
    expect(accentStep(menu, 't1', key('Enter'), true)).toEqual({ kind: 'close', pass: true })
    expect(accentStep(menu, 't1', key('Escape'), true)).toEqual({ kind: 'close', pass: false })
    expect(accentStep(menu, 't1', key('x'), true)).toEqual({ kind: 'close', pass: true })
    expect(accentStep(menu, 't1', key('Shift'), true)).toEqual({ kind: 'pass' })
    expect(accentStep(menu, 't1', key('1', { metaKey: true }), true)).toEqual({ kind: 'close', pass: true })
    // A key in another terminal: the offer goes.
    expect(accentStep(menu, 't2', key('2'), true)).toEqual({ kind: 'close', pass: true })
  })
})
