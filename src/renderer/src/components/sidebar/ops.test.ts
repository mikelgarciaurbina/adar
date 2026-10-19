import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/api/client', () => ({
  api: new Proxy({}, { get: () => vi.fn(() => Promise.resolve()) }),
  newOpId: () => 'op-1',
  isMac: true,
  isElectron: false,
  platform: 'darwin',
  setZoom: vi.fn(),
  onAdarEvent: vi.fn(() => () => undefined)
}))
vi.mock('@renderer/components/common/dialogs', async () => {
  const real = await vi.importActual<typeof import('@renderer/components/common/dialogs')>('@renderer/components/common/dialogs')
  return { confirm: vi.fn(), prompt: vi.fn(), choose: vi.fn(), form: vi.fn(), validateRefName: real.validateRefName }
})
vi.mock('@renderer/components/common/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(() => 1), update: vi.fn(), dismiss: vi.fn() }
}))
vi.mock('@renderer/actions/git', () => ({
  absPath: (a: string, b: string) => `${a}/${b}`,
  refresh: vi.fn(() => Promise.resolve()),
  fetchRemote: vi.fn(() => Promise.resolve(true)),
  renameRemote: vi.fn(() => Promise.resolve(true)),
  removeRemote: vi.fn(() => Promise.resolve(true)),
  setRemoteUrl: vi.fn(() => Promise.resolve(true)),
  updateSubmodules: vi.fn(() => Promise.resolve(true))
}))

const git = await import('@renderer/actions/git')
const dialogs = await import('@renderer/components/common/dialogs')
const { toast } = await import('@renderer/components/common/toast')
const { useApp } = await import('@renderer/store/appStore')
const ops = await import('./ops')
const { validateRemoteName } = ops

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ busy: {} })
})

describe('validateRemoteName', () => {
  const existing = new Set(['origin', 'upstream'])
  it('accepts a new valid name and the unchanged name', () => {
    expect(validateRemoteName('fork', 'origin', existing)).toBeNull()
    expect(validateRemoteName('origin', 'origin', existing)).toBeNull()
  })
  it('rejects duplicates, slashes and invalid ref names', () => {
    expect(validateRemoteName('upstream', 'origin', existing)).toMatch(/already exists/)
    expect(validateRemoteName('a/b', 'origin', existing)).toMatch(/\//)
    expect(validateRemoteName('bad name', 'origin', existing)).toMatch(/Spaces/)
    expect(validateRemoteName('  ', 'origin', existing)).toMatch(/required/)
  })
})

describe('remote actions delegate to actions/git', () => {
  it('fetchRemote marks only that remote busy while git.fetchRemote runs', async () => {
    let seen: Record<string, true> = {}
    vi.mocked(git.fetchRemote).mockImplementationOnce(async () => {
      seen = { ...ops.useSidebarBusy.getState().fetching }
      return true
    })
    await expect(ops.fetchRemote('/r', 'origin')).resolves.toBe(true)
    expect(git.fetchRemote).toHaveBeenCalledWith('/r', 'origin')
    expect(seen).toEqual({ [ops.remoteFetchKey('/r', 'origin')]: true })
    expect(ops.useSidebarBusy.getState().fetching).toEqual({})
  })

  it('fetchRemote refuses while another fetch runs', async () => {
    useApp.setState({ busy: { 'fetch:/r': 'Fetching…' } })
    await expect(ops.fetchRemote('/r', 'origin')).resolves.toBe(false)
    expect(git.fetchRemote).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalled()
  })

  it('renameRemote prompts then calls git.renameRemote with the trimmed name', async () => {
    vi.mocked(dialogs.prompt).mockResolvedValueOnce(' fork ')
    await ops.renameRemote('/r', 'origin')
    expect(git.renameRemote).toHaveBeenCalledWith('/r', 'origin', 'fork')
  })

  it('renameRemote does nothing when cancelled or unchanged', async () => {
    vi.mocked(dialogs.prompt).mockResolvedValueOnce(null).mockResolvedValueOnce('origin')
    await ops.renameRemote('/r', 'origin')
    await ops.renameRemote('/r', 'origin')
    expect(git.renameRemote).not.toHaveBeenCalled()
  })

  it('editRemoteUrl only saves a changed, non-empty URL', async () => {
    vi.mocked(dialogs.prompt).mockResolvedValueOnce('git@x:a.git').mockResolvedValueOnce(' git@x:b.git ')
    await ops.editRemoteUrl('/r', 'origin', 'git@x:a.git')
    expect(git.setRemoteUrl).not.toHaveBeenCalled()
    await ops.editRemoteUrl('/r', 'origin', 'git@x:a.git')
    expect(git.setRemoteUrl).toHaveBeenCalledWith('/r', 'origin', 'git@x:b.git')
  })

  it('updateSubmodules skips while already running', async () => {
    useApp.setState({ busy: { 'submodules:/r': 'Updating…' } })
    await expect(ops.updateSubmodules('/r')).resolves.toBe(false)
    useApp.setState({ busy: {} })
    await expect(ops.updateSubmodules('/r')).resolves.toBe(true)
    expect(git.updateSubmodules).toHaveBeenCalledTimes(1)
  })

  it('setRefsHidden uses the store bulk action once', () => {
    const spy = vi.fn()
    useApp.setState({ setRefsHidden: spy } as never)
    ops.setRefsHidden('/r', [], true)
    expect(spy).not.toHaveBeenCalled()
    ops.setRefsHidden('/r', ['refs/heads/a', 'refs/heads/b'], true)
    expect(spy).toHaveBeenCalledWith('/r', ['refs/heads/a', 'refs/heads/b'], true)
  })
})

describe('selection', () => {
  it('selects the commit and shows the graph without paging the log itself', () => {
    const select = vi.fn()
    const setCenter = vi.fn()
    const ensureCommitLoaded = vi.fn()
    useApp.setState({ select, setCenter, ensureCommitLoaded } as never)
    ops.selectRef('/r', { name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: 'abc' })
    expect(select).toHaveBeenCalledWith('/r', { kind: 'commit', sha: 'abc' })
    expect(setCenter).toHaveBeenCalledWith('/r', { kind: 'graph' })
    expect(ensureCommitLoaded).not.toHaveBeenCalled()
  })
})
