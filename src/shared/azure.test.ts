import { describe, expect, it } from 'vitest'
import {
  azureChecks,
  azureCommits,
  azureErrorMessage,
  azureMergeChecks,
  azureMergeMethods,
  azureProtected,
  azurePull,
  azureRepo,
  azureUser
} from './azure'

const sha = (c: string) => c.repeat(40)
const REPO_URL = 'https://dev.azure.com/contoso/Web/_git/widgets'
const pr = (p: Record<string, unknown> = {}) => ({
  pullRequestId: 12,
  status: 'active',
  isDraft: false,
  title: 'Saved cards',
  description: 'Pay with a saved card.',
  createdBy: { id: 'u-ane', displayName: 'Ane Etxeberria', uniqueName: 'ane@contoso.com' },
  creationDate: '2026-11-01T10:00:00Z',
  sourceRefName: 'refs/heads/feat/cards',
  targetRefName: 'refs/heads/main',
  lastMergeSourceCommit: { commitId: sha('a') },
  mergeStatus: 'succeeded',
  reviewers: [
    { id: 'u-jon', displayName: 'Jon', uniqueName: 'jon@contoso.com', vote: 10 },
    { id: 'u-me', displayName: 'Mikel', uniqueName: 'mikel@contoso.com', vote: 0, isRequired: true },
    { id: 'g-web', displayName: '[Web]\\Web Team', vote: 0, isContainer: true }
  ],
  ...p
})
const NONE = { checks: null, evaluations: null }

describe('Azure DevOps answers', () => {
  it('reads who a token belongs to, and refuses an anonymous answer', () => {
    expect(azureUser({ authenticatedUser: { id: 'u-me', providerDisplayName: 'Mikel Garcia', properties: { Account: { $value: 'mikel@contoso.com' } } } })).toEqual({
      id: 'u-me',
      name: 'Mikel Garcia',
      login: 'mikel@contoso.com'
    })
    expect(azureUser({ authenticatedUser: { id: 'x', providerDisplayName: 'Anonymous', properties: {} } })).toBeNull()
    expect(azureUser(null)).toBeNull()
    expect(azureErrorMessage({ message: 'TF401019: The Git repository with name or identifier x does not exist.' }, 'fallback')).toBe(
      'The Git repository with name or identifier x does not exist.'
    )
    expect(azureErrorMessage('<html>', 'fallback')).toBe('fallback')
    expect(azureRepo({ id: 'r1', defaultBranch: 'refs/heads/develop', project: { id: 'p1' }, webUrl: REPO_URL })).toEqual({
      id: 'r1',
      projectId: 'p1',
      defaultBranch: 'develop',
      webUrl: REPO_URL
    })
  })

  it('maps a pull request: votes, required reviewers, forks, states and links', () => {
    const open = azurePull(pr(), 'u-me', NONE, REPO_URL)!
    expect(open).toMatchObject({
      provider: 'azure',
      number: 12,
      state: 'open',
      url: `${REPO_URL}/pullrequest/12`,
      author: 'ane@contoso.com',
      authorName: 'Ane Etxeberria',
      headRef: 'feat/cards',
      baseRef: 'main',
      headSha: sha('a'),
      headFork: null,
      approvedBy: ['Jon'],
      reviewRequests: ['Mikel'],
      reviewRequested: true,
      // A required reviewer has not approved yet.
      review: 'review-required',
      mergeable: 'clean',
      viewerIsAuthor: false,
      checks: 'none'
    })
    expect(azurePull(pr({ reviewers: [{ id: 'u-jon', displayName: 'Jon', vote: -10 }] }), 'u-me', NONE, REPO_URL)).toMatchObject({
      review: 'changes-requested',
      changesRequestedBy: ['Jon']
    })
    expect(azurePull(pr({ reviewers: [{ id: 'u-jon', displayName: 'Jon', vote: 5 }] }), 'u-ane', NONE, REPO_URL)).toMatchObject({
      review: 'approved',
      viewerIsAuthor: true
    })
    expect(azurePull(pr({ isDraft: true, mergeStatus: 'conflicts' }), '', NONE, REPO_URL)).toMatchObject({ state: 'draft', mergeable: 'conflicts' })
    expect(azurePull(pr({ status: 'completed', closedDate: '2026-11-02T10:00:00Z' }), '', NONE, REPO_URL)).toMatchObject({
      state: 'merged',
      closedAt: '2026-11-02T10:00:00Z',
      body: '',
      review: 'none'
    })
    expect(azurePull(pr({ status: 'abandoned' }), '', NONE, REPO_URL)?.state).toBe('closed')
    expect(azurePull(pr({ forkSource: { repository: { name: 'widgets', project: { name: 'Ane' } } } }), '', NONE, REPO_URL)?.headFork).toBe('Ane/widgets')
    expect(azurePull(pr({ sourceRefName: 'refs/heads/--upload-pack=x' }), '', NONE, REPO_URL)).toBeNull()
  })

  it('reads checks from statuses and build policies, and why it would not complete', () => {
    const statuses = {
      value: [
        { state: 'pending', context: { genre: 'ci', name: 'lint' }, targetUrl: 'https://ci.example.com/1' },
        { state: 'succeeded', context: { genre: 'ci', name: 'lint' }, targetUrl: 'https://ci.example.com/2' }
      ]
    }
    const evaluations = {
      value: [
        { status: 'running', configuration: { isEnabled: true, isBlocking: true, type: { displayName: 'Build' }, settings: { displayName: 'CI build' } }, context: { buildId: 41 } },
        { status: 'rejected', configuration: { isEnabled: true, isBlocking: true, type: { displayName: 'Minimum number of reviewers' } } },
        { status: 'rejected', configuration: { isEnabled: true, isBlocking: false, type: { displayName: 'Work item linking' } } },
        { status: 'approved', configuration: { isEnabled: true, isBlocking: true, type: { displayName: 'Comment requirements' } } }
      ]
    }
    expect(azureChecks(statuses, evaluations, 'https://dev.azure.com/contoso/Web/_build/results')).toEqual([
      { name: 'ci/lint', state: 'passed', url: 'https://ci.example.com/2' },
      { name: 'CI build', state: 'running', url: 'https://dev.azure.com/contoso/Web/_build/results?buildId=41' }
    ])
    expect(azureMergeChecks(pr({ mergeStatus: 'conflicts' }), evaluations)).toEqual({
      blocked: true,
      reasons: ['CI build must succeed first', 'It needs more approvals', 'It conflicts with main'],
      conflicts: true
    })
    expect(azureMergeChecks(pr(), { value: [] })).toEqual({ blocked: false, reasons: [], conflicts: false })
    const mapped = azurePull(pr(), '', { checks: azureChecks(statuses, evaluations, null), evaluations }, REPO_URL)!
    expect(mapped).toMatchObject({ checks: 'running', mergeBlocked: true })
  })

  it('reads merge strategies and protected branches from branch policies', () => {
    const configurations = {
      value: [
        {
          isEnabled: true,
          isBlocking: true,
          type: { displayName: 'Require a merge strategy' },
          settings: { allowSquash: true, allowNoFastForward: false, allowRebase: true, scope: [{ refName: 'refs/heads/main', matchKind: 'Exact', repositoryId: 'r1' }] }
        },
        { isEnabled: true, isBlocking: true, type: { displayName: 'Minimum number of reviewers' }, settings: { scope: [{ refName: 'refs/heads/release', matchKind: 'Prefix', repositoryId: null }] } },
        { isEnabled: true, isBlocking: true, type: { displayName: 'Build' }, settings: { scope: [{ refName: 'refs/heads/other', matchKind: 'Exact', repositoryId: 'r2' }] } },
        { isEnabled: false, isBlocking: true, type: { displayName: 'Build' }, settings: { scope: [{ refName: 'refs/heads/off', matchKind: 'Exact' }] } }
      ]
    }
    expect(azureMergeMethods(configurations, 'r1', 'main')).toEqual(['squash', 'rebase'])
    expect(azureMergeMethods(configurations, 'r1', 'develop')).toEqual(['merge', 'squash', 'rebase'])
    expect(azureProtected(configurations, 'r1')).toEqual(['main', 'release/*'])
    expect(azureCommits({ value: [{ commitId: sha('c'), comment: 'Saved cards\n\nBody', author: { name: 'Ane' } }, { commitId: 'nope' }] })).toEqual([
      { sha: sha('c'), subject: 'Saved cards', author: 'Ane' }
    ])
  })
})
