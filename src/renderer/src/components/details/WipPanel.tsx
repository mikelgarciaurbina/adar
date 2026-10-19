// Staging area (GitKraken "WIP" panel): conflicted / unstaged / staged file
// sections with hover Stage/Unstage buttons, multi-select (Cmd/Shift click,
// Shift+Arrows, Cmd+A) with Enter/Space to stage or unstage, context menus,
// and the commit composer pinned at the bottom.

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, ChevronDown, ChevronRight, CircleCheck, FilePen, Minus, Plus, Trash, TriangleAlert, Undo2 } from 'lucide-react'
import * as actions from '@renderer/actions/git'
import { EmptyState, IconButton } from '@renderer/components/common/Button'
import { showContextMenu } from '@renderer/components/common/ContextMenu'
import { markResolvedAndAdvance } from '@renderer/components/conflicts/resolveFlow'
import { isMod } from '@renderer/lib/keys'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { ConflictFile, ConflictKind, DiffTarget, FileChange, WorkingStatus } from '@shared/types'
import { CommitComposer } from './CommitComposer'
import { FileList, type MenuAnchor } from './FileList'
import { displayOrder, filesUnder, type FileViewMode } from './fileTree'
import { conflictMenu, wipDirMenu, wipFileMenu } from './menus'
import { LoadingBlock, ViewModeToggle } from './parts'
import { applyClick, EMPTY_SELECTION, pruneSelection, selectAll, targetsOf, type PathSelection } from './selection'
import { uniquePathCount, withRenameSources } from './targets'
import { useFileViewMode } from './viewMode'

type WipKind = 'unstaged' | 'staged'

const CONFLICT_LABEL: Record<ConflictKind, string> = {
  'both-modified': 'both modified',
  'both-added': 'both added',
  'both-deleted': 'both deleted',
  'added-by-us': 'added by us',
  'added-by-them': 'added by them',
  'deleted-by-us': 'deleted by us',
  'deleted-by-them': 'deleted by them'
}

/** True when the working tree has anything to show in the staging area. */
export function hasWorkingChanges(status: WorkingStatus | null): boolean {
  return !!status && (status.staged.length > 0 || status.unstaged.length > 0 || status.conflicted.length > 0)
}

function getTab(repo: string): RepoTab | undefined {
  return useApp.getState().tabs.find((t) => t.path === repo)
}

/**
 * After staging/unstaging the file whose diff is open, show the diff of its new
 * location (unstaged → staged or back). The staging actions resolve once the
 * status has been refreshed, so the store already holds the new lists.
 */
function followDiff(repo: string, from: WipKind, paths: string[]): void {
  const t = getTab(repo)
  const st = t?.status
  const c = t?.center
  if (!st || c?.kind !== 'diff' || c.target.kind !== from || !paths.includes(c.target.path)) return
  const path = c.target.path
  const fromList = from === 'unstaged' ? st.unstaged : st.staged
  if (fromList.some((f) => f.path === path)) return // still (partially) there
  const to: WipKind = from === 'unstaged' ? 'staged' : 'unstaged'
  const toList = to === 'staged' ? st.staged : st.unstaged
  if (!toList.some((f) => f.path === path)) return
  const mode = useFileViewMode.getState().mode
  const siblings: DiffTarget[] = displayOrder(toList, mode).map((f) => ({ kind: to, path: f.path }))
  actions.openDiff(repo, { kind: to, path }, siblings)
}

/** Selection updates are functional so several clicks handled before a re-render compose correctly. */
export type SelectionUpdate = (sel: PathSelection) => PathSelection

export function WipPanel({ tab }: { tab: RepoTab }) {
  const repo = tab.path
  const status = tab.status
  const mode = useFileViewMode((s) => s.mode)
  const [selection, setSelection] = useState<{ kind: WipKind; sel: PathSelection }>({ kind: 'unstaged', sel: EMPTY_SELECTION })
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState<Record<'conflicted' | WipKind, boolean>>({ conflicted: false, unstaged: false, staged: false })

  const { conflicted, unstaged, staged } = useMemo(() => {
    if (!status) return { conflicted: [] as ConflictFile[], unstaged: [] as FileChange[], staged: [] as FileChange[] }
    const conflictPaths = new Set(status.conflicted.map((c) => c.path))
    return {
      conflicted: status.conflicted,
      unstaged: status.unstaged.filter((f) => !conflictPaths.has(f.path)),
      staged: status.staged.filter((f) => !conflictPaths.has(f.path))
    }
  }, [status])

  const conflictFiles = useMemo<FileChange[]>(() => conflicted.map((c) => ({ path: c.path, status: 'conflicted' })), [conflicted])
  const conflictKinds = useMemo(() => new Map(conflicted.map((c) => [c.path, c.kind])), [conflicted])

  const runOp = useCallback(
    async (kind: WipKind, paths: string[]) => {
      if (!paths.length) return
      setPending((prev) => new Set([...prev, ...paths]))
      const st = getTab(repo)?.status
      // A rename is two index entries: move both sides, or half of it stays behind.
      const withOld = withRenameSources(paths, (kind === 'unstaged' ? st?.unstaged : st?.staged) ?? [])
      let ok = false
      try {
        // Both actions resolve after the status refresh, so the rows have moved by now.
        ok = kind === 'unstaged' ? await actions.stageFiles(repo, withOld) : await actions.unstageFiles(repo, withOld)
      } finally {
        setPending((prev) => {
          const next = new Set(prev)
          for (const p of paths) next.delete(p)
          return next
        })
      }
      if (ok) followDiff(repo, kind, paths)
    },
    [repo]
  )
  const stage = useCallback((paths: string[]) => void runOp('unstaged', paths), [runOp])
  const unstage = useCallback((paths: string[]) => void runOp('staged', paths), [runOp])

  const stageAll = useCallback(async () => {
    const paths = (getTab(repo)?.status?.unstaged ?? []).map((f) => f.path)
    if (await actions.stageAll(repo)) followDiff(repo, 'unstaged', paths)
  }, [repo])
  const unstageAll = useCallback(async () => {
    const paths = (getTab(repo)?.status?.staged ?? []).map((f) => f.path)
    if (await actions.unstageAll(repo)) followDiff(repo, 'staged', paths)
  }, [repo])

  const onSelUnstaged = useCallback(
    (update: SelectionUpdate) => setSelection((prev) => ({ kind: 'unstaged', sel: update(prev.kind === 'unstaged' ? prev.sel : EMPTY_SELECTION) })),
    []
  )
  const onSelStaged = useCallback(
    (update: SelectionUpdate) => setSelection((prev) => ({ kind: 'staged', sel: update(prev.kind === 'staged' ? prev.sel : EMPTY_SELECTION) })),
    []
  )
  const toggleUnstaged = useCallback(() => setCollapsed((c) => ({ ...c, unstaged: !c.unstaged })), [])
  const toggleStaged = useCallback(() => setCollapsed((c) => ({ ...c, staged: !c.staged })), [])

  if (tab.info?.isBare) {
    return (
      <div className="det-panel">
        <EmptyState icon={<FilePen size={28} />} title="Bare repository">
          Bare repositories have no working tree to stage or commit from.
        </EmptyState>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="det-panel">
        <div className="ui-panel-header det-header">
          <FilePen size={14} className="det-header-icon" />
          <span className="det-header-title">Working directory</span>
        </div>
        <LoadingBlock label="Reading working tree…" />
      </div>
    )
  }

  const total = uniquePathCount(unstaged, staged, conflicted)
  const head = tab.info?.head
  const branch = status.branch ?? head?.branch ?? null
  const detached = !branch && (head?.detached ?? true)
  const center = tab.center

  return (
    <div className="det-panel det-wip">
      <div className="ui-panel-header det-header">
        <FilePen size={14} className="det-header-icon" />
        <span className="det-header-title">
          {total} file change{total === 1 ? '' : 's'} on{' '}
          {detached ? <span className="det-branch det-branch-detached">detached HEAD</span> : <span className="det-branch">{branch}</span>}
        </span>
      </div>

      <div className="det-toolbar">
        <ViewModeToggle />
        <span className="det-spacer" />
        <IconButton size="sm" label="Stash all changes" disabled={total === 0} onClick={() => void actions.stash(repo)}>
          <Archive size={14} />
        </IconButton>
        <IconButton size="sm" label="Discard all unstaged changes" className="det-icon-danger" disabled={unstaged.length === 0} onClick={() => void actions.discardAll(repo)}>
          <Trash size={14} />
        </IconButton>
      </div>

      <div className="det-sections">
        {conflicted.length > 0 && (
          <Section
            id="conflicted"
            title="Conflicted Files"
            count={conflicted.length}
            tone="conflict"
            collapsed={collapsed.conflicted}
            onToggle={() => setCollapsed((c) => ({ ...c, conflicted: !c.conflicted }))}
          >
            <FileList
              files={conflictFiles}
              mode={mode}
              ariaLabel="Conflicted files"
              activePath={center.kind === 'conflict' ? center.path : null}
              renderMeta={(f) => <span className="det-conflict-kind">{CONFLICT_LABEL[conflictKinds.get(f.path) ?? 'both-modified']}</span>}
              renderActions={(f) => (
                <>
                  <button
                    type="button"
                    className="det-row-icon-btn det-row-resolved"
                    title="Mark as resolved (stage the file as it is)"
                    aria-label={`Mark ${f.path} as resolved`}
                    onClick={() => void markResolvedAndAdvance(repo, f.path)}
                  >
                    <CircleCheck size={14} />
                  </button>
                  <button type="button" className="det-row-btn det-row-btn-conflict" onClick={() => actions.openConflict(repo, f.path)}>
                    Resolve
                  </button>
                </>
              )}
              onRowClick={(f) => actions.openConflict(repo, f.path)}
              onActivate={(f) => actions.openConflict(repo, f.path)}
              onRowContextMenu={(f, e) => showContextMenu(e, conflictMenu(repo, f.path))}
            />
          </Section>
        )}

        <WipSection
          repo={repo}
          kind="unstaged"
          files={unstaged}
          mode={mode}
          activePath={center.kind === 'diff' && center.target.kind === 'unstaged' ? center.target.path : null}
          selection={selection.kind === 'unstaged' ? selection.sel : EMPTY_SELECTION}
          onSelection={onSelUnstaged}
          pending={pending}
          collapsed={collapsed.unstaged}
          onToggleCollapsed={toggleUnstaged}
          stage={stage}
          unstage={unstage}
          stageAll={stageAll}
          unstageAll={unstageAll}
        />
        <WipSection
          repo={repo}
          kind="staged"
          files={staged}
          mode={mode}
          activePath={center.kind === 'diff' && center.target.kind === 'staged' ? center.target.path : null}
          selection={selection.kind === 'staged' ? selection.sel : EMPTY_SELECTION}
          onSelection={onSelStaged}
          pending={pending}
          collapsed={collapsed.staged}
          onToggleCollapsed={toggleStaged}
          stage={stage}
          unstage={unstage}
          stageAll={stageAll}
          unstageAll={unstageAll}
        />

        {total === 0 && (
          <div className="det-clean">
            <CircleCheck size={22} />
            <div className="det-clean-title">No changes</div>
            <div className="det-clean-body">Your working tree is clean.</div>
          </div>
        )}
      </div>

      <CommitComposer tab={tab} staged={staged.length} unstaged={unstaged.length} conflicted={conflicted.length} />
    </div>
  )
}

function Section({
  id,
  title,
  count,
  tone,
  collapsed,
  onToggle,
  action,
  children
}: {
  id: string
  title: string
  count: number
  tone?: 'conflict'
  collapsed: boolean
  onToggle: () => void
  action?: ReactNode
  children?: ReactNode
}) {
  const hasBody = count > 0 && !collapsed
  return (
    <section className={`det-section${hasBody ? ' det-section-open' : ''}${tone === 'conflict' ? ' det-section-conflict' : ''}`} aria-labelledby={`det-sec-${id}`}>
      <div className="det-section-head">
        <button type="button" className="det-section-toggle" aria-expanded={!collapsed} onClick={onToggle} id={`det-sec-${id}`}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          {tone === 'conflict' && <TriangleAlert size={12} className="det-conflict-icon" />}
          <span className="det-section-title">{title}</span>
          <span className="det-section-count">({count})</span>
        </button>
        <span className="det-spacer" />
        {action}
      </div>
      {hasBody && <div className="det-section-body">{children}</div>}
    </section>
  )
}

interface WipSectionProps {
  repo: string
  kind: WipKind
  files: FileChange[]
  mode: FileViewMode
  activePath: string | null
  selection: PathSelection
  onSelection: (update: SelectionUpdate) => void
  pending: ReadonlySet<string>
  collapsed: boolean
  onToggleCollapsed: () => void
  stage: (paths: string[]) => void
  unstage: (paths: string[]) => void
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
}

/** Memoised so typing in the commit composer does not re-render the file lists. */
const WipSection = memo(function WipSection(props: WipSectionProps) {
  const { repo, kind, files, mode, activePath, selection, onSelection, pending, collapsed, onToggleCollapsed, stage, unstage } = props
  const isUnstaged = kind === 'unstaged'
  const order = useMemo(() => displayOrder(files, mode).map((f) => f.path), [files, mode])
  const existing = useMemo(() => new Set(order), [order])
  const sel = useMemo(() => pruneSelection(selection, existing), [selection, existing])
  // Forget files that left the list so they are not re-selected when they come back.
  useEffect(() => {
    if (sel !== selection) onSelection((cur) => pruneSelection(cur, existing))
  }, [sel, selection, existing, onSelection])
  const selectedSet = useMemo(() => new Set(sel.paths), [sel])
  const siblings = useMemo<DiffTarget[]>(() => order.map((path) => ({ kind, path })), [order, kind])

  const open = (f: FileChange) => actions.openDiff(repo, { kind, path: f.path }, siblings)
  const apply = (paths: string[]) => (isUnstaged ? stage(paths) : unstage(paths))

  const onRowClick = (f: FileChange, e: React.MouseEvent) => {
    const toggle = isMod(e)
    const range = e.shiftKey
    onSelection((cur) => applyClick(order, pruneSelection(cur, existing), f.path, { toggle, range }))
    if (!toggle && !range) open(f)
  }

  const onFocusFile = (f: FileChange, e: React.KeyboardEvent) => {
    if (e.shiftKey) {
      onSelection((cur) => {
        const c = pruneSelection(cur, existing)
        return applyClick(order, c.anchor ? c : { paths: [], anchor: f.path }, f.path, { range: true })
      })
      return
    }
    onSelection(() => ({ paths: [f.path], anchor: f.path }))
    const cur = useApp.getState().tabs.find((t) => t.path === repo)?.center
    if (cur?.kind === 'diff') open(f)
  }

  const onContextMenu = (f: FileChange, e: MenuAnchor) => {
    let current = sel
    if (!sel.paths.includes(f.path)) {
      const only: PathSelection = { paths: [f.path], anchor: f.path }
      current = only
      onSelection(() => only)
    }
    const paths = targetsOf(current, f.path, order)
    showContextMenu(e, wipFileMenu({ repo, kind, file: f, paths, openDiff: () => open(f), stage, unstage }))
  }

  const bulk = isUnstaged ? (
    <button type="button" className="det-section-btn det-section-btn-stage" onClick={() => void props.stageAll()}>
      <Plus size={11} strokeWidth={3} />
      Stage all changes
    </button>
  ) : (
    <button type="button" className="det-section-btn det-section-btn-unstage" onClick={() => void props.unstageAll()}>
      <Minus size={11} strokeWidth={3} />
      Unstage all changes
    </button>
  )

  return (
    <Section
      id={kind}
      title={isUnstaged ? 'Unstaged Files' : 'Staged Files'}
      count={files.length}
      collapsed={collapsed}
      onToggle={onToggleCollapsed}
      action={files.length > 0 ? bulk : undefined}
    >
      <FileList
        files={files}
        mode={mode}
        ariaLabel={isUnstaged ? 'Unstaged files' : 'Staged files'}
        multiselectable
        activePath={activePath}
        selected={selectedSet}
        pending={pending}
        onRowClick={onRowClick}
        onRowDoubleClick={(f) => apply([f.path])}
        onFocusFile={onFocusFile}
        onActivate={(f) => apply(targetsOf(sel, f.path, order))}
        onSelectAll={() => onSelection(() => selectAll(order))}
        onRowContextMenu={onContextMenu}
        onDirContextMenu={(dir, e) => showContextMenu(e, wipDirMenu({ repo, kind, dir, paths: filesUnder(files, dir).map((f) => f.path), stage, unstage }))}
        renderActions={(f) =>
          isUnstaged ? (
            <>
              <button
                type="button"
                className="det-row-icon-btn det-row-discard"
                title="Discard changes"
                aria-label={`Discard changes to ${f.path}`}
                onClick={() => void actions.discardFiles(repo, [f.path])}
              >
                <Undo2 size={12} />
              </button>
              <button type="button" className="det-row-btn det-row-btn-stage" onClick={() => stage([f.path])}>
                Stage File
              </button>
            </>
          ) : (
            <button type="button" className="det-row-btn det-row-btn-unstage" onClick={() => unstage([f.path])}>
              Unstage File
            </button>
          )
        }
        renderDirActions={(dir) => (
          <button
            type="button"
            className={`det-row-btn ${isUnstaged ? 'det-row-btn-stage' : 'det-row-btn-unstage'}`}
            onClick={() => apply(filesUnder(files, dir).map((f) => f.path))}
          >
            {isUnstaged ? 'Stage Folder' : 'Unstage Folder'}
          </button>
        )}
      />
    </Section>
  )
})
