import { describe, expect, it } from 'vitest'
import {
  badgeCount,
  busyLabelsFor,
  clampConsoleHeight,
  distinctParents,
  tabHints,
  formatGitVersion,
  headLabel,
  isBusyFor,
  isFullscreenWindow,
  latestProgressWithPrefix,
  pendingUpdateVersion,
  pickProgress,
  reorderIndex,
  tildify,
  toUnixSeconds
} from './chrome'
import type { UpdateStatus } from '@shared/update'

function move<T>(arr: T[], from: number, to: number): T[] {
  const a = [...arr]
  const [x] = a.splice(from, 1)
  a.splice(to, 0, x)
  return a
}

describe('reorderIndex', () => {
  const tabs = ['a', 'b', 'c', 'd']
  it('moves a tab right', () => {
    // drop "a" on the right half of "c" → b c a d
    expect(move(tabs, 0, reorderIndex(0, 2, true))).toEqual(['b', 'c', 'a', 'd'])
    // drop "a" on the left half of "c" → b a c d
    expect(move(tabs, 0, reorderIndex(0, 2, false))).toEqual(['b', 'a', 'c', 'd'])
  })
  it('moves a tab left', () => {
    expect(move(tabs, 3, reorderIndex(3, 0, false))).toEqual(['d', 'a', 'b', 'c'])
    expect(move(tabs, 3, reorderIndex(3, 0, true))).toEqual(['a', 'd', 'b', 'c'])
  })
  it('is a no-op when dropped on itself or its neighbour edge', () => {
    expect(reorderIndex(1, 1, false)).toBe(1)
    expect(reorderIndex(1, 1, true)).toBe(1)
    expect(reorderIndex(1, 0, true)).toBe(1)
    expect(reorderIndex(1, 2, false)).toBe(1)
  })
  it('moves to the end', () => {
    expect(move(tabs, 0, reorderIndex(0, 3, true))).toEqual(['b', 'c', 'd', 'a'])
  })
})

describe('progress & busy', () => {
  it('picks the latest progress for the active repo or global ops', () => {
    const progress = {
      'fetch-1': { message: 'fetch other', repoPath: '/other' },
      'push-1': { message: 'pushing', repoPath: '/repo', percent: 40 },
      'fetch-2': { message: 'fetch other 2', repoPath: '/other' }
    }
    expect(pickProgress(progress, '/repo')).toEqual({ opId: 'push-1', state: progress['push-1'] })
    expect(pickProgress(progress, '/none')).toBeNull()
    expect(pickProgress({ 'clone-1': { message: 'Receiving objects' } }, null)?.opId).toBe('clone-1')
  })

  it('finds the latest entry with a prefix', () => {
    const progress = { 'clone-a': { message: 'a' }, 'push-x': { message: 'x' }, 'clone-b': { message: 'b' } }
    expect(latestProgressWithPrefix(progress, 'clone')?.message).toBe('b')
    expect(latestProgressWithPrefix(progress, 'pull')).toBeNull()
  })

  it('lists busy labels for the active repo', () => {
    const busy = { 'push:/repo': 'Pushing…', 'fetch:/other': 'Fetching…', 'clone:clone-1': 'Cloning…', 'fetch:/repo/sub': 'x' }
    expect(busyLabelsFor(busy, '/repo')).toEqual(['Pushing…', 'Cloning…'])
    expect(busyLabelsFor(busy, null)).toEqual(['Cloning…'])
    expect(isBusyFor(busy, 'push', '/repo')).toBe(true)
    expect(isBusyFor(busy, 'pull', '/repo')).toBe(false)
  })
})

describe('formatting', () => {
  it('formats git versions', () => {
    expect(formatGitVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5')
    expect(formatGitVersion('2.47.1')).toBe('2.47.1')
    expect(formatGitVersion('git version 2.45.2.windows.1')).toBe('2.45.2.windows.1')
    expect(formatGitVersion('unknown')).toBe('')
    expect(formatGitVersion('')).toBe('')
    expect(formatGitVersion(undefined)).toBe('')
  })

  it('normalises timestamps', () => {
    expect(toUnixSeconds(1_760_000_000)).toBe(1_760_000_000)
    expect(toUnixSeconds(1_760_000_000_123)).toBe(1_760_000_000)
  })

  it('tildifies paths', () => {
    expect(tildify('/Users/me/Projects/x', '/Users/me')).toBe('~/Projects/x')
    expect(tildify('/Users/me', '/Users/me/')).toBe('~')
    expect(tildify('/Users/meow/x', '/Users/me')).toBe('/Users/meow/x')
    expect(tildify('/x', null)).toBe('/x')
  })

  it('labels HEAD', () => {
    expect(headLabel({ branch: 'main', detached: false, sha: 'abc' })).toBe('main')
    expect(headLabel({ branch: null, detached: true, sha: 'abc' })).toBe('detached HEAD')
    expect(headLabel(null)).toBe('…')
  })

  it('clamps console height and formats badges', () => {
    expect(clampConsoleHeight(50, 900)).toBe(120)
    expect(clampConsoleHeight(5000, 900)).toBe(720)
    expect(clampConsoleHeight(240, 900)).toBe(240)
    expect(badgeCount(0)).toBe('')
    expect(badgeCount(undefined)).toBe('')
    expect(badgeCount(7)).toBe('7')
    expect(badgeCount(150)).toBe('99+')
  })
})

describe('distinctParents', () => {
  it('gives no hint to unique names', () => {
    const m = distinctParents([
      { path: '/a/x/one', name: 'one' },
      { path: '/a/x/two', name: 'two' }
    ])
    expect(m.size).toBe(0)
  })
  it('uses the nearest differing parent folder', () => {
    const m = distinctParents([
      { path: '/tmp/fx/demo', name: 'demo' },
      { path: '/tmp/fx2/demo/', name: 'demo' },
      { path: '/tmp/other', name: 'other' }
    ])
    expect(m.get('/tmp/fx/demo')).toBe('fx')
    expect(m.get('/tmp/fx2/demo/')).toBe('fx2')
    expect(m.has('/tmp/other')).toBe(false)
  })
  it('walks up until the labels differ', () => {
    const m = distinctParents([
      { path: '/work/a/src/app', name: 'app' },
      { path: '/work/b/src/app', name: 'app' }
    ])
    expect(m.get('/work/a/src/app')).toBe('a/src')
    expect(m.get('/work/b/src/app')).toBe('b/src')
  })
  it('handles different depths, root parents and duplicate paths', () => {
    const m = distinctParents([
      { path: '/x/demo', name: 'demo' },
      { path: '/y/x/demo', name: 'demo' },
      { path: '/x/demo', name: 'demo' }
    ])
    expect(m.get('/x/demo')).toBe('x')
    expect(m.get('/y/x/demo')).toBe('y/x')
    const root = distinctParents([
      { path: '/demo', name: 'demo' },
      { path: '/home/demo', name: 'demo' }
    ])
    expect(root.get('/demo')).toBe('/')
    expect(root.get('/home/demo')).toBe('home')
  })
  it('works with Windows paths', () => {
    const m = distinctParents([
      { path: 'C:\\code\\one\\repo', name: 'repo' },
      { path: 'C:\\code\\two\\repo', name: 'repo' }
    ])
    expect(m.get('C:\\code\\one\\repo')).toBe('one')
  })
})

describe('isFullscreenWindow', () => {
  const screen = { screenWidth: 1512, screenHeight: 982 }
  const win = (w: number, h: number, extra: Partial<Parameters<typeof isFullscreenWindow>[0]> = {}) => ({
    innerWidth: w,
    innerHeight: h,
    zoom: 1,
    ...screen,
    htmlFullscreen: false,
    ...extra
  })
  it('detects native full screen (viewport exactly covers the screen)', () => {
    expect(isFullscreenWindow(win(1512, 982))).toBe(true)
  })
  it('is false for normal and maximised windows (menu bar stays visible)', () => {
    expect(isFullscreenWindow(win(1280, 800))).toBe(false)
    expect(isFullscreenWindow(win(1512, 949))).toBe(false) // zoomed: screen minus menu bar
    expect(isFullscreenWindow(win(1512, 900))).toBe(false)
  })
  it('accounts for the UI zoom (viewport in CSS px, rounded down)', () => {
    // 1512 / 1.25 = 1209.6 → 1209, 982 / 1.25 = 785.6 → 785
    expect(isFullscreenWindow(win(1209, 785, { zoom: 1.25 }))).toBe(true)
    expect(isFullscreenWindow(win(1374, 892, { zoom: 1.1 }))).toBe(true)
    expect(isFullscreenWindow(win(1209, 759, { zoom: 1.25 }))).toBe(false) // maximised at 125%
    expect(isFullscreenWindow(win(1680, 1091, { zoom: 0.9 }))).toBe(true)
    expect(isFullscreenWindow(win(1512, 982, { zoom: 0 }))).toBe(true) // invalid zoom → 1
  })
  it('honours the HTML fullscreen API and ignores missing metrics', () => {
    expect(isFullscreenWindow(win(800, 600, { htmlFullscreen: true }))).toBe(true)
    expect(isFullscreenWindow(win(1512, 982, { screenWidth: 0, screenHeight: 0 }))).toBe(false)
    expect(isFullscreenWindow(win(0, 0, { screenWidth: 0, screenHeight: 0 }))).toBe(false)
  })
})

describe('pendingUpdateVersion', () => {
  const info = {
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    releaseName: 'Adar 0.2.0',
    notes: '',
    releaseUrl: 'https://github.com/mikelgarciaurbina/adar/releases/tag/v0.2.0',
    publishedAt: '',
    zip: null,
    dmg: null
  }
  const st = (state: UpdateStatus['state'], withInfo = true): UpdateStatus => ({ state, currentVersion: '0.1.0', info: withInfo ? info : null, canInstall: false })
  it('is the new version while available or downloaded', () => {
    expect(pendingUpdateVersion(st('available'))).toBe('0.2.0')
    expect(pendingUpdateVersion(st('downloaded'))).toBe('0.2.0')
  })
  it('is null otherwise', () => {
    expect(pendingUpdateVersion(null)).toBeNull()
    expect(pendingUpdateVersion(undefined)).toBeNull()
    for (const s of ['idle', 'checking', 'not-available', 'downloading', 'error'] as const) expect(pendingUpdateVersion(st(s))).toBeNull()
    expect(pendingUpdateVersion(st('available', false))).toBeNull()
  })
})

describe('tabHints', () => {
  it('drops the folder hint inside a group unless two tabs of that group share a name', () => {
    const tabs = [
      { path: '/w/OBS/api', name: 'api' },
      { path: '/w/Other/api', name: 'api' },
      { path: '/w/OBS/app', name: 'app' },
      { path: '/x/a/app', name: 'app' }
    ]
    const hints = tabHints(tabs, [{ repos: ['/w/OBS/api', '/w/OBS/app'] }])
    expect(hints.has('/w/OBS/api')).toBe(false)
    expect(hints.has('/w/OBS/app')).toBe(false)
    expect(hints.get('/w/Other/api')).toBe('Other')
    expect(hints.get('/x/a/app')).toBe('a')

    const same = tabHints(
      [
        { path: '/p/one/demo', name: 'demo' },
        { path: '/p/two/demo', name: 'demo' }
      ],
      [{ repos: ['/p/one/demo', '/p/two/demo'] }]
    )
    expect(same.get('/p/one/demo')).toBe('one')
    expect(same.get('/p/two/demo')).toBe('two')
  })
})
