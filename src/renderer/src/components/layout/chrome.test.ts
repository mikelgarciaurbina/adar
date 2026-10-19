import { describe, expect, it } from 'vitest'
import {
  badgeCount,
  busyLabelsFor,
  clampConsoleHeight,
  distinctParents,
  formatGitVersion,
  headLabel,
  isBusyFor,
  latestProgressWithPrefix,
  pickProgress,
  reorderIndex,
  tildify,
  toUnixSeconds
} from './chrome'

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
