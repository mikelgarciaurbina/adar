// The small pull request label next to a branch (graph, toolbar) and the state icon used
// everywhere else: the number, the state's icon and colour, and how its checks went.

import type { MouseEvent } from 'react'
import { Check, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, X } from 'lucide-react'
import { pullTitle } from '@renderer/lib/pulls'
import type { PullRequest, PullState } from '@shared/hosting'
import './pulls.css'

export function PullStateIcon({ state, size = 12 }: { state: PullState; size?: number }) {
  const props = { size, className: `pr-icon pr-icon-${state}`, 'aria-hidden': true }
  switch (state) {
    case 'draft':
      return <GitPullRequestDraft {...props} />
    case 'merged':
      return <GitMerge {...props} />
    case 'closed':
      return <GitPullRequestClosed {...props} />
    default:
      return <GitPullRequest {...props} />
  }
}

/** How the checks went, as a glyph (nothing when there are none). */
export function ChecksGlyph({ pr }: { pr: PullRequest }) {
  switch (pr.checks) {
    case 'passed':
      return <Check size={10} strokeWidth={3} className="pr-checks pr-checks-passed" aria-label="checks passed" />
    case 'failed':
      return <X size={10} strokeWidth={3} className="pr-checks pr-checks-failed" aria-label="a check failed" />
    case 'running':
      return <span className="pr-checks pr-checks-running" aria-label="checks running" />
    default:
      return null
  }
}

export function PullChip({ pr, onClick, hash = false }: { pr: PullRequest; onClick: (e: MouseEvent) => void; hash?: boolean }) {
  return (
    <button
      type="button"
      className={`pr-chip pr-chip-${pr.state}`}
      title={pullTitle(pr)}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <PullStateIcon state={pr.state} size={11} />
      <span className="pr-chip-num">
        {hash ? '#' : ''}
        {pr.number}
      </span>
      {(pr.state === 'open' || pr.state === 'draft') && <ChecksGlyph pr={pr} />}
    </button>
  )
}
