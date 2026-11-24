// The panes of a terminal tab: splitting, closing, resizing and moving between them.

import { describe, expect, it } from 'vitest'
import { equalize, moveBefore, movePane, neighbour, nudge, pane, panesOf, parseTree, removePane, setRatio, sideAt, splitPane, stepPane, type PaneTree } from './layout'

// a | b
//   | -
//   | c
const three = (): PaneTree => splitPane(splitPane(pane('a'), 'a', 'b', 'row'), 'b', 'c', 'column')

describe('pane tree', () => {
  it('splits a pane to the right or down, in reading order', () => {
    expect(three()).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: { kind: 'pane', id: 'a' },
      b: { kind: 'split', dir: 'column', ratio: 0.5, a: { kind: 'pane', id: 'b' }, b: { kind: 'pane', id: 'c' } }
    })
    expect(panesOf(three())).toEqual(['a', 'b', 'c'])
    // A pane that is not there splits nothing.
    expect(splitPane(pane('a'), 'x', 'b', 'row')).toEqual(pane('a'))
  })

  it('gives a closed pane’s room to its neighbour', () => {
    expect(removePane(three(), 'b')).toEqual({ kind: 'split', dir: 'row', ratio: 0.5, a: pane('a'), b: pane('c') })
    expect(removePane(three(), 'a')).toEqual({ kind: 'split', dir: 'column', ratio: 0.5, a: pane('b'), b: pane('c') })
    expect(removePane(pane('a'), 'a')).toBeNull()
    const t = three()
    expect(removePane(t, 'nope')).toBe(t)
  })

  it('moves between panes by direction and in order', () => {
    const t = three()
    expect(neighbour(t, 'a', 'right')).toBe('b')
    expect(neighbour(t, 'b', 'left')).toBe('a')
    expect(neighbour(t, 'c', 'left')).toBe('a')
    expect(neighbour(t, 'b', 'down')).toBe('c')
    expect(neighbour(t, 'c', 'up')).toBe('b')
    expect(neighbour(t, 'a', 'left')).toBeNull()
    expect(neighbour(t, 'a', 'down')).toBeNull()
    // Of two panes on that side, the one sharing more of the edge.
    expect(neighbour(setRatio(t, [1], 0.3), 'a', 'right')).toBe('c')
    expect(stepPane(t, 'c', 1)).toBe('a')
    expect(stepPane(t, 'a', -1)).toBe('c')
  })

  it('resizes: a divider by its path, the nearest one by direction, all at once', () => {
    const t = three()
    expect(setRatio(t, [], 0.7)).toMatchObject({ ratio: 0.7 })
    expect(setRatio(t, [1], 0.02)).toMatchObject({ b: { ratio: 0.1 } })
    // c's own split divides up and down; left and right move the outer divider.
    expect(nudge(t, 'c', 'up')).toMatchObject({ ratio: 0.5, b: { ratio: 0.45 } })
    expect(nudge(t, 'c', 'right')).toMatchObject({ ratio: 0.55, b: { ratio: 0.5 } })
    expect(nudge(t, 'a', 'down')).toBe(t)
    // Three panes in a row share it in thirds.
    const row = splitPane(splitPane(pane('a'), 'a', 'b', 'row'), 'b', 'c', 'row')
    expect(equalize(setRatio(row, [], 0.8))).toMatchObject({ ratio: 1 / 3, b: { ratio: 0.5 } })
    expect(equalize(setRatio(t, [], 0.8))).toMatchObject({ ratio: 0.5, b: { ratio: 0.5 } })
  })

  it('moves a pane to a side of another one', () => {
    // a | b, with a the narrow one: b to a's left changes their places, and each keeps its width.
    const two = setRatio(splitPane(pane('a'), 'a', 'b', 'row'), [], 0.3)
    expect(movePane(two, 'b', 'a', 'left')).toEqual({ kind: 'split', dir: 'row', ratio: 0.7, a: pane('b'), b: pane('a') })
    expect(movePane(two, 'a', 'b', 'right')).toEqual({ kind: 'split', dir: 'row', ratio: 0.7, a: pane('b'), b: pane('a') })
    // Onto the top or the bottom the split turns, in halves.
    expect(movePane(two, 'b', 'a', 'up')).toEqual({ kind: 'split', dir: 'column', ratio: 0.5, a: pane('b'), b: pane('a') })
    expect(movePane(two, 'b', 'a', 'down')).toEqual({ kind: 'split', dir: 'column', ratio: 0.5, a: pane('a'), b: pane('b') })
    // Where it already is, onto itself, or a pane that is not there: nothing moves.
    expect(movePane(two, 'b', 'a', 'right')).toBe(two)
    expect(movePane(two, 'a', 'b', 'left')).toBe(two)
    expect(movePane(two, 'a', 'a', 'left')).toBe(two)
    expect(movePane(two, 'x', 'a', 'left')).toBe(two)
    expect(movePane(two, 'a', 'x', 'left')).toBe(two)

    // a | b over c: the place a pane leaves goes to its neighbour, and it shares its target's.
    expect(panesOf(movePane(three(), 'c', 'a', 'left'))).toEqual(['c', 'a', 'b'])
    expect(movePane(three(), 'c', 'a', 'left')).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: { kind: 'split', dir: 'row', ratio: 0.5, a: pane('c'), b: pane('a') },
      b: pane('b')
    })
    expect(movePane(three(), 'a', 'c', 'down')).toEqual({
      kind: 'split',
      dir: 'column',
      ratio: 0.5,
      a: pane('b'),
      b: { kind: 'split', dir: 'column', ratio: 0.5, a: pane('c'), b: pane('a') }
    })
    // b and c change places within their column.
    expect(panesOf(movePane(three(), 'c', 'b', 'up'))).toEqual(['a', 'c', 'b'])
    // Every pane is still there, once.
    for (const side of ['left', 'right', 'up', 'down'] as const) expect(panesOf(movePane(three(), 'b', 'a', side)).sort()).toEqual(['a', 'b', 'c'])
  })

  it('finds the side of a pane a point is nearest to', () => {
    expect(sideAt(0.1, 0.5)).toBe('left')
    expect(sideAt(0.9, 0.5)).toBe('right')
    expect(sideAt(0.5, 0.1)).toBe('up')
    expect(sideAt(0.5, 0.95)).toBe('down')
    expect(sideAt(0.2, 0.1)).toBe('up')
    expect(sideAt(0.7, 0.6)).toBe('right')
  })

  it('moves a tab before another one, or to the end', () => {
    const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const ids = (list: readonly { id: string }[]) => list.map((t) => t.id).join('')
    expect(ids(moveBefore(tabs, 'c', 'a'))).toBe('cab')
    expect(ids(moveBefore(tabs, 'a', 'c'))).toBe('bac')
    expect(ids(moveBefore(tabs, 'a', null))).toBe('bca')
    expect(ids(moveBefore(tabs, 'b', 'a'))).toBe('bac')
    // Already there, or nothing to go by: the same list.
    expect(moveBefore(tabs, 'a', 'b')).toBe(tabs)
    expect(moveBefore(tabs, 'c', null)).toBe(tabs)
    expect(moveBefore(tabs, 'a', 'a')).toBe(tabs)
    expect(moveBefore(tabs, 'x', 'a')).toBe(tabs)
    expect(moveBefore(tabs, 'a', 'x')).toBe(tabs)
  })

  it('reads a stored tree, dropping the panes that are gone', () => {
    const stored = JSON.parse(JSON.stringify(three())) as unknown
    expect(parseTree(stored, new Set(['a', 'b', 'c']))).toEqual(three())
    expect(parseTree(stored, new Set(['a', 'c']))).toEqual({ kind: 'split', dir: 'row', ratio: 0.5, a: pane('a'), b: pane('c') })
    expect(parseTree(stored, new Set())).toBeNull()
    expect(parseTree({ kind: 'split', dir: 'diagonal', a: stored, b: stored }, new Set(['a']))).toBeNull()
    expect(parseTree('a', new Set(['a']))).toBeNull()
  })
})
