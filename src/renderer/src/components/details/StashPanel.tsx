// Stash details: message, branch, date, base commit, files and Apply / Pop / Delete.

import { useEffect } from 'react'
import { Archive, ArchiveRestore, GitBranch, PackageOpen, Trash } from 'lucide-react'
import { api } from '@renderer/api/client'
import * as actions from '@renderer/actions/git'
import { Button, EmptyState } from '@renderer/components/common/Button'
import { shortSha } from '@renderer/lib/format'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { CommitDetails } from '@shared/types'
import { useCached } from './cache'
import { ChangesFileList } from './ChangesFileList'
import { goToCommit } from './CommitPanel'
import { stashTitle } from './message'
import { CopyButton, DateText, LoadingBlock } from './parts'

export function StashPanel({ tab, index, sha }: { tab: RepoTab; index: number; sha: string }) {
  const repo = tab.path
  // The stash list may have shifted since selection (new stash pushed): resolve by sha.
  const stash = tab.refs?.stashes.find((s) => s.sha === sha) ?? null
  const curIndex = stash?.index ?? index
  const busy = useApp((s) => !!s.busy[`stash:${repo}`])
  const details = useCached<CommitDetails>(stash ? `${repo}\u0000stash\u0000${sha}` : null, () => api.getStashDetails(repo, curIndex))
  const gone = !!tab.refs && !stash

  // Once the stash is popped or dropped, fall back to the default view (WIP or empty) right away.
  useEffect(() => {
    if (!gone) return
    const cur = useApp.getState().tabs.find((x) => x.path === repo)
    if (cur?.selection.kind === 'stash' && cur.selection.sha === sha) useApp.getState().select(repo, { kind: 'none' })
  }, [gone, repo, sha])

  if (!stash) {
    if (!tab.refs) {
      return (
        <div className="det-panel">
          <LoadingBlock label="Loading stash…" />
        </div>
      )
    }
    return (
      <div className="det-panel">
        <EmptyState icon={<Archive size={28} />} title="Stash not found">
          This stash no longer exists. It may have been applied or dropped.
        </EmptyState>
      </div>
    )
  }

  const title = stashTitle(stash.message)

  return (
    <div className="det-panel">
      <div className="ui-panel-header det-header">
        <Archive size={14} className="det-header-icon det-stash-icon" />
        <span className="det-header-label">stash:</span>
        <span className="det-sha selectable" title={stash.sha}>
          {stash.ref}
        </span>
        <CopyButton text={stash.sha} label="Copy stash SHA" what="Stash SHA copied" />
        <span className="det-spacer" />
        <span className="det-parents">
          <span className="det-header-label">base:</span>
          <button type="button" className="ui-link det-sha-link" title={`Go to base commit ${stash.baseSha}`} onClick={() => goToCommit(repo, stash.baseSha)}>
            {shortSha(stash.baseSha)}
          </button>
        </span>
      </div>

      <div className="det-info">
        <div className="det-subject selectable" title={stash.message}>
          {title}
        </div>
        <div className="det-meta-row">
          {stash.branch && (
            <span className="det-meta-item" title={`Created on ${stash.branch}`}>
              <GitBranch size={12} />
              <span className="selectable">{stash.branch}</span>
            </span>
          )}
          <span className="det-meta-item">
            <DateText prefix="stashed" ts={stash.date} />
          </span>
        </div>
        <div className="det-actions-row">
          <Button size="sm" variant="primary" icon={<ArchiveRestore size={13} />} disabled={busy} onClick={() => void actions.popStash(repo, curIndex)} title="Apply the stash and remove it">
            Pop
          </Button>
          <Button size="sm" icon={<PackageOpen size={13} />} disabled={busy} onClick={() => void actions.applyStash(repo, curIndex)} title="Apply the stash and keep it">
            Apply
          </Button>
          <span className="det-spacer" />
          <Button size="sm" variant="ghost" className="det-btn-danger-ghost" icon={<Trash size={13} />} disabled={busy} onClick={() => void actions.dropStash(repo, curIndex)}>
            Delete
          </Button>
        </div>
      </div>

      <ChangesFileList
        tab={tab}
        scope={{ kind: 'stash', index: curIndex, sha: stash.sha, baseSha: stash.baseSha }}
        files={details.data?.files ?? null}
        loading={details.loading}
        error={details.error}
        onRetry={details.retry}
        additions={details.data?.additions}
        deletions={details.data?.deletions}
        ariaLabel="Files in this stash"
      />
    </div>
  )
}
