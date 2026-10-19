// GRAPH cell of one row: an inline SVG with the row's lane segments (straight
// verticals + rounded connectors) and the node on top — author avatar inside a
// ring for commits, a small dot for merges, a dashed circle for WIP and a box
// icon for stashes.

import { memo, useMemo } from 'react'
import { Archive } from 'lucide-react'
import { Avatar } from '@renderer/components/common/Avatar'
import { colorOf, DASH, laneX, MERGE_R, NODE_R, rowPaths, WIP_R } from './geometry'
import type { DisplayRow } from './model'

export interface GraphCellProps {
  row: DisplayRow
  /** Row height in px. */
  h: number
  /** Width of the drawing (lanes); the column clips anything wider. */
  width: number
  /** Draw the connector from the BRANCH / TAG pills to the node. */
  connector: boolean
}

export const GraphCell = memo(function GraphCell({ row, h, width, connector }: GraphCellProps) {
  const groups = useMemo(() => rowPaths(row.edges, h), [row.edges, h])
  const x = laneX(row.lane)
  const mid = h / 2
  const color = colorOf(row.color)
  const isAvatarNode = row.kind === 'commit' && !row.isMerge
  const nodeR = row.kind === 'commit' && row.isMerge ? MERGE_R : NODE_R

  return (
    <>
      <svg className="gr-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true">
        {connector && <path className="gr-connector" d={`M0 ${mid + 0.5}H${x - nodeR}`} stroke={color} />}
        {groups.map((g) => (
          <path key={g.key} className="gr-edge" d={g.d} stroke={colorOf(g.color)} strokeDasharray={g.dashed ? DASH : undefined} />
        ))}
        {row.kind === 'commit' && row.isMerge && <circle className="gr-merge-dot" cx={x} cy={mid} r={MERGE_R} fill={color} />}
        {row.kind === 'wip' && <circle className="gr-wip-node" cx={x} cy={mid} r={WIP_R} stroke={color} />}
      </svg>
      {isAvatarNode && (
        <span className="gr-node" style={{ left: x - NODE_R, top: mid - NODE_R }}>
          <Avatar name={row.commit.authorName} email={row.commit.authorEmail} size={NODE_R * 2 - 4} />
        </span>
      )}
      {row.kind === 'stash' && (
        <span className="gr-node gr-node-stash" style={{ left: x - NODE_R, top: mid - NODE_R }} title={row.stash.ref}>
          <Archive size={11} />
        </span>
      )}
    </>
  )
})
