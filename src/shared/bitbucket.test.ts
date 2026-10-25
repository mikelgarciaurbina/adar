import { describe, expect, it } from 'vitest'
import {
  bitbucketErrorMessage,
  buildRuns,
  cloudCommits,
  cloudMergeMethods,
  cloudPull,
  cloudViewer,
  serverCommits,
  serverMergeChecks,
  serverMergeMethods,
  serverPull
} from './bitbucket'
import { sameCommit } from './hosting'
import { hostingOf, pickHostingRemote } from './remoteUrl'

const sha = (c: string) => c.repeat(40)
const viewer = { uuid: '{me}', accountId: 'acc-me', name: 'Mikel Garcia' }

const cloudPr = (p: Record<string, unknown> = {}) => ({
  id: 128,
  title: 'Booking: pay with saved cards',
  description: 'Saved **cards**',
  state: 'OPEN',
  draft: false,
  author: { display_name: 'Ane Etxeberria', nickname: 'ane', uuid: '{ane}', account_id: 'acc-ane' },
  source: { branch: { name: 'feat/saved-cards' }, commit: { hash: 'abcdef123456' }, repository: { full_name: 'acme/widgets' } },
  destination: { branch: { name: 'main' }, repository: { full_name: 'acme/widgets' } },
  links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/128' } },
  created_on: '2026-10-24T10:00:00Z',
  updated_on: '2026-10-25T10:00:00Z',
  task_count: 1,
  participants: [
    { user: { display_name: 'Jon Ibarra', uuid: '{jon}' }, role: 'REVIEWER', approved: true, state: 'approved' },
    { user: { display_name: 'Mikel Garcia', uuid: '{me}' }, role: 'REVIEWER', approved: false, state: null }
  ],
  reviewers: [
    { display_name: 'Jon Ibarra', uuid: '{jon}' },
    { display_name: 'Mikel Garcia', uuid: '{me}' }
  ],
  ...p
})

const serverPr = (p: Record<string, unknown> = {}) => ({
  id: 57,
  version: 3,
  title: 'Rates: round prices per currency',
  description: 'Per currency',
  state: 'OPEN',
  fromRef: { displayId: 'fix/rounding', latestCommit: sha('a'), repository: { slug: 'widgets', project: { key: 'WEB' } } },
  toRef: { displayId: 'main', latestCommit: sha('b'), repository: { slug: 'widgets', project: { key: 'WEB' } } },
  author: { user: { name: 'mikel', slug: 'mikel', displayName: 'Mikel Garcia' } },
  reviewers: [
    { user: { name: 'ane', displayName: 'Ane Etxeberria' }, status: 'NEEDS_WORK' },
    { user: { name: 'jon', displayName: 'Jon Ibarra' }, status: 'UNAPPROVED' }
  ],
  properties: { openTaskCount: 2, mergeResult: { outcome: 'CONFLICTED' } },
  createdDate: Date.parse('2026-10-24T10:00:00Z'),
  updatedDate: Date.parse('2026-10-25T09:00:00Z'),
  ...p
})

describe('Bitbucket remotes', () => {
  it('recognises bitbucket.org and Data Center remotes', () => {
    expect(hostingOf('git@bitbucket.org:acme/widgets.git')).toEqual({ provider: 'bitbucket-cloud', host: 'bitbucket.org', owner: 'acme', name: 'widgets' })
    expect(hostingOf('https://mikel@bitbucket.org/acme/widgets.git')).toMatchObject({ provider: 'bitbucket-cloud', owner: 'acme', name: 'widgets' })
    expect(hostingOf('https://bitbucket.example.com/scm/web/widgets.git')).toEqual({
      provider: 'bitbucket-server',
      host: 'bitbucket.example.com',
      owner: 'web',
      name: 'widgets',
      server: 'https://bitbucket.example.com'
    })
    expect(hostingOf('https://git.example.com:8443/bitbucket/scm/~mikel/dots.git')).toMatchObject({ owner: '~mikel', name: 'dots', server: 'https://git.example.com:8443/bitbucket' })
    expect(hostingOf('ssh://git@bitbucket.example.com:7999/web/widgets.git')).toMatchObject({ provider: 'bitbucket-server', server: 'https://bitbucket.example.com' })
    // A plain ssh remote is only Bitbucket when its host is a known server.
    expect(hostingOf('git@ssh.example.com:web/widgets.git')).toBeNull()
    const servers = [{ url: 'https://code.example.com', hosts: ['code.example.com', 'ssh.example.com'] }]
    expect(hostingOf('git@ssh.example.com:web/widgets.git', servers)).toMatchObject({ provider: 'bitbucket-server', server: 'https://code.example.com', owner: 'web' })
    expect(hostingOf('https://gitlab.com/acme/widgets.git')).toBeNull()
    expect(hostingOf('https://bitbucket.org/acme/widgets/extra')).toBeNull()
    expect(pickHostingRemote([{ name: 'up', url: 'git@bitbucket.org:acme/widgets.git' }, { name: 'lab', url: 'git@gitlab.com:a/b.git' }])).toMatchObject({ remote: 'up', provider: 'bitbucket-cloud' })
  })
})

describe('Bitbucket Cloud answers', () => {
  it('maps an open pull request with reviewers, tasks and builds', () => {
    const builds = buildRuns({ values: [{ name: 'test', state: 'SUCCESSFUL', url: 'https://ci.example.com/1' }, { key: 'lint', state: 'INPROGRESS' }] })
    const pr = cloudPull(cloudPr(), viewer, builds)
    expect(pr).toMatchObject({
      provider: 'bitbucket-cloud',
      number: 128,
      state: 'open',
      headRef: 'feat/saved-cards',
      headSha: 'abcdef123456',
      headFork: null,
      checks: 'running',
      approvedBy: ['Jon Ibarra'],
      reviewRequests: ['Mikel Garcia'],
      reviewRequested: true,
      review: 'approved',
      mergeable: 'unknown',
      openTasks: 1,
      viewerIsAuthor: false,
      author: 'ane',
      authorName: 'Ane Etxeberria'
    })
    expect(pr?.checkRuns.map((r) => [r.name, r.state])).toEqual([
      ['lint', 'running'],
      ['test', 'passed']
    ])
    expect(sameCommit(pr!.headSha, 'abcdef123456' + '0'.repeat(28))).toBe(true)
    expect(cloudPull(cloudPr({ state: 'DECLINED' }), viewer, null)).toMatchObject({ state: 'closed', body: '', checks: 'none' })
    expect(cloudPull(cloudPr({ draft: true }), viewer, null)?.state).toBe('draft')
    expect(cloudPull(cloudPr({ source: { branch: { name: '-x' } } }), viewer, null)).toBeNull()
    expect(cloudPull(cloudPr({ source: { ...cloudPr().source, repository: { full_name: 'ane/widgets' } } }), viewer, null)?.headFork).toBe('ane/widgets')
    const changes = cloudPull(cloudPr({ participants: [{ user: { display_name: 'Ane Etxeberria' }, state: 'changes_requested' }] }), viewer, null)
    expect(changes).toMatchObject({ review: 'changes-requested', changesRequestedBy: ['Ane Etxeberria'] })
    expect(cloudViewer({ display_name: 'Mikel Garcia', uuid: '{me}', account_id: 'acc-me' })).toEqual(viewer)
  })

  it('lists merge strategies with the default first, and commits newest first', () => {
    expect(cloudMergeMethods({ merge_strategies: ['merge_commit', 'squash', 'fast_forward'], default_merge_strategy: 'squash' })).toEqual({
      methods: ['squash', 'merge', 'fast-forward'],
      ids: { squash: 'squash', merge: 'merge_commit', 'fast-forward': 'fast_forward' }
    })
    expect(cloudMergeMethods(undefined).methods).toEqual(['merge', 'squash', 'fast-forward'])
    expect(cloudCommits({ values: [{ hash: sha('c'), message: 'Remember the card\n\nbody', author: { raw: 'Ane <ane@example.com>' } }, { hash: 'short' }] })).toEqual([
      { sha: sha('c'), subject: 'Remember the card', author: 'Ane' }
    ])
    expect(bitbucketErrorMessage({ type: 'error', error: { message: 'Bad request', detail: 'No commits' } }, 'x')).toBe('Bad request: No commits')
  })
})

describe('Bitbucket Data Center answers', () => {
  it('maps a pull request needing work, with conflicts, tasks and builds', () => {
    const pr = serverPull(serverPr(), 'jon', buildRuns({ values: [{ name: 'ci', state: 'SUCCESSFUL' }] }), 'https://bitbucket.example.com/projects/WEB/repos/widgets')
    expect(pr).toMatchObject({
      provider: 'bitbucket-server',
      number: 57,
      url: 'https://bitbucket.example.com/projects/WEB/repos/widgets/pull-requests/57',
      headSha: sha('a'),
      headFork: null,
      checks: 'passed',
      review: 'changes-requested',
      changesRequestedBy: ['Ane Etxeberria'],
      reviewRequests: ['Jon Ibarra'],
      reviewRequested: true,
      mergeable: 'conflicts',
      openTasks: 2,
      createdAt: '2026-10-24T10:00:00.000Z',
      authorName: 'Mikel Garcia'
    })
    expect(serverPull(serverPr({ state: 'DECLINED' }), 'jon', null, 'https://x')).toMatchObject({ state: 'closed' })
    expect(serverPull(serverPr({ fromRef: { ...serverPr().fromRef, repository: { slug: 'widgets', project: { key: '~ANE' } } } }), '', null, 'https://x')?.headFork).toBe('~ane/widgets')
  })

  it('reads strategies, merge checks and commits', () => {
    const settings = { mergeConfig: { defaultStrategy: { id: 'squash' }, strategies: [{ id: 'no-ff', enabled: true }, { id: 'squash', enabled: true }, { id: 'ff-only', enabled: false }] } }
    expect(serverMergeMethods(settings)).toEqual({ methods: ['squash', 'merge'], ids: { squash: 'squash', merge: 'no-ff' } })
    expect(serverMergeMethods(null)).toEqual({ methods: ['merge'], ids: { merge: 'no-ff' } })
    expect(serverMergeChecks({ canMerge: false, conflicted: true, vetoes: [{ summaryMessage: 'Requires 2 approvals' }] })).toEqual({ blocked: true, reasons: ['Requires 2 approvals'], conflicts: true })
    expect(serverMergeChecks({ canMerge: true, conflicted: false, vetoes: [] })).toEqual({ blocked: false, reasons: [], conflicts: false })
    expect(serverCommits({ values: [{ id: sha('d'), message: 'Round prices', author: { name: 'mikel', displayName: 'Mikel Garcia' } }] })).toEqual([{ sha: sha('d'), subject: 'Round prices', author: 'Mikel Garcia' }])
    expect(bitbucketErrorMessage({ errors: [{ message: 'Only one pull request may be open' }] }, 'x')).toBe('Only one pull request may be open')
  })
})
