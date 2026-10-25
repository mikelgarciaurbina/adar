import { describe, expect, it } from 'vitest'
import type { PullRequest, RepoPullRequests } from '@shared/hosting'
import type { Ref, RefsResult } from '@shared/types'
import { buildTree, flattenTree } from '@renderer/components/sidebar/tree'
import { checksLabel, indexPulls, localBranchFor, mergeBlocker, pullForRef, pullTitle, pushPlan, reviewLabel, suggestBody, suggestTitle } from './pulls'

const sha = (c: string) => c.repeat(40)

function pr(p: Partial<PullRequest>): PullRequest {
  return {
    number: 1,
    title: 'Title',
    body: '',
    url: 'https://github.com/acme/widgets/pull/1',
    state: 'open',
    author: 'mikel',
    authorName: 'Mikel Garcia',
    headRef: 'feat/x',
    headSha: sha('a'),
    headFork: null,
    baseRef: 'main',
    createdAt: '',
    updatedAt: '',
    closedAt: null,
    additions: 0,
    deletions: 0,
    commitCount: 1,
    checks: 'none',
    checkRuns: [],
    review: 'none',
    approvedBy: [],
    changesRequestedBy: [],
    reviewRequests: [],
    reviewRequested: false,
    mergeable: 'clean',
    mergeBlocked: false,
    viewerIsAuthor: true,
    ...p
  }
}

const branch = (name: string, s: string, extra: Partial<Ref> = {}): Ref => ({ name, fullName: `refs/heads/${name}`, type: 'branch', sha: s, ...extra })
const remote = (name: string, s: string): Ref => ({ name, fullName: `refs/remotes/${name}`, type: 'remote', sha: s, remote: 'origin' })

function refsWith(branches: Ref[], remotes: Ref[]): RefsResult {
  return { head: { sha: null, branch: null, detached: false, unborn: false }, branches, remotes, tags: [], stashes: [], submodules: [] }
}

const data = (pulls: PullRequest[]): RepoPullRequests => ({
  owner: 'acme',
  name: 'widgets',
  remote: 'origin',
  webUrl: 'https://github.com/acme/widgets',
  viewer: 'mikel',
  defaultBranch: 'main',
  mergeMethods: ['squash'],
  deleteBranchOnMerge: false,
  canMerge: true,
  pulls
})

describe('pull requests on branches', () => {
  it('labels tracking branches and remote branches; open beats merged; merged only on the merged commit', () => {
    const refs = refsWith(
      [
        branch('feat/x', sha('a'), { upstream: 'origin/feat/x' }),
        branch('local-name', sha('b'), { upstream: 'origin/feat/y' }),
        branch('old', sha('c'), { upstream: 'origin/old' }),
        branch('reused', sha('9'), { upstream: 'origin/reused' }),
        branch('pr/7', sha('d'))
      ],
      [remote('origin/feat/x', sha('a')), remote('origin/feat/y', sha('b')), remote('origin/old', sha('c'))]
    )
    const index = indexPulls(
      data([
        pr({ number: 5, headRef: 'feat/x' }),
        pr({ number: 6, headRef: 'feat/y', headSha: sha('b'), state: 'draft' }),
        pr({ number: 7, headRef: 'fix', headFork: 'ane/widgets', headSha: sha('d') }),
        pr({ number: 3, headRef: 'feat/x', state: 'merged' }),
        pr({ number: 2, headRef: 'old', state: 'merged', headSha: sha('c') }),
        pr({ number: 1, headRef: 'reused', state: 'closed', headSha: sha('8') })
      ]),
      refs
    )
    expect(index.open.map((p) => p.number)).toEqual([5, 6, 7])
    expect(pullForRef(index, { name: 'feat/x', type: 'branch' })?.number).toBe(5)
    expect(pullForRef(index, { name: 'origin/feat/x', type: 'remote' })?.number).toBe(5)
    expect(pullForRef(index, { name: 'local-name', type: 'branch' })?.number).toBe(6)
    expect(pullForRef(index, { name: 'pr/7', type: 'branch' })?.number).toBe(7)
    expect(pullForRef(index, { name: 'old', type: 'branch' })?.number).toBe(2)
    expect(pullForRef(index, { name: 'reused', type: 'branch' })).toBeUndefined()
    expect(pullForRef(index, { name: 'v1', type: 'tag' })).toBeUndefined()
    expect(localBranchFor(pr({ number: 7, headFork: 'ane/widgets' }), refs, 'origin')?.name).toBe('pr/7')
    expect(localBranchFor(pr({ headRef: 'feat/y' }), refs, 'origin')?.name).toBe('local-name')
    expect(indexPulls(null, refs).open).toEqual([])
  })

  it('plans the push a pull request needs first', () => {
    expect(pushPlan({ name: 'feat/x' }, 'origin')).toEqual({ kind: 'publish', head: 'feat/x' })
    expect(pushPlan({ name: 'feat/x', upstream: 'origin/feat/x', upstreamGone: true }, 'origin')).toEqual({ kind: 'publish', head: 'feat/x' })
    expect(pushPlan({ name: 'feat/x', upstream: 'origin/feature-x', ahead: 2 }, 'origin')).toEqual({ kind: 'push', head: 'feature-x', ahead: 2 })
    expect(pushPlan({ name: 'feat/x', upstream: 'origin/feat/x', ahead: 1, behind: 3 }, 'origin')).toEqual({ kind: 'behind', head: 'feat/x', behind: 3 })
    expect(pushPlan({ name: 'feat/x', upstream: 'origin/feat/x' }, 'origin')).toEqual({ kind: 'none', head: 'feat/x' })
    expect(pushPlan({ name: 'feat/x', upstream: 'fork/feat/x' }, 'origin')).toEqual({ kind: 'other-remote', head: 'feat/x', upstream: 'fork/feat/x' })
  })

  it('says where a pull request stands', () => {
    const runs = (...states: Array<'passed' | 'failed' | 'running'>) => states.map((state, i) => ({ name: `c${i}`, state, url: null }))
    expect(checksLabel(pr({ checks: 'passed', checkRuns: runs('passed', 'passed', 'passed', 'passed') }))).toBe('All 4 checks passed')
    expect(checksLabel(pr({ checks: 'failed', checkRuns: runs('failed', 'passed', 'passed', 'passed') }))).toBe('1 of 4 checks failed')
    expect(checksLabel(pr({ checks: 'running', checkRuns: runs('running', 'passed') }))).toBe('1 check running')
    expect(checksLabel(pr({ checks: 'none' }))).toBeNull()
    expect(reviewLabel(pr({ review: 'approved', approvedBy: ['ane'] }))).toBe('Approved by ane')
    expect(reviewLabel(pr({ review: 'changes-requested', changesRequestedBy: ['ane', 'jon', 'miren'] }))).toBe('Changes requested by ane, jon and 1 more')
    expect(reviewLabel(pr({ review: 'review-required', reviewRequests: ['ane'] }))).toBe('Waiting for review from ane')
    expect(pullTitle(pr({ number: 41, title: 'Fix', headFork: 'ane/widgets', headRef: 'fix', reviewRequested: true }))).toContain('ane:fix → main')
    const d = data([])
    expect(mergeBlocker(pr({}), d)).toBeNull()
    expect(mergeBlocker(pr({ state: 'draft' }), d)).toMatch(/draft/)
    expect(mergeBlocker(pr({ mergeable: 'conflicts' }), d)).toMatch(/conflicts with main/)
    expect(mergeBlocker(pr({ mergeBlocked: true, checks: 'failed' }), d)).toMatch(/passing checks/)
    expect(mergeBlocker(pr({ mergeBlocked: true }), d)).toMatch(/approving review/)
    expect(mergeBlocker(pr({}), { canMerge: false })).toMatch(/permission/)
  })

  it('writes a title and description from the commits', () => {
    expect(suggestTitle('feat/workspaces', ['Add the dashboard'])).toBe('Add the dashboard')
    expect(suggestTitle('feat/group-dashboard', ['b', 'a'])).toBe('Group dashboard')
    expect(suggestBody(['newest', 'oldest'])).toBe('- oldest\n- newest')
    expect(suggestBody(['only'])).toBe('')
  })

  it('adds a Pull requests section to the left panel for GitHub repositories', () => {
    const refs = refsWith([branch('main', sha('a'))], [])
    expect(buildTree(refs, []).map((s) => s.id)).not.toContain('pulls')
    const off = flattenTree(buildTree(refs, [], { state: 'off' }))
    expect(off.map((r) => r.kind)).toContain('pull-prompt')
    const on = flattenTree(buildTree(refs, [], { state: 'on', pulls: [pr({ number: 42, title: 'Workspaces' }), pr({ number: 41, title: 'Rebase todo', headRef: 'fix' })] }))
    const section = on.find((r) => r.kind === 'section' && r.id === 'pulls')
    expect(section).toMatchObject({ title: 'Pull requests', count: 2 })
    expect(on.filter((r) => r.kind === 'pull').map((r) => r.key)).toEqual(['pull:42', 'pull:41'])
    const filtered = flattenTree(buildTree(refs, [], { state: 'on', pulls: [pr({ number: 42, title: 'Workspaces' })] }), { filter: '#42' })
    expect(filtered.some((r) => r.kind === 'pull')).toBe(true)
    const error = flattenTree(buildTree(refs, [], { state: 'error', message: 'GitHub did not accept the sign-in' }))
    expect(error.some((r) => r.kind === 'hint' && r.text === 'GitHub did not accept the sign-in')).toBe(true)
  })
})
