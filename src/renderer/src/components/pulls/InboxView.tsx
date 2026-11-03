// The pull requests of every open repository (or the active tab group), instead of the graph: what waits for the
// user's review, what they follow and theirs, each with the one thing to know and the next step. The blue dot marks
// what changed since they looked (lib/following.ts).

import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { ArrowLeft, CircleCheck, CircleX, Clock, Copy, ExternalLink, Eye, GitMerge, Inbox as InboxIcon, Bell, BellOff, RefreshCw, Search, ChevronRight, ChevronDown } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { openWebPage, selectPull } from '@renderer/actions/pulls'
import { markSeen, openReview, reviewsInAdar, setFollowing } from '@renderer/actions/review'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button, EmptyState, IconButton } from '@renderer/components/common/Button'
import { showContextMenu, type MenuItem } from '@renderer/components/common/ContextMenu'
import { isFollowing, marksOf } from '@renderer/lib/following'
import { pluralize, relativeTime } from '@renderer/lib/format'
import { groupLine } from '@renderer/lib/groupColors'
import { isEditableTarget } from '@renderer/lib/keys'
import { providerName, pullNoun, pullRef } from '@renderer/lib/pulls'
import { groupOf } from '@renderer/lib/tabGroups'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { buildInbox, needsYou, rowAction, rowPill, type Inbox, type InboxRow, type InboxSource } from './inbox'
import { PullStateIcon } from './PullChip'
import { anyPullsOn, hostingOn, repoHosting, usePulls } from './pullStore'
import '@renderer/components/review/review.css'
import './pulls.css'
import './inbox.css'

/** The open repositories whose pull requests are loaded, in tab order. */
export function useInboxSources(): InboxSource[] {
  const tabs = useApp((s) => s.tabs)
  const repos = usePulls((s) => s.repos)
  return useMemo(() => {
    const out: InboxSource[] = []
    for (const t of tabs) {
      const data = repos[t.path]?.data
      if (data) out.push({ repo: t.path, name: t.name, data })
    }
    return out
  }, [tabs, repos])
}

export function useInbox(): Inbox {
  const sources = useInboxSources()
  const seen = useApp((s) => s.settings.pullsSeen)
  const followed = useApp((s) => s.settings.pullsFollowed)
  const unfollowed = useApp((s) => s.settings.pullsUnfollowed)
  const followParticipated = useApp((s) => s.settings.followParticipated)
  return useMemo(
    () => buildInbox(sources, { pullsSeen: seen, pullsFollowed: followed, pullsUnfollowed: unfollowed, followParticipated }),
    [sources, seen, followed, unfollowed, followParticipated]
  )
}

/** How many pull requests need the user (the toolbar's Reviews badge). */
export function useNeedsYou(): number {
  return needsYou(useInbox())
}

/** Ask for the pull requests of every open repository whose provider is on. */
export function loadAllPulls(force = false): void {
  const p = usePulls.getState()
  for (const t of useApp.getState().tabs) if (hostingOn(repoHosting(t), p)) void p.load(t.path, force ? { force: true } : undefined)
}

/** A colour per repository: its tab group's, else one of the lanes. */
function repoColour(repo: string, name: string): string {
  const group = groupOf(useApp.getState().settings.tabGroups, repo)
  if (group) return groupLine(group.color)
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `var(--lane-${(h % 6) + 1})`
}

export function InboxView({ tab }: { tab: RepoTab }) {
  const inbox = useInbox()
  const groups = useApp((s) => s.settings.tabGroups)
  const group = groupOf(groups, tab.path)
  const [scope, setScope] = useState<'all' | 'group'>('all')
  const [onlyUpdated, setOnlyUpdated] = useState(false)
  const [filter, setFilter] = useState('')
  const [showMerged, setShowMerged] = useState(false)
  const loading = usePulls((s) => Object.values(s.repos).some((r) => r.loading))
  const last = usePulls((s) => Math.max(0, ...Object.values(s.repos).map((r) => r.at)))

  useEffect(() => {
    loadAllPulls()
  }, [])
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

  const inScope = (r: InboxRow) => scope === 'all' || !group || group.repos.includes(r.repo)
  const q = filter.trim().toLowerCase()
  const matches = (r: InboxRow) =>
    inScope(r) &&
    (!onlyUpdated || r.news.updated || r.news.relation === 'requested') &&
    (!q || [r.pr.title, r.pr.author, r.pr.authorName ?? '', r.pr.headRef, r.name, String(r.pr.number)].some((x) => x.toLowerCase().includes(q)))
  const all = [...inbox.requested, ...inbox.following, ...inbox.yours]
  const updatedCount = all.filter((r) => inScope(r) && (r.news.updated || r.news.relation === 'requested')).length
  const count = (rows: InboxRow[]) => rows.filter(inScope).length
  const sections: Array<{ title: string; hint?: string; rows: InboxRow[] }> = [
    { title: 'Waiting for your review', rows: inbox.requested.filter(matches) },
    { title: 'Following', hint: 'you reviewed or commented on them, or follow them with the bell', rows: inbox.following.filter(matches) },
    { title: 'Yours', rows: inbox.yours.filter(matches) }
  ]
  const anyOn = usePulls((s) => anyPullsOn(s))

  return (
    <div className="ib-view">
      <div className="ib-bar">
        <IconButton label="Back to the graph (Esc)" onClick={() => git.showGraph(tab.path)}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="ib-title">
          <InboxIcon size={15} /> Pull requests
        </span>
        <div className="rv-seg" role="group" aria-label="Repositories">
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Every open repository <span>{count(all)}</span>
          </button>
          {group && (
            <button type="button" aria-pressed={scope === 'group'} onClick={() => setScope('group')}>
              {group.name || 'This group'} <span>{all.filter((r) => group.repos.includes(r.repo)).length}</span>
            </button>
          )}
        </div>
        <button type="button" className={`ib-toggle${onlyUpdated ? ' ib-toggle-on' : ''}`} aria-pressed={onlyUpdated} title="Only what waits for you or changed since you looked" onClick={() => setOnlyUpdated((v) => !v)}>
          <i className="ib-dot" /> Updated <span>{updatedCount}</span>
        </button>
        <span className="rv-spacer" />
        <label className="rv-filter ib-filter">
          <Search size={13} />
          <input value={filter} placeholder="Filter by title, author or branch" onChange={(e) => setFilter(e.target.value)} aria-label="Filter pull requests" />
        </label>
        <span className="rv-muted ib-when-all">{last ? `Updated ${relativeTime(Math.floor(last / 1000))}` : ''}</span>
        <IconButton label="Refresh" disabled={loading} onClick={() => loadAllPulls(true)}>
          <RefreshCw size={15} className={loading ? 'rv-spin' : undefined} />
        </IconButton>
      </div>
      <div className="ib-list">
        {!anyOn ? (
          <EmptyState icon={<InboxIcon size={28} />} title="Pull requests are off">
            Turn them on for GitHub, GitLab, Bitbucket or Azure DevOps in Settings → Integrations.
          </EmptyState>
        ) : (
          <>
            {sections.map(
              (s) =>
                s.rows.length > 0 && (
                  <div key={s.title} className="ib-group">
                    <div className="ib-gh">
                      {s.title} · <b>{s.rows.length}</b>
                      {s.hint && <span className="ib-gh-hint">{s.hint}</span>}
                    </div>
                    {s.rows.map((r) => (
                      <Row key={r.key} row={r} />
                    ))}
                  </div>
                )
            )}
            {sections.every((s) => !s.rows.length) && (
              <EmptyState icon={<CircleCheck size={28} />} title={q || onlyUpdated ? 'Nothing matches' : 'Nothing waits for you'}>
                {q || onlyUpdated ? 'Clear the filter to see every pull request.' : 'No reviews asked of you, and nothing you follow changed.'}
              </EmptyState>
            )}
            {(inbox.merged.filter(inScope).length > 0 || inbox.others > 0) && (
              <div className="ib-group">
                <button type="button" className="ib-fold" aria-expanded={showMerged} onClick={() => setShowMerged((v) => !v)} disabled={!inbox.merged.filter(inScope).length}>
                  {showMerged ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <b>Merged this week · {inbox.merged.filter(inScope).length}</b>
                  {inbox.others > 0 && <span className="rv-muted">and {pluralize(inbox.others, 'more open pull request')} in these repositories, by others, not waiting for you</span>}
                </button>
                {showMerged && inbox.merged.filter(inScope).map((r) => <Row key={r.key} row={r} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ row }: { row: InboxRow }) {
  const { pr, repo, data, news } = row
  const pill = pr.state === 'merged' ? { text: 'Merged', tone: 'ok' as const } : rowPill(row)
  const action = pr.state === 'merged' ? 'open' : rowAction(row, data.canMerge)
  const settings = useApp((s) => s.settings)
  const following = isFollowing(pr, marksOf(settings, row.key))
  const run = () => {
    if (action === 'review') openReview(repo, pr.number)
    else {
      if (useApp.getState().activePath !== repo) useApp.getState().setActive(repo)
      useApp.getState().setCenter(repo, { kind: 'graph' })
      selectPull(repo, pr.number)
      markSeen(repo, pr)
    }
  }
  const menu = (e: MouseEvent) => {
    const items: MenuItem[] = [
      { type: 'header', label: `${pullRef(pr)} · ${pr.title}` },
      { label: reviewsInAdar(pr) ? 'Review' : `Review on ${providerName(pr)}`, icon: <Eye size={14} />, onClick: () => openReview(repo, pr.number) },
      {
        label: 'Show in its repository',
        icon: <ChevronRight size={14} />,
        onClick: () => {
          useApp.getState().setActive(repo)
          selectPull(repo, pr.number)
        }
      },
      { label: 'Mark as seen', icon: <CircleCheck size={14} />, disabled: !news.updated, onClick: () => markSeen(repo, pr) }
    ]
    if (!pr.viewerIsAuthor && pr.state !== 'merged')
      items.push({ label: following ? 'Stop following' : 'Follow', icon: following ? <BellOff size={14} /> : <Bell size={14} />, onClick: () => setFollowing(repo, pr, !following) })
    items.push(
      { type: 'separator' },
      { label: `Open on ${providerName(pr)}`, icon: <ExternalLink size={14} />, onClick: () => openWebPage(pr.url) },
      { label: `Copy link to the ${pullNoun(pr.provider)}`, icon: <Copy size={14} />, onClick: () => void git.copyText(pr.url, `Copied the link to ${pullRef(pr)}`) }
    )
    showContextMenu(e, items)
  }
  return (
    <div className={`ib-r${news.updated ? ' ib-r-upd' : ''}`} role="button" tabIndex={0} onClick={run} onKeyDown={(e) => e.key === 'Enter' && run()} onContextMenu={menu} title={`${pr.title}\n${pr.headRef} → ${pr.baseRef}`}>
      <span className="ib-repo">
        <i style={{ background: repoColour(repo, row.name) }} />
        <span>{row.name}</span>
      </span>
      <span className="ib-t">
        <span className="ib-n">{pullRef(pr)}</span>
        <b>{pr.title}</b>
      </span>
      <span className="ib-who">
        <Avatar name={pr.authorName ?? pr.author} size={18} />
        <span>{pr.viewerIsAuthor ? 'You' : (pr.authorName ?? pr.author)}</span>
      </span>
      <span className={`ib-pill ib-pill-${pill.tone}`}>
        {pr.state !== 'merged' && <PullStateIcon state={pr.state} size={11} />}
        <span>{pill.text}</span>
      </span>
      <span className="ib-checks">
        {pr.checks === 'passed' ? (
          <CircleCheck size={14} className="rv-ok" aria-label="Checks passed" />
        ) : pr.checks === 'failed' ? (
          <CircleX size={14} className="rv-bad" aria-label="A check failed" />
        ) : pr.checks === 'running' ? (
          <Clock size={14} className="rv-wait" aria-label="Checks running" />
        ) : null}
      </span>
      <span className="ib-when">{relativeTime(Math.floor(Date.parse(pr.state === 'merged' ? (pr.closedAt ?? pr.updatedAt) : pr.updatedAt) / 1000))}</span>
      <Button
        size="sm"
        variant={(action === 'review' && (news.updated || news.relation === 'requested')) || action === 'merge' ? 'primary' : 'default'}
        icon={action === 'merge' ? <GitMerge size={13} /> : undefined}
        onClick={(e) => {
          e.stopPropagation()
          run()
        }}
      >
        {action === 'review' ? 'Review' : action === 'merge' ? 'Merge…' : 'Open'}
      </Button>
    </div>
  )
}
