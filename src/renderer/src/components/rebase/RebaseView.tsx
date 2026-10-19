// GitKraken-style interactive rebase editor. Commits of base..HEAD are listed
// NEWEST AT THE TOP; each row gets an action (pick / reword / edit / squash /
// fixup / drop), can be reordered by drag & drop or Alt+↑/↓, and reword /
// squash groups get inline message editors. The model (todo order, oldest
// first) lives in rebaseModel.ts.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, CornerDownRight, GripVertical, ListOrdered, Play, RefreshCw, RotateCcw, X } from 'lucide-react'
import { api, isMac } from '@renderer/api/client'
import { handleOperationResult, showGraph } from '@renderer/actions/git'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, EmptyState, IconButton, Kbd, Spinner } from '@renderer/components/common/Button'
import { showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { absoluteTime, formatDate, pluralize, shortSha } from '@renderer/lib/format'
import { isEditableTarget, isMod } from '@renderer/lib/keys'
import { useApp, useSettings, type RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { Commit, OperationResult, RebaseAction } from '@shared/types'
import {
  ACTION_INFO,
  actionForKey,
  buildTodo,
  computeGroups,
  customGroupMessage,
  dropTargetTodoIndex,
  groupMessage,
  initialEntries,
  isMeld,
  isModified,
  moveEntry,
  REBASE_ACTIONS,
  resultCount,
  setAction,
  setGroupMessage,
  setMessage,
  summarize,
  toDisplayIndex,
  validateRebase,
  type RebaseEntry
} from './rebaseModel'
import './rebase.css'

const ROW_DRAG_MIME = 'application/x-adar-rebase-row'

type LoadState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; commits: Commit[] }

const tabOf = (repo: string) => useApp.getState().tabs.find((t) => t.path === repo)

function isDirty(tab: RepoTab | undefined | null): boolean {
  const st = tab?.status
  return !!st && (st.staged.length > 0 || st.unstaged.some((f) => f.status !== 'untracked') || st.conflicted.length > 0)
}

// ── RebaseView ─────────────────────────────────────────────────────────────

export function RebaseView({ tab, base }: { tab: RepoTab; base: string }) {
  const repo = tab.path
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    setLoad({ status: 'loading' })
    api.getRebaseCommits(repo, base).then(
      (commits) => alive && setLoad({ status: 'ready', commits }),
      (err) => alive && setLoad({ status: 'error', error: describeError(err) })
    )
    return () => {
      alive = false
    }
  }, [repo, base, reloadKey])

  const branch = tab.info?.head.branch ?? tab.refs?.head.branch ?? null
  const baseInfo = useMemo(() => describeBase(base, tab.commits), [base, tab.commits])

  return (
    <div className="rb-root">
      <header className="rb-header">
        <ListOrdered size={15} className="rb-header-icon" />
        <span className="rb-header-title">Interactive Rebase:</span>
        <span className="rb-ref" title={branch ?? 'Detached HEAD'}>
          {branch ?? 'detached HEAD'}
        </span>
        {baseInfo.root ? (
          <span className="rb-header-muted">from root</span>
        ) : (
          <>
            <span className="rb-header-muted">onto</span>
            <span className="rb-base mono" title={base}>
              {baseInfo.label}
            </span>
            {baseInfo.subject && (
              <span className="rb-header-subject" title={baseInfo.subject}>
                {baseInfo.subject}
              </span>
            )}
          </>
        )}
        <span className="rb-spacer" />
        <IconButton label="Close" size="sm" onClick={() => showGraph(repo)}>
          <X size={15} />
        </IconButton>
      </header>

      {load.status === 'loading' && (
        <div className="rb-center">
          <Spinner size="lg" />
        </div>
      )}
      {load.status === 'error' && (
        <EmptyState icon={<AlertTriangle size={30} />} title="Could not load the commits to rebase">
          <div className="rb-error-text">{load.error}</div>
          <div className="rb-error-actions">
            <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={() => showGraph(repo)}>
              Back to graph
            </Button>
          </div>
        </EmptyState>
      )}
      {load.status === 'ready' &&
        (load.commits.length === 0 ? (
          <EmptyState icon={<ListOrdered size={30} />} title="Nothing to rebase">
            <div>There are no commits between {baseInfo.root ? 'the root' : baseInfo.label} and HEAD.</div>
            <div className="rb-error-actions">
              <Button size="sm" variant="ghost" onClick={() => showGraph(repo)}>
                Back to graph
              </Button>
            </div>
          </EmptyState>
        ) : (
          <RebaseEditor key={reloadKey} tab={tab} base={base} commits={load.commits} />
        ))}
    </div>
  )
}

function describeBase(base: string, commits: readonly Commit[]): { root: boolean; label: string; subject?: string } {
  if (base === 'ROOT') return { root: true, label: 'root' }
  if (/^[0-9a-f]{7,40}$/i.test(base)) {
    const c = commits.find((x) => x.sha.startsWith(base.toLowerCase()))
    return { root: false, label: shortSha(base), subject: c?.subject }
  }
  return { root: false, label: base }
}

// ── Editor ─────────────────────────────────────────────────────────────────

export interface RebaseEditorProps {
  tab: RepoTab
  base: string
  /** OLDEST first. */
  commits: Commit[]
}

/** The editable todo list (exported for tests; mounted by RebaseView once commits are loaded). */
export function RebaseEditor({ tab, base, commits }: RebaseEditorProps) {
  const repo = tab.path
  const settings = useSettings()
  const [entries, setEntries] = useState<RebaseEntry[]>(() => initialEntries(commits))
  const [selectedSha, setSelectedSha] = useState<string>(() => commits[commits.length - 1]?.sha ?? '')
  const [running, setRunning] = useState(false)
  const [armed, setArmed] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemEls = useRef(new Map<string, HTMLDivElement>())
  const refCallbacks = useRef(new Map<string, (el: HTMLDivElement | null) => void>())
  /** Stable callback ref per commit (keeps memoised rows from re-rendering). */
  const itemRefFor = (sha: string) => {
    let cb = refCallbacks.current.get(sha)
    if (!cb) {
      cb = (el) => {
        if (el) itemEls.current.set(sha, el)
        else itemEls.current.delete(sha)
      }
      refCallbacks.current.set(sha, cb)
    }
    return cb
  }

  const n = entries.length
  const groupInfo = useMemo(() => computeGroups(entries), [entries])
  const issues = useMemo(() => validateRebase(entries), [entries])
  const issueByIndex = useMemo(() => {
    const m = new Map<number, string>()
    for (const i of issues) if (i.index !== null && !m.has(i.index)) m.set(i.index, i.message)
    return m
  }, [issues])
  const globalIssues = issues.filter((i) => i.index === null)
  const modified = isModified(entries, commits)
  const opState = tab.info?.state ?? 'none'
  const dirty = isDirty(tab)

  // Commits of the range that are already on the upstream (rewriting them needs a force push).
  const pushedCount = useMemo(() => {
    const cur = tab.refs?.branches.find((b) => b.isHead)
    if (!cur?.upstream || cur.upstreamGone || typeof cur.ahead !== 'number') return 0
    return Math.max(0, entries.length - cur.ahead)
  }, [tab.refs, entries.length])

  const blockedReason =
    opState !== 'none'
      ? 'Another operation is in progress. Finish or abort it first.'
      : dirty
        ? 'Commit or stash your changes before starting the rebase.'
        : issues.length
          ? 'Fix the problems above first.'
          : null
  const canStart = !blockedReason && !running

  // Latest state for stable callbacks.
  const latest = useRef({ entries, groupInfo, selectedSha })
  latest.current = { entries, groupInfo, selectedSha }

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true })
  }, [])

  // Keep the selected row visible when it moves or the selection changes.
  useEffect(() => {
    itemEls.current.get(selectedSha)?.scrollIntoView({ block: 'nearest' })
  }, [selectedSha, entries])

  // Disarm the drag handle when the pointer is released anywhere.
  useEffect(() => {
    if (armed === null) return
    const up = () => setArmed(null)
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [armed])

  // ── Mutations ──

  const changeAction = useCallback((index: number, action: RebaseAction) => {
    setEntries((prev) => setAction(prev, index, action))
  }, [])

  const changeMessage = useCallback((index: number, message: string) => {
    setEntries((prev) => setMessage(prev, index, message))
  }, [])

  const changeGroupMessage = useCallback((head: number, message: string | null) => {
    setEntries((prev) => {
      const gi = computeGroups(prev)
      const g = gi.groupOf[head] >= 0 ? gi.groups[gi.groupOf[head]] : null
      return g ? setGroupMessage(prev, g, message) : prev
    })
  }, [])

  const move = useCallback((from: number, to: number) => {
    setEntries((prev) => moveEntry(prev, from, to))
  }, [])

  // The selection also lives in a ref updated eagerly, so several key presses handled before
  // React re-renders (key repeat, scripted input) act on the right commit.
  const selRef = useRef(selectedSha)
  selRef.current = selectedSha
  const select = useCallback((sha: string) => {
    selRef.current = sha
    setSelectedSha(sha)
  }, [])

  /** Apply an edit to the selected commit, looked up by sha in the latest entries. */
  const editSelected = useCallback((fn: (list: RebaseEntry[], index: number) => RebaseEntry[]) => {
    const sha = selRef.current
    setEntries((prev) => {
      const i = prev.findIndex((x) => x.commit.sha === sha)
      return i < 0 ? prev : fn(prev, i)
    })
  }, [])

  const openActionMenu = useCallback(
    (el: HTMLElement, index: number) => {
      const { entries: list } = latest.current
      const e = list[index]
      if (!e) return
      const hasOlderKept = list.slice(0, index).some((x) => x.action !== 'drop')
      const items: MenuItem[] = REBASE_ACTIONS.map((a) => ({
        label: a.label,
        icon: <span className={`rb-dot rb-dot-${a.action}`} />,
        shortcut: a.key.toUpperCase(),
        checked: e.action === a.action,
        disabled: isMeld(a.action) && !hasOlderKept,
        onClick: () => changeAction(index, a.action)
      }))
      showMenuBelow(el, items)
    },
    [changeAction]
  )

  // ── Drag & drop (display space) ──
  // The drag source / drop position live in a ref too, so dragover/drop handlers never see a
  // stale render (events can arrive before React re-rendered after dragstart).
  const drag = useRef<{ from: number | null; at: number | null }>({ from: null, at: null })

  const onDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.setData(ROW_DRAG_MIME, String(index))
    e.dataTransfer.effectAllowed = 'move'
    drag.current = { from: index, at: null }
    setDragging(index)
    select(latest.current.entries[index]?.commit.sha ?? '')
  }, [select])

  const onDragOverItem = useCallback((e: React.DragEvent, displayIndex: number) => {
    if (drag.current.from === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const insertBefore = e.clientY < r.top + r.height / 2 ? displayIndex : displayIndex + 1
    drag.current.at = insertBefore
    setDropAt((cur) => (cur === insertBefore ? cur : insertBefore))
  }, [])

  const endDrag = useCallback(() => {
    drag.current = { from: null, at: null }
    setDragging(null)
    setDropAt(null)
    setArmed(null)
  }, [])

  const onDrop = (e: React.DragEvent) => {
    const { from, at } = drag.current
    if (from === null || at === null) return endDrag()
    e.preventDefault()
    const to = dropTargetTodoIndex(latest.current.entries.length, from, at)
    if (to !== from) move(from, to)
    endDrag()
  }

  // ── Keyboard ──

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isMod(e) && e.key === 'Enter') {
      e.preventDefault()
      void start()
      return
    }
    const target = e.target as HTMLElement
    if (isEditableTarget(target)) {
      if (e.key === 'Escape') {
        e.preventDefault()
        target.blur()
        listRef.current?.focus({ preventScroll: true })
      }
      return
    }
    if (e.metaKey || e.ctrlKey) return
    // A context menu handles its own arrow/enter keys.
    if (document.querySelector('.ui-menu')) return
    if (e.key === 'Escape' && !e.altKey && !e.shiftKey) {
      if (document.querySelector('.ui-backdrop')) return
      e.preventDefault()
      void cancel()
      return
    }
    const list = latest.current.entries
    const count = list.length
    const idx = list.findIndex((x) => x.commit.sha === selRef.current)
    const d = idx >= 0 ? toDisplayIndex(count, idx) : -1
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        if (e.altKey) {
          // Up in the display = newer = later in the todo.
          if (idx >= 0) editSelected((l, i) => moveEntry(l, i, i - dir))
          return
        }
        const nd = d < 0 ? 0 : Math.max(0, Math.min(count - 1, d + dir))
        select(list[toDisplayIndex(count, nd)].commit.sha)
        return
      }
      case 'Home':
      case 'End': {
        e.preventDefault()
        const nd = e.key === 'Home' ? 0 : count - 1
        select(list[toDisplayIndex(count, nd)].commit.sha)
        return
      }
      case 'Enter': {
        if (idx < 0) return
        e.preventDefault()
        const el = itemEls.current.get(selRef.current)?.querySelector<HTMLTextAreaElement>('textarea')
        el?.focus()
        return
      }
    }
    if (e.altKey || e.shiftKey) return
    const action = actionForKey(e.key)
    if (action && idx >= 0) {
      e.preventDefault()
      editSelected((l, i) => setAction(l, i, action))
    }
  }

  // ── Footer actions ──

  const reset = () => {
    setEntries(initialEntries(commits))
  }

  const cancel = async () => {
    if (running) return
    if (modified) {
      const ok = await confirm({
        title: 'Discard rebase plan?',
        message: 'Your changes to the commit list are lost. The branch is not modified.',
        confirmLabel: 'Discard',
        danger: true
      })
      if (!ok) return
    }
    showGraph(repo)
  }

  const start = async () => {
    if (!canStart) {
      if (blockedReason && !running) toast.warning(blockedReason)
      return
    }
    const todo = buildTodo(entries)
    const before = tab.info?.head.sha ?? tab.refs?.head.sha ?? null
    const store = useApp.getState()
    const busyKey = `rebase:${repo}`
    setRunning(true)
    store.setBusy(busyKey, 'Rebasing…')
    let res: OperationResult | undefined
    try {
      res = await api.interactiveRebase(repo, base, todo)
    } catch (err) {
      toast.error(err)
    } finally {
      useApp.getState().setBusy(busyKey, null)
    }
    const ok = handleOperationResult(repo, res, 'Rebase completed')
    await useApp.getState().refresh(repo)
    if (ok) {
      pushUndo(repo, before)
      showGraph(repo)
    } else if (res && res.state !== 'none') {
      // Stopped on conflicts or at an "edit" commit: the operation banner takes over.
      showGraph(repo)
    } else {
      setRunning(false)
    }
  }

  // ── Render ──

  const displayEntries = useMemo(() => entries.map((_, d) => toDisplayIndex(entries.length, d)), [entries])

  return (
    <div className="rb-editor">
      {(opState !== 'none' || dirty || pushedCount > 0) && (
        <div className="rb-notices">
          {opState !== 'none' && (
            <div className="rb-notice rb-notice-error">
              <AlertTriangle size={14} /> Another operation is in progress. Finish or abort it before starting an interactive rebase.
            </div>
          )}
          {opState === 'none' && dirty && (
            <div className="rb-notice rb-notice-error">
              <AlertTriangle size={14} /> You have uncommitted changes. Commit or stash them before starting the rebase.
            </div>
          )}
          {pushedCount > 0 && (
            <div className="rb-notice rb-notice-warn">
              <AlertTriangle size={14} />
              {pluralize(pushedCount, 'commit')} in this range {pushedCount === 1 ? 'was' : 'were'} already pushed. Rewriting them will require a
              force push.
            </div>
          )}
        </div>
      )}

      <div className="rb-columns" aria-hidden>
        <span className="rb-col-handle" />
        <span className="rb-col-action">Action</span>
        <span className="rb-col-avatar" />
        <span className="rb-col-sha">Commit</span>
        <span className="rb-col-subject">Message</span>
        <span className="rb-col-author">Author</span>
        <span className="rb-col-date">Date</span>
      </div>

      <div
        ref={listRef}
        className={`rb-list${dragging !== null ? ' rb-list-dragging' : ''}`}
        tabIndex={0}
        role="listbox"
        aria-label="Commits to rebase, newest first"
        aria-activedescendant={selectedSha ? `rb-row-${selectedSha}` : undefined}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (drag.current.from !== null) e.preventDefault()
        }}
        onDrop={onDrop}
      >
        {displayEntries.map((todoIndex, d) => {
          const entry = entries[todoIndex]
          const sha = entry.commit.sha
          const target = groupInfo.targetOf[todoIndex]
          const gIdx = groupInfo.groupOf[todoIndex]
          const group = gIdx >= 0 ? groupInfo.groups[gIdx] : null
          const isHeadOfSquash = !!group && group.head === todoIndex && group.squashMembers.length > 0
          return (
            <RebaseRow
              key={sha}
              entry={entry}
              todoIndex={todoIndex}
              displayIndex={d}
              selected={sha === selectedSha}
              armed={armed === todoIndex}
              isDragging={dragging === todoIndex}
              dropBefore={dropAt === d && dragging !== null}
              dropAfter={dropAt === n && d === n - 1 && dragging !== null}
              meldTarget={target !== null && isMeld(entry.action) ? entries[target].commit : null}
              error={issueByIndex.get(todoIndex)}
              groupMessage={isHeadOfSquash ? groupMessage(entries, group!) : null}
              groupCustom={isHeadOfSquash ? customGroupMessage(entries, group!) !== undefined : false}
              groupSize={isHeadOfSquash ? group!.members.length + 1 : 0}
              dateText={formatDate(entry.commit.authorDate, settings.dateFormat)}
              disabled={running}
              itemRef={itemRefFor(sha)}
              onSelect={select}
              onOpenMenu={openActionMenu}
              onMessage={changeMessage}
              onGroupMessage={changeGroupMessage}
              onArm={setArmed}
              onDragStart={onDragStart}
              onDragOverItem={onDragOverItem}
              onDragEnd={endDrag}
            />
          )
        })}
      </div>

      <footer className="rb-footer">
        <div className="rb-summary">
          <span className="rb-summary-main">{summarize(entries)}</span>
          <span className="rb-summary-result">→ {pluralize(resultCount(entries), 'commit')} after rebase</span>
          {globalIssues.map((i) => (
            <span key={i.message} className="rb-summary-error">
              <AlertTriangle size={12} /> {i.message}
            </span>
          ))}
        </div>
        <span className="rb-footer-hint">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> select · <Kbd>P</Kbd>
          <Kbd>R</Kbd>
          <Kbd>E</Kbd>
          <Kbd>S</Kbd>
          <Kbd>F</Kbd>
          <Kbd>D</Kbd> action · <Kbd>{isMac ? '⌥' : 'Alt'}</Kbd>
          <Kbd>↑</Kbd>/<Kbd>↓</Kbd> move
        </span>
        <span className="rb-spacer" />
        <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={!modified || running} onClick={reset}>
          Reset
        </Button>
        <Button size="sm" disabled={running} onClick={() => void cancel()}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Play size={12} />}
          loading={running}
          disabled={!canStart}
          title={blockedReason ?? `Start the rebase (${isMac ? '⌘' : 'Ctrl+'}Enter)`}
          onClick={() => void start()}
        >
          Start Rebase
        </Button>
      </footer>
    </div>
  )
}

/** Undo = move the branch back to where it was before the rebase (redo = forward again). */
function pushUndo(repo: string, before: string | null): void {
  const after = tabOf(repo)?.info?.head.sha ?? null
  if (!before || !after || before === after) return
  const ensureClean = () => {
    if (isDirty(tabOf(repo))) throw new Error('Commit or stash your changes before undoing or redoing the rebase.')
  }
  useApp.getState().pushHistory(repo, {
    label: 'Interactive rebase',
    undo: async () => {
      ensureClean()
      await api.reset(repo, before, 'hard')
      await useApp.getState().refresh(repo)
    },
    redo: async () => {
      ensureClean()
      await api.reset(repo, after, 'hard')
      await useApp.getState().refresh(repo)
    }
  })
}

// ── Row ────────────────────────────────────────────────────────────────────

interface RowProps {
  entry: RebaseEntry
  todoIndex: number
  displayIndex: number
  selected: boolean
  armed: boolean
  isDragging: boolean
  dropBefore: boolean
  dropAfter: boolean
  meldTarget: Commit | null
  error?: string
  /** Combined message editor (only on the head of a group with squash members). */
  groupMessage: string | null
  groupCustom: boolean
  groupSize: number
  dateText: string
  disabled: boolean
  itemRef(el: HTMLDivElement | null): void
  onSelect(sha: string): void
  onOpenMenu(el: HTMLElement, index: number): void
  onMessage(index: number, message: string): void
  onGroupMessage(head: number, message: string | null): void
  onArm(index: number | null): void
  onDragStart(e: React.DragEvent, index: number): void
  onDragOverItem(e: React.DragEvent, displayIndex: number): void
  onDragEnd(): void
}

const RebaseRow = memo(function RebaseRow(p: RowProps) {
  const { entry, todoIndex, displayIndex } = p
  const { commit, action } = entry
  const info = ACTION_INFO[action]
  const meld = isMeld(action)
  const isMerge = commit.parents.length > 1

  const cls = [
    'rb-item',
    `rb-item-${action}`,
    p.selected ? 'rb-selected' : '',
    p.isDragging ? 'rb-dragging' : '',
    p.dropBefore ? 'rb-drop-before' : '',
    p.dropAfter ? 'rb-drop-after' : '',
    p.error ? 'rb-invalid' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={p.itemRef}
      id={`rb-row-${commit.sha}`}
      role="option"
      aria-selected={p.selected}
      className={cls}
      draggable={p.armed && !p.disabled}
      onDragStart={(e) => p.onDragStart(e, todoIndex)}
      onDragOver={(e) => p.onDragOverItem(e, displayIndex)}
      onDragEnd={p.onDragEnd}
      onMouseDown={() => p.onSelect(commit.sha)}
    >
      <div className="rb-row">
        <span
          className="rb-handle"
          title="Drag to reorder"
          onPointerDown={(e) => {
            if (e.button === 0 && !p.disabled) p.onArm(todoIndex)
          }}
        >
          <GripVertical size={14} />
        </span>
        <button
          type="button"
          className={`rb-action rb-action-${action}`}
          disabled={p.disabled}
          title={`${info.label} — ${info.description} (${info.key.toUpperCase()})`}
          onClick={(e) => p.onOpenMenu(e.currentTarget, todoIndex)}
        >
          <span className="rb-action-label">{info.label}</span>
          <ChevronDown size={11} />
        </button>
        <Avatar name={commit.authorName} email={commit.authorEmail} size={20} className="rb-avatar" />
        <span className="rb-sha mono" title={commit.sha}>
          {shortSha(commit.sha)}
        </span>
        <span className={`rb-subject${meld ? ' rb-subject-meld' : ''}`} title={commit.body ? `${commit.subject}\n\n${commit.body}` : commit.subject}>
          {meld && (
            <span className="rb-meld-hint">
              <CornerDownRight size={12} />
              {action} into {p.meldTarget ? shortSha(p.meldTarget.sha) : '—'}
            </span>
          )}
          {isMerge && <span className="rb-merge-badge">merge</span>}
          <span className="rb-subject-text">{action === 'reword' && entry.message ? firstLineOf(entry.message) : commit.subject}</span>
        </span>
        <span className="rb-author" title={`${commit.authorName} <${commit.authorEmail}>`}>
          {commit.authorName}
        </span>
        <span className="rb-date" title={absoluteTime(commit.authorDate)}>
          {p.dateText}
        </span>
      </div>

      {action === 'reword' && (
        <MessageEditor
          label="New commit message"
          value={entry.message ?? ''}
          disabled={p.disabled}
          onChange={(v) => p.onMessage(todoIndex, v)}
        />
      )}

      {p.groupMessage !== null && (
        <MessageEditor
          label={`Combined message for ${p.groupSize} commits`}
          value={p.groupMessage}
          disabled={p.disabled}
          onChange={(v) => p.onGroupMessage(todoIndex, v)}
          onReset={p.groupCustom ? () => p.onGroupMessage(todoIndex, null) : undefined}
          variant="squash"
        />
      )}

      {p.error && (
        <div className="rb-row-error" role="alert">
          <AlertTriangle size={12} /> {p.error}
        </div>
      )}
    </div>
  )
})

function firstLineOf(s: string): string {
  const t = s.trimStart()
  const i = t.indexOf('\n')
  return i >= 0 ? t.slice(0, i) : t
}

function MessageEditor({
  label,
  value,
  disabled,
  onChange,
  onReset,
  variant
}: {
  label: string
  value: string
  disabled: boolean
  onChange(v: string): void
  onReset?: () => void
  variant?: 'squash'
}) {
  const lines = value.split('\n').length
  const rows = Math.max(2, Math.min(12, lines + 1))
  const summary = value.split('\n')[0] ?? ''
  return (
    <div className={`rb-msg${variant ? ` rb-msg-${variant}` : ''}`}>
      <div className="rb-msg-head">
        <span className="rb-msg-label">{label}</span>
        <span className={`rb-msg-count${summary.length > 72 ? ' rb-msg-count-warn' : ''}`} title="Summary length">
          {summary.length}
        </span>
        {onReset && (
          <button type="button" className="ui-link rb-msg-reset" onClick={onReset}>
            Reset to default
          </button>
        )}
      </div>
      <textarea
        className="ui-input ui-mono rb-msg-input"
        value={value}
        rows={rows}
        spellCheck
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  )
}
