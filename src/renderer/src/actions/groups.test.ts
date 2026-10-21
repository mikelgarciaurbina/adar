import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdarError } from '@shared/errors'

/** openRepo(path) → the tab path git reports, or an error code. */
let repos: Record<string, string | 'NOT_A_REPO' | 'NOT_FOUND'> = {}
let folders: Record<string, { path: string; name: string }[]> = {}
let slowStatus: { path: string; whileLoading: () => void } | null = null

vi.mock('@renderer/api/client', () => ({
  api: new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'openRepo')
          return async (p: string) => {
            const r = repos[p]
            if (!r || r === 'NOT_A_REPO' || r === 'NOT_FOUND') throw new AdarError({ code: (r || 'NOT_FOUND') as 'NOT_A_REPO' | 'NOT_FOUND', message: `${p}: ${r}` })
            return { path: r, name: r.split('/').pop(), head: { sha: 'a', branch: 'main', detached: false, unborn: false }, state: 'none', remotes: [] }
          }
        if (prop === 'getStatus')
          return async (p: string) => {
            if (slowStatus?.path === p) slowStatus.whileLoading()
            return undefined
          }
        if (prop === 'findRepositories') return async (p: string) => folders[p] ?? []
        return async () => undefined
      }
    }
  ),
  updates: {},
  newOpId: () => 'op',
  isMac: true,
  isElectron: false,
  setZoom: () => undefined,
  onAdarEvent: () => () => undefined
}))

const { useApp } = await import('@renderer/store/appStore')
const { openGroup } = await import('./groups')
const { openRepoAt } = await import('./git')
type RepoTab = ReturnType<typeof useApp.getState>['tabs'][number]

const tab = (p: string) => ({ path: p, name: p.split('/').pop(), undoStack: [], redoStack: [], loading: {} }) as unknown as RepoTab
const groups = () => useApp.getState().settings.tabGroups.map((g) => ({ name: g.name, color: g.color, repos: g.repos }))
const paths = () => useApp.getState().tabs.map((t) => t.path)

beforeEach(() => {
  repos = {}
  folders = {}
  slowStatus = null
  useApp.setState({ tabs: [], activePath: null, settings: { ...useApp.getState().settings, tabGroups: [] } })
})

describe('openGroup', () => {
  it('keeps the group intact when another tab is clicked while a repository is loading', async () => {
    repos = { '/p/app': '/p/app', '/p/landing': '/p/landing' }
    useApp.setState({
      tabs: [tab('/p/api'), tab('/x')],
      activePath: '/p/api',
      settings: { ...useApp.getState().settings, tabGroups: [{ id: 'g', name: 'Proj', color: 'sea', repos: ['/p/api', '/p/app', '/p/landing'], collapsed: false }] }
    })
    slowStatus = { path: '/p/app', whileLoading: () => useApp.getState().setActive('/x') }
    await openGroup('g')
    expect(groups()).toEqual([{ name: 'Proj', color: 'sea', repos: ['/p/api', '/p/app', '/p/landing'] }])
    expect(paths()).toEqual(['/p/api', '/p/app', '/p/landing', '/x'])
  })

  it('reports members that are gone, or that git now resolves to an enclosing repository', async () => {
    repos = { '/mono/pkg': '/mono', '/gone': 'NOT_FOUND', '/ok': '/ok' }
    useApp.setState({
      settings: { ...useApp.getState().settings, tabGroups: [{ id: 'g', name: 'Libs', color: 'ember', repos: ['/mono/pkg', '/gone', '/ok'], collapsed: true }] }
    })
    await openGroup('g')
    expect(paths()).toEqual(['/ok']) // the enclosing /mono tab it opened is closed again
    expect(groups()).toEqual([{ name: 'Libs', color: 'ember', repos: ['/ok', '/mono/pkg', '/gone'] }])
    expect(useApp.getState().settings.tabGroups[0].collapsed).toBe(false)
  })
})

describe('opening a folder of repositories', () => {
  it('reopens the saved group of that folder when it is reached through another path', async () => {
    repos = { '/tmp/proj': 'NOT_A_REPO', '/private/tmp/proj/api': '/private/tmp/proj/api', '/private/tmp/proj/app': '/private/tmp/proj/app' }
    // findRepositories returns the folder's real path.
    folders = { '/tmp/proj': ['api', 'app'].map((n) => ({ path: `/private/tmp/proj/${n}`, name: n })) }
    useApp.setState({
      settings: {
        ...useApp.getState().settings,
        tabGroups: [{ id: 'saved', name: 'Proj (work)', color: 'heather', repos: ['/private/tmp/proj/api', '/private/tmp/proj/app'], collapsed: false }]
      }
    })
    // A dialog would never resolve here: reaching the end proves none was shown.
    await expect(openRepoAt('/tmp/proj')).resolves.toBe(true)
    expect(groups()).toEqual([{ name: 'Proj (work)', color: 'heather', repos: ['/private/tmp/proj/api', '/private/tmp/proj/app'] }])
    expect(paths()).toEqual(['/private/tmp/proj/api', '/private/tmp/proj/app'])
  })
})
