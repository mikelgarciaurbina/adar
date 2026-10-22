// The checked-out branch as a dot in the colour of its graph lane (fern until the graph has laid it out),
// like the HEAD node in the graph and the current branch in the left panel.

import { laneColor } from '@renderer/lib/colors'
import { useLanes } from '@renderer/store/laneStore'

export function BranchDot({ repo, sha, size = 'md' }: { repo: string; sha: string | null; size?: 'sm' | 'md' }) {
  const lane = useLanes((s) => (sha ? s.tips[repo]?.get(sha) : undefined))
  return (
    <span
      className={`tb-branch-dot tb-branch-dot-${size}`}
      style={lane === undefined ? undefined : ({ '--tb-branch': laneColor(lane) } as React.CSSProperties)}
      aria-hidden="true"
    />
  )
}
