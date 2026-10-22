// Unit tests for the push action's handling of a branch that is behind its upstream: offer a
// force push before pushing, and after a rejection the refs did not foresee.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { Ref } from '@shared/types'

const apiMock = vi.hoisted(() => ({
  push: vi.fn(async (_repo: string, _opts: unknown): Promise<void> => undefined)
}))
const dialogs = vi.hoisted(() => ({
  choose: vi.fn(),
  confirm: vi.fn(async (_opts: { title: string; message: string; confirmLabel: string; danger: boolean }) => true),
  form: vi.fn(),
  prompt: vi.fn(),
  validateRefName: () => null
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 1), update: vi.fn(), dismiss: vi.fn() }))

vi.mock('@renderer/api/client', () => ({ api: apiMock, isMac: true, newOpId: () => 'op', onAdarEvent: () => () => undefined }))
vi.mock('@renderer/components/common/dialogs', () => dialogs)
vi.mock('@renderer/components/common/toast', () => ({ toast: toasts }))

import { useApp } from '@renderer/store/appStore'
import { AdarError } from '@shared/errors'
import { push } from './git'

const REPO = '/repo'

function branch(name: string, extra: Partial<Ref> = {}): Ref {
  return { name, fullName: `refs/heads/${name}`, type: 'branch', sha: 'a'.repeat(40), upstream: `origin/${name}`, ...extra }
}

function setBranches(branches: Ref[]): void {
  const tab = {
    path: REPO,
    name: 'repo',
    info: {
      path: REPO,
      name: 'repo',
      gitDir: '/repo/.git',
      isBare: false,
      head: { sha: 'a'.repeat(40), branch: 'next', detached: false, unborn: false },
      state: { kind: 'none' },
      remotes: [{ name: 'origin', fetchUrl: 'x', pushUrl: 'x' }]
    },
    refs: { head: { sha: 'a'.repeat(40), branch: 'next', detached: false, unborn: false }, branches, remotes: [], tags: [], stashes: [], submodules: [] }
  } as unknown as RepoTab
  useApp.setState({ tabs: [tab], busy: {}, refresh: vi.fn(async () => undefined) })
}

const rejected = () =>
  new AdarError({
    code: 'GIT_FAILED',
    message: 'Push rejected: the remote branch has commits you do not have. Pull first, or force push.',
    stderr: " ! [rejected]        next -> next (fetch first)\nerror: failed to push some refs to 'x'"
  })

const forceModes = () => apiMock.push.mock.calls.map(([, o]) => (o as { force: unknown }).force)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('push of a branch behind its upstream', () => {
  it('offers a force push with lease before pushing a diverged branch', async () => {
    setBranches([branch('next', { isHead: true, ahead: 16, behind: 1 })])
    await push(REPO)
    expect(dialogs.confirm).toHaveBeenCalledTimes(1)
    expect(dialogs.confirm.mock.calls[0][0]).toMatchObject({
      title: 'Force push next?',
      message:
        'origin/next has 1 commit that next does not have. Force pushing replaces origin/next with your local next and removes that commit from the remote for everyone.',
      confirmLabel: 'Force push',
      danger: true
    })
    expect(forceModes()).toEqual(['with-lease'])
    expect(toasts.success).toHaveBeenCalledWith('Force pushed next')
  })

  it('does not push when the force push is cancelled', async () => {
    setBranches([branch('next', { isHead: true, ahead: 0, behind: 2 })])
    dialogs.confirm.mockResolvedValueOnce(false)
    await push(REPO)
    expect(dialogs.confirm.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('origin/next has 2 commits') })
    expect(apiMock.push).not.toHaveBeenCalled()
  })

  it('pushes right away when the branch is not behind', async () => {
    setBranches([branch('next', { isHead: true, ahead: 2, behind: 0 })])
    await push(REPO)
    expect(dialogs.confirm).not.toHaveBeenCalled()
    expect(forceModes()).toEqual([false])
    expect(toasts.success).toHaveBeenCalledWith('Pushed next to origin/next')
  })

  it('asks once when a force push was requested explicitly', async () => {
    setBranches([branch('next', { isHead: true, ahead: 1, behind: 1 })])
    await push(REPO, { force: 'with-lease' })
    expect(dialogs.confirm).toHaveBeenCalledTimes(1)
    expect(forceModes()).toEqual(['with-lease'])
  })

  it('offers a force push when the remote rejects a push the refs did not foresee', async () => {
    setBranches([branch('next', { isHead: true, ahead: 1, behind: 0 })])
    apiMock.push.mockRejectedValueOnce(rejected())
    await push(REPO)
    expect(dialogs.confirm.mock.calls[0][0]).toMatchObject({ title: 'Push rejected', confirmLabel: 'Force push' })
    expect(forceModes()).toEqual([false, 'with-lease'])
  })
})
