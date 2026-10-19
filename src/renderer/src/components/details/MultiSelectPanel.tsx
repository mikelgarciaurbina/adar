// More than two commits selected: summary list and a bulk cherry-pick.

import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Cherry, Layers, X } from 'lucide-react'
import * as actions from '@renderer/actions/git'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, IconButton } from '@renderer/components/common/Button'
import { currentBranch } from '@renderer/lib/refs'
import { shortSha } from '@renderer/lib/format'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { Commit } from '@shared/types'
import { oldestFirst } from './targets'

export function MultiSelectPanel({ tab }: { tab: RepoTab }) {
  const repo = tab.path
  const busy = useApp((s) => !!s.busy[`cherry-pick:${repo}`])
  const ordered = useMemo(() => oldestFirst(tab.commits, tab.multiSelect), [tab.commits, tab.multiSelect])
  const bySha = useMemo(() => {
    const wanted = new Set(tab.multiSelect)
    const m = new Map<string, Commit>()
    for (const c of tab.commits) if (wanted.has(c.sha)) m.set(c.sha, c)
    return m
  }, [tab.commits, tab.multiSelect])
  const n = ordered.length
  const branch = currentBranch(tab.refs)?.name
  const onto = branch ?? (tab.info?.head.detached ? 'detached HEAD' : 'HEAD')

  return (
    <div className="det-panel">
      <div className="ui-panel-header det-header">
        <Layers size={14} className="det-header-icon" />
        <span className="det-header-title">{n} commits selected</span>
        <span className="det-spacer" />
        <IconButton size="sm" label="Clear selection" onClick={() => useApp.getState().select(repo, { kind: 'none' })}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="det-info">
        <Button variant="primary" icon={<Cherry size={14} />} loading={busy} className="det-wide-btn" onClick={() => void actions.cherryPick(repo, ordered)}>
          Cherry-pick {n} commits
        </Button>
        <div className="det-hint">
          Applied oldest first onto <strong>{onto}</strong>.
        </div>
      </div>
      <SelectedCommitList repo={repo} ordered={ordered} bySha={bySha} />
    </div>
  )
}

const MULTI_ROW_H = 28

/** Selected commits in application order (virtualised: range selections can be huge). */
function SelectedCommitList({ repo, ordered, bySha }: { repo: string; ordered: string[]; bySha: Map<string, Commit> }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => MULTI_ROW_H,
    getItemKey: (i) => ordered[i] ?? i,
    overscan: 12
  })
  const select = (sha: string) => useApp.getState().select(repo, { kind: 'commit', sha })

  return (
    <div ref={scrollRef} className="det-multi-list" role="list" aria-label="Selected commits">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const sha = ordered[vi.index]
          const c = bySha.get(sha)
          return (
            <div
              key={sha}
              role="listitem"
              tabIndex={0}
              className="det-multi-row"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}
              title={c ? `${c.subject}\n${c.authorName} <${c.authorEmail}>` : sha}
              onClick={() => select(sha)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') select(sha)
              }}
            >
              <span className="det-multi-num">{vi.index + 1}</span>
              {c && <Avatar name={c.authorName} email={c.authorEmail} size={18} />}
              <span className="det-multi-subject">{c?.subject ?? '(commit not loaded)'}</span>
              <span className="det-multi-sha">{shortSha(sha)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
