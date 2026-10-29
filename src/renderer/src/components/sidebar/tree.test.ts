import { describe, expect, it } from 'vitest'
import type { Ref, RefsResult, Stash, Submodule } from '@shared/types'
import {
  buildTree,
  collectContainerKeys,
  collectRefs,
  firstLeafIndex,
  flattenTree,
  folderKey,
  headFolders,
  naturalCompare,
  parentIndex,
  remoteKey,
  sectionKey,
  splitMatch,
  stepIndex,
  withExpanded,
  withToggled,
  type FolderNode,
  type RemoteNode,
  type Row
} from './tree'

const sha = (n: number) => n.toString(16).padStart(40, '0')

function branch(name: string, extra: Partial<Ref> = {}): Ref {
  return { name, fullName: `refs/heads/${name}`, type: 'branch', sha: sha(name.length), ...extra }
}
function remote(name: string, extra: Partial<Ref> = {}): Ref {
  return { name, fullName: `refs/remotes/${name}`, type: 'remote', sha: sha(name.length + 100), remote: name.split('/')[0], ...extra }
}
function tag(name: string): Ref {
  return { name, fullName: `refs/tags/${name}`, type: 'tag', sha: sha(name.length + 200) }
}
function stash(index: number, message: string, branchName = 'main'): Stash {
  return { index, ref: `stash@{${index}}`, sha: sha(1000 + index), baseSha: sha(1), message, branch: branchName, date: 0 }
}

function refsFixture(overrides: Partial<RefsResult> = {}): RefsResult {
  return {
    head: { sha: sha(4), branch: 'main', detached: false, unborn: false },
    branches: [
      branch('main', { isHead: true, upstream: 'origin/main' }),
      branch('feature/login'),
      branch('feature/ui/button'),
      branch('Feature-zeta'),
      branch('bugfix/crash')
    ],
    remotes: [
      remote('origin/HEAD', { isSymbolic: true }),
      remote('origin/main'),
      remote('origin/feature/login'),
      remote('upstream/main'),
      remote('fork/dev')
    ],
    tags: [tag('v1.10.0'), tag('v1.9.0'), tag('v1.2.0')],
    stashes: [stash(1, 'On main: older'), stash(0, 'WIP on main: abc123 newer')],
    submodules: [],
    ...overrides
  }
}

const remotesInfo = [
  { name: 'upstream', fetchUrl: 'git@github.com:up/repo.git', pushUrl: 'git@github.com:up/repo.git' },
  { name: 'origin', fetchUrl: 'git@github.com:me/repo.git', pushUrl: 'git@github.com:me/repo.git' },
  { name: 'empty', fetchUrl: 'https://example.com/empty.git', pushUrl: '' }
]

const keys = (rows: Row[]) => rows.map((r) => r.key)
const labels = (rows: Row[]) =>
  rows.map((r) => {
    switch (r.kind) {
      case 'section':
        return `[${r.title}]`
      case 'folder':
      case 'remote':
        return `${'  '.repeat(r.depth)}${r.expanded ? 'v' : '>'} ${r.node.label}`
      case 'hint':
        return `${'  '.repeat(r.depth)}(${r.text})`
      default:
        return `${'  '.repeat(r.depth)}${r.node.label}`
    }
  })

describe('naturalCompare', () => {
  it('sorts numerically and case-insensitively', () => {
    expect(['v1.10', 'v1.9', 'V1.2'].sort(naturalCompare)).toEqual(['V1.2', 'v1.9', 'v1.10'])
    expect(naturalCompare('a', 'A')).not.toBe(0) // stable tiebreak
  })
})

describe('buildTree', () => {
  const sections = buildTree(refsFixture(), remotesInfo)

  it('creates sections in order and skips SUBMODULES when empty', () => {
    expect(sections.map((s) => s.id)).toEqual(['local', 'remote', 'tags', 'stashes'])
    expect(sections.map((s) => s.total)).toEqual([5, 4, 3, 2])
  })

  it('groups local branches into nested folders (folders first, natural order)', () => {
    const local = sections[0].children
    expect(local.map((n) => `${n.kind}:${n.label}`)).toEqual(['folder:bugfix', 'folder:feature', 'ref:Feature-zeta', 'ref:main'])
    const feature = local[1] as FolderNode
    expect(feature.key).toBe(folderKey('local', 'feature'))
    expect(feature.leafCount).toBe(2)
    expect(feature.children.map((n) => `${n.kind}:${n.label}`)).toEqual(['folder:ui', 'ref:login'])
    const ui = feature.children[0] as FolderNode
    expect(ui.path).toBe('feature/ui')
    expect(ui.children[0]).toMatchObject({ kind: 'ref', label: 'button', key: 'refs/heads/feature/ui/button' })
  })

  it('marks folders containing the checked-out branch', () => {
    const s = buildTree(refsFixture({ branches: [branch('team/a/mine', { isHead: true }), branch('team/b/other')] }))
    const team = s[0].children[0] as FolderNode
    expect(team.containsHead).toBe(true)
    expect((team.children[0] as FolderNode).containsHead).toBe(true)
    expect((team.children[1] as FolderNode).containsHead).toBe(false)
  })

  it('creates one node per remote, origin first, including remotes without branches, excluding symbolic refs', () => {
    const remotes = sections[1].children as RemoteNode[]
    expect(remotes.map((r) => r.name)).toEqual(['origin', 'empty', 'fork', 'upstream'])
    const origin = remotes[0]
    expect(origin.key).toBe(remoteKey('origin'))
    expect(origin.url).toBe('git@github.com:me/repo.git')
    expect(origin.leafCount).toBe(2)
    expect(origin.children.map((n) => `${n.kind}:${n.label}`)).toEqual(['folder:feature', 'ref:main'])
    expect((origin.children[0] as FolderNode).key).toBe(folderKey('remote', 'origin/feature'))
    expect(remotes[1].children).toEqual([])
    expect(remotes[2].url).toBeNull() // fork is only known from refs
  })

  it('sorts tags naturally and stashes by index', () => {
    expect(sections[2].children.map((n) => n.label)).toEqual(['v1.2.0', 'v1.9.0', 'v1.10.0'])
    expect(sections[3].children.map((n) => n.label)).toEqual(['WIP on main: abc123 newer', 'On main: older'])
  })

  it('adds SUBMODULES when present', () => {
    const sub: Submodule = { path: 'libs/core', url: 'git@x:y/core.git', sha: sha(9), status: 'initialized' }
    const s = buildTree(refsFixture({ submodules: [sub] }))
    expect(s.map((x) => x.id)).toContain('submodules')
    expect(s[4].children[0]).toMatchObject({ kind: 'submodule', label: 'libs/core' })
  })

  it('adds a detached HEAD pseudo-row', () => {
    const s = buildTree(refsFixture({ head: { sha: sha(77), branch: null, detached: true, unborn: false } }))
    expect(s[0].children[0]).toMatchObject({ kind: 'head', label: `HEAD (detached at ${sha(77).slice(0, 7)})`, detached: true })
    expect(s[0].total).toBe(5)
  })

  it('adds an unborn-branch pseudo-row in a fresh repo', () => {
    const s = buildTree({
      head: { sha: null, branch: 'main', detached: false, unborn: true },
      branches: [],
      remotes: [],
      tags: [],
      stashes: [],
      submodules: []
    })
    expect(s[0].children).toHaveLength(1)
    expect(s[0].children[0]).toMatchObject({ kind: 'head', label: 'main (no commits yet)', sha: null })
  })
})

describe('flattenTree', () => {
  const sections = buildTree(refsFixture(), remotesInfo)

  it('renders defaults: sections and remotes open, folders closed', () => {
    expect(labels(flattenTree(sections))).toEqual([
      '[Local]',
      '  > bugfix',
      '  > feature',
      '  Feature-zeta',
      '  main',
      '[Remote]',
      '  v origin',
      '    > feature',
      '    main',
      '  v empty',
      '    (No branches)',
      '  v fork',
      '    dev',
      '  v upstream',
      '    main',
      '[Tags]',
      '  v1.2.0',
      '  v1.9.0',
      '  v1.10.0',
      '[Stashes]',
      '  WIP on main: abc123 newer',
      '  On main: older'
    ])
  })

  it('opens folders containing HEAD by default', () => {
    const s = buildTree(refsFixture({ branches: [branch('feature/mine', { isHead: true }), branch('other/x')] }))
    expect(labels(flattenTree(s)).slice(0, 4)).toEqual(['[Local]', '  v feature', '    mine', '  > other'])
    const rows = flattenTree(s)
    const feature = rows.find((r) => r.kind === 'folder' && r.node.label === 'feature')
    const other = rows.find((r) => r.kind === 'folder' && r.node.label === 'other')
    expect(feature && 'expanded' in feature && feature.expanded).toBe(true)
    expect(other && 'expanded' in other && other.expanded).toBe(false)
    expect(rows.some((r) => r.kind === 'ref' && r.node.label === 'mine')).toBe(true)
  })

  it('keeps folders opened or closed by hand, whichever branch is checked out', () => {
    const folders = new Map([
      [folderKey('local', 'feature'), true],
      [remoteKey('origin'), false]
    ])
    const out = labels(flattenTree(sections, { folders }))
    expect(out.slice(0, 7)).toEqual(['[Local]', '  > bugfix', '  v feature', '    > ui', '    login', '  Feature-zeta', '  main'])
    expect(out).toContain('  > origin')
    expect(out).not.toContain('    > feature') // origin collapsed hides its folder

    // Checking out a branch inside an opened folder used to close it (the choice was stored as "not the default").
    const openFolders = (branches: Ref[], choices: Map<string, boolean>) =>
      flattenTree(buildTree(refsFixture({ branches })), { folders: choices }).flatMap((r) => (r.kind === 'folder' && r.expanded ? [r.node.label] : []))
    const onFeature = [branch('main'), branch('feature/login', { isHead: true }), branch('bugfix/crash')]
    const opened = new Map([
      [folderKey('local', 'feature'), true],
      [folderKey('local', 'bugfix'), true]
    ])
    expect(openFolders(onFeature, opened)).toEqual(['bugfix', 'feature'])
    expect(openFolders([branch('main', { isHead: true }), branch('feature/login'), branch('bugfix/crash')], opened)).toEqual(['bugfix', 'feature'])
    // Closed by hand stays closed, even with the checked-out branch inside; untouched folders follow the branch.
    expect(openFolders(onFeature, new Map([[folderKey('local', 'feature'), false]]))).toEqual([])
    expect(openFolders(onFeature, new Map())).toEqual(['feature'])
  })

  it('collapsed sections hide their children but keep the total count', () => {
    const rows = flattenTree(sections, { collapsedSections: new Set(['local', 'tags'] as const) })
    const local = rows.find((r) => r.key === sectionKey('local'))
    expect(local).toMatchObject({ expanded: false, count: 5 })
    expect(rows[1].key).toBe(sectionKey('remote'))
    const tagsIdx = rows.findIndex((r) => r.key === sectionKey('tags'))
    expect(rows[tagsIdx + 1].key).toBe(sectionKey('stashes'))
  })

  it('shows empty-section hints', () => {
    const s = buildTree(refsFixture({ tags: [], stashes: [] }))
    const out = labels(flattenTree(s))
    expect(out).toContain('  (No tags)')
    expect(out).toContain('  (No stashes)')
  })

  it('filters case-insensitively, auto-expands matching folders and drops empty sections', () => {
    const rows = flattenTree(sections, { filter: '  LOGIN ' })
    expect(labels(rows)).toEqual(['[Local]', '  v feature', '    login', '[Remote]', '  v origin', '    v feature', '      login'])
    expect(rows[0]).toMatchObject({ kind: 'section', count: 1 })
    expect(rows[3]).toMatchObject({ kind: 'section', count: 1 })
  })

  it('filter ignores collapsed sections and toggles, but honours filterCollapsed', () => {
    const base = { filter: 'login', collapsedSections: new Set(['local'] as const), folders: new Map([[remoteKey('origin'), false]]) }
    expect(labels(flattenTree(sections, base))).toHaveLength(7)
    const rows = flattenTree(sections, { ...base, filterCollapsed: new Set([folderKey('local', 'feature'), sectionKey('remote')]) })
    expect(labels(rows)).toEqual(['[Local]', '  > feature', '[Remote]'])
    expect(rows[1]).toMatchObject({ count: 1 })
  })

  it('matches remote branches by their full name, including the remote', () => {
    const rows = flattenTree(sections, { filter: 'upstream' })
    expect(labels(rows)).toEqual(['[Remote]', '  v upstream', '    main'])
  })

  it('shows a remote without branches when its name matches', () => {
    expect(labels(flattenTree(sections, { filter: 'empt' }))).toEqual(['[Remote]', '  v empty'])
  })

  it('matches stashes by message, ref and branch', () => {
    expect(labels(flattenTree(sections, { filter: 'stash@{1}' }))).toEqual(['[Stashes]', '  On main: older'])
    expect(labels(flattenTree(sections, { filter: 'newer' }))).toEqual(['[Stashes]', '  WIP on main: abc123 newer'])
  })

  it('returns no rows when nothing matches', () => {
    expect(flattenTree(sections, { filter: 'zzz-nothing' })).toEqual([])
  })

  it('produces unique keys', () => {
    const rows = flattenTree(sections, { folders: new Map(collectContainerKeys(sections).map((n) => [n.key, true])) })
    const all = flattenTree(sections, { filter: 'a' })
    for (const list of [rows, all]) expect(new Set(keys(list)).size).toBe(list.length)
  })
})

describe('queries', () => {
  const sections = buildTree(refsFixture(), remotesInfo)

  it('finds the folders of the checked-out branch, and records folders opened and closed', () => {
    const s = buildTree(refsFixture({ branches: [branch('team/a/mine', { isHead: true }), branch('team/b/other')] }))
    const [team, teamA] = headFolders(s)
    expect([team.key, teamA.key]).toEqual([folderKey('local', 'team'), folderKey('local', 'team/a')])
    // Open by default (the checked-out branch is inside): a click closes it, another opens it.
    let folders = withToggled(new Map(), team)
    expect(folders.get(team.key)).toBe(false)
    folders = withToggled(folders, team)
    expect(folders.get(team.key)).toBe(true)
    // The latest choice goes last, so trimming drops the oldest.
    expect([...withExpanded(new Map([[team.key, false], ['f:local:x', true]]), [team], true)]).toEqual([
      ['f:local:x', true],
      [team.key, true]
    ])
    expect(headFolders(sections)).toEqual([])
  })

  it('collectRefs returns every ref below a container', () => {
    const origin = sections[1].children[0] as RemoteNode
    expect(collectRefs(origin).map((r) => r.name).sort()).toEqual(['origin/feature/login', 'origin/main'])
    expect(collectRefs(sections[0]).length).toBe(5)
  })

  it('collectContainerKeys lists folders and remotes, optionally per section', () => {
    expect(collectContainerKeys(sections, 'local').map((n) => n.key)).toEqual([
      folderKey('local', 'bugfix'),
      folderKey('local', 'feature'),
      folderKey('local', 'feature/ui')
    ])
    expect(collectContainerKeys(sections).some((n) => n.kind === 'remote')).toBe(true)
  })

  it('stepIndex skips hint rows and clamps', () => {
    const rows = flattenTree(sections)
    const emptyIdx = rows.findIndex((r) => r.key === remoteKey('empty'))
    expect(rows[emptyIdx + 1].kind).toBe('hint')
    expect(stepIndex(rows, emptyIdx, 1)).toBe(emptyIdx + 2)
    expect(stepIndex(rows, emptyIdx + 2, -1)).toBe(emptyIdx)
    expect(stepIndex(rows, 0, -1)).toBe(0)
    expect(stepIndex(rows, rows.length - 1, 1)).toBe(rows.length - 1)
    expect(stepIndex(rows, -1, 1)).toBe(0)
    expect(stepIndex(rows, 999, -1)).toBe(rows.length - 1)
    expect(stepIndex(rows, 0, 1, 1000)).toBe(rows.length - 1)
    expect(stepIndex([], -1, 1)).toBe(-1)
  })

  it('parentIndex finds the enclosing container', () => {
    const rows = flattenTree(sections)
    const mainIdx = rows.findIndex((r) => r.key === 'refs/remotes/origin/main')
    expect(rows[parentIndex(rows, mainIdx)].key).toBe(remoteKey('origin'))
    expect(rows[parentIndex(rows, parentIndex(rows, mainIdx))].key).toBe(sectionKey('remote'))
    expect(parentIndex(rows, 0)).toBe(-1)
  })

  it('firstLeafIndex finds the first selectable leaf', () => {
    const rows = flattenTree(sections, { filter: 'v1.' })
    expect(rows[firstLeafIndex(rows)].key).toBe('refs/tags/v1.2.0')
  })
})

describe('splitMatch', () => {
  it('splits around every case-insensitive match', () => {
    expect(splitMatch('Feature/feat', 'FEAT')).toEqual([
      { text: 'Feat', match: true },
      { text: 'ure/', match: false },
      { text: 'feat', match: true }
    ])
  })
  it('returns the whole text when there is no query or match', () => {
    expect(splitMatch('main', '')).toEqual([{ text: 'main', match: false }])
    expect(splitMatch('main', 'x')).toEqual([{ text: 'main', match: false }])
  })
})
