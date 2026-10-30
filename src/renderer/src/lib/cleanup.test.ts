import { describe, expect, it } from 'vitest'
import type { PullRequest, RepoPullRequests } from '@shared/hosting'
import type { BranchCleanupInfo, RefsResult } from '@shared/types'
import { cleanupBase, cleanupPlan, cleanupSummary, defaultSelection, keepMatches, keptBy, keptMatches } from './cleanup'

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
    expect(plan.kept).toEqual({ base: 'main', everywhere: ['develop'], protected: [], mine: [] })
    // A branch checked out in another worktree is never offered (git would refuse to delete it).
    expect(plan.inWorktrees).toEqual(['review'])
    expect(plan.inBase.some((i) => i.name === 'review')).toBe(false)
    expect([...defaultSelection(plan)].sort()).toEqual(['local:feat/cards', 'local:feat/search', 'local:fix/rounding'])
  })

  it('lists environment branches without ticking them, and leaves out what the repository and its service keep', () => {
    const remote = (name: string) => ({ name, sha: sha('a'), merged: true, unique: 0, subject: 'x', date: 1 })
    const data = info({
      local: [
        local('pre', { merged: true }),
        local('qa', { merged: true }),
        local('int', { merged: true }),
        local('env/eu', { merged: true }),
        local('prod', { merged: true }),
        local('fix/rounding', { merged: true })
      ],
      remote: [remote('pre'), remote('int'), remote('env/us'), remote('release/4.2'), remote('fix/rounding')]
    })
    // Nothing set up: environment names are offered, never ticked.
    const before = cleanupPlan(data, null)
    expect(before.inBase.map((i) => [i.name, i.ticked, i.environment])).toEqual([
      ['env/eu', true, false],
      ['fix/rounding', true, false],
      ['int', false, true],
      ['pre', false, true],
      ['prod', false, true],
      ['qa', false, true]
    ])
    expect(before.remote.find((i) => i.name === 'pre')?.ticked).toBe(false)

    // Kept by name and by pattern, here and on the remote; what the service protects too.
    const plan = cleanupPlan(data, null, { mine: ['pre', 'int', 'env/*', 'prod'], protected: ['prod', 'release/*'] })
    expect(plan.inBase.map((i) => i.name)).toEqual(['fix/rounding', 'qa'])
    expect(plan.remote.map((i) => i.label)).toEqual(['origin/fix/rounding'])
    // The service's rules show once, as protected; the default branch is never repeated.
    expect(plan.kept).toEqual({ base: 'main', everywhere: [], protected: ['prod', 'release/*'], mine: ['pre', 'int', 'env/*'] })
    expect(cleanupPlan(data, null, { mine: ['main'], protected: ['main'] }).kept).toEqual({ base: 'main', everywhere: [], protected: [], mine: [] })
  })

  it('matches kept names and patterns, and says why a branch is kept', () => {
    expect(keepMatches('pre', 'pre')).toBe(true)
    expect(keepMatches('pre', 'pre/x')).toBe(false)
    expect(keepMatches('env/*', 'env/eu')).toBe(true)
    expect(keepMatches('env/*', 'env/eu/west')).toBe(true)
    expect(keepMatches('env/*', 'envy')).toBe(false)
    expect(keepMatches('*-stable', '4.2-stable')).toBe(true)
    expect(keepMatches('v1.*', 'v1x2')).toBe(false)
    expect(keepMatches('(a)+*', '(a)+b')).toBe(true)
    expect(keptMatches('env/*', ['env/eu', 'main', 'env/us'], 'origin', ['env/us', 'env/latam', 'main'])).toEqual(['env/eu', 'env/us', 'origin/env/latam'])
    expect(keptMatches('env/*', ['env/eu'], null, ['env/latam'])).toEqual(['env/eu'])

    const rules = { mine: ['pre', 'env/*'], protected: ['release/*', 'env/eu'] }
    expect(keptBy('main', 'main', rules)).toEqual({ kind: 'base' })
    expect(keptBy('develop', 'main', rules)).toEqual({ kind: 'everywhere' })
    expect(keptBy('pre', 'main', rules)).toEqual({ kind: 'mine', rule: 'pre' })
    expect(keptBy('release/4.2', 'main', rules)).toEqual({ kind: 'protected', rule: 'release/*' })
    expect(keptBy('env/eu', 'main', rules)).toEqual({ kind: 'protected', rule: 'env/eu' })
    expect(keptBy('env/us', 'main', rules)).toEqual({ kind: 'mine', rule: 'env/*' })
    expect(keptBy('feat/x', 'main', rules)).toBeNull()
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
