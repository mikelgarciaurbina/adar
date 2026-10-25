// Smoke tests: server-render the pull request panel and dialogs in their main states.
// The shared Modal renders through a portal (needs a DOM), so it is replaced by a plain wrapper.

import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp, type AppState, type RepoTab } from '@renderer/store/appStore'
import type { GithubConnection, PullRequest, RepoPullRequests } from '@shared/hosting'
import { DEFAULT_SETTINGS, type RefsResult } from '@shared/types'

vi.mock('@renderer/components/common/Modal', () => ({
  Modal: ({ title, children, footer, className }: { title: ReactNode; children: ReactNode; footer?: ReactNode; className?: string }) => (
    <div className={`ui-modal ${className ?? ''}`}>
      <div className="ui-modal-title">{title}</div>
      {children}
      <div className="ui-modal-footer">{footer}</div>
    </div>
  )
}))

const { PullPanel } = await import('./PullPanel')
const { ConnectDialog } = await import('./ConnectDialog')
const { CreatePullDialog } = await import('./CreatePullDialog')
const { usePulls } = await import('./pullStore')
type RepoPulls = import('./pullStore').RepoPulls

const REPO = '/Users/me/Projects/widgets'
const sha = (c: string) => c.repeat(40)

const refs: RefsResult = {
  head: { sha: sha('a'), branch: 'feat/x', detached: false, unborn: false },
  branches: [
    { name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: sha('m'), upstream: 'origin/main' },
    { name: 'feat/x', fullName: 'refs/heads/feat/x', type: 'branch', sha: sha('a'), isHead: true, upstream: 'origin/feat/x' },
    { name: 'feat/new', fullName: 'refs/heads/feat/new', type: 'branch', sha: sha('n') }
  ],
  remotes: [
    { name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', sha: sha('m'), remote: 'origin' },
    { name: 'origin/feat/x', fullName: 'refs/remotes/origin/feat/x', type: 'remote', sha: sha('a'), remote: 'origin' }
  ],
  tags: [],
  stashes: [],
  submodules: []
}

function pr(p: Partial<PullRequest>): PullRequest {
  return {
    number: 42,
    title: 'Workspaces: a dashboard for each tab group',
    body: 'Each tab group gets a **dashboard**.',
    url: 'https://github.com/acme/widgets/pull/42',
    state: 'open',
    author: 'mikel',
    authorName: 'Mikel Garcia',
    headRef: 'feat/x',
    headSha: sha('a'),
    headFork: null,
    baseRef: 'main',
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    closedAt: null,
    additions: 142,
    deletions: 18,
    commitCount: 3,
    checks: 'passed',
    checkRuns: [{ name: 'test', state: 'passed', url: null }],
    review: 'approved',
    approvedBy: ['ane'],
    changesRequestedBy: [],
    reviewRequests: [],
    reviewRequested: false,
    mergeable: 'clean',
    mergeBlocked: false,
    viewerIsAuthor: true,
    ...p
  }
}

const data = (pulls: PullRequest[], patch: Partial<RepoPullRequests> = {}): RepoPullRequests => ({
  owner: 'acme',
  name: 'widgets',
  remote: 'origin',
  webUrl: 'https://github.com/acme/widgets',
  viewer: 'mikel',
  defaultBranch: 'main',
  mergeMethods: ['squash', 'merge'],
  deleteBranchOnMerge: false,
  canMerge: true,
  pulls,
  ...patch
})

const tab = {
  path: REPO,
  name: 'widgets',
  info: { path: REPO, name: 'widgets', gitDir: `${REPO}/.git`, isBare: false, head: refs.head, state: 'none', remotes: [{ name: 'origin', fetchUrl: 'git@github.com:acme/widgets.git', pushUrl: 'git@github.com:acme/widgets.git' }] },
  refs,
  commits: [],
  multiSelect: [],
  selection: { kind: 'pull', number: 42 }
} as unknown as RepoTab

const connection: GithubConnection = { method: 'gh', login: 'mikel', error: null, ghLogin: 'mikel', canStoreToken: true }

function seed(pulls: RepoPullRequests | null, conn: GithubConnection | null = connection) {
  // Server rendering reads the stores' initial state, so seed both.
  const app: Partial<AppState> = { tabs: [tab], activePath: REPO, settings: { ...DEFAULT_SETTINGS }, busy: {}, modal: null }
  useApp.setState(app)
  Object.assign(useApp.getInitialState(), app)
  const repos: Record<string, RepoPulls> = pulls ? { [REPO]: { data: pulls, error: null, loading: false, at: Date.now() } } : {}
  const p = { connection: conn, repos }
  usePulls.setState(p)
  Object.assign(usePulls.getInitialState(), p)
}

beforeEach(() => seed(null))

describe('pull request panel', () => {
  it('shows an open pull request ready to merge, with the clean-up option', () => {
    seed(data([pr({})]))
    const html = renderToStaticMarkup(<PullPanel tab={tab} number={42} />)
    expect(html).toContain('Workspaces: a dashboard for each tab group')
    expect(html).toContain('The check passed')
    expect(html).toContain('Approved by ane')
    expect(html).toContain('No conflicts with main')
    expect(html).toContain('<strong>dashboard</strong>')
    expect(html).toContain('Squash and merge')
    expect(html).toContain('Then switch to main, pull, and delete feat/x')
    expect(html).toContain('3 commits')
    expect(html).toContain('Loading commits…')
    expect(html).not.toContain('>Check out<')
  })

  it('explains what blocks a merge and offers the next step instead', () => {
    seed(data([pr({ checks: 'failed', mergeBlocked: true, mergeable: 'conflicts', checkRuns: [{ name: 'test (windows-latest)', state: 'failed', url: null }] })]))
    const html = renderToStaticMarkup(<PullPanel tab={tab} number={42} />)
    expect(html).toContain('1 of 1 check failed')
    expect(html).toContain('test (windows-latest)')
    expect(html).toContain('It conflicts with main.')
    expect(html).toContain('Bring main in…')
  })

  it('offers to check out and review someone else’s pull request from a fork', () => {
    seed(data([pr({ number: 41, headFork: 'ane/widgets', headRef: 'fix', viewerIsAuthor: false, reviewRequested: true })], { canMerge: false }))
    const html = renderToStaticMarkup(<PullPanel tab={tab} number={41} />)
    expect(html).toContain('ane:fix')
    expect(html).toContain('Your review is requested')
    expect(html).toContain('Check out')
    expect(html).toContain('Review on GitHub')
    expect(html).not.toContain('Squash and merge')
  })

  it('offers to clean up once merged, and reports a missing pull request', () => {
    seed(data([pr({ state: 'merged', closedAt: '2026-10-25T11:00:00Z' })]))
    const merged = renderToStaticMarkup(<PullPanel tab={tab} number={42} />)
    expect(merged).toContain('Merged into main')
    expect(merged).toContain('Clean up')
    expect(merged).toContain('here and on origin')
    expect(renderToStaticMarkup(<PullPanel tab={tab} number={7} />)).toContain('#7 is not among')
  })
})

describe('pull request dialogs', () => {
  it('offers gh when it is signed in, and the token otherwise', () => {
    seed(null, { ...connection, method: null, login: null })
    const html = renderToStaticMarkup(<ConnectDialog />)
    expect(html).toContain('Found on this')
    expect(html).toContain('Signed in as <strong>mikel</strong>')
    expect(html).toContain('only talks to api.github.com')
    seed(null, { ...connection, method: null, login: null, ghLogin: null })
    const noGh = renderToStaticMarkup(<ConnectDialog />)
    expect(noGh).toContain('Looking for the GitHub CLI…')
    expect(noGh).toContain('Personal access token')
  })

  it('pushes a new branch before creating its pull request', () => {
    seed(data([]))
    const html = renderToStaticMarkup(<CreatePullDialog repo={REPO} head="feat/new" />)
    expect(html).toContain('Create pull request')
    expect(html).toContain('is not on origin yet. Adar pushes it first.')
    expect(html).toContain('Push and create')
    expect(html).toContain('main (default)')
    expect(html).toContain('github.com/acme/widgets')
  })
})
