// File history: commits touching a file (following renames) on the left, the
// file's diff in the selected commit on the right.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Copy, ExternalLink, GitCommitHorizontal, History, ScanText, X } from 'lucide-react'
import { api } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { showContextMenu } from '@renderer/components/common/ContextMenu'
import { Resizer } from '@renderer/components/common/Resizer'
import { isEditableTarget } from '@renderer/lib/keys'
import { absoluteTime, formatDate, shortSha } from '@renderer/lib/format'
import type { RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { Commit, DiffTarget, FileDiff } from '@shared/types'
import { DiffBody } from './DiffBody'
import type { DiffRendererHandle } from './DiffRenderer'
import { followLogArgs, parseFollowLog, type HistoryPathEntry } from './history'
import { revealCommit } from './nav'
import { ChangeStats, DiffMoreButton, FullFileToggle, PathLabel, StatusBadge, ViewModeSwitch } from './parts'
import { setFullFile, toggleFullFile, useDiffPrefs } from './prefs'
import './diff.css'

const MAX_COMMITS = 2000
const ITEM_H = 48
const LIST_W_KEY = 'adar.diff.historyListWidth'

function readListWidth(): number {
  try {
    const v = Number(localStorage.getItem(LIST_W_KEY))
    return v >= 220 && v <= 700 ? v : 340
  } catch {
    return 340
  }
}

export function FileHistoryView({ tab, path }: { tab: RepoTab; path: string }) {
  const repo = tab.path
  const { dateFormat } = useDiffPrefs()
  const [commits, setCommits] = useState<Commit[] | null>(null)
  const [paths, setPaths] = useState<Map<string, HistoryPathEntry>>(() => new Map())
  const [error, setError] = useState<string | null>(null)
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [listWidth, setListWidth] = useState(readListWidth)
  const [reloadTick, setReloadTick] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // New commits (commit, pull, checkout...) refresh the history.
  const headSha = tab.refs?.head.sha ?? tab.info?.head.sha ?? null

  // ── Load history ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    setError(null)
    api.getFileHistory(repo, path, { maxCount: MAX_COMMITS }).then(
      (list) => {
        if (!alive) return
        setCommits(list)
        setSelectedSha((cur) => (cur && list.some((c) => c.sha === cur) ? cur : (list[0]?.sha ?? null)))
      },
      (err) => alive && setError(describeError(err))
    )
    // Per-commit path / status of the file (renames): best effort.
    api.runGit(repo, followLogArgs(path, MAX_COMMITS)).then(
      (res) => alive && res.code === 0 && setPaths(parseFollowLog(res.stdout)),
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [repo, path, reloadTick, headSha])

  const index = useMemo(() => (commits && selectedSha ? commits.findIndex((c) => c.sha === selectedSha) : -1), [commits, selectedSha])
  const selected = index >= 0 ? commits![index] : null
  const entry = selected ? paths.get(selected.sha) : undefined
  const target: DiffTarget | null = selected
    ? { kind: 'commit', sha: selected.sha, path: entry?.path ?? path, ...(entry?.oldPath ? { oldPath: entry.oldPath } : {}) }
    : null

  // ── List virtualisation & keyboard ────────────────────────────────────────
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: commits?.length ?? 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => ITEM_H,
    overscan: 12,
    useFlushSync: false
  })

  const selectIndex = useCallback(
    (i: number) => {
      if (!commits?.length) return
      const clamped = Math.max(0, Math.min(commits.length - 1, i))
      setSelectedSha(commits[clamped].sha)
      virtualizer.scrollToIndex(clamped, { align: 'auto' })
    },
    [commits, virtualizer]
  )

  const onListKey = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 400) / ITEM_H) - 1)
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, j: 1, k: -1 }
    if (Object.hasOwn(moves, e.key)) {
      e.preventDefault()
      selectIndex((index < 0 ? 0 : index) + moves[e.key])
    } else if (e.key === 'Home') {
      e.preventDefault()
      selectIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      selectIndex((commits?.length ?? 1) - 1)
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault()
      void revealCommit(repo, selected.sha)
    }
  }

  const focusedOnce = useRef(false)
  useEffect(() => {
    if (!commits?.length || focusedOnce.current) return
    focusedOnce.current = true
    listRef.current?.focus({ preventScroll: true })
  }, [commits?.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target) || document.querySelector('.ui-backdrop, .ui-menu')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        git.showGraph(repo)
        return
      }
      const a = document.activeElement
      const inView = !a || a === document.body || !!rootRef.current?.contains(a)
      if (e.key === 'f' && inView && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        toggleFullFile()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repo])

  const commitMenu = (e: React.MouseEvent, c: Commit) => {
    const p = paths.get(c.sha)
    showContextMenu(e, [
      { label: 'Show commit in graph', icon: <GitCommitHorizontal size={14} />, onClick: () => revealCommit(repo, c.sha) },
      {
        label: 'Blame at this commit',
        icon: <ScanText size={14} />,
        disabled: p?.status === 'deleted',
        onClick: () => git.openBlame(repo, p?.path ?? path, c.sha)
      },
      {
        label: 'Open diff',
        icon: <History size={14} />,
        onClick: () =>
          git.openDiff(repo, { kind: 'commit', sha: c.sha, path: p?.path ?? path, ...(p?.oldPath ? { oldPath: p.oldPath } : {}) })
      },
      { type: 'separator' },
      { label: 'Copy commit SHA', icon: <Copy size={14} />, onClick: () => git.copyText(c.sha, 'Commit SHA copied') }
    ])
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="diff-view diff-history" ref={rootRef}>
      <div className="diff-header">
        <div className="diff-titlebar">
          <History size={15} className="diff-title-icon" />
          <span className="diff-title-label">File History</span>
          <PathLabel path={path} />
          {commits && (
            <span className="diff-target">
              {commits.length >= MAX_COMMITS ? `${MAX_COMMITS}+ commits` : `${commits.length} commit${commits.length === 1 ? '' : 's'}`}
            </span>
          )}
          <span className="diff-spacer" />
          <Button
            size="sm"
            variant="ghost"
            icon={<ScanText size={14} />}
            onClick={() => git.openBlame(repo, path)}
            title="Blame the working tree version"
          >
            Blame
          </Button>
          <IconButton size="sm" label="Open in editor" onClick={() => void git.openInEditor(git.absPath(repo, path))}>
            <ExternalLink size={14} />
          </IconButton>
          <IconButton label="Close (Esc)" onClick={() => git.showGraph(repo)}>
            <X size={16} />
          </IconButton>
        </div>
      </div>

      <div className="diff-history-main">
        <div className="diff-history-list" style={{ width: listWidth }}>
          {error ? (
            <EmptyState icon={<AlertTriangle size={30} />} title="Could not load the history">
              <p className="diff-empty-text">{error}</p>
              <Button size="sm" onClick={() => setReloadTick((t) => t + 1)}>
                Retry
              </Button>
            </EmptyState>
          ) : !commits ? (
            <div className="diff-center">
              <Spinner />
            </div>
          ) : !commits.length ? (
            <EmptyState icon={<History size={30} />} title="No history">
              This file has not been committed yet.
            </EmptyState>
          ) : (
            <div ref={listRef} className="diff-hl-scroll" tabIndex={0} onKeyDown={onListKey} role="listbox" aria-label="Commits">
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((v) => {
                  const c = commits[v.index]
                  const p = paths.get(c.sha)
                  const active = c.sha === selectedSha
                  return (
                    <div
                      key={c.sha}
                      role="option"
                      aria-selected={active}
                      className={`diff-hl-item${active ? ' diff-hl-active' : ''}`}
                      style={{ transform: `translateY(${v.start}px)`, height: ITEM_H }}
                      onMouseDown={() => {
                        setSelectedSha(c.sha)
                        listRef.current?.focus({ preventScroll: true })
                      }}
                      onDoubleClick={() => void revealCommit(repo, c.sha)}
                      onContextMenu={(e) => {
                        setSelectedSha(c.sha)
                        commitMenu(e, c)
                      }}
                      title={`${c.subject}\n${c.authorName} <${c.authorEmail}>\n${absoluteTime(c.authorDate)}`}
                    >
                      <Avatar name={c.authorName} email={c.authorEmail} size={26} />
                      <div className="diff-hl-text">
                        <div className="diff-hl-subject">{c.subject || '(no message)'}</div>
                        <div className="diff-hl-meta">
                          <span className="diff-hl-author">{c.authorName}</span>
                          <span className="diff-hl-dot">·</span>
                          <span>{formatDate(c.authorDate, dateFormat)}</span>
                        </div>
                      </div>
                      <div className="diff-hl-side">
                        <span className="diff-hl-sha">{c.shortSha || shortSha(c.sha)}</span>
                        {p && p.status !== 'modified' && <StatusBadge status={p.status} />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <Resizer
          side="left"
          width={listWidth}
          min={220}
          max={700}
          onResize={(w) => {
            setListWidth(w)
            try {
              localStorage.setItem(LIST_W_KEY, String(w))
            } catch {
              /* ignore */
            }
          }}
        />
        <div className="diff-history-diff">
          {selected && target ? (
            <CommitFileDiff repo={repo} commit={selected} target={target} entry={entry} />
          ) : commits && commits.length ? (
            <EmptyState title="Select a commit" />
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Diff of the file in one commit, with its own small header and view controls. */
function CommitFileDiff({
  repo,
  commit,
  target,
  entry
}: {
  repo: string
  commit: Commit
  target: DiffTarget & { kind: 'commit' }
  entry?: HistoryPathEntry
}) {
  const { mode, fullFile, ignoreWhitespace, context, contextLines, dateFormat } = useDiffPrefs()
  const key = JSON.stringify(target)
  const [diff, setDiff] = useState<{ key: string; diff: FileDiff; full: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const handle = useRef<DiffRendererHandle | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    // Small delay so holding an arrow key through the list does not fire a diff per commit.
    const timer = setTimeout(() => {
      api.getDiff(repo, JSON.parse(key) as DiffTarget, { context, ignoreWhitespace }).then(
        (d) => {
          if (!alive) return
          setDiff({ key, diff: d, full: fullFile })
          setLoading(false)
        },
        (err) => {
          if (!alive) return
          setError(describeError(err))
          setLoading(false)
        }
      )
    }, 60)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [repo, key, context, fullFile, ignoreWhitespace])

  const current = diff?.diff
  const path = target.path
  return (
    <div className="diff-hd">
      <div className="diff-hd-header">
        <Avatar name={commit.authorName} email={commit.authorEmail} size={28} />
        <div className="diff-hd-info">
          <div className="diff-hd-subject selectable" title={commit.subject}>
            {commit.subject || '(no message)'}
          </div>
          <div className="diff-hd-meta">
            <span className="diff-hl-author">{commit.authorName}</span>
            <span className="diff-hl-dot">·</span>
            <span title={absoluteTime(commit.authorDate)}>{formatDate(commit.authorDate, dateFormat)}</span>
            <span className="diff-hl-dot">·</span>
            <button className="diff-sha-link" title="Show commit in graph" onClick={() => void revealCommit(repo, commit.sha)}>
              {commit.shortSha || shortSha(commit.sha)}
            </button>
            {entry?.oldPath && (
              <>
                <span className="diff-hl-dot">·</span>
                <span className="diff-renamed">renamed from {entry.oldPath}</span>
              </>
            )}
          </div>
        </div>
        {current && !current.binary && <ChangeStats additions={current.additions} deletions={current.deletions} />}
      </div>
      <div className="diff-toolbar">
        {(!current || (!current.isImage && !current.binary)) && (
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
          title="Show this commit in the graph"
          icon={<GitCommitHorizontal size={14} />}
          onClick={() => void revealCommit(repo, commit.sha)}
        >
          View Commit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="diff-tb-btn"
          title="Blame the file at this commit"
          icon={<ScanText size={14} />}
          disabled={entry?.status === 'deleted' || current?.status === 'deleted'}
          onClick={() => git.openBlame(repo, path, commit.sha)}
        >
          Blame
        </Button>
        <DiffMoreButton
          repo={repo}
          path={path}
          canOpen={current?.status !== 'deleted'}
          ignoreWhitespace={ignoreWhitespace}
          contextLines={contextLines}
          fullFile={fullFile}
        />
        {loading && current && <Spinner size="sm" />}
      </div>
      <div className="diff-body">
        {error ? (
          <EmptyState icon={<AlertTriangle size={30} />} title="Could not load the diff">
            {error}
          </EmptyState>
        ) : !current ? (
          <div className="diff-center">
            <Spinner />
          </div>
        ) : (
          <DiffBody
            repo={repo}
            diff={current}
            target={target}
            mode={mode}
            fullFile={diff!.full}
            handle={handle}
            resetKey={diff!.key}
            ignoreWhitespace={ignoreWhitespace}
            onShowChangesOnly={() => setFullFile(false)}
          />
        )}
      </div>
    </div>
  )
}
