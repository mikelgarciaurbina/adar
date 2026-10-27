import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import type { Ref, RefsResult, Stash, Submodule } from '@shared/types'

vi.mock('@renderer/api/client', () => ({
  api: new Proxy({}, { get: () => vi.fn(() => Promise.resolve()) }),
  newOpId: () => 'op-1',
  isMac: true,
  isElectron: false,
  platform: 'darwin',
  setZoom: vi.fn(),
  onAdarEvent: vi.fn(() => () => undefined)
}))
vi.mock('@renderer/components/common/dialogs', () => ({
  confirm: vi.fn(() => Promise.resolve(false)),
  prompt: vi.fn(() => Promise.resolve(null)),
  choose: vi.fn(() => Promise.resolve(null)),
  form: vi.fn(() => Promise.resolve(null)),
  validateRefName: vi.fn(() => null)
}))
vi.mock('@renderer/components/common/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 1), update: vi.fn(), dismiss: vi.fn() }
}))
vi.mock('@renderer/actions/git', () => ({
  absPath: (repo: string, rel: string) => `${repo}/${rel}`,
  refresh: vi.fn(() => Promise.resolve()),
  checkoutRef: vi.fn(() => Promise.resolve(true)),
  checkoutRemote: vi.fn(() => Promise.resolve(true)),
  pull: vi.fn(),
  push: vi.fn(),
  fastForward: vi.fn(),
  merge: vi.fn(),
  rebase: vi.fn(),
  createBranch: vi.fn(),
  createTag: vi.fn(),
  renameBranch: vi.fn(),
  deleteBranch: vi.fn(),
  deleteRemoteBranch: vi.fn(),
  setUpstreamDialog: vi.fn(),
  copyText: vi.fn(),
  pushTag: vi.fn(),
  deleteTag: vi.fn(),
  applyStash: vi.fn(),
  popStash: vi.fn(),
  dropStash: vi.fn(),
  stash: vi.fn(),
  fetchAll: vi.fn(),
  showInFolder: vi.fn()
}))

const git = await import('@renderer/actions/git')
const {
  canFastForward,
  currentLabel,
  headMenu,
  localBranchMenu,
  remoteBranchMenu,
  remoteMenu,
  sectionMenu,
  stashMenu,
  submoduleMenu,
  tagMenu
} = await import('./menus')
type Ctx = import('./menus').SidebarMenuCtx

const sha = (c: string) => c.repeat(40)

function local(name: string, extra: Partial<Ref> = {}): Ref {
  return { name, fullName: `refs/heads/${name}`, type: 'branch', sha: sha('a'), ...extra }
}
function remote(name: string, extra: Partial<Ref> = {}): Ref {
  return { name, fullName: `refs/remotes/${name}`, type: 'remote', sha: sha('b'), remote: name.split('/')[0], ...extra }
}

const main = local('main', { isHead: true, upstream: 'origin/main', ahead: 0, behind: 0 })
const behind = local('feature/behind', { upstream: 'origin/feature/behind', ahead: 0, behind: 3 })
const diverged = local('feature/diverged', { upstream: 'origin/feature/diverged', ahead: 1, behind: 2 })
const gone = local('old', { upstream: 'origin/old', upstreamGone: true, behind: 1, ahead: 0 })
const v1: Ref = { name: 'v1.0', fullName: 'refs/tags/v1.0', type: 'tag', sha: sha('c') }

function refs(overrides: Partial<RefsResult> = {}): RefsResult {
  return {
    head: { sha: sha('a'), branch: 'main', detached: false, unborn: false },
    branches: [main, behind, diverged, gone],
    remotes: [remote('origin/main'), remote('origin/feature/behind'), remote('origin/lonely')],
    tags: [v1],
    stashes: [],
    submodules: [],
    ...overrides
  }
}

function ctx(overrides: Partial<Ctx> = {}): Ctx {
  return {
    repo: '/repo',
    refs: refs(),
    remotes: [{ name: 'origin', fetchUrl: 'git@github.com:me/repo.git', pushUrl: 'git@github.com:me/repo.git' }],
    hidden: new Set(),
    soloRef: null,
    ...overrides
  }
}

type Item = Extract<MenuItem, { label: string; type?: 'item' }>
const items = (menu: MenuItem[]): Item[] => menu.filter((i): i is Item => i.type === undefined || i.type === 'item')
const labels = (menu: MenuItem[]) => items(menu).map((i) => i.label)
const find = (menu: MenuItem[], label: string | RegExp) =>
  items(menu).find((i) => (typeof label === 'string' ? i.label === label : label.test(i.label)))

beforeEach(() => vi.clearAllMocks())

describe('helpers', () => {
  it('canFastForward requires behind > 0, ahead == 0 and a live upstream', () => {
    expect(canFastForward(behind)).toBe(true)
    expect(canFastForward(diverged)).toBe(false)
    expect(canFastForward(gone)).toBe(false)
    expect(canFastForward(local('x'))).toBe(false)
    expect(canFastForward(main)).toBe(false)
  })

  it('currentLabel handles branch, detached and unborn HEAD', () => {
    expect(currentLabel(refs())).toBe('main')
    expect(currentLabel(refs({ head: { sha: sha('d'), branch: null, detached: true, unborn: false }, branches: [behind] }))).toBe('HEAD')
    expect(currentLabel(refs({ head: { sha: null, branch: 'main', detached: false, unborn: true }, branches: [] }))).toBeNull()
  })
})

describe('localBranchMenu', () => {
  it('current branch: Pull, disabled Checkout, Delete enabled, no merge/rebase', () => {
    const m = localBranchMenu(ctx(), main)
    expect(find(m, 'Checkout')?.disabled).toBe(true)
    expect(labels(m)).toContain('Pull')
    expect(labels(m)).toContain('Push main')
    expect(find(m, 'Delete…')?.disabled).toBeFalsy()
    expect(labels(m).some((l) => l.startsWith('Merge') || l.startsWith('Rebase') || l.startsWith('Fast-forward'))).toBe(false)
  })

  it('behind branch offers fast-forward, merge and rebase', () => {
    const m = localBranchMenu(ctx(), behind)
    expect(labels(m)).not.toContain('Pull')
    expect(labels(m)).toEqual(
      expect.arrayContaining([
        'Checkout',
        'Fast-forward to origin/feature/behind',
        'Push feature/behind',
        'Merge feature/behind into main',
        'Rebase main onto feature/behind',
        'Create branch here…',
        'Rename…',
        'Delete…',
        'Set upstream… (origin/feature/behind)',
        'Copy branch name',
        'Hide in graph',
        'Solo'
      ])
    )
    void find(m, 'Fast-forward to origin/feature/behind')!.onClick!()
    expect(git.fastForward).toHaveBeenCalledWith('/repo', 'feature/behind', 'origin/feature/behind')
    void find(m, 'Merge feature/behind into main')!.onClick!()
    expect(git.merge).toHaveBeenCalledWith('/repo', 'feature/behind')
    void find(m, 'Rebase main onto feature/behind')!.onClick!()
    expect(git.rebase).toHaveBeenCalledWith('/repo', 'feature/behind')
    void find(m, 'Push feature/behind')!.onClick!()
    expect(git.push).toHaveBeenCalledWith('/repo', { branch: 'feature/behind' })
  })

  it('no fast-forward for diverged or gone upstreams', () => {
    expect(labels(localBranchMenu(ctx(), diverged)).some((l) => l.startsWith('Fast-forward'))).toBe(false)
    expect(labels(localBranchMenu(ctx(), gone)).some((l) => l.startsWith('Fast-forward'))).toBe(false)
  })

  it('reflects hidden and solo state', () => {
    const m = localBranchMenu(ctx({ hidden: new Set([behind.fullName]), soloRef: behind.fullName }), behind)
    expect(labels(m)).toContain('Show in graph')
    expect(labels(m)).toContain('Un-solo')
  })

  it('uses HEAD as the merge target when detached and hides merge when unborn', () => {
    const detached = ctx({ refs: refs({ head: { sha: sha('d'), branch: null, detached: true, unborn: false }, branches: [behind] }) })
    expect(labels(localBranchMenu(detached, behind))).toContain('Merge feature/behind into HEAD')
    const unborn = ctx({ refs: refs({ head: { sha: null, branch: 'main', detached: false, unborn: true } }) })
    expect(labels(localBranchMenu(unborn, behind)).some((l) => l.startsWith('Merge'))).toBe(false)
  })

  it('Checkout calls checkoutRef', () => {
    void find(localBranchMenu(ctx(), behind), 'Checkout')!.onClick!()
    expect(git.checkoutRef).toHaveBeenCalledWith('/repo', behind)
  })
})

describe('remoteBranchMenu', () => {
  it('offers creating a tracking branch when none exists', () => {
    const lonely = remote('origin/lonely')
    const m = remoteBranchMenu(ctx(), lonely)
    expect(labels(m)).toContain('Checkout (create tracking branch)')
    expect(labels(m)).toContain('Merge origin/lonely into main')
    expect(labels(m)).toContain('Rebase main onto origin/lonely')
    expect(labels(m)).toContain('Delete from remote…')
    void find(m, 'Checkout (create tracking branch)')!.onClick!()
    expect(git.checkoutRemote).toHaveBeenCalledWith('/repo', lonely)
    void find(m, 'Delete from remote…')!.onClick!()
    expect(git.deleteRemoteBranch).toHaveBeenCalledWith('/repo', lonely)
  })

  it('uses the existing tracking branch and offers fast-forwarding it', () => {
    const r = remote('origin/feature/behind')
    const m = remoteBranchMenu(ctx(), r)
    expect(labels(m)).toContain('Checkout feature/behind')
    expect(labels(m)).toContain('Fast-forward feature/behind to origin/feature/behind')
  })

  it('disables checkout when the tracking branch is already checked out', () => {
    expect(find(remoteBranchMenu(ctx(), remote('origin/main')), 'Checkout main')?.disabled).toBe(true)
  })
})

describe('remoteMenu', () => {
  it('names the provider and enables URL actions', () => {
    const m = remoteMenu(ctx(), { name: 'origin', url: 'git@github.com:me/repo.git', refs: [remote('origin/main')] }, { fetching: false })
    expect(labels(m)).toEqual(
      expect.arrayContaining(['Fetch origin', 'Edit URL…', 'Rename…', 'Remove…', 'Copy URL', 'Open on GitHub', 'Hide all branches in graph', 'Manage remotes…'])
    )
    expect(find(m, 'Open on GitHub')?.disabled).toBe(false)
    // The header shows just the name (long URLs are in the row tooltip).
    expect(m[0]).toEqual({ type: 'header', label: 'origin' })
    void find(m, 'Copy URL')!.onClick!()
    expect(git.copyText).toHaveBeenCalledWith('git@github.com:me/repo.git', 'Copied remote URL')
  })

  it('disables actions that need a URL or configuration', () => {
    const m = remoteMenu(ctx({ remotes: [] }), { name: 'ghost', url: null, refs: [] }, { fetching: true })
    expect(find(m, 'Fetch ghost')?.disabled).toBe(true)
    expect(find(m, 'Edit URL…')?.disabled).toBe(true)
    expect(find(m, 'Copy URL')?.disabled).toBe(true)
    expect(find(m, 'Open in browser')?.disabled).toBe(true)
    expect(find(m, /branches in graph/)?.disabled).toBe(true)
  })

  it('offers showing branches when all are hidden', () => {
    const r = remote('origin/main')
    const m = remoteMenu(ctx({ hidden: new Set([r.fullName]) }), { name: 'origin', url: null, refs: [r] }, { fetching: false })
    expect(labels(m)).toContain('Show all branches in graph')
  })
})

describe('tag, stash, submodule and section menus', () => {
  it('tag menu', () => {
    const m = tagMenu(ctx(), v1)
    expect(labels(m)).toEqual(expect.arrayContaining(['Checkout (detached HEAD)', 'Push tag', 'Delete…', 'Copy tag name', 'Hide in graph']))
    expect(find(m, 'Push tag')?.disabled).toBe(false)
    void find(m, 'Push tag')!.onClick!()
    expect(git.pushTag).toHaveBeenCalledWith('/repo', 'v1.0')
    expect(find(tagMenu(ctx({ remotes: [] }), v1), 'Push tag')?.disabled).toBe(true)
  })

  it('stash menu passes the stash index', () => {
    const s: Stash = { index: 2, ref: 'stash@{2}', sha: sha('e'), baseSha: sha('a'), message: 'WIP on main: x', date: 0 }
    const m = stashMenu(ctx(), s)
    expect(labels(m)).toEqual(['Apply stash', 'Pop stash', 'Delete stash…', 'Copy stash message'])
    void find(m, 'Apply stash')!.onClick!()
    void find(m, 'Pop stash')!.onClick!()
    void find(m, 'Delete stash…')!.onClick!()
    void find(m, 'Copy stash message')!.onClick!()
    expect(git.applyStash).toHaveBeenCalledWith('/repo', 2)
    expect(git.popStash).toHaveBeenCalledWith('/repo', 2)
    expect(git.dropStash).toHaveBeenCalledWith('/repo', 2)
    expect(git.copyText).toHaveBeenCalledWith('WIP on main: x', 'Copied stash message')
  })

  it('submodule menu disables opening uninitialized submodules', () => {
    const sm: Submodule = { path: 'libs/a', url: 'git@x:a.git', sha: null, status: 'uninitialized' }
    const m = submoduleMenu(ctx(), sm)
    expect(find(m, 'Open submodule')?.disabled).toBe(true)
    expect(labels(m)).toContain('Initialize & update submodules')
  })

  it('section menus', () => {
    const state = { refs: [], canExpandAll: true, expandAll: vi.fn(), collapseAll: vi.fn() }
    expect(labels(sectionMenu(ctx(), 'local', state))).toEqual(['Create branch…', 'New worktree…', 'Clean up branches…', 'Expand all folders', 'Collapse all folders'])
    expect(labels(sectionMenu(ctx(), 'remote', state))).toContain('Add remote…')
    const unborn = ctx({ refs: refs({ head: { sha: null, branch: 'main', detached: false, unborn: true } }) })
    expect(find(sectionMenu(unborn, 'tags', state), 'Create tag at HEAD…')?.disabled).toBe(true)
    void find(sectionMenu(ctx(), 'tags', state), 'Create tag at HEAD…')!.onClick!()
    expect(git.createTag).toHaveBeenCalledWith('/repo', sha('a'))
  })
})

describe('headMenu', () => {
  it('detached HEAD: header with the short sha, create branch/tag, copy sha', () => {
    const m = headMenu(ctx(), sha('d'))
    expect(m[0]).toEqual({ type: 'header', label: 'Detached HEAD · ddddddd' })
    expect(labels(m)).toEqual(['Create branch here…', 'Create tag here…', 'Copy commit SHA'])
  })
  it('unborn branch: a single disabled hint', () => {
    expect(headMenu(ctx(), null)).toEqual([{ label: 'Make a first commit to create this branch', disabled: true }])
  })
})
