// Small building blocks shared by the right panel views.

import { Fragment, memo, type ReactNode } from 'react'
import { Check, Cloud, Copy, GitBranch, List, ListTree, Tag, TriangleAlert } from 'lucide-react'
import { api } from '@renderer/api/client'
import * as actions from '@renderer/actions/git'
import { Button, IconButton, Spinner } from '@renderer/components/common/Button'
import { toast } from '@renderer/components/common/toast'
import { absoluteTime, formatDate, pluralize, relativeTime } from '@renderer/lib/format'
import type { RefsAtCommit } from '@renderer/lib/refs'
import { useSettings } from '@renderer/store/appStore'
import type { UnixSeconds } from '@shared/types'
import { linkify } from './linkify'
import { statBlocks } from './targets'
import { useFileViewMode } from './viewMode'

/** Path / Tree segmented toggle (shared preference). */
export function ViewModeToggle() {
  const mode = useFileViewMode((s) => s.mode)
  const setMode = useFileViewMode((s) => s.setMode)
  return (
    <div className="det-seg" role="radiogroup" aria-label="File list view">
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'path'}
        className={`det-seg-btn${mode === 'path' ? ' det-seg-on' : ''}`}
        title="Path view"
        onClick={() => setMode('path')}
      >
        <List size={13} />
        <span>Path</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'tree'}
        className={`det-seg-btn${mode === 'tree' ? ' det-seg-on' : ''}`}
        title="Tree view"
        onClick={() => setMode('tree')}
      >
        <ListTree size={13} />
        <span>Tree</span>
      </button>
    </div>
  )
}

/** "N files changed +X −Y" with a 5-block green/red bar. */
export function StatsSummary({ files, additions, deletions }: { files: number; additions: number; deletions: number }) {
  const blocks = statBlocks(additions, deletions)
  const cells: ReactNode[] = []
  for (let i = 0; i < blocks.add; i++) cells.push(<span key={`a${i}`} className="det-bar-cell det-bar-add" />)
  for (let i = 0; i < blocks.del; i++) cells.push(<span key={`d${i}`} className="det-bar-cell det-bar-del" />)
  for (let i = 0; i < blocks.neutral; i++) cells.push(<span key={`n${i}`} className="det-bar-cell" />)
  return (
    <div className="det-stats" title={`${additions} additions, ${deletions} deletions`}>
      <span className="det-stats-files">{pluralize(files, 'file')} changed</span>
      <span className="det-add">+{additions}</span>
      <span className="det-del">−{deletions}</span>
      <span className="det-bar" aria-hidden="true">
        {cells}
      </span>
    </div>
  )
}

function openUrl(href: string) {
  api.openExternal(href).catch((err) => toast.error(err))
}

/** Text with clickable URLs (opened in the system browser). */
export const LinkifiedText = memo(function LinkifiedText({ text }: { text: string }) {
  const segments = linkify(text)
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'url' ? (
          <a
            key={i}
            href={s.href}
            className="det-link"
            title={s.href}
            onClick={(e) => {
              e.preventDefault()
              openUrl(s.href)
            }}
          >
            {s.text}
          </a>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        )
      )}
    </>
  )
})

/** Date rendered per the user's date format, with the other format as tooltip. */
export function DateText({ ts, prefix }: { ts: UnixSeconds; prefix?: string }) {
  const { dateFormat } = useSettings()
  const text = formatDate(ts, dateFormat)
  const tip = dateFormat === 'relative' ? absoluteTime(ts) : relativeTime(ts)
  return (
    <span className="det-date" title={tip}>
      {prefix ? `${prefix} ` : ''}
      {text}
    </span>
  )
}

export function CopyButton({ text, label, what }: { text: string; label: string; what: string }) {
  return (
    <IconButton size="sm" label={label} onClick={() => void actions.copyText(text, what)}>
      <Copy size={13} />
    </IconButton>
  )
}

/** Branch / remote / tag chips for the refs pointing at a commit. */
export function RefChips({ repo, refs }: { repo: string; refs: RefsAtCommit | undefined }) {
  if (!refs || refs.branches.length + refs.remotes.length + refs.tags.length === 0) return null
  return (
    <div className="det-refs">
      {refs.branches.map((b) => (
        <span
          key={b.fullName}
          className={`det-ref det-ref-local${b.isHead ? ' det-ref-head' : ''}`}
          title={`${b.isHead ? 'Checked out branch' : 'Local branch'} ${b.name}${b.upstream ? ` → ${b.upstream}` : ''}\nDouble-click to checkout`}
          onDoubleClick={() => void actions.checkoutRef(repo, b)}
        >
          {b.isHead ? <Check size={11} strokeWidth={3} /> : <GitBranch size={11} />}
          <span className="det-ref-name">{b.name}</span>
        </span>
      ))}
      {refs.remotes.map((r) => (
        <span
          key={r.fullName}
          className="det-ref det-ref-remote"
          title={`Remote branch ${r.name}\nDouble-click to checkout`}
          onDoubleClick={() => void actions.checkoutRef(repo, r)}
        >
          <Cloud size={11} />
          <span className="det-ref-name">{r.name}</span>
        </span>
      ))}
      {refs.tags.map((t) => (
        <span key={t.fullName} className="det-ref det-ref-tag" title={t.tagMessage ? `Tag ${t.name}\n${t.tagMessage}` : `Tag ${t.name}`}>
          <Tag size={11} />
          <span className="det-ref-name">{t.name}</span>
        </span>
      ))}
    </div>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="det-loading" role="status">
      <Spinner size="sm" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="det-error" role="alert">
      <TriangleAlert size={14} />
      <span className="det-error-msg selectable">{message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
