import { describe, expect, it } from 'vitest'
import type { PullRequest, RepoPullRequests } from '@shared/hosting'
import type { BranchCleanupInfo, RefsResult } from '@shared/types'
import { cleanupBase, cleanupPlan, cleanupSummary, defaultSelection } from './cleanup'

const sha = (c: string) => c.repeat(40)
type Local = BranchCleanupInfo['local'][number]

const local = (name: string, p: Partial<Local> = {}): Local => ({
  name,
  sha: sha('a'),
  merged: false,
  unique: 0,
  subject: `Work on ${name}`,
  date: 1_700_000_000,
  upstream: `origin/${name}`,
  upstreamGone: false,
  isHead: false,
  ...p
})

const info = (p: Partial<BranchCleanupInfo> = {}): BranchCleanupInfo => ({
  base: 'main',
  baseRefs: ['refs/heads/main', 'refs/remotes/origin/main'],
  local: [],
  remote: [],
  remoteName: 'origin',
  ...p
})

const mergedPull = (p: Partial<PullRequest>): PullRequest =>
  ({ provider: 'github', number: 41, state: 'merged', headRef: 'feat/cards', headSha: sha('c'), headFork: null, ...p }) as PullRequest
const pulls = (list: PullRequest[]): RepoPullRequests => ({ remote: 'origin', defaultBranch: 'main', pulls: list }) as RepoPullRequests

describe('branch cleanup', () => {
  it('groups merged, squash-merged and gone branches, and ticks only what loses nothing', () => {
    const plan = cleanupPlan(
      info({
        local: [
          local('main', { merged: true, isHead: false }),
          local('develop', { merged: true }),
          local('fix/rounding', { merged: true, date: 1_700_000_100 }),
          local('feat/cards', { sha: sha('c'), upstreamGone: true, unique: 2 }),
          local('feat/search', { merged: true, isHead: true, date: 1_700_000_200 }),
          local('release/1.0', { merged: true }),
          local('try/one-page', { upstreamGone: true, unique: 1 }),
          local('wip', { upstream: null }),
          local('review', { merged: true, worktree: '/p/widgets-review' }),
          local('ahead', { sha: sha('e') })
        ],
        remote: [
          { name: 'main', sha: sha('m'), merged: true, unique: 0, subject: 'x', date: 1 },
          { name: 'fix/rounding', sha: sha('a'), merged: true, unique: 0, subject: 'x', date: 1 },
          { name: 'ahead', sha: sha('a'), merged: true, unique: 0, subject: 'x', date: 1 },
          { name: 'release/1.0', sha: sha('a'), merged: true, unique: 0, subject: 'x', date: 1 },
          { name: 'open', sha: sha('o'), merged: false, unique: 0, subject: 'x', date: 1 }
        ]
      }),
      pulls([mergedPull({}), mergedPull({ number: 9, headRef: 'try/one-page', headSha: sha('9') })])
    )
    expect(plan.inBase.map((i) => [i.name, i.reason.kind, i.ticked, i.isHead])).toEqual([
      ['feat/search', 'merged', true, true],
      ['fix/rounding', 'merged', true, false],
      ['feat/cards', 'pull', true, false],
      ['release/1.0', 'merged', false, false]
    ])
    expect(plan.inBase.find((i) => i.name === 'feat/cards')?.reason).toEqual({ kind: 'pull', ref: '#41' })
    // A merged pull request for another commit does not make the branch safe.
    expect(plan.gone.map((i) => [i.name, i.loses, i.ticked])).toEqual([['try/one-page', 1, false]])
    // origin/ahead stays: the local ahead still tracks it. main and the open branch never show.
    expect(plan.remote.map((i) => [i.label, i.ticked])).toEqual([
      ['origin/fix/rounding', true],
      ['origin/release/1.0', false]
    ])
    expect(plan.kept).toEqual(['main', 'develop'])
    // A branch checked out in another worktree is never offered (git would refuse to delete it).
    expect(plan.inWorktrees).toEqual(['review'])
    expect(plan.inBase.some((i) => i.name === 'review')).toBe(false)
    expect([...defaultSelection(plan)].sort()).toEqual(['local:feat/cards', 'local:feat/search', 'local:fix/rounding'])
  })

  it('treats a fork’s merged pull request branch as merged, and works without a remote', () => {
    const plan = cleanupPlan(
      info({ remoteName: null, local: [local('mr/13', { sha: sha('f'), upstream: null })] }),
      pulls([mergedPull({ provider: 'gitlab', number: 13, headFork: 'jon/widgets', headSha: sha('f') })])
    )
    expect(plan.inBase.map((i) => [i.name, i.reason])).toEqual([['mr/13', { kind: 'pull', ref: '!13' }]])
    expect(plan.remote).toEqual([])
  })

  it('finds the base branch and words the result', () => {
    const refs = { remotes: [{ name: 'origin/HEAD', fullName: 'refs/remotes/origin/HEAD', type: 'remote', sha: sha('a'), remote: 'origin', isSymbolic: true, target: 'origin/trunk' }] } as unknown as RefsResult
    expect(cleanupBase(refs, null, undefined)).toBe('trunk')
    expect(cleanupBase(refs, { defaultBranch: 'main' }, undefined)).toBe('main')
    expect(cleanupBase(null, null, undefined)).toBe('main')
    expect(cleanupSummary(4, 0, 'origin')).toBe('Deleted 4 branches')
    expect(cleanupSummary(1, 0, 'origin')).toBe('Deleted 1 branch')
    expect(cleanupSummary(4, 3, 'origin')).toBe('Deleted 4 branches here and 3 on origin')
    expect(cleanupSummary(0, 2, 'origin')).toBe('Deleted 2 branches on origin')
  })
})
