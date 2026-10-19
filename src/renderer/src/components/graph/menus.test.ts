import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import type { Commit, RefsResult } from '@shared/types'

const state: { tabs: unknown[] } = { tabs: [] }
vi.mock('@renderer/store/appStore', () => ({ useApp: { getState: () => state } }))
vi.mock('@renderer/actions/git', () => ({
  checkout: vi.fn(),
  checkoutRef: vi.fn(),
  createBranch: vi.fn(),
  createTag: vi.fn(),
  cherryPick: vi.fn(),
  revert: vi.fn(),
  reset: vi.fn(),
  startInteractiveRebase: vi.fn(),
  copyText: vi.fn()
}))

const git = await import('@renderer/actions/git')
const { commitMenu } = await import('./menus')

function commit(sha: string, ...parents: string[]): Commit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    authorName: 'A',
    authorEmail: 'a@x',
    authorDate: 0,
    committerName: 'A',
    committerEmail: 'a@x',
    committerDate: 0,
    subject: `subject ${sha}`,
    body: ''
  }
}

function refs(headSha: string): RefsResult {
  return {
    head: { sha: headSha, branch: 'main', detached: false, unborn: false },
    branches: [{ name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: headSha, isHead: true }],
    remotes: [],
    tags: [],
    stashes: [],
    submodules: []
  }
}

function setTab(commits: Commit[], headSha: string) {
  state.tabs = [{ path: '/repo', commits, refs: refs(headSha), info: null }]
}

type Item = Extract<MenuItem, { label: string; type?: 'item' }>
const labels = (menu: MenuItem[]) =>
  menu.filter((i): i is Item => i.type === undefined || i.type === 'item').map((i) => i.label)
const find = (menu: MenuItem[], label: string) =>
  menu.find((i): i is Item => (i.type === undefined || i.type === 'item') && i.label === label)

// orphan ── x          (unrelated root on another branch, not in HEAD's history)
// root ── a ── b (HEAD, main)
const root = commit('r'.repeat(40))
const a = commit('a'.repeat(40), root.sha)
const b = commit('b'.repeat(40), a.sha)
const orphan = commit('0'.repeat(40))
const x = commit('c'.repeat(40), orphan.sha)

beforeEach(() => vi.clearAllMocks())

describe('commitMenu — interactive rebase', () => {
  it('offers rebasing from the root on the root commit of HEAD', () => {
    setTab([b, a, x, root, orphan], b.sha)
    const m = commitMenu('/repo', root, undefined)
    expect(labels(m)).toContain('Interactive rebase main from root…')
    // "From here" (the commits after it) stays available.
    expect(labels(m)).toContain('Interactive rebase main from here…')
    void find(m, 'Interactive rebase main from root…')!.onClick!()
    expect(git.startInteractiveRebase).toHaveBeenCalledWith('/repo', 'ROOT')
    void find(m, 'Interactive rebase main from here…')!.onClick!()
    expect(git.startInteractiveRebase).toHaveBeenLastCalledWith('/repo', root.sha)
  })

  it('offers it when the root commit is HEAD itself (single-commit history)', () => {
    setTab([root], root.sha)
    const m = commitMenu('/repo', root, undefined)
    expect(labels(m)).toContain('Interactive rebase main from root…')
    expect(labels(m)).not.toContain('Interactive rebase main from here…')
  })

  it('does not offer it for commits with parents', () => {
    setTab([b, a, root], b.sha)
    const m = commitMenu('/repo', a, undefined)
    expect(labels(m)).toContain('Interactive rebase main from here…')
    expect(labels(m)).not.toContain('Interactive rebase main from root…')
  })

  it('does not offer it for a root commit outside HEAD\'s history', () => {
    setTab([b, a, x, root, orphan], b.sha)
    const m = commitMenu('/repo', orphan, undefined)
    expect(labels(m).some((l) => l.startsWith('Interactive rebase'))).toBe(false)
  })
})
