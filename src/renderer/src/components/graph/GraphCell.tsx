// GRAPH cell of one row: an inline SVG with the row's lane segments (straight
// verticals + rounded connectors) and the node on top — author avatar inside a
// ring for commits, a small dot for merges, a dashed circle for WIP and a box
// icon for stashes. Everything is drawn inside .gr-draw (which fades out at the
// right edge while lanes are clipped); a selected row whose lane is clipped gets
// its node pinned to the column's right edge, outside the fade.

import { memo, useMemo } from 'react'
import { Archive } from 'lucide-react'
import { Avatar } from '@renderer/components/common/Avatar'
import { colorOf, DASH, laneX, MERGE_R, NODE_R, pinnedNodeX, rowPaths, WIP_R } from './geometry'
import type { DisplayRow } from './model'

export interface GraphCellProps {
  row: DisplayRow
  /** Row height in px. */
  h: number
  /** Width of the drawing (lanes); the column clips anything wider. */
  width: number
  /** Draw the connector from the BRANCH / TAG pills to the node. */
  connector: boolean
  /**
   * Rendered width of the GRAPH column when this node must never be hidden (the
   * selected row); 0 otherwise. A node that does not fit is pinned to the edge.
   */
  pinWidth?: number
}

export const GraphCell = memo(function GraphCell({ row, h, width, connector, pinWidth = 0 }: GraphCellProps) {
  const groups = useMemo(() => rowPaths(row.edges, h), [row.edges, h])
  const pinX = pinnedNodeX(row.lane, pinWidth)
  const pinned = pinX !== null
  const x = pinX ?? laneX(row.lane)
  const mid = h / 2
  const color = colorOf(row.color)
  const isMerge = row.kind === 'commit' && row.isMerge
  const isAvatarNode = row.kind === 'commit' && !row.isMerge
  const nodeR = isMerge ? MERGE_R : NODE_R
  const nodeStyle = { left: x - NODE_R, top: mid - NODE_R }

  return (
    <>
      <div className="gr-draw">
        <svg className="gr-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true">
          {connector && <path className="gr-connector" d={`M0 ${mid + 0.5}H${x - nodeR}`} stroke={color} />}
          {groups.map((g) => (
            <path key={g.key} className="gr-edge" d={g.d} stroke={colorOf(g.color)} strokeDasharray={g.dashed ? DASH : undefined} />
          ))}
          {!pinned && isMerge && <circle className="gr-merge-dot" cx={x} cy={mid} r={MERGE_R} fill={color} />}
          {!pinned && row.kind === 'wip' && <circle className="gr-wip-node" cx={x} cy={mid} r={WIP_R} stroke={color} />}
        </svg>
        {!pinned && isAvatarNode && (
          <span className="gr-node" style={nodeStyle}>
            <Avatar name={row.commit.authorName} email={row.commit.authorEmail} size={NODE_R * 2 - 4} />
          </span>
        )}
        {!pinned && row.kind === 'stash' && (
          <span className="gr-node gr-node-stash" style={nodeStyle} title={row.stash.ref}>
            <Archive size={11} />
          </span>
        )}
      </div>
      {pinned && (
        <span
          className={`gr-node gr-node-pinned gr-node-pinned-${isAvatarNode ? 'avatar' : row.kind === 'stash' ? 'stash' : row.kind === 'wip' ? 'wip' : 'merge'}`}
          style={nodeStyle}
          title={`Lane ${row.lane + 1} is outside the GRAPH column — widen it to see this node in place`}
        >
          {isAvatarNode && <Avatar name={row.commit.authorName} email={row.commit.authorEmail} size={NODE_R * 2 - 4} />}
          {row.kind === 'stash' && <Archive size={11} />}
          {isMerge && <span className="gr-node-dot" />}
        </span>
      )}
    </>
  )
})
