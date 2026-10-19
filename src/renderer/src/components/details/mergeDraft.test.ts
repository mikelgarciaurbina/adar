// Unit tests for the prefilled merge message: once per merge, never over a draft, and
// removed again when the merge ends without it (abort, terminal commit).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { RepoOperationState } from '@shared/types'

const apiMock = vi.hoisted(() => ({ getMergeMessage: vi.fn(async (_repo: string) => "Merge branch 'feature'\n\nResolved README") }))
vi.mock('@renderer/api/client', () => ({ api: apiMock, isMac: true, newOpId: () => 'op', onAdarEvent: () => () => undefined }))

import { useApp } from '@renderer/store/appStore'
import { dropMergePrefill, hasMergePrefill, prefillMergeMessage } from './mergeDraft'

const REPO = '/repo'

function makeTab(state: RepoOperationState): RepoTab {
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
    status: { staged: [], unstaged: [], conflicted: [], branch: 'main', upstream: null, ahead: 0, behind: 0 },
    loading: { log: false, refs: false, status: false, more: false },
    error: null,
    selection: { kind: 'none' },
    multiSelect: [],
    center: { kind: 'graph' },
    search: { open: false, query: '', mode: 'message', results: [], index: 0, loading: false },
    hiddenRefs: [],
    soloRef: null,
    undoStack: [],
    redoStack: [],
    draft: { summary: '', description: '', amend: false },
    lastFetch: null
  }
}

const tab = () => useApp.getState().tabs[0]
const patchTab = (patch: Partial<RepoTab>) => useApp.setState({ tabs: [{ ...tab(), ...patch }] })
const setState = (state: RepoOperationState) => patchTab({ info: { ...tab().info!, state } })
const draft = () => ({ summary: tab().draft.summary, description: tab().draft.description })

beforeEach(() => {
  // Forget prefills left by a previous test (the merge "ended" with a fresh store).
  useApp.setState({ tabs: [] })
  vi.clearAllMocks()
  useApp.setState({ tabs: [makeTab('merge')], activePath: REPO })
})

describe('prefillMergeMessage', () => {
  it('fills an empty draft with MERGE_MSG once per merge (clearing it on purpose sticks)', async () => {
    await prefillMergeMessage(REPO)
    expect(draft()).toEqual({ summary: "Merge branch 'feature'", description: 'Resolved README' })
    expect(hasMergePrefill(REPO)).toBe(true)
    // The user empties the message (to use git's default) and the composer remounts.
    useApp.getState().updateDraft(REPO, { summary: '', description: '' })
    await prefillMergeMessage(REPO)
    expect(draft()).toEqual({ summary: '', description: '' })
    expect(apiMock.getMergeMessage).toHaveBeenCalledTimes(1)
  })

  it('never overwrites a draft, including one typed while the message loads', async () => {
    patchTab({ draft: { summary: 'Mine', description: '', amend: false } })
    await prefillMergeMessage(REPO)
    expect(apiMock.getMergeMessage).not.toHaveBeenCalled()
    expect(draft().summary).toBe('Mine')

    patchTab({ draft: { summary: '', description: '', amend: false } })
    apiMock.getMergeMessage.mockImplementationOnce(async () => {
      useApp.getState().updateDraft(REPO, { summary: 'Typed meanwhile' })
      return 'Merge x'
    })
    await prefillMergeMessage(REPO)
    expect(draft().summary).toBe('Typed meanwhile')
    expect(hasMergePrefill(REPO)).toBe(false)
  })

  it('ignores an empty message and read failures', async () => {
    apiMock.getMergeMessage.mockResolvedValueOnce('')
    await prefillMergeMessage(REPO)
    apiMock.getMergeMessage.mockRejectedValueOnce(new Error('gone'))
    await prefillMergeMessage(REPO)
    expect(draft()).toEqual({ summary: '', description: '' })
    expect(hasMergePrefill(REPO)).toBe(false)
  })
})

describe('when the merge ends', () => {
  it('clears the untouched message after an abort, even with no composer mounted', async () => {
    await prefillMergeMessage(REPO)
    setState('none')
    expect(draft()).toEqual({ summary: '', description: '' })
    expect(hasMergePrefill(REPO)).toBe(false)
  })

  it('keeps a message the user edited', async () => {
    await prefillMergeMessage(REPO)
    useApp.getState().updateDraft(REPO, { description: 'My notes' })
    setState('none')
    expect(draft()).toEqual({ summary: "Merge branch 'feature'", description: 'My notes' })
  })

  it('keeps it while the repository is unreadable (stale info), and prefills again for the next merge', async () => {
    await prefillMergeMessage(REPO)
    patchTab({ error: 'Repository folder not found', info: { ...tab().info!, state: 'none' } })
    expect(hasMergePrefill(REPO)).toBe(true)
    expect(draft().summary).toBe("Merge branch 'feature'")
    patchTab({ error: null })
    expect(hasMergePrefill(REPO)).toBe(false)
    expect(draft().summary).toBe('')

    setState('merge')
    await prefillMergeMessage(REPO)
    expect(draft().summary).toBe("Merge branch 'feature'")
  })

  it('forgets the repository when its tab closes, and dropMergePrefill is safe to repeat', async () => {
    await prefillMergeMessage(REPO)
    useApp.setState({ tabs: [] })
    expect(hasMergePrefill(REPO)).toBe(false)
    expect(() => dropMergePrefill(REPO)).not.toThrow()
  })
})
