// Blame: file content with, for each run of lines introduced by the same commit,
// the author, date, sha and summary, plus an age heat stripe (newer = warmer).
// Clicking a group reveals that commit in the graph.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Copy, ExternalLink, GitCommitHorizontal, History, ScanText, X } from 'lucide-react'
import { api } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { showContextMenu } from '@renderer/components/common/ContextMenu'
import { Resizer } from '@renderer/components/common/Resizer'
import { isEditableTarget } from '@renderer/lib/keys'
import { absoluteTime, formatDate } from '@renderer/lib/format'
import type { RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { BlameLine } from '@shared/types'
import { Code } from './DiffRenderer'
import { visualWidth } from './diffModel'
import type { Token } from './highlight'
import { groupBlame, heatScale, isUncommittedSha, type BlameGroup } from './history'
import { revealCommit, revealWorkingTree } from './nav'
import { PathLabel } from './parts'
import { useDiffPrefs } from './prefs'
import { shortRev } from './targets'
import { useSyntax } from './useSyntax'
import './diff.css'

const ROW_H = 20
const GUTTER_KEY = 'adar.diff.blameGutterWidth'

function readGutterWidth(): number {
  try {
    const v = Number(localStorage.getItem(GUTTER_KEY))
    return v >= 200 && v <= 720 ? v : 340
  } catch {
    return 340
  }
}

export function BlameView({ tab, path, rev }: { tab: RepoTab; path: string; rev?: string }) {
  const repo = tab.path
  const { dateFormat } = useDiffPrefs()
  const [lines, setLines] = useState<BlameLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [gutterW, setGutterW] = useState(readGutterWidth)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setError(null)
    api.getBlame(repo, path, rev).then(
      (res) => alive && setLines(res),
      (err) => alive && setError(describeError(err))
    )
    return () => {
      alive = false
    }
  }, [repo, path, rev, reloadTick])

  // Working-tree blame follows edits.
  const status = tab.status
  const seenStatus = useRef(status)
  useEffect(() => {
    if (seenStatus.current === status) return
    seenStatus.current = status
    if (!rev) setReloadTick((t) => t + 1)
  }, [status, rev])

  const { groups, groupOf } = useMemo(() => groupBlame(lines ?? []), [lines])
  const heat = useMemo(() => heatScale(lines ?? []), [lines])
  const blocks = useMemo(() => (lines ? [lines.map((l) => l.content)] : null), [lines])
  const lookup = useSyntax(path, blocks)

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: lines?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 30,
    useFlushSync: false
  })

  // Focus the content once it first appears (not on later reloads: that would steal focus).
  const focusedOnce = useRef(false)
  useEffect(() => {
    if (!lines || focusedOnce.current) return
    focusedOnce.current = true
    scrollRef.current?.focus({ preventScroll: true })
  }, [lines])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target) || document.querySelector('.ui-backdrop, .ui-menu')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        git.showGraph(repo)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repo])

  const openGroup = useCallback(
    (g: BlameGroup) => {
      if (isUncommittedSha(g.line.sha)) revealWorkingTree(repo)
      else void revealCommit(repo, g.line.sha)
    },
    [repo]
  )

  const groupMenu = useCallback(
    (e: React.MouseEvent, g: BlameGroup) => {
      const uncommitted = isUncommittedSha(g.line.sha)
      showContextMenu(e, [
        {
          label: uncommitted ? 'Show working tree changes' : 'Show commit in graph',
          icon: <GitCommitHorizontal size={14} />,
          onClick: () => openGroup(g)
        },
        {
          label: 'Blame previous revision',
          icon: <ScanText size={14} />,
          disabled: uncommitted,
          onClick: () => git.openBlame(repo, path, `${g.line.sha}^`)
        },
        { type: 'separator' },
        {
          label: 'Copy commit SHA',
          icon: <Copy size={14} />,
          disabled: uncommitted,
          onClick: () => git.copyText(g.line.sha, 'Commit SHA copied')
        }
      ])
    },
    [repo, path, openGroup]
  )

  const digits = Math.max(2, String(lines?.length ?? 1).length)
  const maxCols = useMemo(() => (lines ?? []).reduce((m, l) => Math.max(m, visualWidth(l.content)), 0), [lines])
  const style = { '--diff-digits': digits, '--diff-blame-w': `${gutterW}px` } as CSSProperties

  return (
    <div className="diff-view diff-blame">
      <div className="diff-header">
        <div className="diff-titlebar">
          <ScanText size={15} className="diff-title-icon" />
          <span className="diff-title-label">Blame</span>
          <PathLabel path={path} />
          <span className="diff-target">{rev ? `at ${shortRev(rev)}` : 'Working tree'}</span>
          {lines && (
            <span className="diff-target">
              {groups.length} change{groups.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="diff-spacer" />
          <Button size="sm" variant="ghost" icon={<History size={14} />} onClick={() => git.openFileHistory(repo, path)}>
            History
          </Button>
          <IconButton size="sm" label="Open in editor" onClick={() => void git.openInEditor(git.absPath(repo, path))}>
            <ExternalLink size={14} />
          </IconButton>
          <IconButton label="Close (Esc)" onClick={() => git.showGraph(repo)}>
            <X size={16} />
          </IconButton>
        </div>
      </div>
      <div className="diff-body">
        {error ? (
          <EmptyState icon={<AlertTriangle size={36} />} title="Could not blame this file">
            <p className="diff-empty-text">{error}</p>
            <div className="diff-empty-actions">
              <Button size="sm" onClick={() => setReloadTick((t) => t + 1)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => git.showGraph(repo)}>
                Back to graph
              </Button>
            </div>
          </EmptyState>
        ) : !lines ? (
          <div className="diff-center">
            <Spinner size="lg" />
          </div>
        ) : !lines.length ? (
          <EmptyState icon={<ScanText size={36} />} title="Empty file" />
        ) : (
          <div className="diff-blame-wrap" style={style}>
            <div ref={scrollRef} className="diff-scroll diff-blame-scroll" tabIndex={0} onMouseLeave={() => setHovered(null)}>
              <div
                className="diff-sizer"
                style={{ height: virtualizer.getTotalSize(), minWidth: `calc(${gutterW}px + ${digits}ch + 40px + ${maxCols}ch)` }}
              >
                {virtualizer.getVirtualItems().map((v) => {
                  const g = groupOf[v.index]
                  const group = groups[g]
                  return (
                    <BlameRow
                      key={v.index}
                      top={v.start}
                      line={lines[v.index]}
                      group={group}
                      groupIndex={g}
                      first={group.start === v.index}
                      last={group.end === v.index + 1}
                      hovered={hovered === g}
                      heat={isUncommittedSha(group.line.sha) ? null : heat(group.line.authorDate)}
                      tokens={lookup(0, v.index)}
                      dateFormat={dateFormat}
                      onHover={setHovered}
                      onOpen={openGroup}
                      onMenu={groupMenu}
                    />
                  )
                })}
              </div>
            </div>
            <div className="diff-blame-resizer" style={{ left: gutterW }}>
              <Resizer
                side="left"
                width={gutterW}
                min={200}
                max={720}
                onResize={(w) => {
                  setGutterW(w)
                  try {
                    localStorage.setItem(GUTTER_KEY, String(w))
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface BlameRowProps {
  top: number
  line: BlameLine
  group: BlameGroup
  groupIndex: number
  first: boolean
  last: boolean
  hovered: boolean
  heat: number | null
  tokens: Token[] | null
  dateFormat: 'relative' | 'absolute'
  onHover(group: number): void
  onOpen(group: BlameGroup): void
  onMenu(e: React.MouseEvent, group: BlameGroup): void
}

const BlameRow = memo(function BlameRow({
  top,
  line,
  group,
  groupIndex,
  first,
  last,
  hovered,
  heat,
  tokens,
  dateFormat,
  onHover,
  onOpen,
  onMenu
}: BlameRowProps) {
  const info = group.line
  const uncommitted = heat === null
  const stripe = uncommitted ? 'var(--accent)' : `color-mix(in srgb, var(--c-conflict) ${Math.round(heat * 100)}%, var(--c-renamed))`
  const title = uncommitted
    ? 'Not committed yet'
    : `${info.summary}\n\n${info.authorName} <${info.authorEmail}>\n${absoluteTime(info.authorDate)}\n${info.sha}`
  return (
    <div
      className={`diff-row diff-blame-row${first ? ' diff-blame-first' : ''}${last ? ' diff-blame-last' : ''}${hovered ? ' diff-blame-hover' : ''}${groupIndex % 2 ? ' diff-blame-odd' : ''}`}
      style={{ transform: `translateY(${top}px)` }}
      onMouseEnter={() => onHover(groupIndex)}
    >
      <div className="diff-blame-fixed">
        <div className="diff-blame-gutter" title={title} onClick={() => onOpen(group)} onContextMenu={(e) => onMenu(e, group)}>
          {first &&
            (uncommitted ? (
              <span className="diff-blame-info">
                <span className="diff-blame-uncommitted">Uncommitted changes</span>
              </span>
            ) : (
              <span className="diff-blame-info">
                <Avatar name={info.authorName} email={info.authorEmail} size={16} />
                <span className="diff-blame-author">{info.authorName}</span>
                <span className="diff-blame-summary">{info.summary}</span>
                <span className="diff-blame-date">{formatDate(info.authorDate, dateFormat)}</span>
                <span className="diff-blame-sha">{info.sha.slice(0, 7)}</span>
              </span>
            ))}
        </div>
        <span className="diff-blame-heat" style={{ background: stripe }} />
        <span className="diff-num">{line.lineNo}</span>
      </div>
      <Code text={line.content} tokens={tokens} ranges={null} type="context" noNewline={false} />
    </div>
  )
})
