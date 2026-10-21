import { describe, expect, it } from 'vitest'
import { autoGraphCap, autoGraphWidth, colorOf, edgePath, fitGraphWidth, graphContentWidth, hiddenLanes, LANE_W, lanesFitting, laneX, NODE_R, pinnedNodeX, rowPaths } from './geometry'
import { fitColumns, sanitizeWidths, setWidth, DEFAULT_WIDTHS } from './columns'

describe('geometry', () => {
  it('places lanes on integer x coordinates', () => {
    for (let l = 0; l < 20; l++) expect(Number.isInteger(laneX(l))).toBe(true)
    expect(laneX(1) - laneX(0)).toBe(LANE_W)
  })

  it('computes widths', () => {
    expect(graphContentWidth(3)).toBeGreaterThan(3 * LANE_W)
    expect(autoGraphWidth(0)).toBe(64)
    // Unmeasured panel: fixed fallback cap.
    expect(autoGraphWidth(500)).toBe(360)
    // Fits the lanes up to the cap.
    expect(autoGraphWidth(17, { cap: 500 })).toBe(graphContentWidth(17))
    expect(autoGraphWidth(17, { cap: 200 })).toBe(200)
    // Limited by the space left for the graph, but keeps ~7 lanes and the must-show lanes.
    expect(autoGraphWidth(17, { cap: 500, available: 200 })).toBe(200)
    expect(autoGraphWidth(3, { available: 1000 })).toBe(graphContentWidth(3))
    expect(autoGraphWidth(3, { available: 10 })).toBe(graphContentWidth(3))
    expect(autoGraphWidth(17, { cap: 500, available: 10 })).toBe(140)
    expect(autoGraphWidth(17, { cap: 500, available: 10, mustShow: 12 })).toBe(graphContentWidth(12))
    // Must-show lanes never push past the cap (the selected node is pinned instead).
    expect(autoGraphWidth(40, { cap: 360, available: 10, mustShow: 30 })).toBe(360)
  })

  it('caps the auto width at 45% of the panel, never below ~7 lanes', () => {
    expect(autoGraphCap(Infinity)).toBe(360)
    expect(autoGraphCap(0)).toBe(360)
    expect(autoGraphCap(1000)).toBe(450)
    expect(autoGraphCap(200)).toBe(140)
    // 17 lanes fit in a 900px panel (the 20k synthetic repo case).
    expect(autoGraphWidth(17, { cap: autoGraphCap(900) })).toBe(graphContentWidth(17))
    // Never more than the room left after the reserved columns (no flex squeeze)…
    expect(autoGraphCap(448, 170 + 120)).toBe(158)
    expect(autoGraphCap(1000, 170 + 120)).toBe(450)
    // …and never below the minimum auto width.
    expect(autoGraphCap(300, 520 + 120)).toBe(64)
    // Must-show lanes stay within that bound too (the node is pinned instead).
    expect(autoGraphWidth(17, { cap: autoGraphCap(448, 290), available: 0, mustShow: 13 })).toBe(158)
  })

  it('counts the lanes a column can show', () => {
    for (let n = 1; n < 40; n++) {
      expect(lanesFitting(graphContentWidth(n))).toBe(n)
      expect(lanesFitting(graphContentWidth(n) - LANE_W)).toBe(n - 1)
    }
    expect(lanesFitting(0)).toBe(0)
    expect(lanesFitting(laneX(0) + NODE_R)).toBe(1)
    expect(lanesFitting(laneX(0) + NODE_R - 1)).toBe(0)
    expect(hiddenLanes(17, graphContentWidth(17))).toBe(0)
    expect(hiddenLanes(17, graphContentWidth(11))).toBe(6)
    expect(hiddenLanes(3, 1000)).toBe(0)
  })

  it('fits the lanes in view on request without ever shrinking the column', () => {
    // Plenty of room: exactly the lanes.
    expect(fitGraphWidth(17, 140, 1200, 170)).toBe(graphContentWidth(17))
    // Cramped: bounded by the room (messages keep their CSS minimum)…
    expect(fitGraphWidth(17, 100, 448, 170)).toBe(448 - 170 - 120)
    // …but never narrower than the column already is.
    expect(fitGraphWidth(17, 200, 448, 170)).toBe(200)
    expect(fitGraphWidth(3, 200, 1200, 170)).toBe(200)
    // Unmeasured panel: just the lanes.
    expect(fitGraphWidth(5, 40, Infinity, 170)).toBe(graphContentWidth(5))
  })

  it('pins a clipped node to the column edge', () => {
    expect(pinnedNodeX(2, 0)).toBeNull()
    expect(pinnedNodeX(2, graphContentWidth(3))).toBeNull()
    const w = graphContentWidth(5)
    const x = pinnedNodeX(10, w)!
    expect(x + NODE_R).toBeLessThanOrEqual(w)
    expect(x).toBeGreaterThan(laneX(3))
    // A very narrow column still keeps the whole node inside.
    expect(pinnedNodeX(10, 12)).toBe(NODE_R)
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

  it('renders lanes and neutral colours with theme variables', () => {
    expect(colorOf(-1)).toMatch(/^var\(--/)
    expect(colorOf(0)).toBe('var(--lane-1)')
    expect(colorOf(5)).toBe('var(--lane-6)')
    expect(colorOf(6)).toBe('var(--lane-1)')
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
