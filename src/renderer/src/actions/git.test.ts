// Unit tests for git actions: push of a branch behind its upstream (offer a force push before pushing,
// and after a rejection the refs did not foresee) and deleting the checked-out branch.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { Ref } from '@shared/types'

type FormOpts = {
  title: string
  message: string
  confirmLabel: string
  fields: { name: string; options: { value: string }[]; defaultValue?: string }[]
}

const apiMock = vi.hoisted(() => ({
  push: vi.fn(async (_repo: string, _opts: unknown): Promise<void> => undefined),
  checkout: vi.fn(async (_repo: string, _ref: string, _opts?: unknown): Promise<void> => undefined),
  deleteBranch: vi.fn(async (_repo: string, _name: string, _opts?: unknown): Promise<void> => undefined)
}))
const dialogs = vi.hoisted(() => ({
  choose: vi.fn(),
  confirm: vi.fn(async (_opts: { title: string; message: string; confirmLabel: string; danger: boolean }) => true),
  form: vi.fn(async (_opts: FormOpts): Promise<Record<string, string> | null> => null),
  prompt: vi.fn(),
  validateRefName: () => null
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 1), update: vi.fn(), dismiss: vi.fn() }))

vi.mock('@renderer/api/client', () => ({ api: apiMock, isMac: true, newOpId: () => 'op', onAdarEvent: () => () => undefined }))
vi.mock('@renderer/components/common/dialogs', () => dialogs)
vi.mock('@renderer/components/common/toast', () => ({ toast: toasts }))

import { useApp } from '@renderer/store/appStore'
import { AdarError } from '@shared/errors'
import { deleteBranch, push } from './git'

const REPO = '/repo'

function branch(name: string, extra: Partial<Ref> = {}): Ref {
  return { name, fullName: `refs/heads/${name}`, type: 'branch', sha: 'a'.repeat(40), upstream: `origin/${name}`, ...extra }
}

function setBranches(branches: Ref[], remotes: Ref[] = []): void {
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
    refs: { head: { sha: 'a'.repeat(40), branch: 'next', detached: false, unborn: false }, branches, remotes, tags: [], stashes: [], submodules: [] }
  } as unknown as RepoTab
  useApp.setState({ tabs: [tab], busy: {}, refresh: vi.fn(async () => undefined), pushHistory: vi.fn() })
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

describe('delete of the checked-out branch', () => {
  const originHead: Ref = { name: 'origin/HEAD', fullName: 'refs/remotes/origin/HEAD', type: 'remote', sha: 'b'.repeat(40), remote: 'origin', isSymbolic: true, target: 'origin/develop' }

  it('asks which branch to check out, preselecting the remote default branch, then deletes', async () => {
    const pre = branch('pre', { isHead: true })
    setBranches([pre, branch('main'), branch('develop'), branch('feature/x', { upstream: undefined })], [originHead])
    dialogs.form.mockResolvedValueOnce({ target: 'main' })
    await deleteBranch(REPO, pre)
    const opts = dialogs.form.mock.calls[0][0]
    expect(opts).toMatchObject({ title: 'Delete branch pre?', confirmLabel: 'Check out and delete', danger: true })
    expect(opts.message).toBe('pre is checked out, so Adar checks out another branch before deleting it. The remote branch origin/pre is not deleted.')
    expect(opts.fields[0].options.map((o) => o.value)).toEqual(['main', 'develop', 'feature/x'])
    expect(opts.fields[0].defaultValue).toBe('develop')
    expect(apiMock.checkout).toHaveBeenCalledWith(REPO, 'main', { force: undefined })
    expect(apiMock.deleteBranch).toHaveBeenCalledWith(REPO, 'pre', { force: false })
    expect(apiMock.checkout.mock.invocationCallOrder[0]).toBeLessThan(apiMock.deleteBranch.mock.invocationCallOrder[0])
    expect(dialogs.confirm).not.toHaveBeenCalled()
    expect(toasts.success).toHaveBeenCalledWith('Deleted branch pre')
  })

  it('does nothing when cancelled or when the checkout fails', async () => {
    const pre = branch('pre', { isHead: true })
    setBranches([pre, branch('main')])
    await deleteBranch(REPO, pre)
    expect(dialogs.form.mock.calls[0][0].fields[0].defaultValue).toBe('main')
    expect(apiMock.checkout).not.toHaveBeenCalled()

    dialogs.form.mockResolvedValueOnce({ target: 'main' })
    apiMock.checkout.mockRejectedValueOnce(new AdarError({ code: 'GIT_FAILED', message: 'boom' }))
    await deleteBranch(REPO, pre)
    expect(apiMock.deleteBranch).not.toHaveBeenCalled()
  })

  it('refuses when it is the only local branch', async () => {
    const pre = branch('pre', { isHead: true })
    setBranches([pre])
    await deleteBranch(REPO, pre)
    expect(dialogs.form).not.toHaveBeenCalled()
    expect(toasts.warning).toHaveBeenCalledWith('pre is the only local branch. Create another branch to delete it.')
  })

  it('still confirms and deletes another branch directly', async () => {
    const pre = branch('pre')
    setBranches([branch('main', { isHead: true }), pre])
    await deleteBranch(REPO, pre)
    expect(dialogs.form).not.toHaveBeenCalled()
    expect(dialogs.confirm.mock.calls[0][0]).toMatchObject({ title: 'Delete branch pre?', confirmLabel: 'Delete' })
    expect(apiMock.checkout).not.toHaveBeenCalled()
    expect(apiMock.deleteBranch).toHaveBeenCalledWith(REPO, 'pre', { force: false })
  })
})
