// GitKraken-style merge tool. Top: A (ours) and B (theirs) side by side with a
// checkbox per conflict chunk; bottom: the editable merged Output, generated
// from the chunk choices until the user edits it by hand. Conflicts that can't
// be merged line by line (binary, delete/add) get a simple chooser instead.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Info,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  X
} from 'lucide-react'
import { api, isMac } from '@renderer/api/client'
import { absPath, openConflict, openInEditor, showGraph, showInFolder } from '@renderer/actions/git'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { showContextMenu, showMenuBelow } from '@renderer/components/common/ContextMenu'
import { confirm } from '@renderer/components/common/dialogs'
import { basename, dirname, pluralize } from '@renderer/lib/format'
import { isEditableTarget, isMod } from '@renderer/lib/keys'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { ConflictResolution, ConflictVersions } from '@shared/types'
import { ConflictChooser } from './ConflictChooser'
import {
  buildOutputWithRegions,
  buildPaneRows,
  chunkRowStarts,
  conflictSegments,
  CONFLICT_KIND_LABEL,
  countUnresolved,
  detectEol,
  hasConflictMarkers,
  maxLineColumns,
  needsChooser,
  parseConflicts,
  sideChecked,
  splitLines,
  stripEol,
  toggleChoice,
  type ChunkChoice,
  type Segment,
  type Side
} from './conflictParser'
import { MergePane, type MergePaneHandle } from './MergePane'
import { OutputEditor, type OutputEditorHandle } from './OutputEditor'
import { markResolvedAndAdvance, resolveAndAdvance, resolveBusyKey } from './resolveFlow'
import './conflicts.css'

type LoadState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; versions: ConflictVersions }

type Choices = Array<ChunkChoice | undefined>

// ── Per-file editor state cache ────────────────────────────────────────────
// Switching between conflicted files (or closing the tool) keeps the chunk
// choices / manual edits as long as the working-tree text did not change.

interface CachedEditor {
  merged: string | null
  choices: Choices
  manualText: string | null
  current: number
}
const editorCache = new Map<string, CachedEditor>()
const CACHE_LIMIT = 50
const cacheKeyOf = (repo: string, path: string) => `${repo}\u0000${path}`

function readSplitRatio(): number {
  try {
    const v = Number(localStorage.getItem('adar.cf.split'))
    return v >= 0.15 && v <= 0.85 ? v : 0.55
  } catch {
    return 0.55
  }
}
function saveSplitRatio(v: number): void {
  try {
    localStorage.setItem('adar.cf.split', String(v))
  } catch {
    /* storage unavailable */
  }
}

// ── ConflictView ───────────────────────────────────────────────────────────

export function ConflictView({ tab, path }: { tab: RepoTab; path: string }) {
  const repo = tab.path
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const resolving = useApp((s) => resolveBusyKey(repo) in s.busy)

  useEffect(() => {
    let alive = true
    setLoad({ status: 'loading' })
    api.getConflictVersions(repo, path).then(
      (versions) => alive && setLoad({ status: 'ready', versions }),
      (err) => alive && setLoad({ status: 'error', error: describeError(err) })
    )
    return () => {
      alive = false
    }
  }, [repo, path, reloadKey])

  const files = tab.status?.conflicted ?? []
  const index = files.findIndex((f) => f.path === path)
  const versions = load.status === 'ready' ? load.versions : null
  const kind = versions?.kind ?? files[index]?.kind
  // Status may lag right after the operation stopped; only claim "resolved" once it is fresh.
  const stillConflicted = !tab.status || tab.loading.status || index >= 0

  const segments = useMemo<Segment[]>(() => (versions?.merged != null ? parseConflicts(versions.merged) : []), [versions])
  const firstChunk = useMemo(() => conflictSegments(segments)[0], [segments])
  const oursLabel = versions?.oursLabel || firstChunk?.oursLabel || 'Current'
  const theirsLabel = versions?.theirsLabel || firstChunk?.theirsLabel || 'Incoming'

  const close = useCallback(() => showGraph(repo), [repo])

  const goFile = (delta: 1 | -1) => {
    if (!files.length) return
    const i = index < 0 ? (delta > 0 ? 0 : files.length - 1) : (index + delta + files.length) % files.length
    if (files[i].path !== path) openConflict(repo, files[i].path)
  }

  const markAsIs = async () => {
    if (versions?.merged != null && hasConflictMarkers(versions.merged)) {
      const ok = await confirm({
        title: 'Mark resolved with conflict markers?',
        message: `${basename(path)} still contains conflict markers (<<<<<<< / >>>>>>>). They will be committed as-is.`,
        confirmLabel: 'Mark resolved',
        danger: true
      })
      if (!ok) return
    }
    if (await markResolvedAndAdvance(repo, path)) editorCache.delete(cacheKeyOf(repo, path))
  }

  const openMore = (el: HTMLElement) =>
    showMenuBelow(el, [
      { label: 'Reload from disk', icon: <RefreshCw size={14} />, onClick: () => setReloadKey((k) => k + 1) },
      { label: 'Open in editor', icon: <ExternalLink size={14} />, onClick: () => void openInEditor(absPath(repo, path)) },
      { label: 'Show in folder', icon: <FolderOpen size={14} />, onClick: () => void showInFolder(absPath(repo, path)) },
      { type: 'separator' },
      { label: 'Mark resolved as-is', icon: <Check size={14} />, disabled: resolving || !stillConflicted, onClick: () => void markAsIs() }
    ])

  // Esc closes the tool. Registered on mount (capture) so it runs BEFORE the listeners that
  // context menus / dialogs add when they open — while they are open, Esc is theirs.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.ui-menu, .ui-backdrop')) return
      const active = document.activeElement
      const inView = !!active && (active === document.body || !!rootRef.current?.contains(active))
      if (!inView || isEditableTarget(active)) return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  const dir = dirname(path)
  return (
    <div className="cf-root" ref={rootRef}>
      <header className="cf-header">
        <AlertTriangle size={15} className="cf-header-icon" />
        <div className="cf-header-path selectable" title={path}>
          {dir && <span className="cf-header-dir">{dir}/</span>}
          <span className="cf-header-file">{basename(path)}</span>
        </div>
        {kind && <span className="cf-kind">{CONFLICT_KIND_LABEL[kind]}</span>}
        {versions?.binary && <span className="cf-kind cf-kind-muted">Binary</span>}
        <span className="cf-header-spacer" />
        {files.length > 0 && (
          <div className="cf-file-nav">
            <span className="cf-file-nav-label">
              {index >= 0 ? `Conflicted file ${index + 1} of ${files.length}` : pluralize(files.length, 'conflicted file')}
            </span>
            <IconButton label="Previous conflicted file" size="sm" disabled={files.length < 2 && index >= 0} onClick={() => goFile(-1)}>
              <ChevronLeft size={15} />
            </IconButton>
            <IconButton label="Next conflicted file" size="sm" disabled={files.length < 2 && index >= 0} onClick={() => goFile(1)}>
              <ChevronRight size={15} />
            </IconButton>
          </div>
        )}
        <IconButton label="More actions" size="sm" onClick={(e) => openMore(e.currentTarget)}>
          <MoreHorizontal size={15} />
        </IconButton>
        <IconButton label="Close (Esc)" size="sm" onClick={close}>
          <X size={15} />
        </IconButton>
      </header>

      {!stillConflicted && load.status !== 'loading' && (
        <div className="cf-notice cf-notice-info">
          <Info size={14} />
          <span>This file is no longer marked as conflicted.</span>
          <button className="ui-link" onClick={close}>
            Back to graph
          </button>
        </div>
      )}

      {load.status === 'loading' && (
        <div className="cf-center">
          <Spinner size="lg" />
        </div>
      )}

      {load.status === 'error' && (
        <EmptyState icon={<AlertTriangle size={30} />} title="Could not load the conflict">
          <div className="cf-error-text">{load.error}</div>
          <div className="cf-error-actions">
            <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              Back to graph
            </Button>
          </div>
        </EmptyState>
      )}

      {versions &&
        (needsChooser(versions.kind, versions.binary) ? (
          <ConflictChooser
            versions={versions}
            oursLabel={oursLabel}
            theirsLabel={theirsLabel}
            busy={resolving}
            onResolve={(resolution: ConflictResolution) => {
              void resolveAndAdvance(repo, path, resolution).then((ok) => ok && editorCache.delete(cacheKeyOf(repo, path)))
            }}
          />
        ) : (
          <MergeEditor
            key={reloadKey}
            repo={repo}
            path={path}
            versions={versions}
            segments={segments}
            oursLabel={oursLabel}
            theirsLabel={theirsLabel}
            resolving={resolving}
          />
        ))}
    </div>
  )
}

// ── Merge editor ───────────────────────────────────────────────────────────

export interface MergeEditorProps {
  repo: string
  path: string
  versions: ConflictVersions
  segments: Segment[]
  oursLabel: string
  theirsLabel: string
  resolving: boolean
}

/** Text merge tool for one file (exported for tests; mounted by ConflictView). */
export function MergeEditor({ repo, path, versions, segments, oursLabel, theirsLabel, resolving }: MergeEditorProps) {
  const merged = versions.merged
  const cacheKey = cacheKeyOf(repo, path)
  const chunks = useMemo(() => conflictSegments(segments), [segments])
  const chunkCount = chunks.length
  const eol = useMemo(() => detectEol(merged ?? versions.ours ?? ''), [merged, versions.ours])

  const [restored] = useState(() => {
    const c = editorCache.get(cacheKey)
    return c && c.merged === merged && c.choices.length === chunkCount ? c : null
  })
  const [choices, setChoices] = useState<Choices>(() => restored?.choices ?? new Array<ChunkChoice | undefined>(chunkCount).fill(undefined))
  const [current, setCurrent] = useState(() => Math.min(restored?.current ?? 0, Math.max(0, chunkCount - 1)))
  // null = output generated from the choices; string = edited by hand.
  const [manualText, setManualText] = useState<string | null>(() => restored?.manualText ?? (merged == null ? (versions.ours ?? '') : null))
  const [saving, setSaving] = useState(false)
  const [pulse, setPulse] = useState(0)
  const [ratio, setRatio] = useState(readSplitRatio)

  const rootRef = useRef<HTMLDivElement>(null)
  const splitRef = useRef<HTMLDivElement>(null)
  const paneA = useRef<MergePaneHandle>(null)
  const paneB = useRef<MergePaneHandle>(null)
  const outputRef = useRef<OutputEditorHandle>(null)

  // Without conflict markers the panes show the raw stage versions, which are not aligned.
  const aligned = chunkCount > 0
  const rowsA = useMemo(
    () => (aligned ? buildPaneRows(segments, 'ours') : buildPaneRows([{ type: 'common', lines: splitLines(versions.ours ?? '') }], 'ours')),
    [aligned, segments, versions.ours]
  )
  const rowsB = useMemo(
    () =>
      aligned ? buildPaneRows(segments, 'theirs') : buildPaneRows([{ type: 'common', lines: splitLines(versions.theirs ?? '') }], 'theirs'),
    [aligned, segments, versions.theirs]
  )
  const columns = useMemo(
    () =>
      aligned
        ? maxLineColumns(segments)
        : Math.max(
            maxLineColumns([{ type: 'common', lines: splitLines(versions.ours ?? '') }]),
            maxLineColumns([{ type: 'common', lines: splitLines(versions.theirs ?? '') }])
          ),
    [aligned, segments, versions.ours, versions.theirs]
  )
  const rowStarts = useMemo(() => chunkRowStarts(segments), [segments])
  const baseTitles = useMemo(
    () =>
      chunks.map((c) => {
        if (!c.base) return undefined
        const shown = c.base.slice(0, 30).map(stripEol).join('\n')
        const more = c.base.length > 30 ? `\n… ${c.base.length - 30} more lines` : ''
        return `Common ancestor${c.baseLabel ? ` (${c.baseLabel})` : ''}:\n${c.base.length ? shown : '(no lines)'}${more}`
      }),
    [chunks]
  )

  const built = useMemo(() => buildOutputWithRegions(segments, choices, eol), [segments, choices, eol])
  const manual = manualText !== null
  // Latest values for stable callbacks (keeps memoised pane rows from re-rendering on every change).
  const latest = useRef({ choices, regions: built.regions, manual })
  latest.current = { choices, regions: built.regions, manual }
  const outputText = manualText ?? built.text
  const unresolved = countUnresolved(segments, choices)
  const resolvedCount = chunkCount - unresolved
  const busy = saving || resolving

  // Remember the editor state for this file (restored when coming back).
  useEffect(() => {
    const dirty = manualText !== null || choices.some(Boolean)
    if (!dirty) {
      editorCache.delete(cacheKey)
      return
    }
    editorCache.delete(cacheKey)
    editorCache.set(cacheKey, { merged, choices, manualText, current })
    while (editorCache.size > CACHE_LIMIT) editorCache.delete(editorCache.keys().next().value as string)
  }, [cacheKey, merged, choices, manualText, current])

  // Focus the editor so keyboard shortcuts work immediately; reveal the first chunk.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
    if (chunkCount) {
      requestAnimationFrame(() => {
        const row = rowStarts[current] ?? 0
        paneA.current?.revealRow(row)
        paneB.current?.revealRow(row)
      })
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Chunk navigation & choices ──

  const revealOutput = useCallback((chunk: number) => {
    if (latest.current.manual) return
    const region = latest.current.regions.find((r) => r.chunk === chunk)
    if (region) outputRef.current?.revealLine(region.startLine, 'smooth')
  }, [])

  // Updated eagerly (not only on render) so several key presses within one task stay consistent.
  const currentRef = useRef(current)
  currentRef.current = current

  const goChunk = (i: number) => {
    if (!chunkCount) return
    const next = Math.max(0, Math.min(chunkCount - 1, i))
    currentRef.current = next
    setCurrent(next)
    const row = rowStarts[next] ?? 0
    paneA.current?.revealRow(row, 'smooth')
    if (!aligned) paneB.current?.revealRow(row, 'smooth')
    revealOutput(next)
  }

  const selectChunk = useCallback(
    (chunk: number) => {
      if (currentRef.current === chunk) return
      currentRef.current = chunk
      setCurrent(chunk)
      revealOutput(chunk)
    },
    [revealOutput]
  )

  /** In manual mode, flash the "edited manually" notice so the user knows why the output did not change. */
  const nudgeManual = useCallback(() => {
    if (latest.current.manual) setPulse((p) => p + 1)
  }, [])

  const nextUnresolvedAfter = (from: number, list: Choices): number => {
    for (let k = 1; k <= chunkCount; k++) {
      const i = (from + k) % chunkCount
      if (!list[i]) return i
    }
    return -1
  }

  const applyChoice = (chunk: number, choice: ChunkChoice | undefined, advance = false) => {
    const next = choices.slice()
    next[chunk] = choice
    setChoices(next)
    nudgeManual()
    if (advance && choice) {
      const target = nextUnresolvedAfter(chunk, next)
      if (target >= 0 && target !== chunk) goChunk(target)
    }
  }

  const toggle = useCallback(
    (chunk: number, side: Side) => {
      setChoices((prev) => {
        const next = prev.slice()
        next[chunk] = toggleChoice(prev[chunk], side)
        return next
      })
      nudgeManual()
    },
    [nudgeManual]
  )
  const toggleOurs = useCallback((chunk: number) => toggle(chunk, 'ours'), [toggle])
  const toggleTheirs = useCallback((chunk: number) => toggle(chunk, 'theirs'), [toggle])

  const sideCount = (side: Side) => choices.reduce((n, c) => n + (sideChecked(c, side) ? 1 : 0), 0)
  const allState = (side: Side): 'all' | 'some' | 'none' => {
    const n = sideCount(side)
    return chunkCount && n === chunkCount ? 'all' : n > 0 ? 'some' : 'none'
  }
  const toggleAll = (side: Side) => {
    const all = allState(side) === 'all'
    setChoices((prev) => prev.map((c) => (sideChecked(c, side) === all ? toggleChoice(c, side) : c)))
    nudgeManual()
  }
  const takeAll = (choice: ChunkChoice) => {
    setChoices(new Array<ChunkChoice | undefined>(chunkCount).fill(choice))
    nudgeManual()
  }

  // ── Scroll sync ──

  // The pane we scrolled programmatically and the position we gave it: its next scroll
  // event is our own echo and must not be mirrored back (that would fight smooth/inertial
  // scrolling of the pane the user is actually driving).
  const syncEcho = useRef<{ el: HTMLElement | null; top: number; left: number }>({ el: null, top: 0, left: 0 })
  const onPaneScroll = useCallback(
    (side: Side, el: HTMLDivElement) => {
      if (!aligned) return
      const echo = syncEcho.current
      if (echo.el === el) {
        echo.el = null
        if (Math.abs(echo.top - el.scrollTop) < 1 && Math.abs(echo.left - el.scrollLeft) < 1) return
      }
      const other = (side === 'ours' ? paneB : paneA).current?.element
      if (!other || (other.scrollTop === el.scrollTop && other.scrollLeft === el.scrollLeft)) return
      other.scrollTop = el.scrollTop
      other.scrollLeft = el.scrollLeft
      syncEcho.current = { el: other, top: other.scrollTop, left: other.scrollLeft }
    },
    [aligned]
  )

  // ── Split resizing ──

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const split = splitRef.current
    if (!split) return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    document.body.classList.add('cf-resizing')
    let last = ratio
    let frame = 0
    const move = (ev: PointerEvent) => {
      const r = split.getBoundingClientRect()
      last = Math.max(0.15, Math.min(0.85, (ev.clientY - r.top) / r.height))
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          setRatio(last)
        })
    }
    const up = () => {
      if (frame) cancelAnimationFrame(frame)
      setRatio(last)
      document.body.classList.remove('cf-resizing')
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      saveSplitRatio(last)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  // ── Resolution ──

  const save = async () => {
    if (busy) return
    const content = outputText
    const pending = manual ? 0 : unresolved
    if (pending > 0 || hasConflictMarkers(content)) {
      const ok = await confirm({
        title: 'Conflicts remain',
        message:
          pending > 0
            ? `${pluralize(pending, 'conflict')} ${pending === 1 ? 'is' : 'are'} not resolved yet. The conflict markers will be saved in ${basename(path)}.`
            : `The output still contains conflict markers (<<<<<<< / >>>>>>>). Save ${basename(path)} with them anyway?`,
        confirmLabel: 'Save anyway',
        danger: true
      })
      if (!ok) return
    }
    setSaving(true)
    const ok = await resolveAndAdvance(repo, path, { kind: 'content', content })
    if (ok) editorCache.delete(cacheKey)
    else setSaving(false)
  }

  const resolveWhole = async (side: Side) => {
    if (busy) return
    const letter = side === 'ours' ? 'A' : 'B'
    const label = side === 'ours' ? oursLabel : theirsLabel
    if (manual || choices.some(Boolean)) {
      const ok = await confirm({
        title: `Use ${letter} entirely?`,
        message: `Your selections and output edits are discarded and ${basename(path)} is resolved with the whole file from ${label}.`,
        confirmLabel: `Use ${letter}`
      })
      if (!ok) return
    }
    setSaving(true)
    const ok = await resolveAndAdvance(repo, path, { kind: side })
    if (ok) editorCache.delete(cacheKey)
    else setSaving(false)
  }

  const applyRef = useRef(applyChoice)
  applyRef.current = applyChoice
  const chunkMenu = useCallback(
    (e: React.MouseEvent, chunk: number) => {
      const c = latest.current.choices[chunk]
      const applyChoice = (i: number, choice: ChunkChoice | undefined) => applyRef.current(i, choice)
      showContextMenu(e, [
        { type: 'header', label: `Conflict ${chunk + 1}` },
        { label: `Take A (${oursLabel})`, checked: c === 'ours', onClick: () => applyChoice(chunk, 'ours') },
        { label: `Take B (${theirsLabel})`, checked: c === 'theirs', onClick: () => applyChoice(chunk, 'theirs') },
        { label: 'Take both — A first', checked: c === 'both-ours-first', onClick: () => applyChoice(chunk, 'both-ours-first') },
        { label: 'Take both — B first', checked: c === 'both-theirs-first', onClick: () => applyChoice(chunk, 'both-theirs-first') },
        { label: 'Take neither', checked: c === 'none', onClick: () => applyChoice(chunk, 'none') },
        { type: 'separator' },
        { label: 'Mark unresolved', disabled: !c, onClick: () => applyChoice(chunk, undefined) }
      ])
    },
    [oursLabel, theirsLabel]
  )

  // ── Keyboard ──

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void save()
      return
    }
    const t = e.target as HTMLElement
    const inCheckbox = t instanceof HTMLInputElement && t.type === 'checkbox'
    if (isEditableTarget(t) && !inCheckbox) {
      // Esc leaves the output editor (a second Esc then closes the tool).
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        rootRef.current?.focus({ preventScroll: true })
      }
      return
    }
    if (e.altKey && !isMod(e) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      goChunk(currentRef.current + (e.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey || !chunkCount) return
    switch (e.key) {
      case 'a':
      case 'A':
        e.preventDefault()
        toggle(currentRef.current, 'ours')
        break
      case 'b':
      case 'B':
        e.preventDefault()
        toggle(currentRef.current, 'theirs')
        break
      case 'n':
      case 'j':
        e.preventDefault()
        goChunk(currentRef.current + 1)
        break
      case 'p':
      case 'k':
        e.preventDefault()
        goChunk(currentRef.current - 1)
        break
    }
  }

  const cur = chunkCount ? choices[current] : undefined
  const segBtn = (choice: ChunkChoice, label: string, title: string) => (
    <button
      type="button"
      className={`cf-seg-btn${cur === choice ? ' cf-active' : ''}`}
      aria-pressed={cur === choice}
      title={title}
      disabled={!chunkCount}
      onClick={() => applyChoice(current, choice, true)}
    >
      {label}
    </button>
  )

  return (
    <div className="cf-editor" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="cf-toolbar">
        {chunkCount > 0 ? (
          <>
            <Button size="sm" onClick={() => takeAll('ours')} title={`Take every conflict from A (${oursLabel})`}>
              Take all from A
            </Button>
            <Button size="sm" onClick={() => takeAll('theirs')} title={`Take every conflict from B (${theirsLabel})`}>
              Take all from B
            </Button>
            <span className="cf-toolbar-sep" />
            <div className="cf-chunk-nav">
              <IconButton label="Previous conflict (Alt+↑)" size="sm" disabled={current <= 0} onClick={() => goChunk(current - 1)}>
                <ArrowUp size={14} />
              </IconButton>
              <span className="cf-chunk-nav-label">
                Conflict {current + 1} of {chunkCount}
              </span>
              <IconButton label="Next conflict (Alt+↓)" size="sm" disabled={current >= chunkCount - 1} onClick={() => goChunk(current + 1)}>
                <ArrowDown size={14} />
              </IconButton>
            </div>
            <div className="cf-seg" role="group" aria-label="Resolve current conflict">
              {segBtn('ours', 'A', `Take A (${oursLabel}) for this conflict`)}
              {segBtn('theirs', 'B', `Take B (${theirsLabel}) for this conflict`)}
              {segBtn('both-ours-first', 'A+B', 'Take both, A first')}
              {segBtn('both-theirs-first', 'B+A', 'Take both, B first')}
              {segBtn('none', 'None', 'Take neither side')}
            </div>
            <span className="cf-toolbar-spacer" />
            {manual ? (
              <span className="cf-progress cf-progress-manual" title="The output was edited by hand; it is saved as shown">
                Output edited
              </span>
            ) : (
              <span className={`cf-progress${unresolved === 0 ? ' cf-progress-done' : ''}`} title={`${unresolved} unresolved`}>
                {unresolved === 0 ? <Check size={13} /> : null}
                {resolvedCount} of {chunkCount} resolved
              </span>
            )}
          </>
        ) : (
          <>
            <Info size={14} className="cf-toolbar-info" />
            <span className="cf-toolbar-text">
              {merged == null
                ? 'The working copy of this file is missing — the output starts from A’s version.'
                : 'No conflict markers found — the file may already have been fixed in an editor. Review the output, then mark it resolved.'}
            </span>
            <span className="cf-toolbar-spacer" />
          </>
        )}
      </div>

      <div className="cf-split" ref={splitRef}>
        <div className="cf-panes" style={{ flexBasis: `${ratio * 100}%` }}>
          <MergePane
            ref={paneA}
            side="ours"
            letter="A"
            label={oursLabel}
            rows={rowsA}
            choices={choices}
            currentChunk={current}
            columns={columns}
            baseTitles={baseTitles}
            allState={allState('ours')}
            chunkCount={chunkCount}
            headerExtra={
              <Button size="sm" variant="ghost" disabled={busy} title={`Use A (ours) entirely — resolve with the whole file from ${oursLabel}`} onClick={() => void resolveWhole('ours')}>
                Use A<span className="cf-wide-only"> entirely</span>
              </Button>
            }
            onToggle={toggleOurs}
            onToggleAll={() => toggleAll('ours')}
            onSelectChunk={selectChunk}
            onChunkMenu={chunkMenu}
            onScroll={onPaneScroll}
          />
          <MergePane
            ref={paneB}
            side="theirs"
            letter="B"
            label={theirsLabel}
            rows={rowsB}
            choices={choices}
            currentChunk={current}
            columns={columns}
            baseTitles={baseTitles}
            allState={allState('theirs')}
            chunkCount={chunkCount}
            headerExtra={
              <Button size="sm" variant="ghost" disabled={busy} title={`Use B (theirs) entirely — resolve with the whole file from ${theirsLabel}`} onClick={() => void resolveWhole('theirs')}>
                Use B<span className="cf-wide-only"> entirely</span>
              </Button>
            }
            onToggle={toggleTheirs}
            onToggleAll={() => toggleAll('theirs')}
            onSelectChunk={selectChunk}
            onChunkMenu={chunkMenu}
            onScroll={onPaneScroll}
          />
        </div>
        <div className="cf-hresizer" role="separator" aria-orientation="horizontal" aria-label="Resize output" onPointerDown={startResize} />
        <section className="cf-output" aria-label="Output">
          <header className="cf-output-header">
            <span className="cf-output-title">Output</span>
            {manual && merged != null ? (
              <span key={pulse} className={`cf-manual${pulse ? ' cf-pulse' : ''}`}>
                Edited manually{chunkCount > 0 ? ' — A/B selections no longer update the output.' : '.'}
                <button className="ui-link cf-reset-link" onClick={() => setManualText(null)}>
                  <RotateCcw size={12} /> Reset output
                </button>
              </span>
            ) : chunkCount > 0 ? (
              <span className={`cf-output-hint${unresolved ? ' cf-output-hint-warn' : ''}`}>
                {unresolved ? `${pluralize(unresolved, 'unresolved conflict')} — shown with markers` : 'All conflicts resolved'}
              </span>
            ) : null}
            <span className="cf-toolbar-spacer" />
            <span className="cf-output-meta" title="Line endings">
              {eol === '\r\n' ? 'CRLF' : 'LF'}
            </span>
            <Button
              size="sm"
              variant="primary"
              icon={<Check size={13} />}
              loading={saving}
              disabled={resolving && !saving}
              title={`Save the output to ${basename(path)} and stage it (${isMac ? '⌘S' : 'Ctrl+S'})`}
              onClick={() => void save()}
            >
              Save and mark resolved
            </Button>
          </header>
          <OutputEditor
            ref={outputRef}
            value={outputText}
            onChange={(v) => setManualText(v)}
            regions={manual ? null : built.regions}
            currentChunk={current}
            readOnly={busy}
          />
        </section>
      </div>
    </div>
  )
}
