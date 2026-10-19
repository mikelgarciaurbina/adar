// File diff that replaces the graph in the centre panel (GitKraken style):
// header with path / status / target, prev-next file, layout (unified / split),
// full-file toggle, history / blame, an options menu (whitespace, context,
// editor, copy path), whole-file, hunk, change-block and line staging.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, History, Minus, Plus, ScanText, Trash2, X } from 'lucide-react'
import { api } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { isEditableTarget } from '@renderer/lib/keys'
import { firstLine } from '@renderer/lib/format'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { supportsPartialPatch, type HunkSelection, type PatchMode } from '@shared/patch'
import type { DiffTarget, FileDiff, FileStatusCode, WorkingStatus } from '@shared/types'
import { DiffBody } from './DiffBody'
import type { DiffRendererHandle, DiffStaging } from './DiffRenderer'
import { remapKeys, selectionFromKeys, validKeys } from './diffModel'
import { ChangeStats, DiffMoreButton, FullFileToggle, PathLabel, StatusBadge, ViewModeSwitch } from './parts'
import { applyPartial, type PartialUnit } from './staging'
import { setFullFile, toggleFullFile, useDiffPrefs } from './prefs'
import { blameRev, describeTarget, modeChangeText, nextChangedSibling, sameTarget, stillChanged, viewShowsTarget } from './targets'
import './diff.css'

const tabOf = (repo: string) => useApp.getState().tabs.find((t) => t.path === repo)

function statusFileOf(status: WorkingStatus | null, target: DiffTarget): FileStatusCode | null {
  if (!status) return null
  if (target.kind === 'unstaged') return status.unstaged.find((f) => f.path === target.path)?.status ?? null
  if (target.kind === 'staged') return status.staged.find((f) => f.path === target.path)?.status ?? null
  return null
}

const isEmptyDiff = (d: FileDiff) => !d.hunks.length && !d.binary && !d.isImage && !d.tooLarge && !modeChangeText(d)

export function DiffView({ tab, target, siblings }: { tab: RepoTab; target: DiffTarget; siblings?: DiffTarget[] }) {
  const repo = tab.path
  const { mode, fullFile, ignoreWhitespace, context, contextLines } = useDiffPrefs()
  const targetKey = JSON.stringify(target)
  const stagingKind = target.kind === 'unstaged' || target.kind === 'staged' ? target.kind : null

  const [diff, setDiff] = useState<FileDiff | null>(null)
  /** Whether the loaded `diff` holds the whole file (it lags the setting while reloading). */
  const [diffFull, setDiffFull] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const gen = useRef(0)
  const diffRef = useRef<FileDiff | null>(null)
  /** Generation from which a load may navigate away when the file has no changes left. */
  const navigateFromGen = useRef(0)
  const handle = useRef<DiffRendererHandle | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef({ siblings, target })
  propsRef.current = { siblings, target }

  // App keys this view by its target, so another file (or the staged copy of this
  // one) is a new instance: loads still in flight when this one goes away must
  // neither update it nor navigate on its behalf.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      gen.current++
    }
  }, [])

  /**
   * Whether this view may still navigate: mounted and still what the centre panel
   * shows (the store may already point elsewhere before React unmounts us).
   */
  const ownsCenter = useCallback(
    () => alive.current && viewShowsTarget(tabOf(repo)?.center, propsRef.current.target),
    [repo]
  )

  // ── Navigation ────────────────────────────────────────────────────────────
  const siblingIndex = useMemo(() => (siblings ? siblings.findIndex((s) => sameTarget(s, target)) : -1), [siblings, target])
  const hasSiblings = !!siblings && siblings.length > 1 && siblingIndex >= 0

  const goSibling = useCallback(
    (dir: 1 | -1) => {
      if (!siblings || siblingIndex < 0 || !ownsCenter()) return
      const next = siblings[siblingIndex + dir]
      if (next) git.openDiff(repo, next, siblings)
    },
    [repo, siblings, siblingIndex, ownsCenter]
  )

  const close = useCallback(() => git.showGraph(repo), [repo])

  /** After the file ran out of changes for this target: next / previous changed sibling, else the graph. */
  const leaveEmpty = useCallback(() => {
    if (!ownsCenter()) return
    const { siblings: sibs, target: cur } = propsRef.current
    const next = nextChangedSibling(sibs, cur, tabOf(repo)?.status)
    if (next) git.openDiff(repo, next, sibs)
    else git.showGraph(repo)
  }, [repo, ownsCenter])

  // ── Loading ───────────────────────────────────────────────────────────────
  const load = useCallback(
    /** silent: keep the current diff on screen; external: reload caused by a working tree / index change. */
    async (silent = false, external = false): Promise<void> => {
      const g = ++gen.current
      if (!silent) setLoading(true)
      try {
        const d = await api.getDiff(repo, propsRef.current.target, { context, ignoreWhitespace })
        if (g !== gen.current) return
        const prev = diffRef.current
        diffRef.current = d
        setDiff(d)
        setDiffFull(fullFile)
        setError(null)
        setSelected((sel) => (sel.size ? (prev ? remapKeys(prev, sel, d) : validKeys(d, sel)) : sel))
        if (navigateFromGen.current && g >= navigateFromGen.current) {
          navigateFromGen.current = 0
          if (isEmptyDiff(d)) leaveEmpty()
        } else if (external && isEmptyDiff(d) && !stillChanged(tabOf(repo)?.status, propsRef.current.target)) {
          // Staged / unstaged / committed / discarded elsewhere: nothing left to show here.
          leaveEmpty()
        }
      } catch (err) {
        if (g !== gen.current) return
        setError(describeError(err))
      } finally {
        if (g === gen.current) setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repo, targetKey, context, fullFile, ignoreWhitespace, leaveEmpty]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Working tree / index changed (file edited, staged elsewhere...): reload quietly.
  const status = tab.status
  const seenStatus = useRef(status)
  useEffect(() => {
    if (seenStatus.current === status) return
    seenStatus.current = status
    if (stagingKind) void load(true, true)
  }, [status, stagingKind, load])

  // ── Staging ───────────────────────────────────────────────────────────────
  const patchMode: PatchMode = stagingKind === 'staged' ? 'unstage' : 'stage'
  const partialOk = !!diff && !!stagingKind && supportsPartialPatch(diff, patchMode)

  const runPartial = useCallback(
    async (selection: HunkSelection[], mode: PatchMode, what: PartialUnit) => {
      const d = diffRef.current
      if (!d || !stagingKind || busy) return
      setBusy(true)
      try {
        const outcome = await applyPartial(repo, stagingKind, target.path, d, selection, mode, what)
        if (outcome === 'cancelled' || outcome === 'failed') return
        if (outcome === 'applied') {
          setSelected(new Set())
          navigateFromGen.current = gen.current + 1
        }
        await useApp.getState().refresh(repo, ['status'])
        if (!alive.current) return
        await load(true)
      } finally {
        if (alive.current) {
          setBusy(false)
          handle.current?.focus()
        }
      }
    },
    [repo, stagingKind, target.path, busy, load]
  )

  const staging: DiffStaging | null = useMemo(
    () =>
      stagingKind
        ? {
            kind: stagingKind,
            enabled: partialOk,
            selected,
            onSelect: setSelected,
            onHunk: (hunkIndex, m) => void runPartial([{ hunkIndex }], m, 'hunk'),
            onBlock: (sel, m) => void runPartial([sel], m, 'block'),
            busy
          }
        : null,
    [stagingKind, partialOk, selected, runPartial, busy]
  )

  const applySelected = useCallback(
    (m: PatchMode) => {
      if (!selected.size) return
      void runPartial(selectionFromKeys(selected), m, 'lines')
    },
    [selected, runPartial]
  )

  // Whole-file actions.
  const fileAction = useCallback(
    async (action: 'stage' | 'unstage' | 'discard') => {
      if (busy) return
      const path = target.path
      setBusy(true)
      try {
        if (action === 'stage') await git.stageFiles(repo, [path])
        else if (action === 'unstage') await git.unstageFiles(repo, [path])
        else await git.discardFiles(repo, [path])
        await useApp.getState().refresh(repo, ['status'])
        const st = tabOf(repo)?.status
        // The user may have opened something else meanwhile: leave their view alone.
        if (!st || !ownsCenter()) return
        if (action === 'stage' && st.staged.some((f) => f.path === path)) {
          // Keep the file open, now showing what is staged (like GitKraken).
          git.openDiff(
            repo,
            { kind: 'staged', path },
            st.staged.map((f) => ({ kind: 'staged', path: f.path }))
          )
        } else if (action === 'unstage' && st.unstaged.some((f) => f.path === path)) {
          git.openDiff(
            repo,
            { kind: 'unstaged', path },
            st.unstaged.map((f) => ({ kind: 'unstaged', path: f.path }))
          )
        } else if (!stillChanged(st, target)) {
          leaveEmpty()
        }
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [repo, target, busy, leaveEmpty, ownsCenter]
  )

  // ── Keyboard ──────────────────────────────────────────────────────────────
  /** Letter shortcuts only apply while the diff (or nothing in particular) has the focus. */
  const focusInView = () => {
    const a = document.activeElement
    return !a || a === document.body || !!rootRef.current?.contains(a)
  }
  const keyState = useRef({ selected, close, goSibling })
  keyState.current = { selected, close, goSibling }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target)) return
      if (document.querySelector('.ui-backdrop, .ui-menu')) return
      const k = keyState.current
      if (e.key === 'Escape') {
        e.preventDefault()
        if (k.selected.size) setSelected(new Set())
        else k.close()
        return
      }
      if (e.metaKey || e.ctrlKey) return
      if ((e.altKey && e.key === 'ArrowUp') || (!e.altKey && e.key === '[')) {
        e.preventDefault()
        k.goSibling(-1)
      } else if ((e.altKey && e.key === 'ArrowDown') || (!e.altKey && e.key === ']')) {
        e.preventDefault()
        k.goSibling(1)
      } else if (!e.altKey && !e.shiftKey && (e.key === 'n' || e.key === 'p' || e.key === 'f') && focusInView()) {
        e.preventDefault()
        if (e.key === 'f') toggleFullFile()
        else handle.current?.jumpChange(e.key === 'n' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  const path = target.path
  const fileStatus: FileStatusCode = diff?.status ?? statusFileOf(tab.status, target) ?? 'modified'
  const oldPath = diff?.oldPath ?? ('oldPath' in target ? target.oldPath : undefined)
  const commitSubject =
    target.kind === 'commit' ? tab.commits.find((c) => c.sha === target.sha || c.sha.startsWith(target.sha))?.subject : undefined
  const conflicted = !!tab.status?.conflicted.some((c) => c.path === path)
  const exists = fileStatus !== 'deleted'
  /** Not in HEAD yet (untracked, or added in the index): nothing to blame. */
  const uncommittedNew = (target.kind === 'unstaged' || target.kind === 'staged') && (fileStatus === 'untracked' || fileStatus === 'added')
  /** Layout and full-file only matter for text diffs. */
  const textual = !diff || (!diff.isImage && !diff.binary)
  const modeText = diff ? modeChangeText(diff) : null
  const selCount = selected.size

  return (
    <div className="diff-view" ref={rootRef}>
      <div className="diff-header">
        <div className="diff-titlebar">
          <StatusBadge status={fileStatus} />
          <PathLabel path={path} />
          {oldPath && oldPath !== path && (
            <span className="diff-renamed" title={`Renamed from ${oldPath}`}>
              ← {oldPath}
            </span>
          )}
          <span className="diff-target">
            {describeTarget(target)}
            {commitSubject && <span className="diff-target-sub"> · {firstLine(commitSubject)}</span>}
          </span>
          {loading && diff && <Spinner size="sm" />}
          <span className="diff-spacer" />
          {diff && !diff.binary && <ChangeStats additions={diff.additions} deletions={diff.deletions} />}
          <IconButton label="Close (Esc)" onClick={close}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="diff-toolbar">
          {hasSiblings && (
            <div className="diff-nav">
              <IconButton size="sm" label="Previous file (Alt+↑ or [)" disabled={siblingIndex <= 0} onClick={() => goSibling(-1)}>
                <ChevronUp size={15} />
              </IconButton>
              <span className="diff-nav-count">
                {siblingIndex + 1} / {siblings!.length}
              </span>
              <IconButton
                size="sm"
                label="Next file (Alt+↓ or ])"
                disabled={siblingIndex >= siblings!.length - 1}
                onClick={() => goSibling(1)}
              >
                <ChevronDown size={15} />
              </IconButton>
            </div>
          )}
          {textual && (
            <>
              <ViewModeSwitch value={mode} />
              <FullFileToggle value={fullFile} />
              <span className="diff-tb-sep" />
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="diff-tb-btn"
            icon={<History size={14} />}
            onClick={() => git.openFileHistory(repo, path)}
            title="File history"
          >
            History
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="diff-tb-btn"
            icon={<ScanText size={14} />}
            disabled={!exists || uncommittedNew}
            onClick={() => git.openBlame(repo, path, blameRev(target))}
            title={uncommittedNew ? 'Not committed yet: nothing to blame' : 'Blame: who changed each line'}
          >
            Blame
          </Button>
          <DiffMoreButton
            repo={repo}
            path={path}
            canOpen={exists}
            ignoreWhitespace={ignoreWhitespace}
            contextLines={contextLines}
            fullFile={fullFile}
          />
          <span className="diff-spacer" />
          {conflicted && (
            <Button size="sm" variant="primary" icon={<AlertTriangle size={14} />} onClick={() => git.openConflict(repo, path)}>
              Resolve Conflict
            </Button>
          )}
          {!conflicted && stagingKind === 'unstaged' && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="diff-btn-danger"
                icon={<Trash2 size={14} />}
                disabled={busy}
                onClick={() => void fileAction('discard')}
              >
                Discard File
              </Button>
              <Button size="sm" variant="primary" icon={<Plus size={14} />} disabled={busy} onClick={() => void fileAction('stage')}>
                Stage File
              </Button>
            </>
          )}
          {!conflicted && stagingKind === 'staged' && (
            <Button size="sm" icon={<Minus size={14} />} disabled={busy} onClick={() => void fileAction('unstage')}>
              Unstage File
            </Button>
          )}
        </div>
        {modeText && diff && diff.hunks.length > 0 && <div className="diff-info">{modeText}</div>}
      </div>

      <div className="diff-body">
        {error && !diff ? (
          <EmptyState icon={<AlertTriangle size={36} />} title="Could not load the diff">
            <p className="diff-empty-text">{error}</p>
            <div className="diff-empty-actions">
              <Button size="sm" onClick={() => void load()}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={close}>
                Back to graph
              </Button>
            </div>
          </EmptyState>
        ) : !diff ? (
          <div className="diff-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <DiffBody
            repo={repo}
            diff={diff}
            target={target}
            mode={mode}
            fullFile={diffFull}
            staging={staging}
            handle={handle}
            autoFocus
            ignoreWhitespace={ignoreWhitespace}
            onOpenInEditor={exists ? () => void git.openInEditor(git.absPath(repo, path)) : undefined}
            onShowChangesOnly={() => setFullFile(false)}
          />
        )}
        {error && diff && <div className="diff-error-strip">{error}</div>}

        {partialOk && selCount > 0 && (
          <div className="diff-selbar" role="toolbar" aria-label="Selected lines">
            <span className="diff-selbar-count">
              {selCount} line{selCount === 1 ? '' : 's'} selected
            </span>
            {stagingKind === 'unstaged' ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="diff-btn-danger"
                  icon={<Trash2 size={13} />}
                  disabled={busy}
                  onClick={() => applySelected('discard')}
                >
                  Discard Lines
                </Button>
                <Button size="sm" variant="primary" icon={<Plus size={13} />} loading={busy} onClick={() => applySelected('stage')}>
                  Stage Lines
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" icon={<Minus size={13} />} loading={busy} onClick={() => applySelected('unstage')}>
                Unstage Lines
              </Button>
            )}
            <IconButton size="sm" label="Clear selection (Esc)" onClick={() => setSelected(new Set())}>
              <X size={14} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  )
}
