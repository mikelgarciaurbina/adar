// Warning bar shown at the top of the centre panel while a merge / rebase /
// cherry-pick / revert / bisect is in progress, with the conflict count and the
// Continue / Skip / Abort controls (GitKraken style).

import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Cherry, FileDiff, GitBranch, GitMerge, PauseCircle, Play, Search, SkipForward, Undo2, X } from 'lucide-react'
import { abortOperation, openConflict, skipOperation } from '@renderer/actions/git'
import { Button } from '@renderer/components/common/Button'
import { pluralize, shortSha } from '@renderer/lib/format'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { OPERATION_INFO, type ActiveOperation } from './operationInfo'
import { continueWithDraft, resolveBusyKey } from './resolveFlow'
import './conflicts.css'

const ICON_SIZE = 15

const OPERATION_ICON: Record<ActiveOperation, ReactNode> = {
  merge: <GitMerge size={ICON_SIZE} />,
  rebase: <GitBranch size={ICON_SIZE} />,
  'rebase-interactive': <GitBranch size={ICON_SIZE} />,
  'cherry-pick': <Cherry size={ICON_SIZE} />,
  revert: <Undo2 size={ICON_SIZE} />,
  bisect: <Search size={ICON_SIZE} />,
  am: <FileDiff size={ICON_SIZE} />
}

export function OperationBanner({ tab }: { tab: RepoTab }) {
  const repo = tab.path
  const state = tab.info?.state ?? 'none'
  // Busy keys set by the shared actions (continue / abort / skip) and by the conflict tool.
  const continuing = useApp((s) => `continue:${repo}` in s.busy)
  const aborting = useApp((s) => `abort:${repo}` in s.busy)
  const skipping = useApp((s) => `skip:${repo}` in s.busy)
  const resolving = useApp((s) => resolveBusyKey(repo) in s.busy)

  if (state === 'none') return null
  const info = OPERATION_INFO[state]
  const conflicted = tab.status?.conflicted ?? []
  const statusKnown = !!tab.status
  const busy = continuing || aborting || skipping
  const isMerge = state === 'merge'
  const isRebase = state === 'rebase' || state === 'rebase-interactive'
  // Already looking at one of the conflicted files: "Resolve" would be a no-op.
  const inConflictTool = tab.center.kind === 'conflict' && conflicted.some((c) => c.path === (tab.center as { path: string }).path)

  // A rebase that stopped without conflicts and without pending changes is paused at an
  // "edit" (or "break") step: HEAD is the commit to amend.
  const paused =
    isRebase && statusKnown && conflicted.length === 0 && tab.status!.staged.length === 0 && !tab.status!.unstaged.some((f) => f.status !== 'untracked')
  const headSha = tab.info?.head.sha ?? null
  const headSubject = headSha ? tab.commits.find((c) => c.sha === headSha)?.subject : undefined

  const continueLabel = isMerge ? 'Commit merge' : 'Continue'
  const continueTitle = conflicted.length
    ? `Resolve all conflicts before continuing the ${info.noun}`
    : isMerge
      ? 'Create the merge commit'
      : `Continue the ${info.noun}`

  let stateNode: ReactNode = null
  if (statusKnown && state !== 'bisect') {
    if (conflicted.length > 0) {
      stateNode = (
        <span className="cf-banner-state cf-banner-conflicts">
          <AlertTriangle size={13} />
          <span className="cf-banner-text">{pluralize(conflicted.length, 'conflicted file')}</span>
          {!inConflictTool && (
            <Button size="sm" className="cf-banner-resolve" onClick={() => openConflict(repo, conflicted[0].path)}>
              Resolve
            </Button>
          )}
        </span>
      )
    } else if (paused) {
      stateNode = (
        <span className="cf-banner-state cf-banner-paused" title={`Stopped at ${headSha ? shortSha(headSha) : 'HEAD'}${headSubject ? ` ${headSubject}` : ''} — amend it if needed, then Continue`}>
          <PauseCircle size={13} />
          <span className="cf-banner-paused-text">
            Stopped at {headSha && <span className="cf-banner-sha">{shortSha(headSha)}</span>}
            {headSubject && <span className="cf-banner-subject">{headSubject}</span>}
          </span>
          <span className="cf-banner-hint">— amend it if needed, then Continue</span>
        </span>
      )
    } else {
      stateNode = (
        <span className="cf-banner-state cf-banner-ok">
          <CheckCircle2 size={13} />
          <span className="cf-banner-text">
            {isMerge || state === 'cherry-pick' || state === 'revert' ? 'All conflicts resolved' : 'Ready to continue'}
          </span>
        </span>
      )
    }
  }

  return (
    <div className="cf-banner" role="status" aria-live="polite">
      <span className="cf-banner-icon" title={info.title}>
        {OPERATION_ICON[state]}
      </span>
      <span className="cf-banner-title" title={info.title}>
        {info.title}
      </span>
      {stateNode && (
        <>
          <span className="cf-banner-sep" aria-hidden />
          {stateNode}
        </>
      )}
      <span className="cf-banner-spacer" />
      <div className="cf-banner-actions">
        {info.canSkip && (
          <Button
            size="sm"
            variant="ghost"
            icon={<SkipForward size={13} />}
            loading={skipping}
            disabled={busy || resolving}
            title="Skip the current commit"
            onClick={() => void skipOperation(repo)}
          >
            Skip
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="cf-banner-abort"
          icon={<X size={13} />}
          loading={aborting}
          disabled={busy || resolving}
          title={`Abort the ${info.noun} and restore the previous state`}
          onClick={() => void abortOperation(repo)}
        >
          Abort
        </Button>
        {info.canContinue && (
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={12} />}
            loading={continuing}
            disabled={busy || resolving || !statusKnown || conflicted.length > 0}
            title={continueTitle}
            onClick={() => void continueWithDraft(repo)}
          >
            {continueLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
