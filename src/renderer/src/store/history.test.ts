import { beforeEach, describe, expect, it, vi } from 'vitest'

const head = { sha: 'a1', branch: 'main' }
vi.mock('@renderer/api/client', () => ({
  api: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'getRepoInfo') return async () => ({ head: { ...head, detached: false, unborn: false } })
        return async () => undefined
      }
    }
  ),
  setZoom: () => undefined,
  onAdarEvent: () => () => undefined
}))

import { StaleHistoryError, useApp, type RepoTab } from './appStore'

const REPO = '/repo'

function seedTab() {
  useApp.setState({
    tabs: [{ path: REPO, name: 'repo', undoStack: [], redoStack: [] } as unknown as RepoTab],
    activePath: REPO
  })
}

describe('undo/redo history', () => {
  beforeEach(() => {
    head.sha = 'a1'
    head.branch = 'main'
    seedTab()
  })

  it('undoes and redoes from the recorded HEAD', async () => {
    const undo = vi.fn(async () => {
      head.sha = 'a0'
    })
    const redo = vi.fn(async () => {
      head.sha = 'a1'
    })
    useApp.getState().pushHistory(REPO, { label: 'Commit', undo, redo, head: { sha: 'a1', branch: 'main' } })
    expect(await useApp.getState().undo(REPO)).toBe(true)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(await useApp.getState().redo(REPO)).toBe(true)
    expect(redo).toHaveBeenCalledTimes(1)
  })

  it('refuses a stale entry and keeps the stacks untouched', async () => {
    const undo = vi.fn(async () => undefined)
    useApp.getState().pushHistory(REPO, { label: 'Commit X', undo, redo: async () => undefined, head: { sha: 'a1', branch: 'main' } })
    head.sha = 'b9' // e.g. a pull moved the branch afterwards
    await expect(useApp.getState().undo(REPO)).rejects.toBeInstanceOf(StaleHistoryError)
    expect(undo).not.toHaveBeenCalled()
    expect(useApp.getState().tabs[0].undoStack).toHaveLength(1)
  })

  it('never runs the same entry twice concurrently', async () => {
    let release!: () => void
    const undo = vi.fn(() => new Promise<void>((r) => (release = r)))
    useApp.getState().pushHistory(REPO, { label: 'Stash', undo, redo: async () => undefined, head: { sha: 'a1', branch: 'main' } })
    const first = useApp.getState().undo(REPO)
    const second = await useApp.getState().undo(REPO)
    expect(second).toBe(false)
    await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(1))
    release()
    expect(await first).toBe(true)
    expect(undo).toHaveBeenCalledTimes(1)
  })
})
