// A pull request's review, instead of the graph: its files (all of them, or what changed since the user's last
// review) with Viewed marks (the service's, or Adar's own), one file's diff with its comment threads, the
// conversation in order and the commits. The review itself (verdict, summary, kept comments) is in the right panel
// (ReviewPanel).

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronRight, Circle, ExternalLink, FileCode2, GitCommitHorizontal, GitPullRequest, MessageSquare, RefreshCw, Search, Sparkles } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { openWebPage } from '@renderer/actions/pulls'
import { commentOnConversation, keyOf, loadReview, REVIEW_PAGE, setViewed } from '@renderer/actions/review'
import { api } from '@renderer/api/client'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { Avatar } from '@renderer/components/common/Avatar'
import { goToCommit } from '@renderer/components/details/CommitPanel'
import { StatusBadge } from '@renderer/components/diff/parts'
import { PullStateIcon } from '@renderer/components/pulls/PullChip'
import { usePulls } from '@renderer/components/pulls/pullStore'
import { absoluteTime, pluralize, relativeTime, shortSha } from '@renderer/lib/format'
import { isEditableTarget } from '@renderer/lib/keys'
import { providerName, pullRef } from '@renderer/lib/pulls'
import { useApp, type RepoTab, type ReviewMode, type ReviewTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { PullRequest } from '@shared/hosting'
import type { PullReviewData, TimelineEvent } from '@shared/review'
import type { FileChange, FileDiff } from '@shared/types'
import { baseName, coAuthorAgents, conversation, dirOf, fileGroups, fileOrder, sinceBanner, threadCounts, threadsOf } from './model'
import { ago, CommentBody, Thread } from './parts'
import { ReviewDiff } from './ReviewDiff'
import { useDrafts, useReviewEntry, type ReviewEntry } from './reviewStore'
import '@renderer/components/diff/diff.css'
import './review.css'

type View = { kind: 'review'; number: number; mode: ReviewMode; tab: ReviewTab; path?: string }

export function ReviewView({ tab, view }: { tab: RepoTab; view: View }) {
  const repo = tab.path
  const { number } = view
  const pr = usePulls((s) => s.repos[repo]?.data?.pulls.find((p) => p.number === number))
  const entry = useReviewEntry(repo, number)
  const set = (patch: Partial<View>) => useApp.getState().setCenter(repo, { ...view, ...patch })

  useEffect(() => {
    void loadReview(repo, number)
  }, [repo, number])

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

  const agents = useMemo(() => coAuthorAgents((entry.commits ?? []).map((c) => c.body)), [entry.commits])
  const canSince = !!entry.since && !!entry.range?.since && entry.range.sinceState !== 'missing'
  const mode: ReviewMode = view.mode === 'since' && canSince ? 'since' : 'all'
  const groups = useMemo(() => (entry.files ? fileGroups(entry.files, mode === 'since' ? (entry.sinceFiles ?? []) : null) : null), [entry.files, entry.sinceFiles, mode])

  return (
    <div className="rv-view">
      <div className="rv-bar">
        <IconButton label="Back to the graph (Esc)" onClick={() => git.showGraph(repo)}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="rv-title">
          <b>
            {pr ? <PullStateIcon state={pr.state} size={14} /> : <GitPullRequest size={14} />}
            <span className="rv-title-text">{pr?.title ?? entry.data?.title ?? `Pull request #${number}`}</span>
            <span className="rv-num">{pr ? pullRef(pr) : `#${number}`}</span>
          </b>
          {pr && (
            <small>
              <code>{pr.headFork ? `${pr.headFork.split('/')[0]}:` : ''}{pr.headRef}</code> → <code>{pr.baseRef}</code> · {pr.authorName ?? pr.author}
              {agents.map((a) => (
                <span key={a} className="rv-ai" title={`${a} co-wrote commits of it (Co-Authored-By)`}>
                  <Sparkles size={10} /> {a}
                </span>
              ))}
            </small>
          )}
        </div>
        <span className="rv-spacer" />
        {view.tab === 'files' && (
          <div className="rv-seg" role="group" aria-label="Which changes">
            <button type="button" aria-pressed={mode === 'all'} onClick={() => set({ mode: 'all' })}>
              All changes <span>{entry.files?.length ?? ''}</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === 'since'}
              disabled={!canSince}
              title={canSince ? undefined : 'You have not reviewed it yet'}
              onClick={() => set({ mode: 'since' })}
            >
              {entry.since?.how === 'comment' ? 'Since your comment' : entry.since?.how === 'seen' ? 'Since you looked' : 'Since your review'} <span>{canSince ? (entry.sinceFiles?.length ?? '') : ''}</span>
            </button>
          </div>
        )}
        <div className="rv-seg" role="group" aria-label="What to show">
          <button type="button" aria-pressed={view.tab === 'files'} onClick={() => set({ tab: 'files' })}>
            Files
          </button>
          <button type="button" aria-pressed={view.tab === 'conversation'} onClick={() => set({ tab: 'conversation' })}>
            Conversation <span>{entry.data ? entry.data.comments.length + entry.data.reviews.length : ''}</span>
          </button>
          <button type="button" aria-pressed={view.tab === 'commits'} onClick={() => set({ tab: 'commits' })}>
            Commits <span>{entry.commits?.length ?? ''}</span>
          </button>
        </div>
        <IconButton label="Refresh" onClick={() => void loadReview(repo, number, { force: true })} disabled={entry.loading}>
          <RefreshCw size={15} className={entry.loading ? 'rv-spin' : undefined} />
        </IconButton>
        {pr && (
          <IconButton label={`Open on ${providerName(pr)}`} onClick={() => openWebPage(`${pr.url}${REVIEW_PAGE[pr.provider]}`)}>
            <ExternalLink size={15} />
          </IconButton>
        )}
      </div>

      {entry.error && !entry.data ? (
        <div className="rv-empty">
          <EmptyState title="The review could not be loaded">{entry.error}</EmptyState>
          <div className="rv-row rv-row-center">
            <Button onClick={() => void loadReview(repo, number, { force: true })}>Try again</Button>
            {pr && <Button icon={<ExternalLink size={13} />} onClick={() => openWebPage(`${pr.url}${REVIEW_PAGE[pr.provider]}`)}>Open on {providerName(pr)}</Button>}
          </div>
        </div>
      ) : !entry.data || !entry.range || !groups ? (
        <div className="rv-empty">
          <Spinner size="lg" />
          <span className="rv-muted">Getting the pull request’s commits…</span>
        </div>
      ) : view.tab === 'conversation' ? (
        <Conversation repo={repo} number={number} data={entry.data} pr={pr} />
      ) : view.tab === 'commits' ? (
        <Commits repo={repo} entry={entry} />
      ) : (
        <Files tab={tab} view={view} mode={mode} entry={entry} data={entry.data} groups={groups} pr={pr} />
      )}
    </div>
  )
}

// ── Files ─────────────────────────────────────────────────────────────────────

function Files({
  tab,
  view,
  mode,
  entry,
  data,
  groups,
  pr
}: {
  tab: RepoTab
  view: View
  mode: ReviewMode
  entry: ReviewEntry
  data: PullReviewData
  groups: ReturnType<typeof fileGroups>
  pr: PullRequest | undefined
}) {
  const repo = tab.path
  const number = view.number
  const range = entry.range!
  const pull = keyOf(repo, number) ?? ''
  const drafts = useDrafts(pull)
  const [filter, setFilter] = useState('')
  const [showGenerated, setShowGenerated] = useState(false)
  const counts = useMemo(() => threadCounts(data.threads), [data.threads])
  const order = useMemo(() => fileOrder(groups, showGenerated), [groups, showGenerated])
  const path = view.path && (order.some((f) => f.path === view.path) || groups.generated.some((f) => f.path === view.path)) ? view.path : order[0]?.path
  const file = [...order, ...groups.generated].find((f) => f.path === path) ?? null
  const viewed = (p: string) => data.viewed[p] === 'viewed'
  const viewedCount = (entry.files ?? []).filter((f) => viewed(f.path)).length
  const total = entry.files?.length ?? 0
  const select = (p: string) => useApp.getState().setCenter(repo, { ...view, path: p })
  const from = mode === 'since' ? range.since! : range.base

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target) || document.querySelector('.ui-backdrop, .ui-menu')) return
      const i = order.findIndex((f) => f.path === path)
      if ((e.key === 'v' || e.key === 'V') && path) {
        e.preventDefault()
        void setViewed(repo, number, path, !viewed(path))
      } else if (e.key === 'n' || e.key === 'j') {
        e.preventDefault()
        // The next file not viewed yet, else simply the next one.
        const next = order.slice(i + 1).find((f) => !viewed(f.path)) ?? order[i + 1]
        if (next) select(next.path)
      } else if (e.key === 'p' || e.key === 'k') {
        e.preventDefault()
        if (i > 0) select(order[i - 1].path)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const q = filter.trim().toLowerCase()
  const match = (f: FileChange) => !q || f.path.toLowerCase().includes(q)
  const banner = mode === 'since' && entry.since ? sinceBanner(range, entry.since.how, ago(entry.since.at), pr?.baseRef ?? 'the base branch') : null

  return (
    <div className="rv-body">
      <div className="rv-tree">
        <div className="rv-th">
          <div className="rv-progress" title={data.features.viewed === 'adar' ? 'Files marked Viewed (V), kept by Adar on this computer' : 'Files marked Viewed (V)'}>
            <i style={{ ['--p' as string]: `${total ? Math.round((viewedCount / total) * 100) : 0}%` }} />
            {viewedCount} of {total} viewed
          </div>
          <label className="rv-filter">
            <Search size={13} />
            <input value={filter} placeholder="Filter files" onChange={(e) => setFilter(e.target.value)} aria-label="Filter files" />
          </label>
        </div>
        <div className="rv-files">
          {mode === 'since' && <div className="rv-gl">Changed since · {groups.changed.length}</div>}
          <FileList files={groups.changed.filter(match)} current={path} counts={counts} viewed={data.viewed} onSelect={select} fresh={mode === 'since'} />
          {mode === 'since' && groups.reviewed.length > 0 && (
            <>
              <div className="rv-gl">Already reviewed · {groups.reviewed.length}</div>
              <FileList files={groups.reviewed.filter(match)} current={path} counts={counts} viewed={data.viewed} onSelect={select} dim />
            </>
          )}
          {groups.generated.length > 0 && (
            <>
              <button type="button" className="rv-gen" onClick={() => setShowGenerated((v) => !v)} aria-expanded={showGenerated}>
                {showGenerated ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {pluralize(groups.generated.length, 'generated file')} <span className="rv-muted">lockfiles, builds</span>
              </button>
              {showGenerated && <FileList files={groups.generated.filter(match)} current={path} counts={counts} viewed={data.viewed} onSelect={select} dim />}
            </>
          )}
          {!order.length && !groups.generated.length && <div className="rv-note-block">{mode === 'since' ? 'No files changed since.' : 'No files changed.'}</div>}
        </div>
      </div>

      <div className="rv-center">
        {banner?.text && <div className={`rv-since rv-since-${banner.tone}`}>{banner.text}</div>}
        {data.pendingOnService && (
          <div className="rv-since rv-since-calm">
            You started a review on {pr ? providerName(pr) : 'the website'} with {pluralize(data.pendingOnService.comments, 'comment')}: submitting from Adar adds yours to it and sends them all.
          </div>
        )}
        {file ? (
          <FileBody
            key={`${file.path}@${from}`}
            repo={repo}
            number={number}
            pull={pull}
            file={file}
            from={from}
            to={range.head}
            data={data}
            drafts={drafts}
            againstBase={mode === 'all'}
            canComment={pr?.state === 'open' || pr?.state === 'draft'}
            viewed={viewed(file.path)}
            changedSinceViewed={data.viewed[file.path] === 'changed'}
            next={order[order.findIndex((f) => f.path === file.path) + 1]?.path ?? null}
            onNext={select}
          />
        ) : (
          <div className="rv-empty">
            <EmptyState icon={<FileCode2 size={26} />} title="No file to show" />
          </div>
        )}
      </div>
    </div>
  )
}

function FileList(props: {
  files: FileChange[]
  current: string | undefined
  counts: Map<string, number>
  viewed: PullReviewData['viewed']
  onSelect(path: string): void
  dim?: boolean
  fresh?: boolean
}) {
  let lastDir: string | null = null
  return (
    <>
      {props.files.map((f) => {
        const dir = dirOf(f.path)
        const header = dir !== lastDir && dir ? dir : null
        lastDir = dir
        const v = props.viewed[f.path]
        return (
          <div key={f.path}>
            {header && <div className="rv-dir">{header}</div>}
            <button
              type="button"
              className={`rv-f${f.path === props.current ? ' rv-f-sel' : ''}${props.dim ? ' rv-f-dim' : ''}${dir ? ' rv-f-ind' : ''}`}
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
              onClick={() => props.onSelect(f.path)}
            >
              <StatusBadge status={f.status} />
              <span className="rv-f-name">{baseName(f.path)}</span>
              {props.counts.get(f.path) ? (
                <span className="rv-f-bub" title="Open comment threads">
                  <MessageSquare size={11} /> {props.counts.get(f.path)}
                </span>
              ) : null}
              <span className="rv-f-ch">
                {f.binary ? 'bin' : (
                  <>
                    <span className="rv-add-n">+{f.additions ?? 0}</span> <span className="rv-del-n">−{f.deletions ?? 0}</span>
                  </>
                )}
              </span>
              {v === 'viewed' ? (
                <Check size={13} className="rv-f-vw rv-f-vw-on" aria-label="Viewed" />
              ) : v === 'changed' ? (
                <Circle size={7} className="rv-f-new" aria-label="Changed since you viewed it" />
              ) : props.fresh ? (
                <Circle size={7} className="rv-f-new" aria-label="Changed since your review" />
              ) : (
                <span className="rv-f-vw" />
              )}
            </button>
          </div>
        )
      })}
    </>
  )
}

function FileBody(props: {
  repo: string
  number: number
  pull: string
  file: FileChange
  from: string
  to: string
  data: PullReviewData
  drafts: ReturnType<typeof useDrafts>
  againstBase: boolean
  canComment: boolean
  viewed: boolean
  changedSinceViewed: boolean
  next: string | null
  onNext(path: string): void
}) {
  const { repo, number, file } = props
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setDiff(null)
    setError(null)
    api
      .getDiff(repo, { kind: 'compare', from: props.from, to: props.to, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}) })
      .then((d) => alive && setDiff(d))
      .catch((err) => alive && setError(describeError(err)))
    return () => {
      alive = false
    }
  }, [repo, props.from, props.to, file.path, file.oldPath])

  const threads = useMemo(() => threadsOf(props.data.threads, file.path, props.againstBase), [props.data.threads, file.path, props.againstBase])
  const drafts = useMemo(() => props.drafts.map((draft, index) => ({ draft, index })).filter((d) => d.draft.path === file.path), [props.drafts, file.path])
  const [showElsewhere, setShowElsewhere] = useState(false)

  return (
    <>
      <div className="rv-fh">
        <StatusBadge status={file.status} />
        <span className="rv-fh-path selectable" title={file.path}>
          {file.oldPath ? `${file.oldPath} → ` : ''}
          {file.path}
        </span>
        {!file.binary && (
          <span className="rv-fh-ch">
            <span className="rv-add-n">+{file.additions ?? 0}</span> <span className="rv-del-n">−{file.deletions ?? 0}</span>
          </span>
        )}
        <span className="rv-spacer" />
        {props.changedSinceViewed && <span className="rv-muted">Changed since you viewed it</span>}
        <label className="rv-check" title="Viewed (V)">
          <input type="checkbox" checked={props.viewed} onChange={(e) => void setViewed(repo, number, file.path, e.target.checked)} />
          Viewed
        </label>
        {props.next && (
          <Button size="sm" variant="ghost" title="Next file (N)" onClick={() => props.onNext(props.next!)}>
            Next file
          </Button>
        )}
      </div>
      <div className="rv-scroll diff-scroll">
        {threads.elsewhere.length > 0 && (
          <div className="rv-elsewhere">
            <button type="button" className="rv-elsewhere-head" onClick={() => setShowElsewhere((v) => !v)} aria-expanded={showElsewhere}>
              {showElsewhere ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {pluralize(threads.elsewhere.length, 'comment thread')} on lines that changed or are not in this comparison
            </button>
            {showElsewhere &&
              threads.elsewhere.map((t) => (
                <div key={t.id} className="rv-elsewhere-item">
                  <div className="rv-muted">
                    {t.outdated ? 'Outdated' : 'Old side'} · line {t.originalLine ?? t.line ?? '?'}
                  </div>
                  <Thread repo={repo} number={number} thread={t} canAct={props.canComment} />
                </div>
              ))}
          </div>
        )}
        {error ? (
          <div className="rv-note-block">{error}</div>
        ) : !diff ? (
          <div className="rv-empty">
            <Spinner />
          </div>
        ) : (
          <ReviewDiff
            repo={repo}
            number={number}
            pull={props.pull}
            diff={diff}
            path={file.path}
            threads={threads}
            drafts={drafts}
            againstBase={props.againstBase}
            canComment={props.canComment}
            features={props.data.features}
          />
        )}
      </div>
    </>
  )
}

// ── Conversation ──────────────────────────────────────────────────────────────

const VERDICT_TEXT = { approved: 'approved', 'changes-requested': 'requested changes', commented: 'reviewed', dismissed: 'reviewed (dismissed)' } as const

function eventText(e: TimelineEvent, name: (who: string) => string): { who: string; what: string } {
  switch (e.kind) {
    case 'commits':
      return { who: e.author, what: `pushed ${pluralize(e.commits.length, 'commit')}` }
    case 'force-push':
      return { who: e.actor, what: `force-pushed${e.before && e.after ? ` ${shortSha(e.before)} → ${shortSha(e.after)}` : ''}` }
    case 'review-requested':
      return { who: e.actor, what: `asked ${name(e.reviewer) === 'You' ? 'you' : e.reviewer} for a review` }
    case 'ready':
      return { who: e.actor, what: 'marked it ready for review' }
    case 'merged':
      return { who: e.actor, what: 'merged it' }
    case 'closed':
      return { who: e.actor, what: 'closed it' }
    case 'reopened':
      return { who: e.actor, what: 'reopened it' }
  }
}

function Conversation({ repo, number, data, pr }: { repo: string; number: number; data: PullReviewData; pr: PullRequest | undefined }) {
  const entries = useMemo(() => conversation(data, pr?.createdAt ?? ''), [data, pr?.createdAt])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const me = data.viewer.toLowerCase()
  const name = (who: string) => (who.toLowerCase() === me ? 'You' : who)
  const send = async () => {
    if (!body.trim() || busy) return
    setBusy(true)
    if (await commentOnConversation(repo, number, body)) setBody('')
    setBusy(false)
  }
  return (
    <div className="rv-conv-scroll">
      <div className="rv-conv">
        {entries.map((e, i) => {
          const when = e.at ? <span title={absoluteTime(Math.floor(Date.parse(e.at) / 1000))}>{ago(e.at)}</span> : null
          if (e.kind === 'description')
            return (
              <div key={i} className="rv-ev">
                <Avatar name={e.author} size={24} />
                <div className="rv-ev-tx">
                  <div>
                    <b>{name(e.author)}</b> opened it {when}
                  </div>
                  <div className="rv-card">
                    <CommentBody body={e.body} />
                  </div>
                </div>
              </div>
            )
          if (e.kind === 'review')
            return (
              <div key={i} className="rv-ev">
                <span className={`rv-ev-dot rv-ev-${e.review.verdict}`}>{e.review.verdict === 'approved' ? <Check size={13} /> : <MessageSquare size={12} />}</span>
                <div className="rv-ev-tx">
                  <div>
                    <b>{name(e.review.author)}</b> {VERDICT_TEXT[e.review.verdict]}
                    {e.review.comments ? `, with ${pluralize(e.review.comments, 'comment')} on lines` : ''} {when}
                  </div>
                  {e.review.body.trim() && (
                    <div className="rv-card">
                      <CommentBody body={e.review.body} />
                    </div>
                  )}
                </div>
              </div>
            )
          if (e.kind === 'comment')
            return (
              <div key={i} className="rv-ev">
                <Avatar name={e.comment.author} size={24} />
                <div className="rv-ev-tx">
                  <div>
                    <b>{name(e.comment.author)}</b> commented {when}
                  </div>
                  <div className="rv-card">
                    <CommentBody body={e.comment.body} />
                  </div>
                </div>
              </div>
            )
          const t = eventText(e.event, name)
          return (
            <div key={i} className="rv-ev">
              <span className={`rv-ev-dot${e.event.kind === 'commits' || e.event.kind === 'force-push' ? ' rv-ev-new' : ''}`}>
                <GitCommitHorizontal size={13} />
              </span>
              <div className="rv-ev-tx">
                <div>
                  <b>{name(t.who)}</b> {t.what} {when}
                </div>
                {e.event.kind === 'commits' && (
                  <div className="rv-ev-commits">
                    {e.event.commits.map((c) => (
                      <button key={c.sha} type="button" className="rv-ev-commit" title="Select it in the graph" onClick={() => goToCommit(repo, c.sha)}>
                        <code>{shortSha(c.sha)}</code> {c.subject}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div className="rv-conv-compose">
          <textarea
            className="rv-textarea"
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="rv-row">
            <span className="rv-spacer" />
            <Button variant="primary" loading={busy} disabled={!body.trim()} onClick={() => void send()}>
              Comment
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Commits ───────────────────────────────────────────────────────────────────

function Commits({ repo, entry }: { repo: string; entry: ReviewEntry }) {
  const since = entry.range?.since ?? null
  const commits = entry.commits ?? []
  const sinceIndex = since ? commits.findIndex((c) => c.sha === since) : -1
  return (
    <div className="rv-conv-scroll">
      <div className="rv-commits">
        {commits.map((c, i) => (
          <button key={c.sha} type="button" className={`rv-commit${sinceIndex > 0 && i < sinceIndex ? ' rv-commit-new' : ''}`} title="Select it in the graph" onClick={() => goToCommit(repo, c.sha)}>
            <Avatar name={c.authorName} email={c.authorEmail} sha={c.sha} size={20} />
            <span className="rv-commit-subject">{c.subject}</span>
            {coAuthorAgents([c.body]).map((a) => (
              <span key={a} className="rv-ai">
                <Sparkles size={10} /> {a}
              </span>
            ))}
            <span className="rv-muted">{c.authorName}</span>
            <span className="rv-muted">{relativeTime(c.authorDate)}</span>
            <code>{c.shortSha}</code>
          </button>
        ))}
        {!commits.length && <div className="rv-note-block">No commits.</div>}
      </div>
    </div>
  )
}

