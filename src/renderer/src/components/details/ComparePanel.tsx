// Two selected commits: the files changed between the older and the newer one.

import { useMemo, useState } from 'react'
import { ArrowDownUp, GitCompareArrows } from 'lucide-react'
import { api } from '@renderer/api/client'
import { IconButton } from '@renderer/components/common/Button'
import { shortSha } from '@renderer/lib/format'
import type { RepoTab } from '@renderer/store/appStore'
import type { Commit, FileChange } from '@shared/types'
import { useCached } from './cache'
import { ChangesFileList } from './ChangesFileList'
import { goToCommit } from './CommitPanel'
import { orderPair } from './targets'

export function ComparePanel({ tab, a, b }: { tab: RepoTab; a: string; b: string }) {
  const repo = tab.path
  const [older, newer] = useMemo(() => orderPair(tab.commits, a, b), [tab.commits, a, b])
  const [reversed, setReversed] = useState(false)
  const from = reversed ? newer : older
  const to = reversed ? older : newer
  const files = useCached<FileChange[]>(`${repo}\u0000compare\u0000${from}..${to}`, () => api.getCompareFiles(repo, from, to))
  const bySha = useMemo(() => {
    const m = new Map<string, Commit>()
    for (const c of tab.commits) if (c.sha === from || c.sha === to) m.set(c.sha, c)
    return m
  }, [tab.commits, from, to])

  return (
    <div className="det-panel">
      <div className="ui-panel-header det-header">
        <GitCompareArrows size={14} className="det-header-icon" />
        <span className="det-header-label">Comparing</span>
        <span className="det-sha" title={from}>
          {shortSha(from)}
        </span>
        <span className="det-muted">…</span>
        <span className="det-sha" title={to}>
          {shortSha(to)}
        </span>
        <span className="det-spacer" />
        <IconButton size="sm" label="Swap comparison direction" active={reversed} onClick={() => setReversed((r) => !r)}>
          <ArrowDownUp size={13} />
        </IconButton>
      </div>

      <div className="det-info det-compare">
        <CompareEnd label="From" sha={from} commit={bySha.get(from)} onOpen={() => goToCommit(repo, from)} />
        <CompareEnd label="To" sha={to} commit={bySha.get(to)} onOpen={() => goToCommit(repo, to)} />
      </div>

      <ChangesFileList
        tab={tab}
        scope={{ kind: 'compare', from, to }}
        files={files.data}
        loading={files.loading}
        error={files.error}
        onRetry={files.retry}
        ariaLabel="Files changed between the selected commits"
      />
    </div>
  )
}

function CompareEnd({ label, sha, commit, onOpen }: { label: string; sha: string; commit: Commit | undefined; onOpen: () => void }) {
  return (
    <div className="det-compare-end">
      <span className="det-compare-label">{label}</span>
      <button type="button" className="ui-link det-sha-link" onClick={onOpen} title={`Show ${sha}`}>
        {shortSha(sha)}
      </button>
      <span className="det-compare-subject" title={commit?.subject}>
        {commit?.subject ?? ''}
      </span>
    </div>
  )
}
