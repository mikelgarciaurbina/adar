// Row rendering for the left panel tree (memoised; one component per row kind)
// plus the loading skeleton. Behaviour lives in LeftPanel via RowHandlers.

import { memo, type ReactNode } from 'react'
import { Archive, Box, BrushCleaning, Check, ChevronRight, Cloud, Crosshair, ExternalLink, Eye, EyeOff, Folder, FolderGit2, FolderOpen, GitBranch, GitMerge, GitPullRequest, Lock, Plus, RefreshCw, Tag, Trash2, TriangleAlert } from 'lucide-react'
import { ChecksGlyph, PullStateIcon } from '@renderer/components/pulls/PullChip'
import { pullTitle } from '@renderer/lib/pulls'
import { laneColor } from '@renderer/lib/colors'
import { relativeTime, shortSha } from '@renderer/lib/format'
import { localForRemote } from '@renderer/lib/refs'
import type { Ref, RefsResult } from '@shared/types'
import { remoteWebUrl } from '@shared/remoteUrl'
import { splitMatch, type Row, type SectionId } from './tree'
import { pullRef } from '@renderer/lib/pulls'

export type HiddenState = 'none' | 'some' | 'all'

// ── Tooltips ───────────────────────────────────────────────────────────────

export function aheadBehindText(b: Ref): string {
  const parts: string[] = []
  if (b.ahead) parts.push(`${b.ahead} ahead`)
  if (b.behind) parts.push(`${b.behind} behind`)
  return parts.length ? parts.join(', ') : 'up to date'
}

function localTitle(b: Ref): string {
  const lines = [b.name]
  if (b.isHead) lines.push('Checked out')
  if (b.worktree) lines.push(`Checked out in the worktree ${b.worktree}`)
  if (b.upstream) lines.push(b.upstreamGone ? `Upstream ${b.upstream} no longer exists` : `Tracking ${b.upstream} · ${aheadBehindText(b)}`)
  else lines.push('No upstream branch')
  lines.push(shortSha(b.sha))
  return lines.join('\n')
}

function remoteTitle(r: Ref, refs: RefsResult | null): string {
  const local = localForRemote(refs, r)
  return [r.name, local ? `Tracked by ${local.name}` : 'Not checked out locally', shortSha(r.sha)].join('\n')
}

function tagTitle(t: Ref): string {
  const lines = [t.name, t.annotated ? 'Annotated tag' : 'Lightweight tag']
  if (t.tagMessage) lines.push(t.tagMessage)
  lines.push(shortSha(t.sha))
  return lines.join('\n')
}

// ── Rows ───────────────────────────────────────────────────────────────────

export interface RowHandlers {
  click(row: Row, e: React.MouseEvent): void
  doubleClick(row: Row): void
  contextMenu(row: Row, e: React.MouseEvent): void
  toggleHidden(row: Row): void
  unsolo(row: Row): void
  fetch(remote: string): void
  add(section: SectionId): void
  /** The Local section's clean-up count was clicked. */
  cleanUp(): void
  /** A worktree row's button: open it, finish it after its merge, or forget the missing ones. */
  worktreeAction(row: Row, action: 'open' | 'finish' | 'forget'): void
  dragStart(row: Row, e: React.DragEvent): void
  dragEnd(): void
  dragOver(row: Row, e: React.DragEvent): void
  dragLeave(row: Row, e: React.DragEvent<HTMLElement>): void
  drop(row: Row, e: React.DragEvent): void
}

export interface RowViewProps {
  row: Row
  index: number
  top: number
  height: number
  sticky: boolean
  menuOpen: boolean
  selected: boolean
  cursor: boolean
  drop: boolean
  dragging: boolean
  pending: boolean
  hidden: HiddenState
  solo: boolean
  busy: boolean
  addDisabled: boolean
  /** Local section: branches that can be cleaned up without losing anything (after a fetch). */
  cleanup?: number
  refs: RefsResult
  /** Branches: colour index of the graph lane their tip is drawn in (none when the tip is not in the graph). */
  lane?: number
  q: string
  h: RowHandlers
}

/** "github.com" for a remote's web URL. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation()
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const parts = splitMatch(text, q)
  if (parts.length === 1 && !parts[0].match) return <>{text}</>
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="sb-match">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span className={`sb-chevron${expanded ? ' sb-open' : ''}`} aria-hidden>
      <ChevronRight size={12} />
    </span>
  )
}

function ActionButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`sb-act${active ? ' sb-act-on' : ''}`}
      title={label}
      aria-label={label}
      tabIndex={-1}
      onMouseDown={keepFocus}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

function EyeToggle({ state, onToggle, what }: { state: HiddenState; onToggle: () => void; what: string }) {
  const all = state === 'all'
  return (
    <ActionButton label={all ? `Show ${what} in graph` : `Hide ${what} in graph`} onClick={onToggle} active={all}>
      {all ? <EyeOff size={12} /> : <Eye size={12} className={state === 'some' ? 'sb-eye-some' : undefined} />}
    </ActionButton>
  )
}

export const RowView = memo(function RowView(props: RowViewProps) {
  const { row, h, q } = props
  const indent = 4 + row.depth * 12
  const classes = ['sb-row', `sb-${row.kind}`]
  if (props.sticky) classes.push('sb-sticky')
  if (props.selected) classes.push('sb-selected')
  if (props.cursor) classes.push('sb-cursor')
  if (props.drop) classes.push('sb-drop')
  if (props.dragging) classes.push('sb-dragging')
  if (props.hidden === 'all') classes.push('sb-hidden')
  if (props.solo) classes.push('sb-is-solo')
  if (props.menuOpen) classes.push('sb-menu-open')

  const style: React.CSSProperties = props.sticky
    ? { height: props.height, paddingLeft: indent }
    : { height: props.height, paddingLeft: indent, transform: `translateY(${props.top}px)` }

  const common = {
    'data-index': props.index,
    style,
    role: 'treeitem' as const,
    'aria-level': row.depth + 1,
    'aria-selected': props.selected,
    onClick: (e: React.MouseEvent) => h.click(row, e),
    onDoubleClick: () => h.doubleClick(row),
    onContextMenu: (e: React.MouseEvent) => h.contextMenu(row, e)
  }

  switch (row.kind) {
    case 'section': {
      const canAdd = row.id === 'local' || row.id === 'remote' || row.id === 'tags' || row.id === 'pulls' || row.id === 'worktrees'
      const addLabel = row.id === 'local' ? 'Create branch' : row.id === 'worktrees' ? 'New worktree' : row.id === 'remote' ? 'Add remote' : row.id === 'pulls' ? `Create ${row.title.slice(0, -1).toLowerCase()}` : 'Create tag at HEAD'
      return (
        <div {...common} className={classes.join(' ')} aria-expanded={row.expanded}>
          <Chevron expanded={row.expanded} />
          <span className="sb-section-title">{row.title}</span>
          <span className="sb-spacer" />
          <span className="sb-actions">
            {canAdd && !props.addDisabled && (
              <ActionButton label={addLabel} onClick={() => h.add(row.id)}>
                <Plus size={13} />
              </ActionButton>
            )}
            {row.id === 'submodules' && !props.busy && (
              <ActionButton label="Update submodules" onClick={() => h.add(row.id)}>
                <RefreshCw size={12} />
              </ActionButton>
            )}
          </span>
          {props.busy && <span className="ui-spinner ui-spinner-sm sb-busy" />}
          {row.id === 'local' && !!props.cleanup && (
            <button
              type="button"
              className="sb-cleanup"
              title={`${props.cleanup === 1 ? '1 branch is' : `${props.cleanup} branches are`} already in the main branch · Clean up…`}
              aria-label="Clean up branches"
              onClick={(e) => {
                e.stopPropagation()
                h.cleanUp()
              }}
            >
              <BrushCleaning size={11} />
              {props.cleanup}
            </button>
          )}
          {!(row.id === 'pulls' && props.addDisabled) && <span className="sb-count">{row.count}</span>}
        </div>
      )
    }

    case 'folder':
      return (
        <div {...common} className={classes.join(' ')} aria-expanded={row.expanded} title={row.node.path}>
          <Chevron expanded={row.expanded} />
          <span className="sb-icon sb-icon-folder">{row.expanded ? <FolderOpen size={14} /> : <Folder size={14} />}</span>
          <span className="sb-name">
            <Highlight text={row.node.label} q={q} />
          </span>
          <span className="sb-spacer" />
          <span className={`sb-actions${props.hidden === 'all' ? ' sb-actions-pinned' : ''}`}>
            <EyeToggle state={props.hidden} onToggle={() => h.toggleHidden(row)} what={`all in ${row.node.label}`} />
          </span>
        </div>
      )

    case 'remote': {
      const node = row.node
      const web = node.url ? remoteWebUrl(node.url) : null
      const host = web ? hostOf(web) : null
      return (
        <div {...common} className={classes.join(' ')} aria-expanded={row.expanded} title={node.url ? `${node.name}\n${node.url}` : node.name}>
          <Chevron expanded={row.expanded} />
          <span className="sb-icon sb-icon-remote" aria-hidden>
            <Cloud size={14} />
          </span>
          <span className="sb-name">
            <Highlight text={node.label} q={q} />
          </span>
          <span className="sb-spacer" />
          {host && <span className="sb-host">{host}</span>}
          <span className={`sb-actions${props.hidden === 'all' ? ' sb-actions-pinned' : ''}`}>
            {!props.busy && (
              <ActionButton label={`Fetch ${node.name}`} onClick={() => h.fetch(node.name)}>
                <RefreshCw size={12} />
              </ActionButton>
            )}
            {node.leafCount > 0 && <EyeToggle state={props.hidden} onToggle={() => h.toggleHidden(row)} what={`all ${node.name} branches`} />}
          </span>
          {props.busy && <span className="ui-spinner ui-spinner-sm sb-busy" title={`Fetching ${node.name}…`} />}
          <span className="sb-count sb-count-dim">{row.count}</span>
        </div>
      )
    }

    case 'ref': {
      const ref = row.node.ref
      const isLocal = ref.type === 'branch'
      const isHead = isLocal && !!ref.isHead
      if (isHead) classes.push('sb-head')
      const title = isLocal ? localTitle(ref) : ref.type === 'remote' ? remoteTitle(ref, props.refs) : tagTitle(ref)
      const ahead = isLocal && !ref.upstreamGone ? (ref.ahead ?? 0) : 0
      const behind = isLocal && !ref.upstreamGone ? (ref.behind ?? 0) : 0
      // Branches show a dot in their lane's colour (filled for the checked-out one), tags a tag.
      const icon = props.pending ? (
        <span className="ui-spinner ui-spinner-sm" />
      ) : ref.type === 'tag' ? (
        <Tag size={13} />
      ) : (
        <span
          className={`sb-lane${isHead ? ' sb-lane-head' : ''}${props.lane === undefined ? ' sb-lane-none' : ''}`}
          style={props.lane === undefined ? undefined : ({ '--sb-lane': laneColor(props.lane) } as React.CSSProperties)}
          aria-hidden
        />
      )
      return (
        <div
          {...common}
          className={classes.join(' ')}
          draggable
          onDragStart={(e) => h.dragStart(row, e)}
          onDragEnd={() => h.dragEnd()}
          onDragOver={(e) => h.dragOver(row, e)}
          onDragLeave={(e) => h.dragLeave(row, e)}
          onDrop={(e) => h.drop(row, e)}
        >
          <span className="sb-chevron-space" />
          <span className={`sb-icon sb-icon-${isHead ? 'head' : ref.type}`}>{icon}</span>
          <span className="sb-name" title={title}>
            <Highlight text={row.node.label} q={q} />
          </span>
          <span className="sb-spacer" />
          {(ahead > 0 || behind > 0) && (
            <span className="sb-ab" title={`${aheadBehindText(ref)} vs ${ref.upstream}`}>
              {ahead > 0 && <span>↑{ahead}</span>}
              {behind > 0 && <span>↓{behind}</span>}
            </span>
          )}
          {isLocal && ref.worktree && (
            <span className="sb-worktree-mark" title={`Checked out in the worktree ${ref.worktree}`}>
              <FolderGit2 size={12} />
            </span>
          )}
          {isLocal && ref.upstreamGone && (
            <span className="sb-warn" title={`Upstream ${ref.upstream ?? ''} no longer exists on the remote`}>
              <TriangleAlert size={12} />
            </span>
          )}
          {props.solo && (
            <ActionButton label="Un-solo" onClick={() => h.unsolo(row)} active>
              <Crosshair size={12} />
            </ActionButton>
          )}
          <span className={`sb-actions${props.hidden === 'all' ? ' sb-actions-pinned' : ''}`}>
            <EyeToggle state={props.hidden} onToggle={() => h.toggleHidden(row)} what={ref.name} />
          </span>
        </div>
      )
    }

    case 'head':
      return (
        <div {...common} className={classes.join(' ')} title={row.node.sha ? `Detached HEAD at ${row.node.sha}` : row.node.label}>
          <span className="sb-chevron-space" />
          <span className="sb-icon sb-icon-head">
            <Check size={14} strokeWidth={3} />
          </span>
          <span className="sb-name sb-name-em">
            <Highlight text={row.node.label} q={q} />
          </span>
        </div>
      )

    case 'stash': {
      const s = row.node.stash
      return (
        <div {...common} className={classes.join(' ')}>
          <span className="sb-chevron-space" />
          <span className="sb-icon sb-icon-stash">
            <Archive size={13} />
          </span>
          <span className="sb-name" title={`${s.ref}${s.date ? ` · ${relativeTime(s.date)}` : ''}\n${s.message}`}>
            <Highlight text={row.node.label} q={q} />
          </span>
        </div>
      )
    }

    case 'submodule': {
      const sm = row.node.submodule
      const statusLabel =
        sm.status === 'uninitialized' ? 'Not initialized' : sm.status === 'modified' ? 'Checked out at a different commit' : sm.status === 'conflict' ? 'Merge conflict' : 'Up to date'
      return (
        <div {...common} className={`${classes.join(' ')}${sm.status === 'uninitialized' ? ' sb-uninit' : ''}`}>
          <span className="sb-chevron-space" />
          <span className="sb-icon sb-icon-submodule">
            <Box size={13} />
          </span>
          <span className="sb-name" title={`${sm.path}\n${sm.url}\n${statusLabel}${sm.sha ? ` · ${shortSha(sm.sha)}` : ''}`}>
            <Highlight text={row.node.label} q={q} />
          </span>
          <span className="sb-spacer" />
          {sm.status !== 'initialized' && <span className={`sb-dot sb-dot-${sm.status}`} title={statusLabel} />}
        </div>
      )
    }

    case 'pull': {
      const pr = row.node.pull
      return (
        <div {...common} className={`${classes.join(' ')} sb-pull-${pr.state}`} title={pullTitle(pr)}>
          <span className="sb-chevron-space" />
          <span className="sb-icon sb-icon-pull">{props.pending ? <span className="ui-spinner ui-spinner-sm" /> : <PullStateIcon state={pr.state} size={13} />}</span>
          <span className="sb-name">
            <Highlight text={row.node.label} q={q} />
          </span>
          <span className="sb-spacer" />
          {pr.reviewRequested && <span className="sb-review">Review</span>}
          <ChecksGlyph pr={pr} />
          <span className="sb-count sb-count-dim">{pr.number}</span>
        </div>
      )
    }

    case 'worktree': {
      const wt = row.node.worktree
      const merged = row.node.merged
      if (wt.isCurrent) classes.push('sb-worktree-current')
      if (wt.missing) classes.push('sb-worktree-missing')
      const title = [wt.path, wt.branch ? `Branch ${wt.branch}` : 'Detached HEAD', wt.isMain ? 'The main folder' : null, wt.locked ? 'Locked' : null]
        .filter(Boolean)
        .join('\n')
      return (
        <div {...common} className={classes.join(' ')} title={title}>
          <span className="sb-chevron-space" />
          <span className="sb-icon sb-icon-worktree">{props.pending ? <span className="ui-spinner ui-spinner-sm" /> : <FolderGit2 size={13} />}</span>
          <span className="sb-name sb-worktree-name">
            <Highlight text={row.node.label} q={q} />
          </span>
          {merged ? (
            <span className="sb-worktree-merged" title={`${pullRef(merged)} ${merged.title} was merged: the worktree can go`}>
              <GitMerge size={10} />
              merged
            </span>
          ) : (
            wt.branch && (
              <span className="sb-worktree-branch">
                <GitBranch size={10} />
                {wt.branch}
              </span>
            )
          )}
          <span className="sb-spacer" />
          {wt.locked && (
            <span className="sb-worktree-note" title="Locked: git keeps it even when its folder is away">
              <Lock size={11} />
            </span>
          )}
          {wt.missing ? (
            <>
              <span className="sb-worktree-gone">folder missing</span>
              <ActionButton label="Forget missing worktrees" onClick={() => h.worktreeAction(row, 'forget')}>
                <Trash2 size={12} />
              </ActionButton>
            </>
          ) : wt.isCurrent ? (
            <span className="sb-worktree-note">this tab</span>
          ) : (
            <>
              {!!wt.changes && (
                <span className="sb-worktree-dirty" title={`${wt.changes} ${wt.changes === 1 ? 'file has' : 'files have'} changes`}>
                  ● {wt.changes}
                </span>
              )}
              {merged ? (
                <button type="button" className="sb-worktree-remove" onClick={(e) => (e.stopPropagation(), h.worktreeAction(row, 'finish'))}>
                  Remove
                </button>
              ) : (
                <ActionButton label="Open in a new tab" onClick={() => h.worktreeAction(row, 'open')}>
                  <ExternalLink size={12} />
                </ActionButton>
              )}
            </>
          )}
        </div>
      )
    }

    case 'pull-prompt':
      return (
        <div {...common} className={classes.join(' ')}>
          <span className="sb-chevron-space" />
          <span className="sb-icon sb-icon-pull">
            <GitPullRequest size={13} />
          </span>
          <span className="sb-name sb-pull-prompt-text">{row.node.label}</span>
        </div>
      )

    case 'hint':
      return (
        <div data-index={props.index} style={style} className="sb-row sb-hint" role="presentation">
          <span className="sb-chevron-space" />
          <span className="sb-hint-text">{row.text}</span>
        </div>
      )
  }
})

// ── Loading skeleton ───────────────────────────────────────────────────────

const SKELETON: Array<[number, number]> = [
  [0, 46],
  [1, 62],
  [1, 48],
  [1, 70],
  [0, 54],
  [1, 40],
  [2, 66],
  [2, 52],
  [0, 38],
  [1, 58],
  [0, 50]
]

export function Skeleton() {
  return (
    <div className="sb-skeleton" aria-busy="true" aria-label="Loading branches">
      {SKELETON.map(([depth, width], i) => (
        <div key={i} className={`sb-skel-row${depth === 0 ? ' sb-skel-section' : ''}`} style={{ paddingLeft: 8 + depth * 12 }}>
          {depth > 0 && <span className="sb-skel-icon" />}
          <span className="sb-skel-bar" style={{ width: `${width}%`, animationDelay: `${i * 60}ms` }} />
        </div>
      ))}
    </div>
  )
}
