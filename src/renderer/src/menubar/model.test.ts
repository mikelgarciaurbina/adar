import { describe, expect, it } from 'vitest'
import type { Commit, RecentRepo, TabGroup, WorkingStatus } from '@shared/types'
import { badgesOf, fetchedLabel, groupOf, incomingShas, pickProject, projectSections, shortAge } from './model'

function commit(sha: string, ...parents: string[]): Commit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents,
    authorName: 'A',
    authorEmail: 'a@x',
    authorDate: 0,
    committerName: 'A',
    committerEmail: 'a@x',
    committerDate: 0,
    subject: `subject ${sha}`,
    body: ''
  }
}

const recent = (...paths: string[]): RecentRepo[] => paths.map((p, i) => ({ path: p, name: p.split('/').pop()!, lastOpened: 100 - i }))
const group = (id: string, name: string, repos: string[]): TabGroup => ({ id, name, color: 'sea', repos, collapsed: false })

describe('pickProject', () => {
  it('prefers the pinned project, then the active tab, the first tab and the latest recent repository', () => {
    const r = recent('/r/one', '/r/two')
    expect(pickProject('/p', { activeTab: '/a', openTabs: ['/t'] }, r)).toBe('/p')
    expect(pickProject(null, { activeTab: '/a', openTabs: ['/t'] }, r)).toBe('/a')
    expect(pickProject(null, { activeTab: null, openTabs: ['/t'] }, r)).toBe('/t')
    expect(pickProject(null, { activeTab: null, openTabs: [] }, r)).toBe('/r/one')
    expect(pickProject(null, { activeTab: null, openTabs: [] }, [])).toBeNull()
  })
})

describe('projectSections', () => {
  const settings = {
    openTabs: ['/w/api', '/w/app', '/w/adar'],
    tabGroups: [group('g1', 'OBSFootball', ['/w/api', '/w/app', '/w/landing'])]
  }

  it('lists groups first, then the other tabs and recent repositories once each', () => {
    const sections = projectSections(settings, recent('/w/adar', '/w/dotfiles', '/w/api'))
    expect(sections.map((s) => [s.title, s.projects.map((p) => p.name)])).toEqual([
      ['OBSFootball', ['api', 'app', 'landing']],
      ['Other repositories', ['adar', 'dotfiles']]
    ])
    expect(sections[0].color).toBe('sea')
    expect(sections[1].color).toBeNull()
  })

  it('filters by project name, or keeps a whole group whose name matches', () => {
    expect(projectSections(settings, recent('/w/dotfiles'), 'DOT').map((s) => s.projects.map((p) => p.name))).toEqual([['dotfiles']])
    expect(projectSections(settings, [], 'obs').map((s) => s.projects.map((p) => p.name))).toEqual([['api', 'app', 'landing']])
    expect(projectSections(settings, [], 'zzz')).toEqual([])
  })

  it('calls the list plainly "Repositories" without groups', () => {
    expect(projectSections({ openTabs: ['/w/a'], tabGroups: [] }, [])[0].title).toBe('Repositories')
  })
})

describe('groupOf', () => {
  it('finds the group of a repository', () => {
    const settings = { tabGroups: [group('g1', 'OBSFootball', ['/w/api'])] }
    expect(groupOf(settings, '/w/api')).toEqual({ name: 'OBSFootball', color: 'sea' })
    expect(groupOf(settings, '/w/other')).toBeNull()
  })
})

describe('incomingShas', () => {
  // base ← local (HEAD);  base ← in1 ← in2 (upstream)
  const commits = [commit('in2', 'in1'), commit('local', 'base'), commit('in1', 'base'), commit('base')]

  it('returns the upstream commits HEAD does not contain', () => {
    expect([...incomingShas(commits, 'local', 'in2')].sort()).toEqual(['in1', 'in2'])
  })

  it('is empty without an upstream, when both point at the same commit, or when HEAD is ahead', () => {
    expect(incomingShas(commits, 'local', null).size).toBe(0)
    expect(incomingShas(commits, 'in2', 'in2').size).toBe(0)
    expect(incomingShas(commits, 'in2', 'in1').size).toBe(0)
  })

  it('ignores commits that were not loaded', () => {
    expect([...incomingShas([commit('in2', 'in1')], 'local', 'in2')]).toEqual(['in2'])
  })
})

describe('badgesOf', () => {
  it('counts staged and unstaged changes together', () => {
    const status: WorkingStatus = {
      staged: [{ path: 'a', status: 'modified' }],
      unstaged: [{ path: 'b', status: 'untracked' }, { path: 'c', status: 'modified' }],
      conflicted: [],
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1
    }
    expect(badgesOf(status)).toEqual({ behind: 1, ahead: 2, changes: 3, conflicts: 0 })
  })
})

describe('shortAge / fetchedLabel', () => {
  const now = 1_800_000_000_000
  const ago = (s: number) => Math.floor(now / 1000) - s

  it('keeps ages short for the graph column', () => {
    expect(shortAge(ago(20), now)).toBe('now')
    expect(shortAge(ago(5 * 60), now)).toBe('5 min')
    expect(shortAge(ago(3 * 3600), now)).toBe('3 h')
    expect(shortAge(ago(30 * 3600), now)).toBe('yesterday')
    expect(shortAge(ago(4 * 86400), now)).toBe('4 d')
    expect(shortAge(ago(21 * 86400), now)).toBe('3 w')
  })

  it('says when the project was last fetched', () => {
    expect(fetchedLabel(undefined, now)).toBe('not fetched yet')
    expect(fetchedLabel(now - 10_000, now)).toBe('fetched just now')
    expect(fetchedLabel(now - 2 * 60_000, now)).toBe('fetched 2 min ago')
  })
})
