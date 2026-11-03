// In the right panel, while the reflog view is open: a commit no branch reaches says what left it behind,
// how long git keeps it, and offers the way back.

import { GitBranchPlus, TriangleAlert } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { branchFromLost } from '@renderer/actions/reflog'
import { Button } from '@renderer/components/common/Button'
import { relativeTime } from '@renderer/lib/format'
import { currentBranch } from '@renderer/lib/refs'
import { useApp } from '@renderer/store/appStore'
import type { LostGroup } from '@shared/types'
import { groupOf } from './model'
import { useReflog } from './reflogStore'

function why(g: LostGroup): string {
  const when = relativeTime(g.date)
  switch (g.kind) {
    case 'reset':
      return `Left behind when ${g.branch ?? 'HEAD'} was reset ${when}.`
    case 'deleted':
      return `It was on ${g.branch}, which is deleted; you left it ${when}.`
    case 'detached':
      return `Made on a detached HEAD, left ${when}.`
    case 'rewritten':
      return `An old version, ${/amend/.test(g.move) ? 'amended' : 'rebased'} ${when}.`
    default:
      return `Left behind ${when}.`
  }
}

function kept(daysLeft: number | null): string {
  if (daysLeft === null) return ''
  if (daysLeft <= 0) return ' Git may forget it at its next cleanup.'
  return ` Git keeps it ${daysLeft} more ${daysLeft === 1 ? 'day' : 'days'}.`
}

export function LostCommitNote({ repo, sha, subject }: { repo: string; sha: string; subject: string }) {
  const inReflog = useApp((s) => s.tabs.find((t) => t.path === repo)?.center.kind === 'reflog')
  const refs = useApp((s) => s.tabs.find((t) => t.path === repo)?.refs ?? null)
  const group = useReflog((s) => groupOf(s.lost[repo]?.data?.groups, sha))
  const dangling = useReflog((s) => s.dangling[repo]?.data?.find((c) => c.sha === sha))
  if (!inReflog || (!group && !dangling)) return null
  const onto = currentBranch(refs)?.name
  return (
    <div className="rl-panel-note">
      <span className="rl-panel-note-text">
        <TriangleAlert size={14} />
        <span>
          <b>On no branch.</b> {group ? why(group) + kept(group.daysLeft) : dangling?.stash ? 'A dropped stash that no reflog remembers.' : 'No reflog remembers it.'}
        </span>
      </span>
      <div className="rl-panel-actions">
        <Button size="sm" variant="primary" icon={<GitBranchPlus size={13} />} onClick={() => void branchFromLost(repo, { sha, subject })}>
          Create branch here…
        </Button>
        {onto && (
          <Button size="sm" onClick={() => void git.cherryPick(repo, [sha])}>
            Cherry-pick onto {onto}
          </Button>
        )}
        <Button size="sm" onClick={() => void git.checkout(repo, sha)}>
          Check out
        </Button>
      </div>
    </div>
  )
}
