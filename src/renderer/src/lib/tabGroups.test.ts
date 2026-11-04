import { describe, expect, it } from 'vitest'
import type { TabGroup } from '@shared/types'
import {
  arrangeTabs,
  dropPlacement,
  folderName,
  groupForFolder,
  groupSuggestion,
  moveGroupTabs,
  nextGroupColor,
  parentFolder,
  syncGroupOrder,
  tabSegments,
  withMembership
} from './tabGroups'

const t = (...paths: string[]) => paths.map((path) => ({ path }))
const paths = (tabs: { path: string }[]) => tabs.map((x) => x.path)
const group = (id: string, repos: string[], extra: Partial<TabGroup> = {}): TabGroup => ({ id, name: id, color: 'sea', repos, collapsed: false, ...extra })

describe('arrangeTabs', () => {
  it('pulls each group together at its first tab, keeping everything else in place', () => {
    const groups = [group('p', ['/p/api', '/p/app'])]
    expect(paths(arrangeTabs(t('/x', '/p/api', '/y', '/p/app', '/z'), groups))).toEqual(['/x', '/p/api', '/p/app', '/y', '/z'])
    expect(paths(arrangeTabs(t('/p/app', '/x', '/p/api'), groups))).toEqual(['/p/app', '/p/api', '/x'])
  })
  it('returns the same array when nothing moves', () => {
    const tabs = t('/a', '/b')
    expect(arrangeTabs(tabs, [group('g', ['/a', '/b'])])).toBe(tabs)
    expect(arrangeTabs(tabs, [])).toBe(tabs)
  })
})

describe('syncGroupOrder', () => {
  it('orders open members like the tabs and keeps closed ones after them', () => {
    const g = group('p', ['/p/api', '/p/landing', '/p/app'])
    expect(syncGroupOrder([g], t('/p/app', '/p/api'))[0].repos).toEqual(['/p/app', '/p/api', '/p/landing'])
    const same = group('q', ['/a', '/b'])
    expect(syncGroupOrder([same], t('/a', '/b'))[0]).toBe(same)
  })
})

describe('tabSegments', () => {
  it('splits arranged tabs into ungrouped tabs and group runs with their indices', () => {
    const groups = [group('p', ['/p/api', '/p/app'])]
    const segs = tabSegments(t('/x', '/p/api', '/p/app', '/y'), groups)
    expect(segs.map((s) => (s.kind === 'tab' ? s.tab.path : `${s.group.id}:${s.tabs.map((x) => x.index).join(',')}`))).toEqual(['/x', 'p:1,2', '/y'])
  })
})

describe('dropPlacement', () => {
  // x | [api app landing] | y
  const tabs = t('/x', '/p/api', '/p/app', '/p/landing', '/y')
  const groups = [group('p', ['/p/api', '/p/app', '/p/landing'])]
  it('joins a group when dropped inside it', () => {
    expect(dropPlacement(tabs, groups, 0, 2, false)).toEqual({ to: 1, groupId: 'p' })
    expect(dropPlacement(tabs, groups, 4, 2, true)).toEqual({ to: 3, groupId: 'p' })
  })
  it('lands outside when dropped on a group edge', () => {
    expect(dropPlacement(tabs, groups, 0, 1, false)).toEqual({ to: 0, groupId: null })
    expect(dropPlacement(tabs, groups, 0, 3, true)).toEqual({ to: 3, groupId: null })
    expect(dropPlacement(tabs, groups, 4, 1, false)).toEqual({ to: 1, groupId: null })
  })
  it('only reorders a member dropped on its own group edge', () => {
    expect(dropPlacement(tabs, groups, 3, 1, false)).toEqual({ to: 1, groupId: 'p' })
  })
  it('treats the shown tab of a collapsed group as its edges, landing outside the whole group', () => {
    const collapsed = [group('p', ['/p/api', '/p/app', '/p/landing'], { collapsed: true })]
    // x | [p ▸ app] | y  (api and landing hidden)
    expect(dropPlacement(tabs, collapsed, 4, 2, true, '/p/app')).toEqual({ to: 4, groupId: null })
    expect(dropPlacement(tabs, collapsed, 0, 2, false, '/p/app')).toEqual({ to: 0, groupId: null })
    expect(dropPlacement(tabs, collapsed, 0, 3, false, '/p/landing')).toEqual({ to: 0, groupId: null })
  })
  it('leaves the group when dropped next to an ungrouped tab', () => {
    expect(dropPlacement(tabs, groups, 2, 4, true)).toEqual({ to: 4, groupId: null })
    expect(dropPlacement(tabs, groups, 2, 0, false)).toEqual({ to: 0, groupId: null })
  })
})

describe('moveGroupTabs', () => {
  // [a: a1 a2] x [b: b1] y [c: c1 c2]
  const tabs = t('/a/1', '/a/2', '/x', '/b/1', '/y', '/c/1', '/c/2')
  const groups = [group('a', ['/a/1', '/a/2']), group('b', ['/b/1']), group('c', ['/c/1', '/c/2'])]

  it('moves a whole group past ungrouped tabs and other groups, never inside one', () => {
    expect(paths(moveGroupTabs(tabs, groups, 'a', 4, true))).toEqual(['/x', '/b/1', '/y', '/a/1', '/a/2', '/c/1', '/c/2'])
    expect(paths(moveGroupTabs(tabs, groups, 'a', 6, true))).toEqual(['/x', '/b/1', '/y', '/c/1', '/c/2', '/a/1', '/a/2'])
    // Over the second tab of group c, before it: before the whole of c.
    expect(paths(moveGroupTabs(tabs, groups, 'a', 6, false))).toEqual(['/x', '/b/1', '/y', '/a/1', '/a/2', '/c/1', '/c/2'])
    expect(paths(moveGroupTabs(tabs, groups, 'c', 0, false))).toEqual(['/c/1', '/c/2', '/a/1', '/a/2', '/x', '/b/1', '/y'])
    expect(paths(moveGroupTabs(tabs, groups, 'b', 2, false))).toEqual(['/a/1', '/a/2', '/b/1', '/x', '/y', '/c/1', '/c/2'])
  })

  it('returns the same array when nothing moves', () => {
    expect(moveGroupTabs(tabs, groups, 'a', 2, false)).toBe(tabs)
    expect(moveGroupTabs(tabs, groups, 'a', 1, true)).toBe(tabs)
    expect(moveGroupTabs(tabs, groups, 'missing', 2, true)).toBe(tabs)
  })
})

describe('withMembership', () => {
  it('moves a repository between groups and out of them', () => {
    const groups = [group('a', ['/1', '/2']), group('b', ['/3'])]
    expect(withMembership(groups, '/2', 'b').map((g) => g.repos)).toEqual([['/1'], ['/3', '/2']])
    expect(withMembership(groups, '/3', null).map((g) => g.repos)).toEqual([['/1', '/2']]) // emptied group dropped
    expect(withMembership(groups, '/1', 'a')[0]).toBe(groups[0])
  })
})

describe('suggestions and folders', () => {
  it('suggests grouping open, ungrouped siblings of a new tab', () => {
    const tabs = t('/w/OverlayOn/api', '/w/Adar', '/w/OverlayOn/app')
    expect(groupSuggestion(tabs, [], '/w/OverlayOn/app', '/Users/me')).toEqual({
      folder: '/w/OverlayOn',
      name: 'OverlayOn',
      paths: ['/w/OverlayOn/api', '/w/OverlayOn/app']
    })
    expect(groupSuggestion(tabs, [], '/w/Adar', '/Users/me')).toBeNull() // alone in its folder
    expect(groupSuggestion(tabs, [group('g', ['/w/OverlayOn/api'])], '/w/OverlayOn/app', null)).toBeNull()
    expect(groupSuggestion(t('/Users/me/a', '/Users/me/b'), [], '/Users/me/b', '/Users/me/')).toBeNull() // home folder
  })
  it('finds the saved group of a folder', () => {
    const g = group('p', ['/w/p/api', '/w/p/app'])
    expect(groupForFolder([g], '/w/p/')).toBe(g)
    expect(groupForFolder([g], '/w')).toBeUndefined()
  })
  it('handles paths and colours', () => {
    expect(parentFolder('/w/p/api/')).toBe('/w/p')
    expect(parentFolder('/api')).toBe('')
    expect(folderName('/w/OverlayOn/')).toBe('OverlayOn')
    expect(nextGroupColor([])).toBe('fern')
    expect(nextGroupColor([group('a', [], { color: 'fern' })])).toBe('moss')
  })
})
