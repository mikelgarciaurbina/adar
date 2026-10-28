// Smoke tests: server-render the chrome components with realistic store state to
// catch runtime errors (no DOM / Electron needed). Portal-based UI is not covered.

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { CommandPalette } from '@renderer/components/palette/CommandPalette'
import { useUpdates } from '@renderer/components/update/updateStore'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { DEFAULT_SETTINGS, type RefsResult } from '@shared/types'
import { StatusBar } from './StatusBar'
import { repoLifecycleItems, TabBar } from './TabBar'
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
    paletteOpen: true,
    modal: null
  })
  seedUpdates({ status: null })
})

function seedUpdates(patch: Partial<ReturnType<typeof useUpdates.getState>>) {
  useUpdates.setState(patch)
  Object.assign(useUpdates.getInitialState(), patch)
}

const releaseInfo = {
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  releaseName: 'Adar 0.2.0',
  notes: '',
  releaseUrl: 'https://github.com/mikelgarciaurbina/adar/releases/tag/v0.2.0',
  publishedAt: '',
  zip: null,
  dmg: null
}

describe('chrome render smoke tests', () => {
  it('renders the tab bar with one tab per repo', () => {
    const html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('tb-tab-active')
    expect(html).toContain('>adar<')
    expect(html).toContain('>other<')
    expect(html).toContain('title="/Users/me/Projects/adar"')
  })

  it('shows the update pill only while an update is available or downloaded', () => {
    expect(renderToStaticMarkup(<TabBar />)).not.toContain('tb-update-pill')
    seedUpdates({ status: { state: 'available', currentVersion: '0.1.0', info: releaseInfo, canInstall: false } })
    const html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('tb-update-pill')
    expect(html).toContain('Adar 0.2.0 is available')
    seedUpdates({ status: { state: 'downloaded', currentVersion: '0.1.0', info: releaseInfo, canInstall: true } })
    expect(renderToStaticMarkup(<TabBar />)).toContain('Adar 0.2.0 is ready to install')
    seedUpdates({ status: { state: 'not-available', currentVersion: '0.1.0', info: null, canInstall: false } })
    expect(renderToStaticMarkup(<TabBar />)).not.toContain('tb-update-pill')
  })

  it('offers Open by Path… in the new-tab menu (opens the path modal)', () => {
    const item = repoLifecycleItems().find((i) => 'label' in i && i.label === 'Open by Path…')
    expect(item).toBeTruthy()
    ;(item as { onClick: () => void }).onClick()
    expect(useApp.getState().modal).toEqual({ kind: 'open' })
  })

  it('reserves no traffic-light space outside the macOS desktop app', () => {
    expect(renderToStaticMarkup(<TabBar />)).not.toContain('tb-tabbar-mac')
  })

  it('tells apart tabs of repositories with the same folder name', () => {
    seed({ tabs: [makeTab('/Users/me/work/api', 'api'), makeTab('/Users/me/oss/api', 'api')], activePath: '/Users/me/work/api' })
    const html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('tb-tab-hint">work<')
    expect(html).toContain('tb-tab-hint">oss<')
  })

  it('renders tab groups: a tray with the label and tabs of each group, collapsed groups keep only the active tab', () => {
    const api = makeTab('/w/Proj/api', 'api')
    const app = makeTab('/w/Proj/app', 'app')
    const other = makeTab('/w/other', 'other')
    const group = { id: 'g1', name: 'Proj', color: 'heather' as const, repos: [api.path, app.path, '/w/Proj/landing'], collapsed: false }
    seed({ tabs: [other, api, app], activePath: app.path, settings: { ...DEFAULT_SETTINGS, tabGroups: [group] } })
    let html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('tb-group-chip')
    expect(html).toContain('class="tb-group" style="--tb-group:var(--group-heather)')
    expect(html.indexOf('>Proj<')).toBeLessThan(html.indexOf('>api<'))
    expect(html.match(/tb-tab-grouped/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Group Proj, 2 tabs"')

    seed({ settings: { ...DEFAULT_SETTINGS, tabGroups: [{ ...group, collapsed: true }] } })
    html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('tb-group-count">2<')
    expect(html).not.toContain('>api<')
    expect(html).toContain('>app<') // active
    expect(html).toContain('>other<')

    const openGroup = repoLifecycleItems().find((i) => 'label' in i && i.label === 'Open Group')
    expect(openGroup && 'submenu' in openGroup && openGroup.submenu?.map((x) => ('label' in x ? x.label : ''))).toEqual(['Proj (3)'])
    seed({ tabs: [], activePath: null })
    expect(renderToStaticMarkup(<Welcome />)).toContain('api, app and landing')

    // A custom colour follows the theme: Eguna's version first, Gaua's second.
    seed({ tabs: [api, app], activePath: app.path, settings: { ...DEFAULT_SETTINGS, tabGroups: [{ ...group, color: '#e8559a' }] } })
    html = renderToStaticMarkup(<TabBar />)
    expect(html).toContain('--tb-group:light-dark(#e75499, #ff73b1);--tb-group-ink:light-dark(#ab1167, #ff73b1)')
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
