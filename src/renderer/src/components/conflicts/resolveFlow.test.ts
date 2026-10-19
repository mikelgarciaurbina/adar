// Unit tests for the conflict tool's resolve flow: which file opens next, the
// toasts, and continuing the operation with the drafted merge message.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { ConflictKind, RepoOperationState } from '@shared/types'

const actions = vi.hoisted(() => ({
  continueOperation: vi.fn(async (_repo: string, _message?: string) => undefined),
  markResolved: vi.fn(async (_repo: string, _paths: string[]) => true),
  openConflict: vi.fn(),
  showGraph: vi.fn()
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const apiMock = vi.hoisted(() => ({ resolveConflict: vi.fn(async () => undefined) }))

vi.mock('@renderer/actions/git', () => actions)
vi.mock('@renderer/components/common/toast', () => ({ toast: toasts }))
vi.mock('@renderer/api/client', () => ({ api: apiMock, isMac: true, newOpId: () => 'op', onAdarEvent: () => () => undefined }))

import { useApp } from '@renderer/store/appStore'
import { advanceAfterResolve, continueWithDraft, markResolvedAndAdvance, resolveAndAdvance } from './resolveFlow'

const REPO = '/repo'

function makeTab(state: RepoOperationState, conflicted: string[], centerPath: string | null): RepoTab {
  return {
    path: REPO,
    name: 'repo',
    info: {
      path: REPO,
      name: 'repo',
      gitDir: '/repo/.git',
      isBare: false,
      head: { sha: 'a'.repeat(40), branch: 'main', detached: false, unborn: false },
      state,
      remotes: []
    },
    refs: null,
    commits: [],
    hasMore: false,
    status: {
      staged: [],
      unstaged: [],
      conflicted: conflicted.map((path) => ({ path, kind: 'both-modified' as ConflictKind })),
      branch: 'main',
      upstream: null,
      ahead: 0,
      behind: 0
    },
    loading: { log: false, refs: false, status: false, more: false },
    error: null,
    selection: { kind: 'none' },
    multiSelect: [],
    center: centerPath ? { kind: 'conflict', path: centerPath } : { kind: 'graph' },
    search: { open: false, query: '', mode: 'message', results: [], index: 0, loading: false },
    hiddenRefs: [],
    soloRef: null,
    undoStack: [],
    redoStack: [],
    draft: { summary: '', description: '', amend: false },
    lastFetch: null
  }
}

function setTab(tab: RepoTab): void {
  useApp.setState({ tabs: [tab], activePath: REPO })
}
const tab = () => useApp.getState().tabs[0]
const patchTab = (patch: Partial<RepoTab>) => useApp.setState({ tabs: [{ ...tab(), ...patch }] })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('advanceAfterResolve', () => {
  it('opens the next file in the original order and reports how many are left', () => {
    // b.txt was just resolved; the refreshed status still lists a.txt and c.txt.
    setTab(makeTab('merge', ['a.txt', 'c.txt'], 'b.txt'))
    advanceAfterResolve(REPO, 'b.txt', ['a.txt', 'b.txt', 'c.txt'])
    expect(actions.openConflict).toHaveBeenCalledWith(REPO, 'c.txt')
    expect(toasts.success).toHaveBeenCalledWith('Resolved b.txt · 2 conflicted files left')
  })

  it('stays quiet when the caller already toasted, and never steers a user who navigated away', () => {
    setTab(makeTab('merge', ['a.txt'], null))
    advanceAfterResolve(REPO, 'b.txt', ['a.txt', 'b.txt'], { quiet: true })
    expect(actions.openConflict).not.toHaveBeenCalled()
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('goes back to the graph when everything is resolved and offers "Continue <operation>"', async () => {
    setTab(makeTab('cherry-pick', [], 'x.txt'))
    advanceAfterResolve(REPO, 'x.txt', ['x.txt'])
    expect(actions.showGraph).toHaveBeenCalledWith(REPO)
    const [message, opts] = toasts.success.mock.calls[0]
    expect(message).toBe('All conflicts resolved')
    expect(opts.actions[0].label).toBe('Continue cherry-pick')
    opts.actions[0].onClick()
    await Promise.resolve()
    expect(actions.continueOperation).toHaveBeenCalledWith(REPO, undefined)
  })

  it('has no Continue action for operations without a continue step', () => {
    setTab(makeTab('bisect', [], 'x.txt'))
    advanceAfterResolve(REPO, 'x.txt', ['x.txt'])
    expect(toasts.success).toHaveBeenCalledWith('All conflicts resolved')
  })
})

describe('continueWithDraft', () => {
  it('commits a merge with the drafted message and clears the draft once the merge is done', async () => {
    setTab(makeTab('merge', [], null))
    patchTab({ draft: { summary: 'Merge feature', description: 'Body text', amend: false } })
    actions.continueOperation.mockImplementationOnce(async () => {
      patchTab({ info: { ...tab().info!, state: 'none' } })
    })
    await continueWithDraft(REPO)
    expect(actions.continueOperation).toHaveBeenCalledWith(REPO, 'Merge feature\n\nBody text')
    expect(tab().draft.summary).toBe('')
  })

  it('keeps the draft when the merge did not complete, and sends no message for other operations', async () => {
    setTab(makeTab('merge', [], null))
    patchTab({ draft: { summary: 'Keep me', description: '', amend: false } })
    await continueWithDraft(REPO)
    expect(tab().draft.summary).toBe('Keep me')

    setTab(makeTab('rebase', [], null))
    patchTab({ draft: { summary: 'Unrelated draft', description: '', amend: false } })
    await continueWithDraft(REPO)
    expect(actions.continueOperation).toHaveBeenLastCalledWith(REPO, undefined)
  })
})

describe('resolveAndAdvance / markResolvedAndAdvance', () => {
  it('writes the resolution, refreshes and advances; busy is cleared afterwards', async () => {
    setTab(makeTab('merge', ['a.txt', 'b.txt'], 'a.txt'))
    const refresh = vi.spyOn(useApp.getState(), 'refresh').mockImplementation(async () => {
      patchTab({ status: { ...tab().status!, conflicted: [{ path: 'b.txt', kind: 'both-modified' }] } })
    })
    useApp.setState({ refresh })
    expect(await resolveAndAdvance(REPO, 'a.txt', { kind: 'ours' })).toBe(true)
    expect(apiMock.resolveConflict).toHaveBeenCalledWith(REPO, 'a.txt', { kind: 'ours' })
    expect(actions.openConflict).toHaveBeenCalledWith(REPO, 'b.txt')
    expect(Object.keys(useApp.getState().busy)).toEqual([])
  })

  it('reports a failed write and does not advance', async () => {
    setTab(makeTab('merge', ['a.txt'], 'a.txt'))
    apiMock.resolveConflict.mockRejectedValueOnce(new Error('disk full'))
    expect(await resolveAndAdvance(REPO, 'a.txt', { kind: 'theirs' })).toBe(false)
    expect(toasts.error).toHaveBeenCalled()
    expect(actions.openConflict).not.toHaveBeenCalled()
  })

  it('uses the shared markResolved action (which toasts) and advances quietly', async () => {
    setTab(makeTab('revert', ['a.txt', 'b.txt'], 'a.txt'))
    actions.markResolved.mockImplementationOnce(async () => {
      patchTab({ status: { ...tab().status!, conflicted: [{ path: 'b.txt', kind: 'both-modified' }] } })
      return true
    })
    expect(await markResolvedAndAdvance(REPO, 'a.txt')).toBe(true)
    expect(actions.markResolved).toHaveBeenCalledWith(REPO, ['a.txt'])
    expect(actions.openConflict).toHaveBeenCalledWith(REPO, 'b.txt')
    expect(toasts.success).not.toHaveBeenCalled()

    actions.markResolved.mockResolvedValueOnce(false)
    expect(await markResolvedAndAdvance(REPO, 'b.txt')).toBe(false)
  })
})
