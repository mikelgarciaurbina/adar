// Resolution UI for conflicts that cannot be merged line by line: binary
// files and delete/add conflicts. Explains what each side did and offers
// Keep A / Keep B / Delete (plus "Restore base" when both sides deleted it).

import { useMemo, useState, type ReactNode } from 'react'
import { Binary, FileCheck2, FileMinus, FilePlus, FileX, History, Trash2 } from 'lucide-react'
import { Spinner } from '@renderer/components/common/Button'
import type { ConflictResolution, ConflictVersions } from '@shared/types'
import { describeSide, sideExists, splitLines, stripEol, type Side } from './conflictParser'

const PREVIEW_LINES = 400

export interface ConflictChooserProps {
  versions: ConflictVersions
  oursLabel: string
  theirsLabel: string
  busy: boolean
  onResolve(resolution: ConflictResolution, label: string): void
}

interface Option {
  id: string
  resolution: ConflictResolution
  title: string
  description: string
  icon: ReactNode
  disabled?: string
  danger?: boolean
  recommended?: boolean
}

export function ConflictChooser({ versions, oursLabel, theirsLabel, busy, onResolve }: ConflictChooserProps) {
  const { kind, binary } = versions
  const oursExists = sideExists(kind, 'ours')
  const theirsExists = sideExists(kind, 'theirs')
  const [preview, setPreview] = useState<Side>(oursExists ? 'ours' : 'theirs')

  const options = useMemo<Option[]>(() => {
    const opts: Option[] = [
      {
        id: 'ours',
        resolution: { kind: 'ours' },
        title: `Keep A's version`,
        description: oursExists ? `Use the file as it is on ${oursLabel}.` : `${oursLabel} deleted this file — use "Delete file" to accept that.`,
        icon: <FileCheck2 size={18} />,
        disabled: oursExists ? undefined : `${oursLabel} does not have this file`
      },
      {
        id: 'theirs',
        resolution: { kind: 'theirs' },
        title: `Keep B's version`,
        description: theirsExists ? `Use the file as it is on ${theirsLabel}.` : `${theirsLabel} deleted this file — use "Delete file" to accept that.`,
        icon: <FileCheck2 size={18} />,
        disabled: theirsExists ? undefined : `${theirsLabel} does not have this file`
      },
      {
        id: 'delete',
        resolution: { kind: 'delete' },
        title: 'Delete file',
        description: 'Remove the file from the result.',
        icon: <Trash2 size={18} />,
        danger: oursExists || theirsExists,
        recommended: kind === 'both-deleted'
      }
    ]
    if (kind === 'both-deleted' && versions.base !== null && !binary) {
      opts.push({
        id: 'base',
        resolution: { kind: 'content', content: versions.base },
        title: 'Restore common ancestor',
        description: 'Keep the file with the content it had before both branches deleted it.',
        icon: <History size={18} />
      })
    }
    return opts
  }, [kind, binary, oursExists, theirsExists, oursLabel, theirsLabel, versions.base])

  const previewText = preview === 'ours' ? versions.ours : versions.theirs
  const previewLines = useMemo(() => (previewText != null ? splitLines(previewText) : []), [previewText])
  const canPreview = !binary && ((oursExists && versions.ours != null) || (theirsExists && versions.theirs != null))

  return (
    <div className="cf-chooser">
      <div className="cf-chooser-intro">
        {binary ? <Binary size={18} /> : <FileX size={18} />}
        <div>
          <div className="cf-chooser-title">
            {binary ? 'This binary file cannot be merged line by line.' : 'This conflict cannot be merged line by line.'}
          </div>
          <div className="cf-chooser-sub">Choose which version to keep. The file is staged as resolved.</div>
        </div>
      </div>

      <div className="cf-chooser-sides">
        <SideCard letter="A" side="ours" label={oursLabel} text={describeSide(kind, 'ours')} exists={oursExists} />
        <SideCard letter="B" side="theirs" label={theirsLabel} text={describeSide(kind, 'theirs')} exists={theirsExists} />
      </div>

      <div className="cf-chooser-options" role="group" aria-label="Resolution">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`cf-option${o.danger ? ' cf-option-danger' : ''}${o.recommended ? ' cf-option-recommended' : ''}`}
            disabled={!!o.disabled || busy}
            title={o.disabled}
            onClick={() => onResolve(o.resolution, o.title)}
          >
            <span className="cf-option-icon">{o.icon}</span>
            <span className="cf-option-body">
              <span className="cf-option-title">
                {o.title}
                {o.recommended && <span className="cf-option-tag">Recommended</span>}
              </span>
              <span className="cf-option-desc">{o.description}</span>
            </span>
          </button>
        ))}
        {busy && (
          <div className="cf-chooser-busy">
            <Spinner size="sm" /> Resolving…
          </div>
        )}
      </div>

      {canPreview && (
        <div className="cf-chooser-preview">
          <div className="cf-chooser-preview-tabs" role="tablist">
            {oursExists && versions.ours != null && (
              <button role="tab" aria-selected={preview === 'ours'} className={preview === 'ours' ? 'cf-active' : ''} onClick={() => setPreview('ours')}>
                A — {oursLabel}
              </button>
            )}
            {theirsExists && versions.theirs != null && (
              <button
                role="tab"
                aria-selected={preview === 'theirs'}
                className={preview === 'theirs' ? 'cf-active' : ''}
                onClick={() => setPreview('theirs')}
              >
                B — {theirsLabel}
              </button>
            )}
          </div>
          <pre className="cf-chooser-preview-body selectable">
            {previewLines.slice(0, PREVIEW_LINES).map((l, i) => (
              <div key={i} className="cf-preview-line">
                <span className="cf-gutter">{i + 1}</span>
                <span>{stripEol(l) || ' '}</span>
              </div>
            ))}
            {previewLines.length > PREVIEW_LINES && (
              <div className="cf-preview-more">… {previewLines.length - PREVIEW_LINES} more lines</div>
            )}
            {previewLines.length === 0 && <div className="cf-preview-more">Empty file</div>}
          </pre>
        </div>
      )}
    </div>
  )
}

function SideCard({ letter, side, label, text, exists }: { letter: string; side: Side; label: string; text: string; exists: boolean }) {
  const icon = exists ? (text.startsWith('added') ? <FilePlus size={15} /> : <FileCheck2 size={15} />) : <FileMinus size={15} />
  return (
    <div className={`cf-side-card cf-side-card-${side}${exists ? '' : ' cf-side-card-missing'}`}>
      <span className="cf-pane-letter">{letter}</span>
      <div className="cf-side-card-body">
        <div className="cf-side-card-label" title={label}>
          {label}
        </div>
        <div className="cf-side-card-text">
          {icon}
          {text}
        </div>
      </div>
    </div>
  )
}
