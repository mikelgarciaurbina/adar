// Picks the right presentation for a loaded FileDiff: text renderer, image
// comparison, or a placeholder (binary, too large, no content changes).

import type { MutableRefObject } from 'react'
import { Binary, FileText, FileWarning } from 'lucide-react'
import { Button, EmptyState } from '@renderer/components/common/Button'
import type { DiffTarget, DiffViewMode, FileDiff } from '@shared/types'
import { DiffRenderer, type ChangeNav, type DiffRendererHandle, type DiffStaging } from './DiffRenderer'
import { ImageDiff } from './ImageDiff'
import { modeChangeText } from './targets'

export interface DiffBodyProps {
  repo: string
  diff: FileDiff
  target: DiffTarget
  mode: DiffViewMode
  /** `diff` was requested with the whole file as context. */
  fullFile?: boolean
  staging?: DiffStaging | null
  handle?: MutableRefObject<DiffRendererHandle | null>
  resetKey?: string | number
  autoFocus?: boolean
  ignoreWhitespace?: boolean
  onOpenInEditor?: () => void
  /** Leave full-file mode (offered when the whole file is too large to show). */
  onShowChangesOnly?: () => void
  /** Position among the change blocks (text diffs only). */
  onChangeNav?: (nav: ChangeNav | null) => void
}

export function DiffBody(props: DiffBodyProps) {
  const { repo, diff, target, mode, fullFile, staging, handle, resetKey, autoFocus, ignoreWhitespace, onOpenInEditor, onShowChangesOnly, onChangeNav } =
    props

  if (diff.tooLarge) {
    return (
      <EmptyState icon={<FileWarning size={36} />} title={fullFile ? 'This file is too large to show in full' : 'This diff is too large to display'}>
        <p className="diff-empty-text">
          {fullFile ? 'Showing only the changed parts may still work.' : 'Rendering it would slow the app down.'}
        </p>
        <div className="diff-empty-actions">
          {fullFile && onShowChangesOnly && (
            <Button size="sm" variant="primary" onClick={onShowChangesOnly}>
              Show changes only
            </Button>
          )}
          {onOpenInEditor && (
            <Button size="sm" onClick={onOpenInEditor}>
              Open in editor
            </Button>
          )}
        </div>
      </EmptyState>
    )
  }
  if (diff.isImage) return <ImageDiff repo={repo} diff={diff} target={target} />
  if (diff.binary) {
    return (
      <EmptyState icon={<Binary size={36} />} title="Binary file">
        {diff.status === 'added' || diff.status === 'untracked'
          ? 'A binary file was added.'
          : diff.status === 'deleted'
            ? 'A binary file was deleted.'
            : 'The binary content changed and cannot be shown as text.'}
      </EmptyState>
    )
  }
  if (!diff.hunks.length) {
    const modeText = modeChangeText(diff)
    return (
      <EmptyState icon={<FileText size={36} />} title="No content changes">
        {modeText ??
          (diff.status === 'renamed' && diff.oldPath
            ? `Renamed from ${diff.oldPath} without changing its content.`
            : diff.status === 'added' || diff.status === 'untracked'
              ? 'The file is empty.'
              : ignoreWhitespace
                ? 'Only whitespace changed (whitespace is being ignored).'
                : 'The contents of this file are identical.')}
      </EmptyState>
    )
  }
  return (
    <DiffRenderer
      diff={diff}
      mode={mode}
      fullFile={!!fullFile}
      path={diff.path || target.path}
      staging={staging}
      handle={handle}
      resetKey={resetKey}
      autoFocus={autoFocus}
      onChangeNav={onChangeNav}
    />
  )
}
