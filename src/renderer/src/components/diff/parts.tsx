// Small presentational pieces shared by the diff, history and blame views.

import { useRef } from 'react'
import { Columns2, Copy, Ellipsis, ExternalLink, FoldVertical, ListOrdered, Rows2, Space, UnfoldVertical } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { IconButton } from '@renderer/components/common/Button'
import { showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { basename, dirname, STATUS_LETTER, statusColor } from '@renderer/lib/format'
import type { DiffViewMode, FileStatusCode } from '@shared/types'
import { CONTEXT_CHOICES, setContextLines, setDiffMode, setFullFile, setIgnoreWhitespace } from './prefs'

const STATUS_WORD: Record<FileStatusCode, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
  typechange: 'Type changed',
  conflicted: 'Conflicted'
}

export function StatusBadge({ status }: { status: FileStatusCode }) {
  return (
    <span className="diff-status" style={{ color: statusColor(status), borderColor: statusColor(status) }} title={STATUS_WORD[status]}>
      {STATUS_LETTER[status]}
    </span>
  )
}

/** "src/components/" dimmed + "File.tsx" bold. */
export function PathLabel({ path }: { path: string }) {
  const dir = dirname(path)
  return (
    <span className="diff-path selectable" title={path}>
      {dir && <span className="diff-path-dir">{dir}/</span>}
      <span className="diff-path-name">{basename(path)}</span>
    </span>
  )
}

const LAYOUTS: Array<{ value: DiffViewMode; label: string; icon: React.ReactNode; title: string }> = [
  { value: 'unified', label: 'Unified', icon: <Rows2 size={13} />, title: 'Unified: removed and added lines in one column' },
  { value: 'split', label: 'Split', icon: <Columns2 size={13} />, title: 'Split: old and new versions side by side' }
]

/** Unified / Split segmented control bound to settings.diffViewMode. */
export function ViewModeSwitch({ value }: { value: DiffViewMode }) {
  return (
    <div className="diff-seg" role="radiogroup" aria-label="Diff layout">
      {LAYOUTS.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={value === m.value}
          className={`diff-seg-btn${value === m.value ? ' diff-seg-on' : ''}`}
          title={m.title}
          onClick={() => setDiffMode(m.value)}
        >
          {m.icon}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  )
}

/** "Full file" toggle bound to settings.diffFullFile (works in both layouts). */
export function FullFileToggle({ value }: { value: boolean }) {
  return (
    <button
      type="button"
      className={`diff-toggle${value ? ' diff-toggle-on' : ''}`}
      aria-pressed={value}
      title={value ? 'Showing the whole file — click to show only the changes (F)' : 'Show the whole file (F)'}
      onClick={() => setFullFile(!value)}
    >
      {value ? <FoldVertical size={13} /> : <UnfoldVertical size={13} />}
      <span>Full file</span>
    </button>
  )
}

export interface DiffMoreMenuProps {
  ignoreWhitespace: boolean
  contextLines: number
  fullFile: boolean
  /** Repo-relative path of the file. */
  path: string
  repo: string
  /** False when the file does not exist in the working tree (deleted): no "Open in editor". */
  canOpen: boolean
}

/** The diff options that matter less often (whitespace, context, editor, copy path) behind a "⋯" button. */
export function diffMoreItems({ ignoreWhitespace, contextLines, fullFile, path, repo, canOpen }: DiffMoreMenuProps): MenuItem[] {
  return [
    {
      label: 'Ignore whitespace',
      icon: <Space size={14} />,
      checked: ignoreWhitespace,
      onClick: () => setIgnoreWhitespace(!ignoreWhitespace)
    },
    {
      label: fullFile ? 'Context lines (not used in full file)' : 'Context lines',
      icon: <ListOrdered size={14} />,
      disabled: fullFile,
      submenu: CONTEXT_CHOICES.map((n) => ({
        label: `${n} lines`,
        checked: contextLines === n,
        onClick: () => setContextLines(n)
      }))
    },
    { type: 'separator' },
    {
      label: 'Open in editor',
      icon: <ExternalLink size={14} />,
      disabled: !canOpen,
      onClick: () => git.openInEditor(git.absPath(repo, path))
    },
    { label: 'Copy file path', icon: <Copy size={14} />, onClick: () => git.copyText(path, 'Path copied') }
  ]
}

/** "⋯" button with a subtle dot while whitespace changes are hidden. */
export function DiffMoreButton(props: DiffMoreMenuProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const label = props.ignoreWhitespace ? 'More options · Whitespace changes hidden' : 'More options'
  return (
    <IconButton
      ref={ref}
      size="sm"
      label={label}
      className={`diff-more-btn${props.ignoreWhitespace ? ' diff-more-flag' : ''}`}
      aria-haspopup="menu"
      onClick={() => ref.current && showMenuBelow(ref.current, diffMoreItems(props))}
    >
      <Ellipsis size={17} strokeWidth={2.4} />
      {props.ignoreWhitespace && <span className="diff-more-dot" aria-hidden />}
    </IconButton>
  )
}

/** "+12 −3" change counter. */
export function ChangeStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="diff-stats">
      <span className="diff-stats-add">+{additions}</span>
      <span className="diff-stats-del">−{deletions}</span>
    </span>
  )
}
