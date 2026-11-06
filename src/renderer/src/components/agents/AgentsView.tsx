// The Agents view (a centre view): the watched worktrees of the active repository, of its tab group or of every open
// tab (settings.agentsScope), as they work — working, quiet (it stopped with work left: it may be waiting for an
// answer) and idle — with the files changing now, the last 30 minutes, where its commits stand and what is new since
// the user looked.

import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ArrowLeft, ArrowUp, ArrowUpRight, Bell, BellOff, Bot, CheckCheck, ChevronDown, ChevronRight, FileDiff, FolderGit2, GitCommitHorizontal, MessageCircleQuestion, Moon, ScanEye, Settings, Sparkle } from 'lucide-react'
import { pendingWork, type AgentsScope, type AgentState, type AgentWorktree } from '@shared/agents'
import * as git from '@renderer/actions/git'
import { markWorktreeSeen, setQuietMuted, showWorktree } from '@renderer/actions/agents'
import { openWorkReview } from '@renderer/actions/workReview'
import { Button, EmptyState, IconButton } from '@renderer/components/common/Button'
import { showContextMenu, type MenuItem } from '@renderer/components/common/ContextMenu'
import { pluralize } from '@renderer/lib/format'
import { isEditableTarget } from '@renderer/lib/keys'
import { groupLine } from '@renderer/lib/groupColors'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { repoColour } from '@renderer/components/pulls/InboxView'
import { useAgentScope, useAgents } from './agentStore'
import { agentName, agoText, aheadText, boardOf, newCommits, shortAgo, stateOf, whenText } from './model'
import { StateDot, Strip } from './parts'
import '@renderer/components/review/review.css'
import './agents.css'

type Filter = 'all' | AgentState

const COLUMNS: Array<{ state: AgentState; title: string; hint: string }> = [
  { state: 'working', title: 'Working', hint: 'changing files now' },
  { state: 'quiet', title: 'Quiet', hint: 'may be waiting for you' },
  { state: 'idle', title: 'Idle', hint: 'nothing for 30 min' }
]

/** Which worktrees the view shows (settings.agentsScope), with how many each choice has. */
function ScopeSwitch({ tab }: { tab: RepoTab }) {
  const current = useAgentScope(tab.path)
  const repo = useAgentScope(tab.path, 'repo')
  const group = useAgentScope(tab.path, 'group')
  const name = repoName(current.repo)
  const groupName = current.group ? current.group.name || 'Its group' : null
  const options: Array<{ value: AgentsScope; label: string; title: string; n: number }> = [
    { value: 'repo', label: name, title: `The worktrees of ${name}`, n: repo.list.length },
    ...(groupName ? [{ value: 'group' as const, label: groupName, title: `The worktrees of the repositories in the ${groupName} tab group`, n: group.list.length }] : []),
    { value: 'all', label: 'All tabs', title: 'The worktrees of every open tab', n: current.total }
  ]
  return (
    <div className="rv-seg ag-scope" role="group" aria-label="Show the worktrees of">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={current.scope === o.value} title={o.title} onClick={() => setScope(o.value)}>
          {o.value === 'group' && current.group && <i className="ag-scope-group" style={{ background: groupLine(current.group.color) }} aria-hidden="true" />}
          {o.label} <span>{o.n}</span>
        </button>
      ))}
    </div>
  )
}

function setScope(agentsScope: AgentsScope) {
  void useApp.getState().updateSettings({ agentsScope })
}

export function AgentsView({ tab }: { tab: RepoTab }) {
  const on = useApp((s) => s.settings.agentsOn)
  const settings = useApp((s) => s.settings)
  const now = useAgents((s) => s.now)
  const { list, scope, repo, total } = useAgentScope(tab.path)
  const repos = useMemo(() => new Set(list.map((w) => w.repo)).size, [list])
  const [filter, setFilter] = useState<Filter>('all')
  const [showFolded, setShowFolded] = useState(false)
  const board = useMemo(() => boardOf(list, now, settings), [list, now, settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target) || document.querySelector('.ui-backdrop, .ui-menu')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        git.showGraph(tab.path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab.path])

  const counts = { working: board.working.length, quiet: board.quiet.length, idle: board.idle.length + board.folded.length }
  const anyNew = list.some((w) => newCommits(w, settings.worktreesSeen).length > 0)
  const columns = COLUMNS.filter((c) => filter === 'all' || c.state === filter)
  const openSettings = () => useApp.getState().openModal({ kind: 'settings', section: 'agents' })

  return (
    <div className="ag-view">
      <div className="ag-bar">
        <IconButton label="Back to the graph (Esc)" onClick={() => git.showGraph(tab.path)}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="ag-title">
          <Bot size={15} />
          <span>
            <b>Agents at work</b>
            <small>
              {pluralize(list.length, 'worktree')}
              {scope === 'repo' ? '' : ` in ${pluralize(repos, 'repository', 'repositories')}`}
            </small>
          </span>
        </span>
        <ScopeSwitch tab={tab} />
        <span className="rv-spacer" />
        <div className="rv-seg" role="group" aria-label="Show">
          {(['all', 'working', 'quiet', 'idle'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)} <span>{f === 'all' ? list.length : counts[f]}</span>
            </button>
          ))}
        </div>
        <Button size="sm" icon={<CheckCheck size={14} />} disabled={!anyNew} onClick={() => markWorktreeSeen(list)}>
          Mark all as seen
        </Button>
      </div>
      <div className="ag-body">
        {!on ? (
          <EmptyState icon={<Bot size={28} />} title="Agents at work is off">
            <p>Turn on “Show what agents are doing” in Settings → Agents at work to see what the worktrees of the open repositories are doing.</p>
            <Button size="sm" icon={<Settings size={14} />} onClick={openSettings}>
              Open Settings
            </Button>
          </EmptyState>
        ) : !list.length ? (
          <EmptyState icon={<FolderGit2 size={28} />} title={total && scope !== 'all' ? `No worktrees to watch in ${scope === 'repo' ? repoName(repo) : 'this group'}` : 'No worktrees to watch'}>
            <p>
              Give each agent its own worktree (New worktree in the left panel's Worktrees section) and it shows up here as it works.
              {settings.agentsWatchMain ? '' : ' Agents that work in a repository’s own folder show up once Watch includes it in Settings → Agents at work.'}
            </p>
            <span className="ag-empty-actions">
              {total > 0 && scope !== 'all' && (
                <Button size="sm" variant="primary" onClick={() => setScope('all')}>
                  Show all tabs ({total})
                </Button>
              )}
              {!settings.agentsWatchMain && (
                <Button size="sm" icon={<Settings size={14} />} onClick={openSettings}>
                  Open Settings
                </Button>
              )}
            </span>
          </EmptyState>
        ) : (
          <div className={`ag-columns ag-columns-${columns.length}`}>
            {columns.map((c) => {
              const items = c.state === 'idle' ? board.idle : board[c.state]
              return (
                <section key={c.state} className={`ag-col ag-col-${c.state}`} aria-label={c.title}>
                  <header className="ag-col-head">
                    <StateDot state={c.state} />
                    <b>{c.title}</b>
                    <span className="ag-col-n">{c.state === 'idle' ? counts.idle : items.length}</span>
                    <span className="ag-col-hint">{c.hint}</span>
                  </header>
                  {items.map((w) => (c.state === 'idle' ? <IdleCard key={w.path} w={w} /> : <Card key={w.path} w={w} state={c.state} />))}
                  {c.state === 'idle' && board.folded.length > 0 && (
                    <>
                      <button type="button" className="ag-fold" aria-expanded={showFolded} onClick={() => setShowFolded((v) => !v)}>
                        {showFolded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <Moon size={13} />
                        Idle for a day or more: {pluralize(board.folded.length, 'worktree')}
                        {showFolded ? '' : ', folded'}
                      </button>
                      {showFolded && board.folded.map((w) => <IdleCard key={w.path} w={w} />)}
                    </>
                  )}
                  {!items.length && !(c.state === 'idle' && board.folded.length) && <p className="ag-col-empty">{c.state === 'working' ? 'No agent is changing files right now.' : c.state === 'quiet' ? 'Nothing is waiting.' : 'None.'}</p>}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function repoName(repo: string): string {
  return useApp.getState().tabs.find((t) => t.path === repo)?.name ?? repo.split(/[\\/]/).pop() ?? repo
}

/** Something to review: commits the base branch lacks, or changes not committed. */
const hasWork = (w: AgentWorktree) => w.ahead > 0 || w.fileCount > 0

function cardMenu(w: AgentWorktree, fresh: boolean, muted: boolean): MenuItem[] {
  return [
    { label: 'Open', icon: <ArrowUpRight size={14} />, onClick: () => void showWorktree(w.path, w.repo) },
    { label: 'Review its work', icon: <ScanEye size={14} />, disabled: !hasWork(w), onClick: () => void openWorkReview(w.path, w.repo) },
    { label: 'See changes', icon: <FileDiff size={14} />, onClick: () => void showWorktree(w.path, w.repo, 'changes') },
    { label: 'Mark as seen', icon: <CheckCheck size={14} />, disabled: !fresh, onClick: () => markWorktreeSeen([w]) },
    { type: 'separator' },
    muted
      ? { label: 'Tell me when it goes quiet', icon: <Bell size={14} />, onClick: () => setQuietMuted(w.path, false) }
      : { label: 'Don’t tell me when it goes quiet', icon: <BellOff size={14} />, onClick: () => setQuietMuted(w.path, true) }
  ]
}

function Where({ w }: { w: AgentWorktree }) {
  const name = repoName(w.repo)
  return (
    <span className="ag-where">
      <i style={{ background: repoColour(w.repo, name) }} aria-hidden="true" />
      {name}
      {w.branch && (
        <>
          {' · '}
          <code>{w.branch}</code>
        </>
      )}
    </span>
  )
}

function Card({ w, state }: { w: AgentWorktree; state: AgentState }) {
  const settings = useApp((s) => s.settings)
  const now = useAgents((s) => s.now)
  const agent = agentName(w, settings)
  const fresh = newCommits(w, settings.worktreesSeen)
  const muted = settings.agentsQuietMuted.includes(w.path)
  const since = now - (w.lastChange ?? now)
  const { ahead, push } = aheadText(w)
  const shown = w.files.slice(0, 3)
  const more = w.fileCount - shown.length
  const onMenu = (e: MouseEvent) => showContextMenu(e, cardMenu(w, fresh.length > 0, muted))
  const notCommitted = w.fileCount ? `${pluralize(w.fileCount, 'file')} not committed` : `${pluralize(w.unpushed ?? w.ahead, 'commit')} not pushed`
  return (
    <article className={`ag-card ag-card-${state}`} onContextMenu={onMenu}>
      <div className="ag-card-head">
        <span className="ag-card-icon">{agent ? <Sparkle size={15} /> : <FolderGit2 size={15} />}</span>
        <span className="ag-card-name">
          <b>{w.name}</b>
          <Where w={w} />
        </span>
        <span className={`ag-pill ag-pill-${state}`}>
          <StateDot state={state} />
          {state === 'working' ? 'Working' : `Quiet ${shortAgo(since)}`}
        </span>
      </div>
      {state === 'quiet' && pendingWork(w) && (
        <p className="ag-quiet">
          <MessageCircleQuestion size={14} />
          <span>
            <b>Stopped {agoText(since)}</b> with {notCommitted}. It may be waiting for an answer or a permission in its terminal.
          </span>
        </p>
      )}
      <div className="ag-strip-box">
        <Strip w={w} now={now} state={state} />
        <div className="ag-strip-axis">
          <span>30 min</span>
          <span>
            {agent ? `${agent} · ` : ''}last change {agoText(since)}
          </span>
          <span>now</span>
        </div>
      </div>
      {w.fileCount > 0 && (
        <div className="ag-files">
          <div className="ag-files-head">
            <span>{state === 'working' ? 'Changing now' : 'Not committed'}</span>
            <span>{pluralize(w.fileCount, 'file')}</span>
          </div>
          {shown.map((f) => {
            const cut = f.path.lastIndexOf('/')
            return (
              <div key={f.path} className="ag-file" title={f.path}>
                <span className={`ag-st ag-st-${f.status === '?' ? 'A' : f.status}`}>{f.status === '?' ? 'A' : f.status}</span>
                <span className="ag-path">
                  {cut >= 0 && <span className="ag-dir">{f.path.slice(0, cut + 1)}</span>}
                  {f.path.slice(cut + 1)}
                </span>
                <span className="ag-lines">
                  {f.added > 0 && <span className="ag-add">+{f.added}</span>}
                  {f.removed > 0 && <span className="ag-del">−{f.removed}</span>}
                </span>
                <span className="ag-age">{shortAgo(now - f.at)}</span>
              </div>
            )
          })}
          {more > 0 && (
            <div className="ag-files-more">
              and {pluralize(more, 'more file')} · +{w.added} −{w.removed} in all
            </div>
          )}
        </div>
      )}
      <div className="ag-ahead">
        <GitCommitHorizontal size={13} />
        <span>
          {w.ahead ? <b>{pluralize(w.ahead, 'commit')}</b> : null}
          {w.ahead ? ahead.slice(ahead.indexOf(' ahead')) : ahead}
        </span>
        {push ? (
          <span className="ag-push">
            <ArrowUp size={12} /> {push}
          </span>
        ) : (
          w.since && <span className="ag-push">started {agoText(now - w.since)}</span>
        )}
      </div>
      {fresh.length > 0 && (
        <div className="ag-fresh">
          <div className="ag-fresh-head">
            <i aria-hidden="true" />
            {fresh.length} new since you looked
          </div>
          {fresh.slice(0, 3).map((c) => (
            <button key={c.sha} type="button" className="ag-fresh-row" onClick={() => void showWorktree(w.path, w.repo, 'commit', c.sha)}>
              <code>{c.sha.slice(0, 7)}</code>
              <span>{c.subject}</span>
            </button>
          ))}
          {fresh.length > 3 && <div className="ag-fresh-more">and {pluralize(fresh.length - 3, 'more')}</div>}
        </div>
      )}
      <div className="ag-actions">
        <Button size="sm" icon={<ScanEye size={14} />} disabled={!hasWork(w)} title="Its commits and changes not committed, against the base branch, with notes for the agent" onClick={() => void openWorkReview(w.path, w.repo)}>
          Review
        </Button>
        <Button size="sm" icon={<ArrowUpRight size={14} />} onClick={() => void showWorktree(w.path, w.repo)}>
          Open
        </Button>
        <Button size="sm" icon={<FileDiff size={14} />} disabled={!w.fileCount} onClick={() => void showWorktree(w.path, w.repo, 'changes')}>
          See changes
        </Button>
        {fresh.length > 0 && (
          <Button size="sm" icon={<CheckCheck size={14} />} onClick={() => markWorktreeSeen([w])}>
            Mark as seen
          </Button>
        )}
      </div>
    </article>
  )
}

function IdleCard({ w }: { w: AgentWorktree }) {
  const settings = useApp((s) => s.settings)
  const now = useAgents((s) => s.now)
  const agent = agentName(w, settings)
  const fresh = newCommits(w, settings.worktreesSeen)
  const muted = settings.agentsQuietMuted.includes(w.path)
  const unpushed = w.unpushed ?? (w.upstream ? 0 : w.ahead)
  const when = w.lastChange ? (now - w.lastChange < 12 * 3600_000 ? `since ${whenText(w.lastChange, now)}` : shortAgo(now - w.lastChange)) : 'nothing yet'
  return (
    <button
      type="button"
      className="ag-idle"
      onClick={() => void showWorktree(w.path, w.repo)}
      onContextMenu={(e) => showContextMenu(e, cardMenu(w, fresh.length > 0, muted))}
      title={`Open ${w.name}`}
    >
      <span className="ag-card-icon">{agent ? <Sparkle size={14} /> : <FolderGit2 size={14} />}</span>
      <span className="ag-card-name">
        <b>{w.name}</b>
        <span className="ag-where-line">
          <Where w={w} />
          {unpushed > 0 && <span className="ag-unpushed"> · {unpushed} not pushed</span>}
          {fresh.length > 0 && <span className="ag-new-inline"> · {fresh.length} new</span>}
        </span>
      </span>
      <span className="ag-when">{when}</span>
    </button>
  )
}
