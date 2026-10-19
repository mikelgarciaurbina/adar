// Pure lane layout for the commit graph.
//
// Input: commits in `git log --date-order` order (every child before its parents).
// Output: for every row the lane (column) of its node, the node colour and the
// edge segments that must be drawn inside that row, plus the total lane count.
//
// Algorithm ("expected parent per lane"):
//  - `lanes[l]` holds the sha lane `l` is waiting for (null = free slot).
//  - The first lane expecting the current commit becomes its node lane; every
//    other lane expecting it converges into the node (top half of the row) and
//    is freed. A commit nobody expects (a branch tip) takes the first free slot.
//  - The first parent continues in the node lane (even when another lane also
//    expects it — both lanes then meet at the parent, like GitKraken draws forks).
//  - Every additional parent (merge) reuses a lane already expecting it or takes
//    the first free slot (freed slots are reused so the graph stays compact).
//  - Parents that never show up (pagination, shallow history) simply keep their
//    lane running to the bottom of the list.
// Lanes never move sideways, so a line keeps its column — and its colour — from
// the row it starts in until the row it ends in.

export interface LayoutCommit {
  sha: string
  parents: readonly string[]
}

/**
 * Segment drawn inside one row (lane coordinates, row-local):
 *  - 'pass': vertical line through the whole row in lane `from` (=== `to`).
 *  - 'in':   from the top of the row in lane `from` into the node (lane `to`).
 *  - 'out':  from the node (lane `from`) to the bottom of the row in lane `to`.
 * When `from === to`, 'in' / 'out' are straight half-height verticals.
 */
export interface Edge {
  type: 'pass' | 'in' | 'out'
  from: number
  to: number
  /** Colour index (see lib/colors laneColor); negative = neutral (stash). */
  color: number
  /** Dashed line (connectors of virtual nodes: WIP, stashes). */
  dashed?: boolean
}

export interface LayoutRow {
  /** Lane of the commit node. */
  lane: number
  /** Colour index of the node (the colour of its lane's line). */
  color: number
  edges: Edge[]
}

export interface GraphLayout {
  rows: LayoutRow[]
  /** Number of lane columns needed to draw every row. */
  maxLanes: number
}

/** Colour of a line that starts in `lane`. Column based: stable and GitKraken-like. */
export function colorForLane(lane: number): number {
  return lane
}

function firstFree(lanes: Array<string | null>): number {
  for (let l = 0; l < lanes.length; l++) if (lanes[l] === null) return l
  return lanes.length
}

export function computeGraph(commits: readonly LayoutCommit[]): GraphLayout {
  const lanes: Array<string | null> = []
  const colors: number[] = []
  const rows: LayoutRow[] = new Array(commits.length)
  let maxLanes = 0

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    const sha = commit.sha
    const parents = commit.parents
    const edges: Edge[] = []

    // 1. Node lane: first lane expecting this commit, else the first free slot.
    let node = -1
    for (let l = 0; l < lanes.length; l++) {
      if (lanes[l] === sha) {
        node = l
        break
      }
    }
    let nodeColor: number
    if (node === -1) {
      node = firstFree(lanes)
      if (node === lanes.length) {
        lanes.push(null)
        colors.push(0)
      }
      nodeColor = colorForLane(node)
      colors[node] = nodeColor
    } else {
      nodeColor = colors[node]
    }

    // 2. Top half: every active lane either converges into the node or passes through.
    for (let l = 0; l < lanes.length; l++) {
      const expected = lanes[l]
      if (expected === null) continue
      if (expected === sha) {
        edges.push({ type: 'in', from: l, to: node, color: colors[l] })
        lanes[l] = null
      } else {
        edges.push({ type: 'pass', from: l, to: l, color: colors[l] })
      }
    }

    // 3. Bottom half: parents.
    if (parents.length > 0) {
      lanes[node] = parents[0]
      colors[node] = nodeColor
      edges.push({ type: 'out', from: node, to: node, color: nodeColor })
      for (let p = 1; p < parents.length; p++) {
        const parent = parents[p]
        // Ignore duplicated parents (malformed input).
        let dup = false
        for (let q = 0; q < p; q++) {
          if (parents[q] === parent) {
            dup = true
            break
          }
        }
        if (dup) continue
        let target = -1
        for (let l = 0; l < lanes.length; l++) {
          if (lanes[l] === parent) {
            target = l
            break
          }
        }
        if (target === -1) {
          target = firstFree(lanes)
          if (target === lanes.length) {
            lanes.push(null)
            colors.push(0)
          }
          lanes[target] = parent
          colors[target] = colorForLane(target)
        }
        edges.push({ type: 'out', from: node, to: target, color: colors[target] })
      }
    }

    if (lanes.length > maxLanes) maxLanes = lanes.length
    // Keep the lane array compact so trailing free slots do not widen the graph.
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }

    rows[i] = { lane: node, color: nodeColor, edges }
  }

  return { rows, maxLanes }
}
