// "Update" downloads only; "Restart to update" asks before quitting over running
// operations, commit drafts or unsaved merge-tool edits.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { UpdateStatus } from '@shared/update'

const updatesMock = vi.hoisted(() => ({
  updateDownload: vi.fn(async (): Promise<Partial<UpdateStatus>> => ({ state: 'downloaded', canInstall: true })),
  updateInstall: vi.fn(async () => undefined)
}))
const dialogs = vi.hoisted(() => ({ confirm: vi.fn(async (_opts: { title: string; danger?: boolean }) => false) }))
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }))

vi.mock('@renderer/api/client', () => ({
  api: {},
  updates: updatesMock,
  isElectron: true,
  isMac: true,
  newOpId: () => 'op',
  onAdarEvent: () => () => undefined
}))
vi.mock('@renderer/components/common/dialogs', () => dialogs)
vi.mock('@renderer/components/common/toast', () => ({ toast: toasts }))

import { cacheKeyOf, editorCache } from '@renderer/components/conflicts/editorCache'
import { useApp } from '@renderer/store/appStore'
import { confirmRestartForUpdate, installUpdate, startUpdate, workLostOnRestart } from './restart'
import { useUpdates } from './updateStore'

const status = (canInstall: boolean): UpdateStatus =>
  ({ state: 'downloaded', currentVersion: '0.1.0', canInstall, info: { latestVersion: '0.2.0' } }) as unknown as UpdateStatus

function tab(path: string, summary = '', description = ''): RepoTab {
  return { path, name: path.split('/').pop()!, draft: { summary, description, amend: false } } as unknown as RepoTab
}

beforeEach(() => {
  vi.clearAllMocks()
  editorCache.clear()
  useApp.setState({ busy: {}, tabs: [tab('/r/app')] })
  useUpdates.setState({ status: status(true) })
})

describe('workLostOnRestart', () => {
  it('lists running operations, commit drafts and merge-tool edits', () => {
    const lines = workLostOnRestart(
      { busy: { 'push:/r/app': 'Pushing…' }, tabs: [tab('/r/app', 'Fix the bug'), tab('/r/lib', '', '  '), tab('/r/doc', '', 'body only')] },
      [
        { repo: '/r/app', path: 'a.txt' },
        { repo: '/r/app', path: 'b.txt' }
      ]
    )
    expect(lines).toEqual([
      'Pushing (still running)',
      'Unsaved commit message in app',
      'Unsaved commit message in doc',
      'Unsaved merge-tool changes to 2 conflicted files in app'
    ])
  })

  it('is empty when nothing would be lost', () => {
    expect(workLostOnRestart({ busy: {}, tabs: [tab('/r/app')] }, [])).toEqual([])
  })
})

describe('"Update" only downloads', () => {
  it('never installs (restarts) on its own, even when the download is installable', async () => {
    await startUpdate()
    expect(updatesMock.updateDownload).toHaveBeenCalledTimes(1)
    expect(updatesMock.updateInstall).not.toHaveBeenCalled()
  })
})

describe('"Restart to update"', () => {
  it('restarts right away when no work would be lost', async () => {
    expect(await confirmRestartForUpdate()).toBe(true)
    await installUpdate()
    expect(dialogs.confirm).not.toHaveBeenCalled()
    expect(updatesMock.updateInstall).toHaveBeenCalledTimes(1)
  })

  it('asks first while a git operation runs; declining keeps Adar open', async () => {
    useApp.getState().setBusy('push:/r/app', 'Pushing…')
    dialogs.confirm.mockResolvedValueOnce(false)
    await installUpdate()
    expect(dialogs.confirm).toHaveBeenCalledTimes(1)
    expect(dialogs.confirm.mock.calls[0][0]).toMatchObject({ danger: true, confirmLabel: 'Restart anyway' })
    expect(updatesMock.updateInstall).not.toHaveBeenCalled()

    dialogs.confirm.mockResolvedValueOnce(true)
    await installUpdate()
    expect(updatesMock.updateInstall).toHaveBeenCalledTimes(1)
  })

  it('asks for a drafted commit message and for unsaved merge-tool edits', async () => {
    useApp.setState({ tabs: [tab('/r/app', 'WIP: half-written message')] })
    await installUpdate()
    expect(dialogs.confirm).toHaveBeenCalledTimes(1)

    useApp.setState({ tabs: [tab('/r/app')] })
    editorCache.set(cacheKeyOf('/r/app', 'src/x.ts'), { merged: 'm', choices: ['ours'], manualText: null, current: 0 })
    await installUpdate()
    expect(dialogs.confirm).toHaveBeenCalledTimes(2)
    expect(updatesMock.updateInstall).not.toHaveBeenCalled()
  })

  it('does not ask for "Open installer" (Adar is not restarted)', async () => {
    useUpdates.setState({ status: status(false) })
    useApp.setState({ tabs: [tab('/r/app', 'draft')] })
    await installUpdate()
    expect(dialogs.confirm).not.toHaveBeenCalled()
    expect(updatesMock.updateInstall).toHaveBeenCalledTimes(1)
  })
})
