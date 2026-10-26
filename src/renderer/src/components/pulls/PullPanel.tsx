// Right panel for a pull request (GitLab: merge request): what it is, where it stands (checks, review, conflicts)
// and the one next step that fits: merge, bring the base branch in, check it out, review it
// on GitHub, or clean up once it is merged.

import { useEffect, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  Eye,
  GitMerge,
  ListTodo,
  MessageSquareWarning,
  TriangleAlert,
  UserCheck
} from 'lucide-react'
import {
  bringBaseIn,
  checkoutPull,
  cleanUpAfterMerge,
  deleteClosedBranch,
  MERGE_LABELS,
  mergeMenuLabel,
  mergePull,
  openWebPage,
  preferredMergeMethod
} from '@renderer/actions/pulls'
import { api } from '@renderer/api/client'
import { Avatar } from '@renderer/components/common/Avatar'
import { Button } from '@renderer/components/common/Button'
import { showMenuBelow } from '@renderer/components/common/ContextMenu'
import { goToCommit } from '@renderer/components/details/CommitPanel'
import { CopyButton, ErrorBlock, LoadingBlock } from '@renderer/components/details/parts'
import { ReleaseNotes } from '@renderer/components/update/ReleaseNotes'
import { pluralize, relativeTime } from '@renderer/lib/format'
import { checksLabel, localBranchFor, mergeBlocker, mergeChecksText, providerName, pullNoun, PullNoun, pullRef, reviewLabel, stateLabel } from '@renderer/lib/pulls'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { HostingProvider, MergeChecks, MergeMethod, PullCommit, PullRequest, RepoPullRequests } from '@shared/hosting'
import { PullStateIcon } from './PullChip'
import { repoHosting, usePullIndex, usePulls } from './pullStore'
import './pulls.css'

/** Merged pull requests whose Clean up the user turned down (this session). */
const keptBranches = new Set<string>()

/** Where each provider shows a pull request's changes. */
const REVIEW_PAGE: Record<HostingProvider, string> = { github: 'files', gitlab: 'diffs', 'bitbucket-cloud': 'diff', 'bitbucket-server': 'diff' }

const ago = (iso: string | null) => (iso ? relativeTime(Math.floor(Date.parse(iso) / 1000)) : '')

export function PullPanel({ tab, number }: { tab: RepoTab; number: number }) {
  const { data, state } = usePullIndex(tab)
  const pr = data?.pulls.find((p) => p.number === number)
  if (!pr || !data) {
    const provider = data?.provider ?? repoHosting(tab)?.provider
    if (!state || state.loading) return <div className="det-panel"><LoadingBlock label={`Loading ${pullNoun(provider)}…`} /></div>
    return (
      <div className="det-panel">
        <ErrorBlock
          message={
            state.error ??
            `${PullNoun(provider)} ${pullRef({ provider: provider ?? 'github', number })} is not among this repository's recent ${pullNoun(provider, true)}.`
          }
          onRetry={() => void usePulls.getState().load(tab.path, { force: true })}
        />
      </div>
    )
  }
  return <PullDetails key={pr.number} tab={tab} pr={pr} data={data} />
}

function PullDetails({ tab, pr, data }: { tab: RepoTab; pr: PullRequest; data: RepoPullRequests }) {
  const repo = tab.path
  const open = pr.state === 'open' || pr.state === 'draft'
  const local = localBranchFor(pr, tab.refs, data.remote)
  const fork = pr.headFork ? `${pr.headFork.split('/')[0]}:` : ''
  return (
    <div className="det-panel pr-panel">
      <div className="ui-panel-header det-header">
        <PullStateIcon state={pr.state} size={14} />
        <span className="det-header-label">{PullNoun(pr.provider)}</span>
        <span className="det-sha selectable">{pullRef(pr)}</span>
        <CopyButton text={pr.url} label={`Copy link to the ${pullNoun(pr.provider)}`} what={`Copied the link to ${pullRef(pr)}`} />
        <span className="det-spacer" />
        <button type="button" className="ui-link pr-open-link" onClick={() => openWebPage(pr.url)}>
          Open on {providerName(pr)} <ExternalLink size={12} />
        </button>
      </div>

      <div className="pr-body">
        <h2 className="pr-title selectable">{pr.title}</h2>
        <div className="pr-branches">
          <span className={`pr-state pr-state-${pr.state}`}>
            <PullStateIcon state={pr.state} size={11} />
            {stateLabel(pr)}
          </span>
          <span className="pr-branch" title={`${fork}${pr.headRef}`}>
            {fork}
            {pr.headRef}
          </span>
          <ArrowRight size={13} className="pr-arrow" aria-label="into" />
          <span className="pr-branch">{pr.baseRef}</span>
        </div>
        <div className="det-person">
          <Avatar name={pr.authorName ?? pr.author} size={28} />
          <div className="det-person-text">
            <div className="det-person-line">
              <span className="det-person-name selectable">{pr.authorName ?? pr.author}</span>
              {pr.authorName && <span className="det-person-email selectable">{pr.author}</span>}
            </div>
            <div className="det-person-meta">
              opened {ago(pr.createdAt)}
              {pr.updatedAt && pr.updatedAt !== pr.createdAt ? ` · updated ${ago(pr.updatedAt)}` : ''}
            </div>
          </div>
        </div>

        {open ? (
          <PullStatus pr={pr} data={data} />
        ) : (
          <div className="pr-note">
            {pr.state === 'merged'
              ? `Merged into ${pr.baseRef} ${ago(pr.closedAt)}`
              : stateLabel(pr) === 'Declined'
                ? `Declined ${ago(pr.closedAt)}`
                : `Closed without merging ${ago(pr.closedAt)}`}
          </div>
        )}

        {pr.body.trim() && (
          <div className="pr-desc">
            <ReleaseNotes markdown={pr.body} />
          </div>
        )}

        <PullCommits repo={repo} pr={pr} remote={data.remote} />
      </div>

      {open && <PullActions tab={tab} pr={pr} data={data} hasLocal={!!local} localName={local?.name ?? null} isCheckedOut={!!local?.isHead} />}
      {pr.state === 'merged' && local && !keptBranches.has(`${repo}\0${local.name}`) && <CleanUpBox repo={repo} pr={pr} data={data} branch={local.name} />}
      {pr.state === 'closed' && local && !keptBranches.has(`${repo}\0${local.name}`) && <DeleteBranchBox repo={repo} pr={pr} data={data} branch={local.name} />}
    </div>
  )
}

/** Commits shown at most; the rest are on GitHub. */
const MAX_COMMITS = 20

interface CommitList {
  commits: PullCommit[]
  /** In this repository (a click selects the commit in the graph), else only on GitHub (a click opens it there). */
  local: boolean
}

// Per pull request and head: switching between pull requests does not ask again.
const commitCache = new Map<string, CommitList>()

/** The pull request's commits: from this repository when its head is here, else from GitHub. */
function usePullCommits(repo: string, pr: PullRequest, remote: string): CommitList | 'loading' | 'failed' {
  const key = `${repo}\0${pr.number}\0${pr.headSha}`
  const [list, setList] = useState<CommitList | 'loading' | 'failed'>(() => commitCache.get(key) ?? 'loading')
  useEffect(() => {
    const cached = commitCache.get(key)
    if (cached) {
      setList(cached)
      return
    }
    let alive = true
    setList('loading')
    const here: Promise<CommitList | null> = pr.headSha
      ? api
          .getLog(repo, { revisions: [pr.headSha, `^${remote}/${pr.baseRef}`], maxCount: 100 })
          .then((page) => (page.commits.length ? { commits: page.commits.map((c) => ({ sha: c.sha, subject: c.subject, author: c.authorName })), local: true } : null))
          .catch(() => null)
      : Promise.resolve(null)
    here
      .then((found) => found ?? api.getPullRequestCommits(repo, pr.number).then((commits) => ({ commits, local: false })))
      .then((found) => {
        commitCache.set(key, found)
        if (alive) setList(found)
      })
      .catch(() => alive && setList('failed'))
    return () => {
      alive = false
    }
  }, [key, repo, pr.number, pr.headSha, pr.baseRef, remote])
  return list
}

function PullCommits({ repo, pr, remote }: { repo: string; pr: PullRequest; remote: string }) {
  const list = usePullCommits(repo, pr, remote)
  const commits = typeof list === 'object' ? list.commits : []
  const count = pr.commitCount || commits.length
  const open = (c: PullCommit) => {
    if (typeof list === 'object' && list.local) goToCommit(repo, c.sha)
    else openWebPage(`${pr.url}/commits/${c.sha}`)
  }
  return (
    <div className="pr-commits-section">
      <div className="pr-commits-head">
        <span>{count ? pluralize(count, 'commit') : 'Commits'}</span>
        <span className="det-spacer" />
        {(pr.additions > 0 || pr.deletions > 0) && (
          <span className="pr-diffstat">
            <span className="pr-add">+{pr.additions}</span> <span className="pr-del">−{pr.deletions}</span>
          </span>
        )}
      </div>
      {list === 'loading' && <div className="pr-commits-note">Loading commits…</div>}
      {list === 'failed' && <div className="pr-commits-note">The commits could not be read.</div>}
      {commits.slice(0, MAX_COMMITS).map((c) => (
        <button
          key={c.sha}
          type="button"
          className="pr-commit-row"
          title={typeof list === 'object' && list.local ? `${c.subject}\nSelect it in the graph` : `${c.subject}\nOpen it on GitHub`}
          onClick={() => open(c)}
        >
          <span className="pr-sha">{c.sha.slice(0, 7)}</span>
          <span className="pr-commit-subject">{c.subject}</span>
        </button>
      ))}
      {commits.length > MAX_COMMITS && (
        <button type="button" className="ui-link pr-commits-more" onClick={() => openWebPage(`${pr.url}/commits`)}>
          {pluralize(commits.length - MAX_COMMITS, 'more commit')} on GitHub
        </button>
      )}
    </div>
  )
}

function PullStatus({ pr, data }: { pr: PullRequest; data: RepoPullRequests }) {
  const [showChecks, setShowChecks] = useState(pr.checks === 'failed')
  const checks = checksLabel(pr)
  const review = pr.reviewRequested ? 'Your review is requested' : reviewLabel(pr)
  const checksIcon =
    pr.checks === 'passed' ? (
      <CircleCheck size={16} className="pr-ok" />
    ) : pr.checks === 'failed' ? (
      <CircleX size={16} className="pr-bad" />
    ) : (
      <Clock size={16} className="pr-wait" />
    )
  const reviewIcon = pr.reviewRequested ? (
    <Eye size={16} className="pr-wait" />
  ) : pr.changesRequestedBy.length ? (
    <MessageSquareWarning size={16} className="pr-bad" />
  ) : pr.review === 'approved' ? (
    <UserCheck size={16} className="pr-ok" />
  ) : (
    <Clock size={16} className="pr-wait" />
  )
  return (
    <div className="pr-status">
      {checks && (
        <>
          <button type="button" className="pr-status-row pr-status-button" aria-expanded={showChecks} onClick={() => setShowChecks((v) => !v)}>
            {checksIcon}
            <span className="pr-status-text">{checks}</span>
            {showChecks ? <ChevronDown size={13} className="pr-muted" /> : <ChevronRight size={13} className="pr-muted" />}
          </button>
          {showChecks && (
            <ul className="pr-checklist">
              {pr.checkRuns.map((c, i) => (
                <li key={`${c.name}:${i}`}>
                  {c.state === 'passed' ? (
                    <CircleCheck size={13} className="pr-ok" />
                  ) : c.state === 'failed' ? (
                    <CircleX size={13} className="pr-bad" />
                  ) : c.state === 'running' ? (
                    <Clock size={13} className="pr-wait" />
                  ) : (
                    <CircleDashed size={13} className="pr-muted" />
                  )}
                  <span className="pr-check-name" title={c.name}>
                    {c.name}
                  </span>
                  {c.url && (
                    <button type="button" className="ui-link" onClick={() => openWebPage(c.url!)}>
                      Details
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {review && (
        <div className="pr-status-row">
          {reviewIcon}
          <span className="pr-status-text">{review}</span>
        </div>
      )}
      {pr.openTasks > 0 && (
        <div className="pr-status-row">
          <ListTodo size={16} className="pr-wait" />
          <span className="pr-status-text">{pluralize(pr.openTasks, 'open task')}</span>
        </div>
      )}
      {/* Bitbucket Cloud does not say whether a pull request conflicts. */}
      {data.reportsConflicts && (
        <div className="pr-status-row">
          {pr.mergeable === 'conflicts' ? (
            <TriangleAlert size={16} className="pr-wait" />
          ) : pr.mergeable === 'clean' ? (
            <GitMerge size={16} className="pr-ok" />
          ) : (
            <CircleDashed size={16} className="pr-muted" />
          )}
          <span className="pr-status-text">
            {pr.mergeable === 'conflicts' ? `Conflicts with ${pr.baseRef}` : pr.mergeable === 'clean' ? `No conflicts with ${pr.baseRef}` : 'Checking for conflicts…'}
          </span>
        </div>
      )}
    </div>
  )
}

/** Bitbucket Data Center's merge checks (GitLab: its merge status) for an open pull request, asked when it is shown. */
function useMergeChecks(repo: string, pr: PullRequest, data: RepoPullRequests): MergeChecks | null {
  const [checks, setChecks] = useState<MergeChecks | null>(null)
  const ask = data.mergeChecks && pr.state === 'open'
  useEffect(() => {
    setChecks(null)
    if (!ask) return
    let alive = true
    api
      .getPullRequestMergeChecks(repo, pr.number)
      .then((c) => alive && setChecks(c))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [repo, pr.number, pr.headSha, pr.updatedAt, ask])
  return checks
}

function PullActions(props: { tab: RepoTab; pr: PullRequest; data: RepoPullRequests; hasLocal: boolean; localName: string | null; isCheckedOut: boolean }) {
  const { tab, pr, data } = props
  const repo = tab.path
  const [method, setMethod] = useState<MergeMethod>(() => preferredMergeMethod(data))
  const [cleanUp, setCleanUp] = useState(true)
  const merging = useApp((s) => !!s.busy[`merge-pr:${repo}`])
  const checks = useMergeChecks(repo, pr, data)
  // Bitbucket's own merge checks say it best when it answered (permission, approvals, tasks, conflicts).
  const blocker = (checks?.blocked ? mergeChecksText(checks.reasons, providerName(pr)) : null) ?? mergeBlocker(pr, data)
  const canMerge = data.canMerge && pr.state === 'open'
  const label = MERGE_LABELS[method]

  const secondary = [
    !props.isCheckedOut && (
      <Button key="checkout" onClick={() => void checkoutPull(repo, pr)}>
        Check out
      </Button>
    ),
    pr.mergeable === 'conflicts' && (
      <Button key="bring" title={`Merge ${pr.baseRef} into ${pr.headRef} here and resolve the conflicts, then Push`} onClick={() => void bringBaseIn(repo, pr, data)}>
        Bring {pr.baseRef} in…
      </Button>
    ),
    !pr.viewerIsAuthor && (
      <Button key="review" icon={<ExternalLink size={13} />} onClick={() => openWebPage(`${pr.url}/${REVIEW_PAGE[pr.provider]}`)}>
        Review on {providerName(pr)}
      </Button>
    )
  ].filter(Boolean)

  return (
    <div className="pr-actions">
      {canMerge && (
        <>
          <div className="pr-merge">
            <Button
              variant="primary"
              className="pr-merge-main"
              icon={<GitMerge size={14} />}
              disabled={!!blocker}
              loading={merging}
              onClick={() => void mergePull(repo, pr, data, method, cleanUp && props.hasLocal)}
            >
              {label.button}
            </Button>
            {data.mergeMethods.length > 1 && (
              <Button
                variant="primary"
                className="pr-merge-more"
                aria-label="Other ways to merge"
                icon={<ChevronDown size={14} />}
                disabled={!!blocker || merging}
                onClick={(e) =>
                  showMenuBelow(
                    e.currentTarget,
                    data.mergeMethods.map((m, i) => ({
                      // Bitbucket lists the repository's default first.
                      label: `${mergeMenuLabel(m, pr.provider)}${i === 0 && pr.provider !== 'github' ? ' (default)' : ''} · ${MERGE_LABELS[m].hint(pr)}`,
                      checked: m === method,
                      onClick: () => setMethod(m)
                    }))
                  )
                }
              />
            )}
          </div>
          {blocker ? (
            <div className="pr-hint">{blocker}</div>
          ) : (
            props.hasLocal && (
              <label className="pr-check">
                <input type="checkbox" checked={cleanUp} onChange={(e) => setCleanUp(e.target.checked)} />
                Then switch to {pr.baseRef}, pull, and delete {props.localName}
              </label>
            )
          )}
        </>
      )}
      {secondary.length > 0 && <div className="pr-secondary">{secondary}</div>}
    </div>
  )
}

function CleanUpBox({ repo, pr, data, branch }: { repo: string; pr: PullRequest; data: RepoPullRequests; branch: string }) {
  const [hidden, setHidden] = useState(false)
  const busy = useApp((s) => !!s.busy[`cleanup:${repo}`])
  if (hidden) return null
  return (
    <div className="pr-actions">
      <div className="pr-cleanup">
        <span>
          Switch to <strong>{pr.baseRef}</strong>, pull, and delete <strong>{branch}</strong> here{!pr.headFork && !data.deleteBranchOnMerge ? ` and on ${data.remote}` : ''}.
        </span>
        <div className="pr-secondary">
          <Button variant="primary" loading={busy} onClick={() => void cleanUpAfterMerge(repo, pr, data)}>
            Clean up
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              keptBranches.add(`${repo}\0${branch}`)
              setHidden(true)
            }}
          >
            Keep branch
          </Button>
        </div>
      </div>
    </div>
  )
}

function DeleteBranchBox({ repo, pr, data, branch }: { repo: string; pr: PullRequest; data: RepoPullRequests; branch: string }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div className="pr-actions">
      <div className="pr-cleanup">
        <span>
          Delete <strong>{branch}</strong> here?
        </span>
        <div className="pr-secondary">
          <Button variant="primary" onClick={() => void deleteClosedBranch(repo, pr, data)}>
            Delete branch
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              keptBranches.add(`${repo}\0${branch}`)
              setHidden(true)
            }}
          >
            Keep it
          </Button>
        </div>
      </div>
    </div>
  )
}
