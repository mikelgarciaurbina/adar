import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifications: Array<{ title: string; body: string; click?: () => void }> = []
const trays: Array<{ image: string; destroyed: boolean }> = []

vi.mock('electron', () => {
  class Notification {
    private entry: { title: string; body: string; click?: () => void }
    static isSupported = () => true
    constructor(opts: { title: string; body: string }) {
      this.entry = { ...opts }
    }
    on(event: string, fn: () => void) {
      if (event === 'click') this.entry.click = fn
    }
    show() {
      notifications.push(this.entry)
    }
  }
  class Tray {
    private state: { image: string; destroyed: boolean }
    constructor(image: { name: string }) {
      this.state = { image: image.name, destroyed: false }
      trays.push(this.state)
    }
    setToolTip() {}
    setIgnoreDoubleClickEvents() {}
    on() {}
    setImage(image: { name: string }) {
      this.state.image = image.name
    }
    destroy() {
      this.state.destroyed = true
    }
  }
  return {
    app: { quit: () => undefined },
    BrowserWindow: class {},
    Menu: { buildFromTemplate: () => ({ popup: () => undefined }) },
    // The file name without the folder (path.join uses backslashes on Windows).
    nativeImage: { createFromPath: (p: string) => ({ name: p.split(/[\\/]/).pop()!.replace('.png', ''), setTemplateImage: () => undefined }) },
    Notification,
    screen: {},
    Tray
  }
})

import { DEFAULT_SETTINGS, type AppSettings, type RefsResult, type RepoInfo } from '@shared/types'
import type { Backend } from './backend'
import { MenuBar } from './menuBar'

const REPO = '/work/api'

function refs(upstreamSha: string, behind: number, branch = 'main'): RefsResult {
  return {
    head: { sha: 'local', branch, detached: false, unborn: false },
    branches: [{ name: branch, fullName: `refs/heads/${branch}`, type: 'branch', sha: 'local', isHead: true, upstream: `origin/${branch}`, ahead: 0, behind }],
    remotes: [{ name: `origin/${branch}`, fullName: `refs/remotes/origin/${branch}`, type: 'remote', sha: upstreamSha, remote: 'origin' }],
    tags: [],
    stashes: [],
    submodules: []
  }
}

let current: RefsResult
const realPlatform = process.platform

function setup(settings: Partial<AppSettings> = {}) {
  const opened: string[] = []
  const backend = {
    getRefs: async () => current,
    openRepo: async (p: string) => ({ path: p }) as RepoInfo,
    updateSettings: async (patch: Partial<AppSettings>) => ({ ...DEFAULT_SETTINGS, ...patch })
  } as unknown as Backend
  const mb = new MenuBar({
    backend,
    iconDir: '/icons',
    preload: '/preload.js',
    loadPanel: () => undefined,
    openInAdar: (repo) => void opened.push(repo ?? '(window)'),
    sendMenu: () => undefined,
    emit: () => undefined
  })
  mb.apply({ ...DEFAULT_SETTINGS, tabGroups: [{ id: 'g', name: 'OBSFootball', color: 'sea', repos: [REPO], collapsed: false }], ...settings })
  return { mb, opened }
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  notifications.length = 0
  trays.length = 0
  current = refs('up1', 0)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
})

describe('MenuBar', () => {
  it('notifies and marks the icon when a fetch brings new commits to the checked-out branch', async () => {
    const { mb, opened } = setup()
    await mb.beforeFetch(REPO)
    current = refs('up2', 3)
    await mb.afterFetch(REPO)
    expect(notifications).toEqual([expect.objectContaining({ title: 'api · OBSFootball', body: '3 new commits on main from origin.' })])
    expect(trays[0].image).toBe('trayNewTemplate')
    notifications[0].click?.()
    expect(opened).toEqual([REPO])
  })

  it('stays quiet when nothing new arrived, the branch changed, or notifications are off', async () => {
    const { mb } = setup()
    await mb.beforeFetch(REPO)
    await mb.afterFetch(REPO)
    await mb.beforeFetch(REPO)
    current = refs('up2', 3, 'other')
    await mb.afterFetch(REPO)
    expect(notifications).toEqual([])
    expect(trays[0].image).toBe('trayTemplate')

    const quiet = setup({ notifyNewCommits: false }).mb
    current = refs('up1', 0)
    await quiet.beforeFetch(REPO)
    current = refs('up2', 1)
    await quiet.afterFetch(REPO)
    expect(notifications).toEqual([])
    expect(trays[1].image).toBe('trayNewTemplate')
  })

  it('animates the icon while network operations run and counts the panel’s own', () => {
    vi.useFakeTimers()
    try {
      const { mb } = setup()
      mb.networkStarted(true)
      expect(trays[0].image).toBe('trayFetch1Template')
      vi.advanceTimersByTime(170)
      expect(trays[0].image).toBe('trayFetch2Template')
      expect(mb.panelOperationRunning).toBe(true)
      mb.networkEnded(true)
      expect(mb.panelOperationRunning).toBe(false)
      expect(trays[0].image).toBe('trayTemplate')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the icon only on macOS and while the setting is on', () => {
    const { mb } = setup()
    expect(trays).toHaveLength(1)
    mb.apply({ ...DEFAULT_SETTINGS, menuBarIcon: false })
    expect(trays[0].destroyed).toBe(true)
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    setup()
    expect(trays).toHaveLength(1)
  })

  it('lets the panel read only repositories Adar opened', async () => {
    const { mb } = setup()
    expect(mb.isAdmitted(REPO)).toBe(false)
    expect(mb.isAdmitted(42)).toBe(false)
    await mb.handle('menuBarUseRepo', [REPO])
    expect(mb.isAdmitted(REPO)).toBe(true)
    await expect(mb.handle('menuBarUseRepo', ['relative/path'])).rejects.toThrow(/repository path/)
  })
})
