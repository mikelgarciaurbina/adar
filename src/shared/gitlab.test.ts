import { describe, expect, it } from 'vitest'
import { gitlabApprovers, gitlabCommits, gitlabErrorMessage, gitlabJobs, gitlabMergeChecks, gitlabMergeMethods, gitlabPull, type GitlabExtra } from './gitlab'
import { hostingOf, pickHostingRemote } from './remoteUrl'

const sha = (c: string) => c.repeat(40)
const viewer = { username: 'mikel', name: 'Mikel Garcia' }
const REPO = 'https://gitlab.com/acme/shop/widgets'
const none: GitlabExtra = { approvers: null, pipeline: null, fork: null }

const mr = (p: Record<string, unknown> = {}) => ({
  iid: 42,
  title: 'Checkout: pay with saved cards',
  description: 'Saved **cards**',
  state: 'opened',
  draft: false,
  author: { username: 'ane', name: 'Ane Etxeberria' },
  source_branch: 'feat/saved-cards',
  target_branch: 'main',
  sha: sha('a'),
  source_project_id: 7,
  target_project_id: 7,
  reviewers: [
    { username: 'jon', name: 'Jon Ibarra' },
    { username: 'mikel', name: 'Mikel Garcia' }
  ],
  detailed_merge_status: 'mergeable',
  has_conflicts: false,
  created_at: '2026-10-24T10:00:00Z',
  updated_at: '2026-10-25T10:00:00Z',
  ...p
})

describe('GitLab remotes', () => {
  it('recognises gitlab.com, gitlab.* hosts and known instances, with subgroups', () => {
    expect(hostingOf('git@gitlab.com:acme/shop/widgets.git')).toEqual({ provider: 'gitlab', host: 'gitlab.com', owner: 'acme/shop', name: 'widgets', server: 'https://gitlab.com' })
    expect(hostingOf('https://oauth2:token@gitlab.com/acme/widgets.git')).toMatchObject({ provider: 'gitlab', owner: 'acme', name: 'widgets' })
    expect(hostingOf('git@gitlab.com-work:acme/widgets.git')).toMatchObject({ provider: 'gitlab', host: 'gitlab.com' })
    expect(hostingOf('ssh://git@gitlab.example.com:2222/web/widgets.git')).toMatchObject({ provider: 'gitlab', server: 'https://gitlab.example.com', owner: 'web' })
    expect(hostingOf('https://gitlab.example.com:8443/web/widgets.git')).toMatchObject({ server: 'https://gitlab.example.com:8443' })
    // Any other host is GitLab only once it is a known instance (its SSH host may differ).
    expect(hostingOf('git@code.example.com:web/widgets.git')).toBeNull()
    const gitlab = [{ url: 'https://example.com/gitlab', hosts: ['example.com', 'ssh.example.com'] }]
    expect(hostingOf('git@ssh.example.com:web/widgets.git', { gitlab })).toMatchObject({ provider: 'gitlab', server: 'https://example.com/gitlab', owner: 'web' })
    expect(hostingOf('https://example.com/gitlab/web/sub/widgets.git', { gitlab })).toMatchObject({ owner: 'web/sub', name: 'widgets' })
    expect(hostingOf('https://example.com/other/web/widgets.git', { gitlab })).toBeNull()
    // Not projects: one segment, GitLab's own /-/ pages; Bitbucket Data Center stays Bitbucket.
    expect(hostingOf('https://gitlab.com/widgets.git')).toBeNull()
    expect(hostingOf('https://gitlab.com/acme/-/widgets')).toBeNull()
    expect(hostingOf('ssh://git@gitlab.example.com:7999/web/widgets.git')).toMatchObject({ provider: 'bitbucket-server' })
    expect(pickHostingRemote([{ name: 'origin', url: 'git@gitlab.com:acme/widgets.git' }, { name: 'gh', url: 'git@github.com:acme/widgets.git' }])).toMatchObject({ remote: 'origin', provider: 'gitlab' })
  })
})

describe('GitLab answers', () => {
  it('maps an open merge request with its pipeline, approvals and reviewers', () => {
    const extra: GitlabExtra = {
      approvers: gitlabApprovers({ approved_by: [{ user: { username: 'jon', name: 'Jon Ibarra' } }] }),
      pipeline: {
        status: 'running',
        jobs: gitlabJobs([
          { name: 'test', status: 'running', web_url: 'https://gitlab.com/acme/shop/widgets/-/jobs/1' },
          { name: 'lint', status: 'success' },
          { name: 'flaky', status: 'failed', allow_failure: true },
          { name: 'deploy', status: 'manual' }
        ])
      },
      fork: null
    }
    const pr = gitlabPull(mr(), viewer, extra, REPO)
    expect(pr).toMatchObject({
      provider: 'gitlab',
      number: 42,
      url: `${REPO}/-/merge_requests/42`,
      state: 'open',
      headSha: sha('a'),
      headFork: null,
      checks: 'running',
      review: 'approved',
      approvedBy: ['Jon Ibarra'],
      reviewRequests: ['Mikel Garcia'],
      reviewRequested: true,
      mergeable: 'clean',
      mergeBlocked: false,
      viewerIsAuthor: false,
      author: 'ane',
      authorName: 'Ane Etxeberria'
    })
    expect(pr?.checkRuns.map((r) => [r.name, r.state])).toEqual([
      ['test', 'running'],
      ['lint', 'passed'],
      ['deploy', 'skipped'],
      ['flaky', 'skipped']
    ])
    expect(gitlabPull(mr({ draft: true }), viewer, none, REPO)?.state).toBe('draft')
    expect(gitlabPull(mr({ state: 'merged', merged_at: '2026-10-25T11:00:00Z' }), viewer, none, REPO)).toMatchObject({ state: 'merged', closedAt: '2026-10-25T11:00:00Z', body: '' })
    expect(gitlabPull(mr({ state: 'closed' }), viewer, none, REPO)?.state).toBe('closed')
    expect(gitlabPull(mr({ has_conflicts: true, detailed_merge_status: 'conflict' }), viewer, none, REPO)).toMatchObject({ mergeable: 'conflicts', mergeBlocked: false })
    expect(gitlabPull(mr({ detailed_merge_status: 'ci_must_pass' }), viewer, none, REPO)?.mergeBlocked).toBe(true)
    expect(gitlabPull(mr({ detailed_merge_status: 'checking' }), viewer, none, REPO)?.mergeable).toBe('unknown')
    expect(gitlabPull(mr({ detailed_merge_status: 'requested_changes' }), viewer, none, REPO)?.review).toBe('changes-requested')
    expect(gitlabPull(mr({ source_project_id: 99 }), viewer, { ...none, fork: 'ane/widgets' }, REPO)?.headFork).toBe('ane/widgets')
    expect(gitlabPull(mr({ source_branch: '-x' }), viewer, none, REPO)).toBeNull()
    expect(gitlabPull(mr({ author: { username: 'mikel', name: 'Mikel Garcia' } }), viewer, none, REPO)?.viewerIsAuthor).toBe(true)
    const failed = gitlabPull(mr(), viewer, { ...none, pipeline: { status: 'failed', jobs: [] } }, REPO)
    expect(failed?.checks).toBe('failed')
  })

  it('reads merge methods, merge status, commits and errors', () => {
    expect(gitlabMergeMethods({ merge_method: 'merge', squash_option: 'default_off' })).toEqual(['merge', 'squash'])
    expect(gitlabMergeMethods({ merge_method: 'ff', squash_option: 'default_on' })).toEqual(['squash', 'fast-forward'])
    expect(gitlabMergeMethods({ merge_method: 'rebase_merge', squash_option: 'never' })).toEqual(['merge'])
    expect(gitlabMergeMethods({ squash_option: 'always' })).toEqual(['squash'])
    expect(gitlabMergeChecks({ detailed_merge_status: 'mergeable', user: { can_merge: true } })).toEqual({ blocked: false, reasons: [], conflicts: false })
    expect(gitlabMergeChecks({ detailed_merge_status: 'need_rebase', target_branch: 'main', user: { can_merge: false } })).toEqual({
      blocked: true,
      reasons: ['You do not have permission to merge it', 'It needs a rebase onto main'],
      conflicts: false
    })
    expect(gitlabMergeChecks({ detailed_merge_status: 'something_new' }).reasons).toEqual(['It cannot be merged yet'])
    expect(gitlabCommits([{ id: sha('c'), title: 'Remember the card', author_name: 'Ane' }, { id: 'short' }])).toEqual([{ sha: sha('c'), subject: 'Remember the card', author: 'Ane' }])
    expect(gitlabErrorMessage({ message: ['Another open merge request already exists for this source branch: !12'] }, 'x')).toBe('Another open merge request already exists for this source branch: !12')
    expect(gitlabErrorMessage({ message: { source_branch: ['is invalid'], base: ['Branch cannot be merged'] } }, 'x')).toBe('source branch is invalid; Branch cannot be merged')
    expect(gitlabErrorMessage({ message: '401 Unauthorized' }, 'x')).toBe('the token is wrong, expired or revoked')
    expect(gitlabErrorMessage({ error: 'insufficient_scope', scope: 'api' }, 'x')).toMatch(/^the token lacks the api scope/)
    expect(gitlabErrorMessage(null, '500 Internal Server Error')).toBe('500 Internal Server Error')
  })
})
