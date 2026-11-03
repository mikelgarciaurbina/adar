// The reflog, instead of the graph. Lost commits: what no branch reaches any more, grouped by what left it
// behind (a reset, a deleted branch, a detached HEAD; rewritten ones folded away), each group with its way
// back. Every move: HEAD's or a branch's reflog in words. A selected commit shows in the right panel.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, Copy, GitBranchPlus, GitCommitHorizontal, History, RefreshCw, RotateCcw, Sparkle, Undo2, X } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { branchFromLost, moveBranchBack, openReflog, restoreBranch, type ReflogMode } from '@renderer/actions/reflog'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { showContextMenu, type MenuItem } from '@renderer/components/common/ContextMenu'
import { absoluteTime, relativeTime, shortSha } from '@renderer/lib/format'
import { isEditableTarget } from '@renderer/lib/keys'
import { currentBranch } from '@renderer/lib/refs'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { DanglingCommit, LostCommit, LostGroup, ReflogEntry } from '@shared/types'
import { KIND_LABEL, MOVE_LABEL, groupDetail, groupTitle, keptText, moveDetail, rewrittenText, splitGroups } from './model'
import { forgetDeeper, loadLostCommits, loadMoves, lookDeeper, movesKey, useReflog } from './reflogStore'
import './reflog.css'

/** Commits a group shows before "N more commits". */
const FOLDED = 5
const ROW = 36

export function ReflogView({ tab, mode }: { tab: RepoTab; mode: ReflogMode }) {
  const repo = tab.path
  const rootRef = useRef<HTMLDivElement>(null)
  const [ref, setRef] = useState<string | null>(null)
  const selected = tab.selection.kind === 'commit' ? tab.selection.sha : null
  const select = (sha: string) => useApp.getState().select(repo, { kind: 'commit', sha })
  // Reload whenever branches or HEAD move (a restore, a reset, a commit in a terminal).
  const refsKey = useMemo(() => [tab.refs?.head.sha, ...(tab.refs?.branches ?? []).map((b) => `${b.name}@${b.sha}`)].join('\n'), [tab.refs])
  useEffect(() => {
    void loadLostCommits(repo)
    // What looking deeper found may be on a branch now: look again when asked.
    forgetDeeper(repo)
  }, [repo, refsKey])
  useEffect(() => {
    if (mode === 'moves') void loadMoves(repo, ref)
  }, [repo, mode, ref, refsKey])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target) || document.querySelector('.ui-backdrop, .ui-menu')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        git.showGraph(repo)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repo])

  const lost = useReflog((s) => s.lost[repo])
  const moves = useReflog((s) => s.moves[movesKey(repo, ref)])
  const groups = lost?.data?.groups
  const { shown, rewritten } = useMemo(() => splitGroups(groups ?? []), [groups])
  const lostCount = shown.reduce((n, g) => n + g.commits.length, 0)
  const onto = currentBranch(tab.refs)?.name ?? 'HEAD'

  const commitMenu = (e: MouseEvent, c: { sha: string; subject: string }, opts: { lost: boolean; moves?: boolean }) => {
    select(c.sha)
    const items: MenuItem[] = [
      { type: 'header', label: `${shortSha(c.sha)} · ${c.subject}` },
      { label: 'Create branch here…', icon: <GitBranchPlus size={14} />, onClick: () => void branchFromLost(repo, c) },
      { label: 'Check out (detached)', icon: <GitCommitHorizontal size={14} />, onClick: () => void git.checkout(repo, c.sha) },
      { label: `Cherry-pick onto ${onto}`, icon: <RotateCcw size={14} />, disabled: !currentBranch(tab.refs), onClick: () => void git.cherryPick(repo, [c.sha]) }
    ]
    if (opts.moves && opts.lost) items.push({ label: 'Show in Lost commits', icon: <History size={14} />, onClick: () => openReflog(repo, 'lost') })
    if (opts.moves) items.push({ type: 'separator' }, { label: `Reset ${onto} to here…`, icon: <Undo2 size={14} />, danger: true, onClick: () => void git.reset(repo, c.sha) })
    items.push({ type: 'separator' }, { label: 'Copy commit SHA', icon: <Copy size={14} />, onClick: () => git.copyText(c.sha, 'Commit SHA copied') })
    showContextMenu(e, items)
  }

  return (
    <div className="rl-view" ref={rootRef}>
      <div className="rl-titlebar">
        <History size={15} className="rl-title-icon" />
        <span className="rl-title">Reflog</span>
        <div className="rl-seg" role="radiogroup" aria-label="Show">
          {(
            [
              ['lost', 'Lost commits'],
              ['moves', 'Every move']
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={mode === value} className={`rl-seg-btn${mode === value ? ' rl-seg-on' : ''}`} onClick={() => openReflog(repo, value)}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'moves' && (
          <select className="ui-input rl-ref" aria-label="Whose moves" value={ref ?? ''} onChange={(e) => setRef(e.target.value || null)}>
            <option value="">HEAD</option>
            {(tab.refs?.branches ?? []).map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <span className="rl-count">
          {mode === 'lost'
            ? groups && `${lostCount} ${lostCount === 1 ? 'commit' : 'commits'} in ${shown.length} ${shown.length === 1 ? 'group' : 'groups'}${rewritten.length ? ` · ${rewritten.reduce((n, g) => n + g.commits.length, 0)} rewritten` : ''}`
            : null}
        </span>
        <span className="rl-spacer" />
        <IconButton size="sm" label="Read the reflog again" onClick={() => void (mode === 'lost' ? loadLostCommits(repo) : loadMoves(repo, ref))}>
          <RefreshCw size={14} />
        </IconButton>
        <IconButton label="Close (Esc)" onClick={() => git.showGraph(repo)}>
          <X size={16} />
        </IconButton>
      </div>
      {mode === 'lost' ? (
        <LostList tab={tab} groups={shown} rewritten={rewritten} selected={selected} onSelect={select} onMenu={commitMenu} />
      ) : (
        <MoveList repo={repo} entries={moves} selected={selected} onSelect={select} onMenu={commitMenu} />
      )}
    </div>
  )
}

type Menu = (e: MouseEvent, c: { sha: string; subject: string }, opts: { lost: boolean; moves?: boolean }) => void

// ── Lost commits ─────────────────────────────────────────────────────────────

function LostList(props: { tab: RepoTab; groups: LostGroup[]; rewritten: LostGroup[]; selected: string | null; onSelect(sha: string): void; onMenu: Menu }) {
  const { tab, groups, rewritten, selected, onSelect, onMenu } = props
  const repo = tab.path
  const lost = useReflog((s) => s.lost[repo])
  const dangling = useReflog((s) => s.dangling[repo])
  const [showRewritten, setShowRewritten] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Look deeper finds every commit only a reflog remembers too: leave out those shown above.
  const known = useMemo(() => new Set((lost?.data?.groups ?? []).flatMap((g) => g.commits.map((c) => c.sha))), [lost?.data])
  const deeper = useMemo(() => dangling?.data?.filter((c) => !known.has(c.sha)) ?? null, [dangling?.data, known])

  const visible = useMemo(() => [...groups, ...(showRewritten ? rewritten : [])].flatMap((g) => g.commits.map((c) => c.sha)), [groups, rewritten, showRewritten])
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = selected ? visible.indexOf(selected) : -1
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) onSelect(next)
  }

  if (!lost || (lost.loading && !lost.data)) {
    return (
      <div className="rl-center">
        <Spinner /> Reading the reflog…
      </div>
    )
  }
  if (lost.error && !lost.data) {
    return <EmptyState title="Could not read the reflog">{lost.error}</EmptyState>
  }
  const nothing = !groups.length && !rewritten.length
  return (
    <>
      <div className="rl-list" ref={listRef} tabIndex={0} onKeyDown={onKey}>
        {nothing && (
          <EmptyState icon={<Sparkle size={26} />} title="Nothing lost">
            Every commit in the reflog is on a branch or tag.
          </EmptyState>
        )}
        {groups.map((g) => (
          <GroupCard key={`${g.kind}:${g.commits[0].sha}`} repo={repo} group={g} selected={selected} onSelect={onSelect} onMenu={onMenu} />
        ))}
        {rewritten.length > 0 && (
          <div className="rl-group">
            <button type="button" className="rl-fold rl-fold-head" aria-expanded={showRewritten} onClick={() => setShowRewritten((v) => !v)}>
              {showRewritten ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="rl-kind rl-kind-rewritten">{KIND_LABEL.rewritten}</span>
              <span>
                {rewrittenText(rewritten.reduce((n, g) => n + g.commits.length, 0))} · their changes live on in the new commits
              </span>
            </button>
          </div>
        )}
        {showRewritten &&
          rewritten.map((g) => <GroupCard key={`${g.kind}:${g.commits[0].sha}`} repo={repo} group={g} selected={selected} onSelect={onSelect} onMenu={onMenu} />)}
        {deeper && <DeeperCard repo={repo} commits={deeper} selected={selected} onSelect={onSelect} onMenu={onMenu} />}
      </div>
      <div className="rl-foot">
        <span>
          From the reflogs of HEAD and every branch.
          {lost.data?.expireDays !== null && lost.data?.expireDays !== undefined && ` Git forgets a lost commit about ${lost.data.expireDays} days after it was left behind.`}
        </span>
        <span className="rl-spacer" />
        {dangling?.loading ? (
          <span className="rl-working">
            <Spinner size="sm" /> Looking through every object…
          </span>
        ) : (
          <button
            type="button"
            className="ui-link"
            title="Also find commits no reflog remembers: dropped stashes, branches deleted without being checked out (git fsck)"
            onClick={() => void lookDeeper(repo)}
          >
            {dangling?.data ? 'Look deeper again' : 'Look deeper…'}
          </button>
        )}
      </div>
    </>
  )
}

function GroupCard(props: { repo: string; group: LostGroup; selected: string | null; onSelect(sha: string): void; onMenu: Menu }) {
  const { repo, group: g, selected, onSelect, onMenu } = props
  const [open, setOpen] = useState(false)
  const kept = keptText(g.daysLeft)
  const rows = open ? g.commits : g.commits.slice(0, FOLDED)
  return (
    <section className="rl-group" aria-label={groupTitle(g)}>
      <header className="rl-gh">
        <span className={`rl-kind rl-kind-${g.kind}`}>{KIND_LABEL[g.kind]}</span>
        <div className="rl-gt">
          <span className="rl-gtitle">
            {groupTitle(g)} · <span title={absoluteTime(g.date)}>{relativeTime(g.date)}</span>
          </span>
          <span className="rl-gdetail">{groupDetail(g)}</span>
        </div>
        {kept && <span className="rl-kept">{kept}</span>}
        {g.kind === 'reset' && g.canMoveBack && g.branch && (
          <Button size="sm" onClick={() => void moveBranchBack(repo, g)} title={`Put ${g.branch} back where it was before the reset`}>
            Move {g.branch} back
          </Button>
        )}
        {g.kind === 'deleted' && g.canRestore && g.branch ? (
          <Button size="sm" variant="primary" onClick={() => void restoreBranch(repo, g)}>
            Restore {g.branch}
          </Button>
        ) : (
          <Button size="sm" variant={g.kind === 'rewritten' ? 'default' : 'primary'} onClick={() => void branchFromLost(repo, g.commits[0])}>
            Create branch…
          </Button>
        )}
      </header>
      {rows.map((c) => (
        <CommitRow key={c.sha} kind={g.kind} commit={c} selected={selected === c.sha} onSelect={onSelect} onMenu={onMenu} />
      ))}
      {g.commits.length > FOLDED && (
        <button type="button" className="rl-fold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {open ? 'Show fewer' : `${g.commits.length - FOLDED} more commits`}
        </button>
      )}
    </section>
  )
}

function CommitRow(props: { kind: LostGroup['kind'] | 'deeper'; commit: Pick<LostCommit, 'sha' | 'subject' | 'author' | 'date'> & { email?: string }; selected: boolean; onSelect(sha: string): void; onMenu: Menu; note?: string }) {
  const { kind, commit: c, selected, onSelect, onMenu, note } = props
  return (
    <button
      type="button"
      className={`rl-row${selected ? ' rl-row-sel' : ''}`}
      aria-current={selected || undefined}
      onClick={() => onSelect(c.sha)}
      onContextMenu={(e) => onMenu(e, c, { lost: true })}
    >
      <span className={`rl-dot rl-dot-${kind}`} />
      <span className="rl-subject">{c.subject || '(no message)'}</span>
      {note && <span className="rl-note-tag">{note}</span>}
      <span className="rl-who">
        <Avatar name={c.author} email={c.email ?? ''} sha={c.sha} size={18} />
        {c.author}
      </span>
      <span className="rl-when" title={absoluteTime(c.date)}>
        {relativeTime(c.date)}
      </span>
      <span className="rl-sha">{shortSha(c.sha)}</span>
    </button>
  )
}

function DeeperCard(props: { repo: string; commits: DanglingCommit[]; selected: string | null; onSelect(sha: string): void; onMenu: Menu }) {
  const { repo, commits, selected, onSelect, onMenu } = props
  return (
    <section className="rl-group" aria-label="Found by looking deeper">
      <header className="rl-gh">
        <span className="rl-kind rl-kind-other">Deeper</span>
        <div className="rl-gt">
          <span className="rl-gtitle">
            {commits.length ? `${commits.length} more ${commits.length === 1 ? 'commit' : 'commits'} that no reflog remembers` : 'Nothing more found'}
          </span>
          <span className="rl-gdetail">
            {commits.length ? 'Dropped stashes, and branches deleted without ever being checked out' : 'Every other commit is on a branch, a tag or in a reflog'}
          </span>
        </div>
      </header>
      {commits.map((c) => (
        <div key={c.sha} className="rl-deeper">
          <CommitRow kind="deeper" commit={c} note={c.stash ? 'dropped stash' : undefined} selected={selected === c.sha} onSelect={onSelect} onMenu={onMenu} />
          <Button size="sm" className="rl-deeper-btn" onClick={() => void branchFromLost(repo, c)}>
            Create branch…
          </Button>
        </div>
      ))}
    </section>
  )
}

// ── Every move ───────────────────────────────────────────────────────────────

function MoveList(props: {
  repo: string
  entries: { data: ReflogEntry[] | null; loading: boolean; error: string | null } | undefined
  selected: string | null
  onSelect(sha: string): void
  onMenu: Menu
}) {
  const { entries, selected, onSelect, onMenu } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState(-1)
  const list = entries?.data ?? []
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 12 })

  if (!entries || (entries.loading && !entries.data)) {
    return (
      <div className="rl-center">
        <Spinner /> Reading the reflog…
      </div>
    )
  }
  if (entries.error && !entries.data) return <EmptyState title="Could not read the reflog">{entries.error}</EmptyState>
  if (!list.length) return <EmptyState title="No moves recorded">git keeps no reflog for this branch.</EmptyState>

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.max(0, Math.min(list.length - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)))
    setCursor(next)
    onSelect(list[next].sha)
    virtualizer.scrollToIndex(next)
  }
  const lostCount = list.filter((m) => m.lost).length

  return (
    <div className="rl-moves">
      <div className="rl-th">
        <span>When</span>
        <span>Action</span>
        <span>What happened</span>
        <span>Commit</span>
        <span />
        <span className="rl-th-count">
          {list.length} moves{lostCount ? ` · ${lostCount} lost` : ''}
        </span>
      </div>
      <div className="rl-moves-scroll" ref={scrollRef} tabIndex={0} onKeyDown={onKey}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const m = list[v.index]
            const sel = v.index === cursor || (cursor < 0 && selected === m.sha && v.index === list.findIndex((x) => x.sha === selected))
            return (
              <button
                key={v.key}
                type="button"
                className={`rl-move${sel ? ' rl-row-sel' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW, transform: `translateY(${v.start}px)` }}
                onClick={() => {
                  setCursor(v.index)
                  onSelect(m.sha)
                }}
                onContextMenu={(e) => {
                  setCursor(v.index)
                  onMenu(e, m, { lost: m.lost, moves: true })
                }}
              >
                <span className="rl-when" title={absoluteTime(m.date)}>
                  {relativeTime(m.date)}
                </span>
                <span className={`rl-act rl-act-${m.kind}`}>{MOVE_LABEL[m.kind]}</span>
                <span className="rl-what" title={m.detail}>
                  {moveDetail(m)}
                </span>
                <span className="rl-subject">{m.subject}</span>
                <span className="rl-sha">{shortSha(m.sha)}</span>
                <span>{m.lost && <span className="rl-lost">lost</span>}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
