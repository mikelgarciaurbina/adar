import { describe, expect, it } from 'vitest'
import type { Ref, RefsResult } from '@shared/types'
import { mainBranch } from './refs'

const SHA = 'a'.repeat(40)
const local = (name: string, upstream?: string): Ref => ({ name, fullName: `refs/heads/${name}`, type: 'branch', sha: SHA, upstream })
const head = (remote: string, target: string): Ref => ({
  name: `${remote}/HEAD`,
  fullName: `refs/remotes/${remote}/HEAD`,
  type: 'remote',
  sha: SHA,
  remote,
  isSymbolic: true,
  target
})
const refs = (branches: Ref[], remotes: Ref[] = []): RefsResult => ({
  head: { sha: SHA, branch: branches[0]?.name ?? null, detached: false, unborn: false },
  branches,
  remotes,
  tags: [],
  stashes: [],
  submodules: []
})

describe('mainBranch', () => {
  it('prefers the local branch of the remote default branch, by upstream or by name', () => {
    expect(mainBranch(refs([local('main'), local('dev', 'origin/develop')], [head('origin', 'origin/develop')]))?.name).toBe('dev')
    expect(mainBranch(refs([local('main'), local('develop')], [head('origin', 'origin/develop')]))?.name).toBe('develop')
    expect(mainBranch(refs([local('main'), local('trunk')], [head('team/a', 'team/a/trunk')]))?.name).toBe('trunk')
  })

  it('prefers origin over other remotes', () => {
    const r = refs([local('main'), local('develop')], [head('fork', 'fork/main'), head('origin', 'origin/develop')])
    expect(mainBranch(r)?.name).toBe('develop')
  })

  it('falls back to main, master, develop or trunk, then the first branch, never the excluded one', () => {
    expect(mainBranch(refs([local('feature'), local('master')]))?.name).toBe('master')
    expect(mainBranch(refs([local('main'), local('master')]), 'main')?.name).toBe('master')
    expect(mainBranch(refs([local('develop'), local('pre')], [head('origin', 'origin/develop')]), 'develop')?.name).toBe('pre')
    expect(mainBranch(refs([local('pre')]), 'pre')).toBeUndefined()
    expect(mainBranch(null)).toBeUndefined()
  })
})
