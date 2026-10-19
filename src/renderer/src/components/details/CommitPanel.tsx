// Commit details (GitKraken right panel): sha header, subject/body, author and
// committer, parents, refs, change stats and the changed files.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Avatar } from '@renderer/components/common/Avatar'
import { refsBySha } from '@renderer/lib/refs'
import { shortSha } from '@renderer/lib/format'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { Commit, CommitDetails } from '@shared/types'
import { useCached } from './cache'
import { ChangesFileList } from './ChangesFileList'
import { CopyButton, DateText, ErrorBlock, LinkifiedText, LoadingBlock, RefChips } from './parts'

/** Select a commit and page it into the graph if needed. */
export function goToCommit(repo: string, sha: string): void {
  const st = useApp.getState()
  st.select(repo, { kind: 'commit', sha })
  void st.ensureCommitLoaded(repo, sha)
}

export function commitDetailsKey(repo: string, sha: string): string {
  return `${repo}\u0000commit\u0000${sha}`
}

export function CommitPanel({ tab, sha }: { tab: RepoTab; sha: string }) {
  const repo = tab.path
  const listCommit = useMemo(() => tab.commits.find((c) => c.sha === sha) ?? null, [tab.commits, sha])
  const details = useCached<CommitDetails>(commitDetailsKey(repo, sha), () => api.getCommitDetails(repo, sha))
  const commit: Commit | null = details.data?.commit ?? listCommit
  const refsMap = useMemo(() => refsBySha(tab.refs), [tab.refs])
  const [bodyExpanded, setBodyExpanded] = useState(false)

  if (!commit) {
    return (
      <div className="det-panel">
        <div className="ui-panel-header det-header">
          <GitCommitHorizontal size={14} className="det-header-icon" />
          <span className="det-header-label">commit:</span>
          <span className="det-sha">{shortSha(sha)}</span>
        </div>
        {details.error ? <ErrorBlock message={details.error} onRetry={details.retry} /> : <LoadingBlock label="Loading commit…" />}
      </div>
    )
  }

  const committerDiffers = commit.committerName !== commit.authorName || commit.committerEmail !== commit.authorEmail
  const dateDiffers = Math.abs(commit.committerDate - commit.authorDate) > 60

  return (
    <div className="det-panel">
      <div className="ui-panel-header det-header">
        <GitCommitHorizontal size={14} className="det-header-icon" />
        <span className="det-header-label">commit:</span>
        <span className="det-sha selectable" title={commit.sha}>
          {commit.shortSha || shortSha(commit.sha)}
        </span>
        <CopyButton text={commit.sha} label="Copy full commit SHA" what="Commit SHA copied" />
        <span className="det-spacer" />
        <Parents repo={repo} parents={commit.parents} />
      </div>

      <div className={`det-info${bodyExpanded ? ' det-info-expanded' : ''}`}>
        <RefChips repo={repo} refs={refsMap.get(commit.sha)} />
        <div className="det-subject selectable">{commit.subject || <span className="det-muted">(no commit message)</span>}</div>
        {commit.body.trim() && <CommitBody text={commit.body.replace(/\s+$/, '')} expanded={bodyExpanded} onToggle={() => setBodyExpanded((v) => !v)} />}

        <div className="det-person">
          <Avatar name={commit.authorName} email={commit.authorEmail} size={32} />
          <div className="det-person-text">
            <div className="det-person-line">
              <span className="det-person-name selectable">{commit.authorName}</span>
              <span className="det-person-email selectable">{commit.authorEmail}</span>
            </div>
            <div className="det-person-meta">
              <DateText prefix="authored" ts={commit.authorDate} />
            </div>
          </div>
        </div>
        {committerDiffers ? (
          <div className="det-committer">
            <Avatar name={commit.committerName} email={commit.committerEmail} size={18} />
            <span>committed by</span>
            <span className="det-person-name selectable">{commit.committerName}</span>
            <span className="det-person-email selectable">{commit.committerEmail}</span>
            <DateText ts={commit.committerDate} />
          </div>
        ) : (
          dateDiffers && (
            <div className="det-committer det-committer-plain">
              <DateText prefix="committed" ts={commit.committerDate} />
            </div>
          )
        )}
      </div>

      <ChangesFileList
        tab={tab}
        scope={{ kind: 'commit', sha: commit.sha }}
        files={details.data?.files ?? null}
        loading={details.loading}
        error={details.error}
        onRetry={details.retry}
        additions={details.data?.additions}
        deletions={details.data?.deletions}
        ariaLabel="Files changed in this commit"
      />
    </div>
  )
}

function Parents({ repo, parents }: { repo: string; parents: string[] }) {
  if (!parents.length) return <span className="det-parents det-muted">root commit</span>
  return (
    <span className="det-parents">
      <span className="det-header-label">{parents.length > 1 ? 'parents:' : 'parent:'}</span>
      {parents.map((p) => (
        <button key={p} type="button" className="ui-link det-sha-link" title={`Go to parent ${p}`} onClick={() => goToCommit(repo, p)}>
          {shortSha(p)}
        </button>
      ))}
    </span>
  )
}

/** Commit body, clamped to a few lines with a Show more / Show less toggle when it is long. */
function CommitBody({ text, expanded, onToggle }: { text: string; expanded: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, expanded])
  return (
    <div className="det-body-wrap">
      <div ref={ref} className={`det-body selectable${expanded ? '' : ' det-body-clamped'}${!expanded && overflows ? ' det-body-fade' : ''}`}>
        <LinkifiedText text={text} />
      </div>
      {(overflows || expanded) && (
        <button type="button" className="ui-link det-more" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
