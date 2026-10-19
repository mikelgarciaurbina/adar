import { describe, expect, it } from 'vitest'
import { autoGraphWidth, colorOf, edgePath, graphContentWidth, LANE_W, laneX, rowPaths } from './geometry'
import { fitColumns, sanitizeWidths, setWidth, DEFAULT_WIDTHS } from './columns'

describe('geometry', () => {
  it('places lanes on integer x coordinates', () => {
    for (let l = 0; l < 20; l++) expect(Number.isInteger(laneX(l))).toBe(true)
    expect(laneX(1) - laneX(0)).toBe(LANE_W)
  })

  it('computes widths', () => {
    expect(graphContentWidth(3)).toBeGreaterThan(3 * LANE_W)
    expect(autoGraphWidth(0)).toBe(64)
    expect(autoGraphWidth(500)).toBe(360)
    // Limited by the space left for the graph, but keeps ~7 lanes and HEAD's lane visible.
    expect(autoGraphWidth(17, 200)).toBe(200)
    expect(autoGraphWidth(3, 1000)).toBe(graphContentWidth(3))
    expect(autoGraphWidth(3, 10)).toBe(graphContentWidth(3))
    expect(autoGraphWidth(17, 10)).toBe(140)
    expect(autoGraphWidth(17, 10, 12)).toBe(graphContentWidth(12))
    expect(autoGraphWidth(40, 10, 30)).toBe(360)
  })

  it('builds straight and curved paths', () => {
    const x0 = laneX(0)
    const x1 = laneX(1)
    expect(edgePath({ type: 'pass', from: 1, to: 1, color: 1 }, 28)).toBe(`M${x1} 0V28`)
    expect(edgePath({ type: 'in', from: 0, to: 0, color: 0 }, 28)).toBe(`M${x0} 0V14`)
    expect(edgePath({ type: 'out', from: 0, to: 0, color: 0 }, 28)).toBe(`M${x0} 14V28`)
    // Converging from the right: ends horizontally at the node centre.
    const inPath = edgePath({ type: 'in', from: 1, to: 0, color: 1 }, 28)
    expect(inPath.startsWith(`M${x1} 0`)).toBe(true)
    expect(inPath.endsWith(`H${x0}`)).toBe(true)
    // Branching out to the right: leaves the node horizontally, ends at the bottom of lane 1.
    const outPath = edgePath({ type: 'out', from: 0, to: 1, color: 1 }, 28)
    expect(outPath.startsWith(`M${x0} 14H`)).toBe(true)
    expect(outPath.endsWith('V28')).toBe(true)
  })

  it('groups edges by colour and dash, straight lines first', () => {
    const groups = rowPaths(
      [
        { type: 'out', from: 0, to: 1, color: 1 },
        { type: 'pass', from: 1, to: 1, color: 1 },
        { type: 'pass', from: 2, to: 2, color: 2 },
        { type: 'in', from: 3, to: 0, color: 3, dashed: true }
      ],
      28
    )
    expect(groups.map((g) => [g.color, g.dashed])).toEqual([
      [1, false],
      [2, false],
      [1, false],
      [3, true]
    ])
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length)
  })

  it('renders neutral colours with a theme variable', () => {
    expect(colorOf(-1)).toMatch(/^var\(--/)
    expect(colorOf(0)).toMatch(/^#/)
  })
})

describe('column widths', () => {
  it('sanitizes persisted data', () => {
    expect(sanitizeWidths(null)).toEqual(DEFAULT_WIDTHS)
    expect(sanitizeWidths('junk')).toEqual(DEFAULT_WIDTHS)
    const w = sanitizeWidths({ refs: 9999, graph: 120, author: 'x', date: NaN, sha: 10 })
    expect(w.refs).toBe(520)
    expect(w.graph).toBe(120)
    expect(w.author).toBe(DEFAULT_WIDTHS.author)
    expect(w.date).toBe(DEFAULT_WIDTHS.date)
    expect(w.sha).toBe(52)
    expect(sanitizeWidths({ graph: null }).graph).toBeNull()
  })

  it('sets and resets widths', () => {
    expect(setWidth(DEFAULT_WIDTHS, 'refs', 200.4).refs).toBe(200)
    expect(setWidth({ ...DEFAULT_WIDTHS, graph: 100 }, 'graph', null).graph).toBeNull()
    expect(setWidth({ ...DEFAULT_WIDTHS, author: 300 }, 'author', null).author).toBe(DEFAULT_WIDTHS.author)
  })

  it('drops optional columns (SHA, then date, then author) when they do not fit', () => {
    const all = { author: true, date: true, sha: true }
    const w = DEFAULT_WIDTHS
    expect(fitColumns(all, w, 10_000)).toEqual(all)
    expect(fitColumns(all, w, w.author + w.date)).toEqual({ author: true, date: true, sha: false })
    expect(fitColumns(all, w, w.author)).toEqual({ author: true, date: false, sha: false })
    expect(fitColumns(all, w, 0)).toEqual({ author: false, date: false, sha: false })
    // Disabled columns stay disabled and free room for the others.
    expect(fitColumns({ author: true, date: false, sha: true }, w, w.author + w.sha)).toEqual({ author: true, date: false, sha: true })
  })
})
