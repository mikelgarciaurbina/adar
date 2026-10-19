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
const toasts = vi.hoisted(() => {
  let id = 0
  type Opts = { actions: { label: string; onClick: () => void }[]; duration: number }
  return { success: vi.fn((_message: string, _opts?: Opts) => ++id), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }
})
const apiMock = vi.hoisted(() => ({ resolveConflict: vi.fn(async () => undefined) }))

vi.mock('@renderer/actions/git', () => actions)
vi.mock('@renderer/components/common/toast', () => ({ toast: toasts }))
vi.mock('@renderer/api/client', () => ({ api: apiMock, isMac: true, newOpId: () => 'op', onAdarEvent: () => () => undefined }))

import { useApp } from '@renderer/store/appStore'
import {
  advanceAfterResolve,
  CONTINUE_OFFER_MS,
  continueWithDraft,
  dismissContinueOffer,
  hasContinueOffer,
  markResolvedAndAdvance,
  resolveAndAdvance
} from './resolveFlow'

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
  dismissContinueOffer(REPO)
  vi.clearAllMocks()
  vi.useRealTimers()
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
    expect(opts!.actions[0].label).toBe('Continue cherry-pick')
    opts!.actions[0].onClick()
    await Promise.resolve()
    expect(actions.continueOperation).toHaveBeenCalledWith(REPO, undefined)
  })

  it('has no Continue action for operations without a continue step', () => {
    setTab(makeTab('bisect', [], 'x.txt'))
    advanceAfterResolve(REPO, 'x.txt', ['x.txt'])
    expect(toasts.success).toHaveBeenCalledWith('All conflicts resolved')
  })
})

describe('"Continue <operation>" offer', () => {
  /** Resolve the last conflict of a merge and return the offered toast's id and action. */
  function offerMerge() {
    setTab(makeTab('merge', [], 'x.txt'))
    advanceAfterResolve(REPO, 'x.txt', ['x.txt'])
    const opts = toasts.success.mock.calls.at(-1)![1]!
    const id = toasts.success.mock.results.at(-1)!.value as number
    return { id, action: opts.actions[0], duration: opts.duration }
  }

  it('is withdrawn once the merge was committed elsewhere (e.g. from the composer)', () => {
    const { id, action, duration } = offerMerge()
    expect(action.label).toBe('Continue merge')
    expect(duration).toBe(CONTINUE_OFFER_MS)
    expect(hasContinueOffer(REPO)).toBe(true)
    patchTab({ info: { ...tab().info!, state: 'none' } })
    expect(toasts.dismiss).toHaveBeenCalledWith(id)
    expect(hasContinueOffer(REPO)).toBe(false)
  })

  it('re-checks the state when clicked: nothing in progress → an info toast, no continue', () => {
    const { action } = offerMerge()
    // The toast host is mocked, so the action is still reachable after the offer was withdrawn.
    patchTab({ info: { ...tab().info!, state: 'none' } })
    action.onClick()
    expect(actions.continueOperation).not.toHaveBeenCalled()
    expect(toasts.info).toHaveBeenCalledWith('Nothing to continue: the merge is no longer in progress')
  })

  it('continues with the drafted merge message while the merge is still in progress', () => {
    const { action } = offerMerge()
    patchTab({ draft: { summary: 'Merge it', description: '', amend: false } })
    action.onClick()
    expect(actions.continueOperation).toHaveBeenCalledWith(REPO, 'Merge it')
    expect(hasContinueOffer(REPO)).toBe(false)
  })

  it('is withdrawn when a continue starts from the banner/composer, the tab closes, or conflicts come back', () => {
    let { id } = offerMerge()
    useApp.getState().setBusy(`continue:${REPO}`, 'Continuing…')
    expect(toasts.dismiss).toHaveBeenLastCalledWith(id)
    useApp.getState().setBusy(`continue:${REPO}`, null)

    ;({ id } = offerMerge())
    useApp.setState({ tabs: [] })
    expect(toasts.dismiss).toHaveBeenLastCalledWith(id)

    ;({ id } = offerMerge())
    patchTab({ status: { ...tab().status!, conflicted: [{ path: 'x.txt', kind: 'both-modified' }] } })
    expect(toasts.dismiss).toHaveBeenLastCalledWith(id)
  })

  it('survives unrelated store updates and a fresh status without conflicts', () => {
    offerMerge()
    patchTab({ selection: { kind: 'wip' } })
    patchTab({ status: { ...tab().status!, staged: [{ path: 'x.txt', status: 'modified' }] } })
    useApp.getState().setBusy('commit:/other', 'Committing…')
    useApp.getState().setBusy('commit:/other', null)
    expect(toasts.dismiss).not.toHaveBeenCalled()
    expect(hasContinueOffer(REPO)).toBe(true)
  })

  it('replaces an older offer for the same repository, and stops watching once the toast expired', () => {
    vi.useFakeTimers()
    const first = offerMerge()
    const second = offerMerge()
    expect(toasts.dismiss).toHaveBeenCalledWith(first.id)
    expect(second.id).not.toBe(first.id)
    vi.advanceTimersByTime(CONTINUE_OFFER_MS)
    expect(hasContinueOffer(REPO)).toBe(false)
    toasts.dismiss.mockClear()
    patchTab({ info: { ...tab().info!, state: 'none' } })
    expect(toasts.dismiss).not.toHaveBeenCalled()
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
