import { describe, expect, it } from 'vitest'
import { buildTree, flattenTree } from '@renderer/components/sidebar/tree'
import type { PullRequest } from '@shared/hosting'
import type { RefsResult, Worktree } from '@shared/types'
import { worktreeFolder } from './worktrees'

const refs = { head: { sha: 'a'.repeat(40), branch: 'main', detached: false, unborn: false }, branches: [], remotes: [], tags: [], stashes: [], submodules: [] } as unknown as RefsResult
const wt = (name: string, p: Partial<Worktree> = {}): Worktree => ({
  path: `/p/${name}`,
  name,
  branch: name === 'widgets' ? 'main' : `feat/${name}`,
  sha: 'a'.repeat(40),
  isMain: name === 'widgets',
  isCurrent: name === 'widgets',
  detached: false,
  locked: false,
  missing: false,
  changes: 0,
  changedFiles: [],
  ...p
})

describe('worktrees', () => {
  it('proposes a folder next to the main one, named after the branch', () => {
    expect(worktreeFolder('/Users/me/Projects/widgets', 'feat/saved-cards')).toBe('/Users/me/Projects/widgets-saved-cards')
    expect(worktreeFolder('/Users/me/Projects/widgets', 'hotfix/round prices!', 2)).toBe('/Users/me/Projects/widgets-round-prices-2')
    expect(worktreeFolder('C:\\code\\widgets', 'pr/41')).toBe('C:\\code\\widgets-41')
  })

  it('shows the Worktrees section once loaded (empty until there is another one), with merged ones marked', () => {
    expect(buildTree(refs).map((s) => s.id)).not.toContain('worktrees')
    const alone = flattenTree(buildTree(refs, [], undefined, { list: [wt('widgets')] }))
    expect(alone.filter((r) => r.kind === 'section' && r.id === 'worktrees')).toMatchObject([{ count: 0 }])
    expect(alone.some((r) => r.kind === 'hint' && r.text === 'No other worktrees')).toBe(true)
    // Below the branches and pull requests, above tags and stashes.
    expect(buildTree(refs, [], { state: 'loading' }, { list: [wt('widgets')] }).map((s) => s.id)).toEqual(['local', 'remote', 'pulls', 'worktrees', 'tags', 'stashes'])
    const merged = new Map([['feat/review', { number: 41, provider: 'github', state: 'merged' } as PullRequest]])
    const rows = flattenTree(buildTree(refs, [], undefined, { list: [wt('widgets'), wt('review'), wt('old', { missing: true })], merged }))
    expect(rows.find((r) => r.kind === 'section' && r.id === 'worktrees')).toMatchObject({ title: 'Worktrees', count: 3 })
    const list = rows.filter((r) => r.kind === 'worktree')
    expect(list.map((r) => (r.kind === 'worktree' ? [r.node.label, r.node.merged?.number ?? null] : null))).toEqual([
      ['widgets', null],
      ['review', 41],
      ['old', null]
    ])
    const found = flattenTree(buildTree(refs, [], undefined, { list: [wt('widgets'), wt('review')] }), { filter: 'feat/review' })
    expect(found.some((r) => r.kind === 'worktree' && r.node.label === 'review')).toBe(true)
  })
})
