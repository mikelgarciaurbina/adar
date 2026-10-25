import { describe, expect, it } from 'vitest'
import { checksOf, githubErrorMessage, httpsUrl, isSafeBranchName, pullFromNode, pullFromRest, pullsFromQuery } from './hosting'
import { githubRepoOf } from './remoteUrl'

const sha = 'a'.repeat(40)
const base = {
  number: 42,
  title: 'Workspaces',
  url: 'https://github.com/acme/widgets/pull/42',
  state: 'OPEN',
  isDraft: false,
  headRefName: 'feat/workspaces',
  headRefOid: sha,
  isCrossRepository: false,
  baseRefName: 'main',
  author: { login: 'mikel', name: 'Mikel' }
}

describe('github remotes', () => {
  it('finds owner/name on github.com only', () => {
    expect(githubRepoOf('git@github.com:acme/widgets.git')).toEqual({ owner: 'acme', name: 'widgets' })
    expect(githubRepoOf('https://user:tok@github.com/acme/widgets')).toEqual({ owner: 'acme', name: 'widgets' })
    expect(githubRepoOf('ssh://git@github.com/acme/my.repo.git')).toEqual({ owner: 'acme', name: 'my.repo' })
    expect(githubRepoOf('git@github.com-work:acme/widgets.git')).toEqual({ owner: 'acme', name: 'widgets' })
    expect(githubRepoOf('https://gitlab.com/acme/widgets.git')).toBeNull()
    expect(githubRepoOf('https://github.com.evil.example/acme/widgets')).toBeNull()
    expect(githubRepoOf('https://github.com/acme/widgets/extra')).toBeNull()
    expect(githubRepoOf('https://github.com:8443/acme/widgets')).toBeNull()
    expect(githubRepoOf('/local/path')).toBeNull()
  })
})

describe('pull request mapping', () => {
  it('summarises checks: failed beats running beats passed, failed ones listed first', () => {
    const rollup = (nodes: unknown[], state = '') => ({ state, contexts: { nodes } })
    const run = (name: string, status: string, conclusion: string | null) => ({ __typename: 'CheckRun', name, status, conclusion, detailsUrl: 'https://github.com/x' })
    expect(checksOf(null)).toEqual({ checks: 'none', runs: [] })
    expect(checksOf(rollup([run('lint', 'COMPLETED', 'SUCCESS'), run('test', 'COMPLETED', 'SKIPPED')])).checks).toBe('passed')
    expect(checksOf(rollup([run('lint', 'COMPLETED', 'SUCCESS'), run('test', 'IN_PROGRESS', null)])).checks).toBe('running')
    const failed = checksOf(rollup([run('a', 'COMPLETED', 'SUCCESS'), run('test (windows)', 'COMPLETED', 'FAILURE'), { __typename: 'StatusContext', context: 'ci/x', state: 'PENDING', targetUrl: 'javascript:alert(1)' }]))
    expect(failed.checks).toBe('failed')
    expect(failed.runs.map((r) => [r.name, r.state])).toEqual([
      ['test (windows)', 'failed'],
      ['ci/x', 'running'],
      ['a', 'passed']
    ])
    expect(failed.runs[1].url).toBeNull()
  })

  it('maps open pull requests with reviews, requests and mergeability', () => {
    const pr = pullFromNode(
      {
        ...base,
        body: 'Closes #37',
        additions: 142,
        deletions: 18,
        reviewDecision: 'CHANGES_REQUESTED',
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'BLOCKED',
        commits: { totalCount: 3, nodes: [] },
        reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'Mikel' } }, { requestedReviewer: { __typename: 'Team', name: 'core' } }] },
        latestReviews: { nodes: [{ author: { login: 'ane' }, state: 'CHANGES_REQUESTED' }, { author: { login: 'jon' }, state: 'APPROVED' }] }
      },
      'mikel'
    )
    expect(pr).toMatchObject({
      number: 42,
      state: 'open',
      body: 'Closes #37',
      headSha: sha,
      headFork: null,
      review: 'changes-requested',
      approvedBy: ['jon'],
      changesRequestedBy: ['ane'],
      reviewRequests: ['Mikel', 'core'],
      reviewRequested: true,
      mergeable: 'conflicts',
      mergeBlocked: true,
      commitCount: 3,
      viewerIsAuthor: true
    })
    expect(pullFromNode({ ...base, isDraft: true, isCrossRepository: true, headRepository: { nameWithOwner: 'ane/widgets' } }, 'x')).toMatchObject({ state: 'draft', headFork: 'ane/widgets', viewerIsAuthor: false })
    expect(pullFromNode({ ...base, state: 'MERGED', body: 'gone', mergedAt: '2026-10-20T10:00:00Z' }, 'x')).toMatchObject({ state: 'merged', body: '', closedAt: '2026-10-20T10:00:00Z', checks: 'none' })
  })

  it('drops what cannot be trusted', () => {
    expect(pullFromNode({ ...base, url: 'http://evil.example' }, 'x')).toBeNull()
    expect(pullFromNode({ ...base, headRefName: '--upload-pack=sh' }, 'x')).toBeNull()
    expect(pullFromNode({ ...base, number: 0 }, 'x')).toBeNull()
    expect(pullFromNode({ ...base, headRefOid: 'not-a-sha' }, 'x')?.headSha).toBe('')
    for (const bad of ['-x', 'a..b', 'a b', 'a:b', '.hidden', 'x/.y', 'x.lock', 'x/', 'a@{1}', 'a\\b', '']) expect(isSafeBranchName(bad)).toBe(false)
    for (const ok of ['main', 'feat/workspaces', 'fix-rebase_todo.2', 'pr/7']) expect(isSafeBranchName(ok)).toBe(true)
    expect(httpsUrl('https://github.com/a')).toBe('https://github.com/a')
    expect(httpsUrl('https://u:p@github.com/a')).toBeNull()
  })

  it('reads the whole answer: open first, merge methods, permissions', () => {
    const data = {
      viewer: { login: 'mikel' },
      repository: {
        url: 'https://github.com/acme/widgets',
        viewerPermission: 'READ',
        squashMergeAllowed: false,
        mergeCommitAllowed: false,
        rebaseMergeAllowed: false,
        deleteBranchOnMerge: true,
        defaultBranchRef: { name: 'trunk' },
        open: { nodes: [base, { broken: true }] },
        done: { nodes: [{ ...base, number: 40, state: 'CLOSED' }, base] }
      }
    }
    const res = pullsFromQuery(data, { owner: 'acme', name: 'widgets', remote: 'origin' })
    expect(res).toMatchObject({ viewer: 'mikel', defaultBranch: 'trunk', canMerge: false, mergeMethods: ['merge'], deleteBranchOnMerge: true })
    expect(res?.pulls.map((p) => [p.number, p.state])).toEqual([
      [42, 'open'],
      [40, 'closed']
    ])
    expect(pullsFromQuery({ repository: null }, { owner: 'a', name: 'b', remote: 'origin' })).toBeNull()
  })

  it('reads REST answers and error messages', () => {
    const pr = pullFromRest(
      {
        number: 7,
        html_url: 'https://github.com/acme/widgets/pull/7',
        state: 'open',
        draft: false,
        user: { login: 'ane' },
        head: { ref: 'fix', sha, repo: { full_name: 'ane/widgets' } },
        base: { ref: 'main', repo: { full_name: 'acme/widgets' } }
      },
      'mikel'
    )
    expect(pr).toMatchObject({ number: 7, state: 'open', headRef: 'fix', headFork: 'ane/widgets', author: 'ane' })
    expect(githubErrorMessage({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists for acme:feat.' }] }, 'x')).toBe('A pull request already exists for acme:feat.')
    expect(githubErrorMessage({ message: 'Not Found' }, 'x')).toBe('Not Found')
    expect(githubErrorMessage('<html>', '502 Bad Gateway')).toBe('502 Bad Gateway')
  })
})
