import { describe, expect, it } from 'vitest'
import { computeGraph, type Edge, type GraphLayout, type LayoutCommit } from './layout'

const c = (sha: string, ...parents: string[]): LayoutCommit => ({ sha, parents })

/** Compact edge notation for assertions: "p0" pass lane 0, "i1>0" in from 1 to node 0, "o0>2" out from 0 to 2. */
function fmt(e: Edge): string {
  if (e.type === 'pass') return `p${e.from}`
  return `${e.type === 'in' ? 'i' : 'o'}${e.from}>${e.to}`
}
function edges(layout: GraphLayout, row: number): string[] {
  return layout.rows[row].edges.map(fmt).sort()
}
function lanesOf(layout: GraphLayout): number[] {
  return layout.rows.map((r) => r.lane)
}

/** Lanes leaving the bottom of a row must be exactly the lanes entering the top of the next row. */
function assertContinuity(layout: GraphLayout): void {
  for (let i = 0; i + 1 < layout.rows.length; i++) {
    const bottom = new Set<number>()
    for (const e of layout.rows[i].edges) if (e.type === 'pass' || e.type === 'out') bottom.add(e.to)
    const top = new Set<number>()
    for (const e of layout.rows[i + 1].edges) if (e.type === 'pass' || e.type === 'in') top.add(e.from)
    expect([...top].sort(), `row ${i}→${i + 1}`).toEqual([...bottom].sort())
  }
  for (const r of layout.rows) {
    for (const e of r.edges) {
      expect(e.from).toBeLessThan(layout.maxLanes)
      expect(e.to).toBeLessThan(layout.maxLanes)
      if (e.type === 'in') expect(e.to).toBe(r.lane)
      if (e.type === 'out') expect(e.from).toBe(r.lane)
    }
  }
}

/** Synthetic history: main line + concurrent feature branches merged back. Returns newest first. */
function synthHistory(n: number, seed = 42, maxFeatures = 8): LayoutCommit[] {
  let s = seed
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const created: LayoutCommit[] = []
  let id = 0
  const mk = (parents: string[]) => {
    const sha = `c${id++}`
    created.push({ sha, parents })
    return sha
  }
  let main = mk([])
  const features: string[] = []
  while (created.length < n) {
    const r = rnd()
    if (r < 0.3 || features.length === 0) {
      if (features.length < maxFeatures && rnd() < 0.5) features.push(mk([main]))
      else main = mk([main])
    } else if (r < 0.8) {
      const k = Math.floor(rnd() * features.length)
      features[k] = mk([features[k]])
    } else {
      const k = Math.floor(rnd() * features.length)
      main = mk([main, features[k]])
      features.splice(k, 1)
    }
  }
  return created.reverse()
}

describe('computeGraph', () => {
  it('handles an empty list', () => {
    expect(computeGraph([])).toEqual({ rows: [], maxLanes: 0 })
  })

  it('lays out a linear history in one lane', () => {
    const g = computeGraph([c('C', 'B'), c('B', 'A'), c('A')])
    expect(lanesOf(g)).toEqual([0, 0, 0])
    expect(g.maxLanes).toBe(1)
    expect(edges(g, 0)).toEqual(['o0>0'])
    expect(edges(g, 1)).toEqual(['i0>0', 'o0>0'])
    expect(edges(g, 2)).toEqual(['i0>0'])
    assertContinuity(g)
  })

  it('draws a branch and its merge', () => {
    // M merges feature F into main B; both fork from A.
    const g = computeGraph([c('M', 'B', 'F'), c('F', 'A'), c('B', 'A'), c('A')])
    expect(lanesOf(g)).toEqual([0, 1, 0, 0])
    expect(g.maxLanes).toBe(2)
    expect(edges(g, 0)).toEqual(['o0>0', 'o0>1'])
    expect(edges(g, 1)).toEqual(['i1>1', 'o1>1', 'p0'])
    expect(edges(g, 2)).toEqual(['i0>0', 'o0>0', 'p1'])
    // Fork point: the feature lane converges into A.
    expect(edges(g, 3)).toEqual(['i0>0', 'i1>0'])
    assertContinuity(g)
  })

  it('keeps line colours stable along a branch', () => {
    const g = computeGraph([c('M', 'B', 'F'), c('F', 'F0'), c('F0', 'A'), c('B', 'A'), c('A')])
    expect(g.rows[1].color).toBe(g.rows[2].color)
    expect(g.rows[1].color).not.toBe(g.rows[0].color)
    const featureColor = g.rows[1].color
    // The merge edge into the feature lane uses the feature colour.
    expect(g.rows[0].edges.find((e) => e.type === 'out' && e.to === 1)?.color).toBe(featureColor)
    // The pass-through of the feature lane next to B keeps the feature colour.
    expect(g.rows[3].edges.find((e) => e.type === 'pass')?.color).toBe(featureColor)
    // Converging edge at the fork point keeps the feature colour too.
    expect(g.rows[4].edges.find((e) => e.type === 'in' && e.from === 1)?.color).toBe(featureColor)
    for (const row of g.rows) for (const e of row.edges) if (e.type === 'pass') expect(e.color).toBe(e.from === 1 ? featureColor : g.rows[0].color)
  })

  it('handles octopus merges', () => {
    const g = computeGraph([c('M', 'A', 'B', 'C'), c('A', 'R'), c('B', 'R'), c('C', 'R'), c('R')])
    expect(lanesOf(g)).toEqual([0, 0, 1, 2, 0])
    expect(g.maxLanes).toBe(3)
    expect(edges(g, 0)).toEqual(['o0>0', 'o0>1', 'o0>2'])
    expect(edges(g, 1)).toEqual(['i0>0', 'o0>0', 'p1', 'p2'])
    expect(edges(g, 4)).toEqual(['i0>0', 'i1>0', 'i2>0'])
    assertContinuity(g)
  })

  it('handles criss-cross merges', () => {
    const g = computeGraph([c('M1', 'A1', 'B1'), c('M2', 'B1', 'A1'), c('A1', 'R'), c('B1', 'R'), c('R')])
    expect(lanesOf(g)).toEqual([0, 2, 0, 1, 0])
    // M2's second parent A1 is already expected by lane 0: merge edge into it, no new lane.
    expect(edges(g, 1)).toEqual(['o2>0', 'o2>2', 'p0', 'p1'])
    // Two lanes expect B1: they meet at B1.
    expect(edges(g, 3)).toEqual(['i1>1', 'i2>1', 'o1>1', 'p0'])
    expect(g.maxLanes).toBe(3)
    assertContinuity(g)
  })

  it('handles multiple roots and orphan branches', () => {
    const g = computeGraph([c('A', 'B'), c('C', 'D'), c('B'), c('E', 'F'), c('D'), c('F')])
    // E is a new tip after root B freed lane 0: it reuses lane 0.
    expect(lanesOf(g)).toEqual([0, 1, 0, 0, 1, 0])
    expect(edges(g, 2)).toEqual(['i0>0', 'p1'])
    expect(edges(g, 3)).toEqual(['o0>0', 'p1'])
    expect(edges(g, 4)).toEqual(['i1>1', 'p0'])
    expect(g.maxLanes).toBe(2)
    assertContinuity(g)
  })

  it('keeps lanes of parents missing from the list running to the bottom', () => {
    const g = computeGraph([c('A', 'B'), c('B', 'Z'), c('C', 'Y')])
    expect(lanesOf(g)).toEqual([0, 0, 1])
    // Z is not loaded: lane 0 keeps running past B.
    expect(edges(g, 1)).toEqual(['i0>0', 'o0>0'])
    expect(edges(g, 2)).toEqual(['o1>1', 'p0'])
    assertContinuity(g)
  })

  it('reuses freed slots to keep the graph compact', () => {
    // f1 forks from M2 and is merged… never: it just ends at M2; f2 starts later and reuses its slot.
    const g = computeGraph([c('M3', 'M2'), c('F1', 'M2'), c('M2', 'M1'), c('F2', 'M1'), c('M1')])
    expect(lanesOf(g)).toEqual([0, 1, 0, 1, 0])
    expect(g.maxLanes).toBe(2)
    assertContinuity(g)
  })

  it('reuses a slot freed in the same row for a merge parent', () => {
    const g = computeGraph([c('C', 'M'), c('T', 'M'), c('M', 'A', 'B'), c('A', 'R'), c('B', 'R'), c('R')])
    expect(lanesOf(g)).toEqual([0, 1, 0, 0, 1, 0])
    expect(edges(g, 2)).toEqual(['i0>0', 'i1>0', 'o0>0', 'o0>1'])
    expect(g.maxLanes).toBe(2)
    assertContinuity(g)
  })

  it('places a merge parent in the first free slot, left of the node when available', () => {
    // Lane 0 frees at root R0; later merge M (lane 1) puts its second parent into slot 0.
    const g = computeGraph([c('X', 'R0'), c('Y', 'M'), c('R0'), c('M', 'P1', 'P2'), c('P2'), c('P1')])
    expect(lanesOf(g)).toEqual([0, 1, 0, 1, 0, 1])
    expect(edges(g, 3)).toEqual(['i1>1', 'o1>0', 'o1>1'])
    assertContinuity(g)
  })

  it('ignores duplicated parents', () => {
    const g = computeGraph([c('M', 'A', 'A'), c('A')])
    expect(edges(g, 0)).toEqual(['o0>0'])
    expect(g.maxLanes).toBe(1)
  })

  it('stays consistent on large synthetic histories', () => {
    for (const seed of [1, 7, 99]) {
      const g = computeGraph(synthHistory(3000, seed))
      assertContinuity(g)
      expect(g.maxLanes).toBeGreaterThan(1)
      expect(g.maxLanes).toBeLessThan(40)
    }
  })

  it('lays out 10k commits in about 50ms', () => {
    const commits = synthHistory(10_000, 3)
    computeGraph(commits) // warm-up (JIT)
    const times: number[] = []
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      computeGraph(commits)
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    expect(times[2]).toBeLessThan(50)
  })
})
