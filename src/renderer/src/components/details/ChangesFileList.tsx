// Read-only file list for commits, stashes and comparisons: header with change
// stats + Path/Tree toggle, then the (virtualised) list. Clicking a file opens
// its diff in the centre panel with every file of the list as siblings.

import { useCallback, useMemo, type ReactNode } from 'react'
import { FileX } from 'lucide-react'
import * as actions from '@renderer/actions/git'
import { showContextMenu } from '@renderer/components/common/ContextMenu'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { FileChange } from '@shared/types'
import { FileList } from './FileList'
import { displayOrder } from './fileTree'
import { readOnlyFileMenu } from './menus'
import { ErrorBlock, LoadingBlock, StatsSummary, ViewModeToggle } from './parts'
import { activePathIn, blameRev, makeTarget, sumStats, type ChangeScope } from './targets'
import { useFileViewMode } from './viewMode'

export interface ChangesFileListProps {
  tab: RepoTab
  scope: ChangeScope
  files: FileChange[] | null
  loading: boolean
  error: string | null
  onRetry?: () => void
  /** Totals when known (otherwise summed from files). */
  additions?: number
  deletions?: number
  ariaLabel: string
  /** Extra controls at the left of the header (replaces the stats while loading). */
  headerExtra?: ReactNode
}

export function ChangesFileList({ tab, scope, files, loading, error, onRetry, additions, deletions, ariaLabel, headerExtra }: ChangesFileListProps) {
  const repo = tab.path
  const mode = useFileViewMode((s) => s.mode)
  // Scope objects are usually created inline; key memoisation on their content.
  const scopeKey = JSON.stringify(scope)
  const stableScope = useMemo(() => JSON.parse(scopeKey) as ChangeScope, [scopeKey])

  const ordered = useMemo(() => (files ? displayOrder(files, mode) : []), [files, mode])
  const siblings = useMemo(() => ordered.map((f) => makeTarget(stableScope, f)), [ordered, stableScope])
  const totals = useMemo(() => {
    if (additions !== undefined && deletions !== undefined) return { additions, deletions }
    return sumStats(files ?? [])
  }, [files, additions, deletions])

  const center = tab.center
  const activePath = center.kind === 'diff' ? activePathIn(center.target, makeTarget(stableScope, { path: '' })) : null

  const open = useCallback((f: FileChange) => actions.openDiff(repo, makeTarget(stableScope, f), siblings), [repo, stableScope, siblings])

  const onFocusFile = useCallback(
    (f: FileChange) => {
      // Arrow navigation follows along in the diff view when one is open.
      const cur = useApp.getState().tabs.find((t) => t.path === repo)?.center
      if (cur?.kind === 'diff') open(f)
    },
    [repo, open]
  )

  const onContextMenu = useCallback(
    (f: FileChange, e: Parameters<typeof showContextMenu>[0]) => {
      showContextMenu(e, readOnlyFileMenu(repo, f, makeTarget(stableScope, f), siblings, blameRev(stableScope, f)))
    },
    [repo, stableScope, siblings]
  )

  let body: ReactNode
  if (error) body = <ErrorBlock message={error} onRetry={onRetry} />
  else if (loading || !files) body = <LoadingBlock label="Loading files…" />
  else if (!files.length)
    body = (
      <div className="det-list-empty">
        <FileX size={16} />
        <span>No file changes</span>
      </div>
    )
  else
    body = (
      <FileList
        files={files}
        mode={mode}
        ariaLabel={ariaLabel}
        activePath={activePath}
        onRowClick={open}
        onActivate={open}
        onFocusFile={onFocusFile}
        onRowContextMenu={onContextMenu}
      />
    )

  return (
    <div className="det-files">
      <div className="det-files-head">
        {headerExtra}
        {files && !error ? (
          <StatsSummary files={files.length} additions={totals.additions} deletions={totals.deletions} />
        ) : (
          <span className="det-files-title">Files</span>
        )}
        <span className="det-spacer" />
        <ViewModeToggle />
      </div>
      {body}
    </div>
  )
}
