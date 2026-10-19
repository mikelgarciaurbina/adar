import { describe, expect, it } from 'vitest'
import { applyClick, EMPTY_SELECTION, pruneSelection, selectAll, targetsOf } from './selection'

const order = ['a', 'b', 'c', 'd', 'e']

describe('applyClick', () => {
  it('plain click selects one path and sets the anchor', () => {
    expect(applyClick(order, { paths: ['a', 'b'], anchor: 'a' }, 'c')).toEqual({ paths: ['c'], anchor: 'c' })
  })

  it('toggle adds and removes paths', () => {
    let sel = applyClick(order, EMPTY_SELECTION, 'b')
    sel = applyClick(order, sel, 'd', { toggle: true })
    expect(sel).toEqual({ paths: ['b', 'd'], anchor: 'd' })
    sel = applyClick(order, sel, 'b', { toggle: true })
    expect(sel).toEqual({ paths: ['d'], anchor: 'b' })
    sel = applyClick(order, sel, 'd', { toggle: true })
    expect(sel).toEqual({ paths: [], anchor: null })
  })

  it('range selects from the anchor in display order, both directions', () => {
    const sel = applyClick(order, EMPTY_SELECTION, 'b')
    expect(applyClick(order, sel, 'd', { range: true })).toEqual({ paths: ['b', 'c', 'd'], anchor: 'b' })
    expect(applyClick(order, sel, 'a', { range: true })).toEqual({ paths: ['a', 'b'], anchor: 'b' })
  })

  it('range without an anchor behaves like a plain click', () => {
    expect(applyClick(order, EMPTY_SELECTION, 'c', { range: true })).toEqual({ paths: ['c'], anchor: 'c' })
  })

  it('toggle+range adds the range to the existing selection', () => {
    const sel = { paths: ['a', 'e'], anchor: 'b' }
    expect(applyClick(order, sel, 'c', { range: true, toggle: true })).toEqual({ paths: ['a', 'e', 'b', 'c'], anchor: 'b' })
  })

  it('falls back to a plain click when the anchor vanished', () => {
    expect(applyClick(order, { paths: ['zz'], anchor: 'zz' }, 'c', { range: true })).toEqual({ paths: ['c'], anchor: 'c' })
  })
})

describe('pruneSelection', () => {
  it('drops paths that no longer exist and keeps identity when unchanged', () => {
    const sel = { paths: ['a', 'c'], anchor: 'c' }
    expect(pruneSelection(sel, new Set(order))).toBe(sel)
    expect(pruneSelection(sel, new Set(['a', 'b']))).toEqual({ paths: ['a'], anchor: 'a' })
    expect(pruneSelection(sel, new Set())).toEqual({ paths: [], anchor: null })
  })
})

describe('targetsOf', () => {
  it('uses the whole selection when the path is part of it, in display order', () => {
    const sel = { paths: ['d', 'b'], anchor: 'b' }
    expect(targetsOf(sel, 'b', order)).toEqual(['b', 'd'])
    expect(targetsOf(sel, 'b')).toEqual(['d', 'b'])
  })
  it('uses just the path otherwise', () => {
    expect(targetsOf({ paths: ['d', 'b'], anchor: 'b' }, 'a', order)).toEqual(['a'])
  })
})

describe('selectAll', () => {
  it('selects every path', () => {
    expect(selectAll(order)).toEqual({ paths: order, anchor: 'a' })
    expect(selectAll([])).toEqual({ paths: [], anchor: null })
  })
})
