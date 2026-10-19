// Smoke tests: server-render the chrome components with realistic store state to
// catch runtime errors (no DOM / Electron needed). Portal-based UI is not covered.

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { CommandPalette } from '@renderer/components/palette/CommandPalette'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { DEFAULT_SETTINGS, type RefsResult } from '@shared/types'
import { StatusBar } from './StatusBar'
import { TabBar } from './TabBar'
import { Toolbar } from './Toolbar'
import { Welcome } from './Welcome'

const refs: RefsResult = {
  head: { sha: 'a'.repeat(40), branch: 'main', detached: false, unborn: false },
  branches: [
    { name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: 'a'.repeat(40), isHead: true, upstream: 'origin/main', ahead: 2, behind: 3 },
    { name: 'feature/x', fullName: 'refs/heads/feature/x', type: 'branch', sha: 'b'.repeat(40) }
  ],
  remotes: [
    { name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', sha: 'c'.repeat(40), remote: 'origin' },
    { name: 'origin/HEAD', fullName: 'refs/remotes/origin/HEAD', type: 'remote', sha: 'c'.repeat(40), remote: 'origin', isSymbolic: true }
  ],
  tags: [],
  stashes: [{ index: 0, ref: 'stash@{0}', sha: 'd'.repeat(40), baseSha: 'a'.repeat(40), message: 'WIP on main: x', date: 1_760_000_000 }],
  submodules: []
}

function makeTab(path: string, name: string): RepoTab {
  return {
    path,
    name,
    info: { path, name, gitDir: `${path}/.git`, isBare: false, head: refs.head, state: 'merge', remotes: [{ name: 'origin', fetchUrl: 'git@github.com:o/r.git', pushUrl: 'git@github.com:o/r.git' }] },
    refs,
    commits: [],
    hasMore: false,
    status: { staged: [{ path: 'a.ts', status: 'modified' }], unstaged: [{ path: 'b.ts', status: 'untracked' }], conflicted: [], branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3 },
    loading: { log: false, refs: false, status: false, more: false },
    error: null,
    selection: { kind: 'none' },
    multiSelect: [],
    center: { kind: 'graph' },
    search: { open: false, query: '', mode: 'message', results: [], index: 0, loading: false },
    hiddenRefs: [],
    soloRef: null,
    undoStack: [{ label: 'Commit', undo: async () => {}, redo: async () => {} }],
    redoStack: [],
    draft: { summary: '', description: '', amend: false },
    lastFetch: Date.now() - 120_000
  }
}

/**
 * Server rendering reads zustand's *initial* state snapshot (useSyncExternalStore's
 * getServerSnapshot), so tests patch that object in place.
 */
function seed(patch: Partial<ReturnType<typeof useApp.getState>>) {
  useApp.setState(patch)
  Object.assign(useApp.getInitialState(), patch)
}

beforeEach(() => {
  const a = makeTab('/Users/me/Projects/adar', 'adar')
  const b = makeTab('/Users/me/Projects/other', 'other')
  seed({
    ready: true,
    appInfo: { version: '0.1.0', platform: 'darwin', gitVersion: 'git version 2.47.1', homeDir: '/Users/me', isElectron: false },
    settings: { ...DEFAULT_SETTINGS, zoom: 1.1 },
    recent: [
      { path: '/Users/me/Projects/adar', name: 'adar', lastOpened: Date.now() - 3600_000 },
      { path: '/Users/me/Projects/old', name: 'old', lastOpened: 1_700_000_000 }
    ],
    tabs: [a, b],
    activePath: a.path,
    busy: { 'push:/Users/me/Projects/adar': 'Pushing…' },
    progress: { 'push-1': { message: 'Writing objects: 40% (4/10)', percent: 40, repoPath: a.path } },
    paletteOpen: true
  })
})

describe('chrome render smoke tests', () => {
  it('renders the tab bar with one tab per repo', () => {
    const html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('tb-tab-active')
    expect(html).toContain('>adar<')
    expect(html).toContain('>other<')
    expect(html).toContain('title="/Users/me/Projects/adar"')
  })

  it('tells apart tabs of repositories with the same folder name', () => {
    seed({ tabs: [makeTab('/Users/me/work/api', 'api'), makeTab('/Users/me/oss/api', 'api')], activePath: '/Users/me/work/api' })
    const html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('tb-tab-hint">work<')
    expect(html).toContain('tb-tab-hint">oss<')
  })

  it('renders the toolbar with badges, busy state and labels', () => {
    const tab = useApp.getState().tabs[0]
    const html = renderToStaticMarkup(<Toolbar tab={tab} />)
    expect(html).toContain('repository')
    expect(html).toContain('>main<')
    expect(html).toContain('tb-badge">3<') // behind on Pull
    expect(html).not.toContain('tb-badge">2<') // Push is busy: spinner replaces the ahead badge
    expect(html).toContain('ui-spinner')
    expect(html).toContain('Undo: Commit')
    expect(html).not.toContain('disabled="" title="Nothing to undo"')
  })

  it('renders the status bar with progress, branch, zoom and versions', () => {
    const html = renderToStaticMarkup(<StatusBar />)
    expect(html).toContain('Writing objects')
    expect(html).toContain('40%')
    expect(html).toContain('110%')
    expect(html).toContain('git 2.47.1')
    expect(html).toContain('fetched')
    expect(html).toContain('MERGING')
    expect(html).toContain('tb-status-logo')
  })

  it('renders the welcome screen with recent repositories', () => {
    seed({ tabs: [], activePath: null })
    const html = renderToStaticMarkup(<Welcome />)
    expect(html).toContain('Adar')
    expect(html).toContain('public or private')
    expect(html).toContain('Clone a repository')
    expect(html).toContain('~/Projects/old')
    expect(html).toContain('Open by path') // browser dev mode
  })

  it('renders the command palette with commands and sections', () => {
    const html = renderToStaticMarkup(<CommandPalette />)
    expect(html).toContain('pal-panel')
    expect(html).toContain('Switch to tab other')
    expect(html).toContain('Fetch All')
    expect(html).not.toContain('Command Palette<')
  })
})
