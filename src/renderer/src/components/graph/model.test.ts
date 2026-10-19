import { describe, expect, it } from 'vitest'
import type { Commit, Ref, RefsResult, Stash, WorkingStatus } from '@shared/types'
import { computeGraph, type Edge } from './layout'
import {
  buildDisplayRows,
  buildPillMap,
  findSelectionIndex,
  hasWorkingChanges,
  highlightRanges,
  isAncestor,
  lanesInRange,
  localBranchesIn,
  navigate,
  nearestCommitRow,
  NEUTRAL_COLOR,
  oldestFirst,
  rowSelection,
  selectionKey,
  stashKey,
  wipCounts,
  WIP_KEY,
  type CommitRow,
  type DisplayModel
} from './model'

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

function stash(index: number, sha: string, baseSha: string): Stash {
  return { index, ref: `stash@{${index}}`, sha, baseSha, message: `WIP ${index}`, date: 0 }
}

function model(commits: Commit[], opts: { headSha?: string | null; showWip?: boolean; stashes?: Stash[] } = {}): DisplayModel {
  return buildDisplayRows({
    commits,
    layout: computeGraph(commits),
    headSha: opts.headSha ?? null,
    showWip: opts.showWip ?? false,
    stashes: opts.stashes ?? []
  })
}

const fmt = (e: Edge) => `${e.type === 'pass' ? 'p' : e.type === 'in' ? 'i' : 'o'}${e.type === 'pass' ? e.from : `${e.from}>${e.to}`}${e.dashed ? '*' : ''}`
const edgesOf = (m: DisplayModel, i: number) => m.rows[i].edges.map(fmt).sort()

/** Bottom lanes of row i must equal top lanes of row i+1 (dashed connectors included). */
function assertContinuity(m: DisplayModel): void {
  for (let i = 0; i + 1 < m.rows.length; i++) {
    const bottom = new Set<number>()
    for (const e of m.rows[i].edges) if (e.type === 'pass' || e.type === 'out') bottom.add(e.to)
    const top = new Set<number>()
    for (const e of m.rows[i + 1].edges) if (e.type === 'pass' || e.type === 'in') top.add(e.from)
    expect([...top].sort(), `row ${i}→${i + 1}`).toEqual([...bottom].sort())
  }
}

const linear = [commit('C', 'B'), commit('B', 'A'), commit('A')]

describe('buildDisplayRows', () => {
  it('maps commits 1:1 without WIP or stashes', () => {
    const m = model(linear)
    expect(m.rows.map((r) => r.key)).toEqual(['C', 'B', 'A'])
    expect(m.index.get('B')).toBe(1)
    expect(m.maxLanes).toBe(1)
  })

  it('puts a WIP row on top with a dashed line straight into HEAD', () => {
    const m = model(linear, { headSha: 'C', showWip: true })
    expect(m.rows.map((r) => r.key)).toEqual([WIP_KEY, 'C', 'B', 'A'])
    expect(m.rows[0].lane).toBe(0)
    expect(edgesOf(m, 0)).toEqual(['o0>0*'])
    expect(edgesOf(m, 1)).toEqual(['i0>0*', 'o0>0'])
    assertContinuity(m)
  })

  it('routes the WIP connector through a free lane when HEAD is further down', () => {
    // main (lane 0) has newer commits; HEAD is the feature tip F in lane 1.
    const commits = [commit('M2', 'M1'), commit('F', 'M1'), commit('M1')]
    const m = model(commits, { headSha: 'F', showWip: true })
    expect(m.rows.map((r) => r.key)).toEqual([WIP_KEY, 'M2', 'F', 'M1'])
    expect(m.rows[0].lane).toBe(1)
    expect(edgesOf(m, 1)).toEqual(['o0>0', 'p1*'])
    expect(edgesOf(m, 2)).toEqual(['i1>1*', 'o1>1', 'p0'])
    expect(m.rows[0].color).toBe(m.rows[2].color)
    assertContinuity(m)
  })

  it('uses another lane when HEAD has a child above it (detached HEAD)', () => {
    const m = model(linear, { headSha: 'B', showWip: true })
    // Lane 0 is busy with C → B, so the WIP line takes lane 1 and curves into B.
    expect(m.rows[0].lane).toBe(1)
    expect(edgesOf(m, 1)).toEqual(['o0>0', 'p1*'])
    expect(edgesOf(m, 2)).toEqual(['i0>0', 'i1>0*', 'o0>0'])
    expect(m.maxLanes).toBe(2)
    assertContinuity(m)
  })

  it('shows a bare WIP node when HEAD is unborn or not loaded', () => {
    const empty = model([], { headSha: null, showWip: true })
    expect(empty.rows).toHaveLength(1)
    expect(empty.rows[0].kind).toBe('wip')
    expect(empty.rows[0].edges).toEqual([])
    expect(empty.maxLanes).toBe(1)
    const missing = model(linear, { headSha: 'ZZZ', showWip: true })
    expect(missing.rows[0].edges).toEqual([])
    assertContinuity(missing)
  })

  it('inserts stash rows right above their base commit', () => {
    const m = model(linear, { stashes: [stash(0, 'S0', 'B')] })
    expect(m.rows.map((r) => r.key)).toEqual(['C', stashKey('S0'), 'B', 'A'])
    const s = m.rows[1]
    expect(s.kind).toBe('stash')
    expect(s.color).toBe(NEUTRAL_COLOR)
    // Lane 0 carries C → B, so the stash sits in lane 1 and connects into B.
    expect(s.lane).toBe(1)
    expect(edgesOf(m, 1)).toEqual(['o1>1*', 'p0'])
    expect(edgesOf(m, 2)).toEqual(['i0>0', 'i1>0*', 'o0>0'])
    assertContinuity(m)
  })

  it('stacks several stashes on the same base in separate lanes, newest first', () => {
    const m = model(linear, { stashes: [stash(1, 'S1', 'C'), stash(0, 'S0', 'C')] })
    expect(m.rows.map((r) => r.key)).toEqual([stashKey('S0'), stashKey('S1'), 'C', 'B', 'A'])
    // Even on a tip, stashes branch off to the side instead of sitting inline.
    expect(m.rows[0].lane).toBe(1)
    expect(m.rows[1].lane).toBe(2)
    expect(edgesOf(m, 1)).toEqual(['o2>2*', 'p1*'])
    expect(edgesOf(m, 2)).toEqual(['i1>0*', 'i2>0*', 'o0>0'])
    assertContinuity(m)
  })

  it('skips stashes whose base commit is not loaded', () => {
    const m = model(linear, { stashes: [stash(0, 'S0', 'nope')] })
    expect(m.rows).toHaveLength(3)
  })

  it('routes the WIP connector around stash rows', () => {
    const m = model(linear, { headSha: 'C', showWip: true, stashes: [stash(0, 'S0', 'C')] })
    expect(m.rows.map((r) => r.key)).toEqual([WIP_KEY, stashKey('S0'), 'C', 'B', 'A'])
    // WIP sits right above HEAD in its lane; the stash branches off to the side.
    expect(m.rows[0].lane).toBe(0)
    expect(m.rows[1].lane).toBe(1)
    expect(edgesOf(m, 0)).toEqual(['o0>0*'])
    expect(edgesOf(m, 1)).toEqual(['o1>1*', 'p0*'])
    expect(edgesOf(m, 2)).toEqual(['i0>0*', 'i1>0*', 'o0>0'])
    expect(m.rows[0].color).toBe(m.rows[2].color)
    assertContinuity(m)
  })

  it('keeps WIP in HEAD\'s lane with several stashes on HEAD and a branch beside it', () => {
    // HEAD = M (lane 0) with stashes on it; feature tip F (lane 1) is older than M.
    const commits = [commit('M', 'B'), commit('F', 'B'), commit('B', 'A'), commit('A')]
    const m = model(commits, { headSha: 'M', showWip: true, stashes: [stash(0, 'S0', 'M'), stash(1, 'S1', 'M')] })
    expect(m.rows.map((r) => r.key)).toEqual([WIP_KEY, stashKey('S0'), stashKey('S1'), 'M', 'F', 'B', 'A'])
    expect(m.rows[0].lane).toBe(0)
    expect(m.rows[1].lane).toBe(1)
    expect(m.rows[2].lane).toBe(2)
    expect(edgesOf(m, 3)).toEqual(['i0>0*', 'i1>0*', 'i2>0*', 'o0>0'])
    assertContinuity(m)
  })

  it('reserves the WIP lane in stash rows above a HEAD that is further down', () => {
    // main tip M2 has a stash; HEAD is the feature tip F (lane 1).
    const commits = [commit('M2', 'M1'), commit('F', 'M1'), commit('M1')]
    const m = model(commits, { headSha: 'F', showWip: true, stashes: [stash(0, 'S0', 'M2')] })
    expect(m.rows.map((r) => r.key)).toEqual([WIP_KEY, stashKey('S0'), 'M2', 'F', 'M1'])
    expect(m.rows[0].lane).toBe(1)
    // Lane 1 carries the WIP line, so the stash moves one further right.
    expect(m.rows[1].lane).toBe(2)
    expect(edgesOf(m, 1)).toEqual(['o2>2*', 'p1*'])
    assertContinuity(m)
  })

  it('reuses cached commit rows so unchanged rows keep their identity', () => {
    const layout = computeGraph(linear)
    const cache = new WeakMap()
    const a = buildDisplayRows({ commits: linear, layout, headSha: 'C', showWip: false, stashes: [], cache })
    const b = buildDisplayRows({ commits: linear, layout, headSha: 'C', showWip: true, stashes: [], cache })
    // Row B is untouched by the WIP connector (HEAD is C): same object.
    expect(b.rows[2]).toBe(a.rows[1])
    // Row C gets the dashed connector: a new object.
    expect(b.rows[1]).not.toBe(a.rows[0])
    expect((b.rows[1] as CommitRow).commit).toBe(linear[0])
  })

  it('flags merge commits', () => {
    const m = model([commit('M', 'A', 'B'), commit('B', 'A'), commit('A')])
    expect((m.rows[0] as CommitRow).isMerge).toBe(true)
    expect((m.rows[1] as CommitRow).isMerge).toBe(false)
  })
})

describe('lanesInRange', () => {
  // Three branches forked from a root and merged back one by one:
  //   m2 ─┐          lanes: m2 (0) merges c (2), m1 (0) merges b (1)
  //   c   │ (lane 2)
  //   m1 ─┤
  //   b   │ (lane 1)
  //   a     (lane 0)
  //   root
  const commits = [
    commit('m2', 'm1', 'c'),
    commit('c', 'root'),
    commit('m1', 'a', 'b'),
    commit('b', 'root'),
    commit('a', 'root'),
    commit('root')
  ]
  const m = model(commits)

  it('counts the lanes touched by the rows in range (nodes and lines)', () => {
    expect(lanesInRange(m.rows, 0, m.rows.length - 1)).toBe(m.maxLanes)
    // The root row alone only uses lane 0, but lines from the other lanes converge into it.
    const rootIdx = m.index.get('root')!
    expect(lanesInRange(m.rows, rootIdx, rootIdx)).toBe(m.maxLanes)
    // Any single row reaches at least its own node lane.
    for (let i = 0; i < m.rows.length; i++) expect(lanesInRange(m.rows, i, i)).toBeGreaterThan(m.rows[i].lane)
  })

  it('clamps the range and returns 0 when empty', () => {
    expect(lanesInRange(m.rows, -5, 100)).toBe(m.maxLanes)
    expect(lanesInRange(m.rows, 3, 2)).toBe(0)
    expect(lanesInRange([], 0, 10)).toBe(0)
  })

  it('includes the lanes of stash and WIP connectors', () => {
    const withStash = model(commits, { headSha: 'm2', showWip: true, stashes: [stash(0, 's0', 'm2')] })
    const stashIdx = withStash.rows.findIndex((r) => r.kind === 'stash')
    expect(lanesInRange(withStash.rows, stashIdx, stashIdx)).toBe(withStash.rows[stashIdx].lane + 1)
    expect(lanesInRange(withStash.rows, 0, withStash.rows.length - 1)).toBe(withStash.maxLanes)
  })
})

describe('selection helpers', () => {
  it('maps selections to keys and back', () => {
    const m = model(linear, { headSha: 'C', showWip: true, stashes: [stash(0, 'S0', 'B')] })
    expect(selectionKey({ kind: 'none' })).toBeNull()
    expect(findSelectionIndex(m, { kind: 'wip' })).toBe(0)
    expect(findSelectionIndex(m, { kind: 'commit', sha: 'B' })).toBe(3)
    expect(findSelectionIndex(m, { kind: 'stash', index: 0, sha: 'S0' })).toBe(2)
    expect(findSelectionIndex(m, { kind: 'commit', sha: 'missing' })).toBe(-1)
    expect(rowSelection(m.rows[2])).toEqual({ kind: 'stash', index: 0, sha: 'S0' })
    expect(rowSelection(m.rows[1])).toEqual({ kind: 'commit', sha: 'C' })
    expect(rowSelection(m.rows[0])).toEqual({ kind: 'wip' })
  })

  it('finds abbreviated shas', () => {
    const commits = [commit('abcdef1234567890abcdef1234567890abcdef12')]
    const m = model(commits)
    expect(findSelectionIndex(m, { kind: 'commit', sha: 'abcdef1' })).toBe(0)
  })

  it('finds the nearest commit row for Shift+Arrow ranges (skips WIP / stash rows)', () => {
    const m = model(linear, { headSha: 'C', showWip: true, stashes: [stash(0, 'S0', 'B')] })
    // rows: wip, C, stash, B, A
    expect(nearestCommitRow(m.rows, 2, 1)).toBe(3)
    expect(nearestCommitRow(m.rows, 2, -1)).toBe(1)
    expect(nearestCommitRow(m.rows, 0, -1)).toBe(-1)
    expect(nearestCommitRow(m.rows, 4, 1)).toBe(4)
    expect(nearestCommitRow(m.rows, 9, 1)).toBe(-1)
  })

  it('navigates with keys and clamps', () => {
    expect(navigate(-1, 'ArrowDown', 10, 5)).toBe(0)
    expect(navigate(3, 'ArrowDown', 10, 5)).toBe(4)
    expect(navigate(9, 'ArrowDown', 10, 5)).toBe(9)
    expect(navigate(0, 'ArrowUp', 10, 5)).toBe(0)
    expect(navigate(4, 'Home', 10, 5)).toBe(0)
    expect(navigate(4, 'End', 10, 5)).toBe(9)
    expect(navigate(4, 'PageDown', 10, 5)).toBe(9)
    expect(navigate(8, 'PageUp', 10, 5)).toBe(3)
    expect(navigate(2, 'x', 10, 5)).toBeNull()
    expect(navigate(0, 'ArrowDown', 0, 5)).toBeNull()
  })

  it('checks ancestry through loaded commits', () => {
    const commits = [commit('M', 'B', 'F'), commit('F', 'A'), commit('B', 'A'), commit('A'), commit('X')]
    expect(isAncestor(commits, 'A', 'M')).toBe(true)
    expect(isAncestor(commits, 'F', 'M')).toBe(true)
    expect(isAncestor(commits, 'F', 'B')).toBe(false)
    expect(isAncestor(commits, 'X', 'M')).toBe(false)
    expect(isAncestor(commits, 'M', 'M')).toBe(true)
  })

  it('orders a multi-selection oldest first', () => {
    const commits = [commit('D', 'C'), commit('C', 'B'), commit('B', 'A'), commit('A')]
    expect(oldestFirst(commits, ['D', 'B', 'C']).map((c) => c.sha)).toEqual(['B', 'C', 'D'])
  })
})

describe('wip counters', () => {
  const status = (s: Partial<WorkingStatus>): WorkingStatus => ({
    staged: [],
    unstaged: [],
    conflicted: [],
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    ...s
  })

  it('detects working changes', () => {
    expect(hasWorkingChanges(null)).toBe(false)
    expect(hasWorkingChanges(status({}))).toBe(false)
    expect(hasWorkingChanges(status({ unstaged: [{ path: 'x', status: 'untracked' }] }))).toBe(true)
    expect(hasWorkingChanges(status({ conflicted: [{ path: 'x', kind: 'both-modified' }] }))).toBe(true)
  })

  it('counts files once across staged and unstaged', () => {
    const c = wipCounts(
      status({
        staged: [
          { path: 'new.ts', status: 'added' },
          { path: 'mod.ts', status: 'modified' },
          { path: 'gone.ts', status: 'deleted' }
        ],
        unstaged: [
          { path: 'new.ts', status: 'modified' },
          { path: 'mod.ts', status: 'modified' },
          { path: 'untracked.txt', status: 'untracked' },
          { path: 'ren.ts', oldPath: 'old.ts', status: 'renamed' },
          { path: 'conf.ts', status: 'conflicted' }
        ],
        conflicted: [{ path: 'conf.ts', kind: 'both-modified' }]
      })
    )
    expect(c).toEqual({ modified: 2, added: 2, deleted: 1, conflicts: 1 })
  })
})

describe('buildPillMap', () => {
  const ref = (p: Partial<Ref> & Pick<Ref, 'name' | 'type' | 'sha'>): Ref => ({
    fullName: p.type === 'branch' ? `refs/heads/${p.name}` : p.type === 'remote' ? `refs/remotes/${p.name}` : `refs/tags/${p.name}`,
    ...p
  })
  const refs = (over: Partial<RefsResult> = {}): RefsResult => ({
    head: { sha: 'A', branch: 'main', detached: false, unborn: false },
    branches: [
      ref({ name: 'feature', type: 'branch', sha: 'A' }),
      ref({ name: 'main', type: 'branch', sha: 'A', isHead: true, upstream: 'origin/main' }),
      ref({ name: 'dev', type: 'branch', sha: 'B', upstream: 'origin/dev' })
    ],
    remotes: [
      ref({ name: 'origin/main', type: 'remote', sha: 'A', remote: 'origin' }),
      ref({ name: 'origin/HEAD', type: 'remote', sha: 'A', remote: 'origin', isSymbolic: true }),
      ref({ name: 'origin/dev', type: 'remote', sha: 'C', remote: 'origin' }),
      ref({ name: 'upstream/main', type: 'remote', sha: 'A', remote: 'upstream' })
    ],
    tags: [ref({ name: 'v1.0', type: 'tag', sha: 'A' })],
    stashes: [],
    submodules: [],
    ...over
  })
  const opts = { hidden: new Set<string>(), showRemotes: true, showTags: true }

  it('merges same-named remote branches into the local pill and orders HEAD first', () => {
    const map = buildPillMap(refs(), opts)
    const a = map.get('A')!
    expect(a.map((p) => `${p.kind}:${p.label}`)).toEqual(['branch:main', 'branch:feature', 'tag:v1.0'])
    expect(a[0].isHead).toBe(true)
    // upstream first, then other remotes with the same branch name.
    expect(a[0].remotes.map((r) => r.name)).toEqual(['origin/main', 'upstream/main'])
    // origin/dev is at another commit than dev: not merged.
    expect(map.get('B')!.map((p) => p.label)).toEqual(['dev'])
    expect(map.get('C')!.map((p) => `${p.kind}:${p.label}`)).toEqual(['remote:origin/dev'])
    expect(localBranchesIn(a).map((r) => r.name)).toEqual(['main', 'feature'])
  })

  it('respects hidden refs and the remote / tag settings', () => {
    const hidden = new Set(['refs/heads/main', 'refs/tags/v1.0'])
    const a = buildPillMap(refs(), { ...opts, hidden }).get('A')!
    // main hidden: its remotes show on their own.
    expect(a.map((p) => `${p.kind}:${p.label}`)).toEqual(['branch:feature', 'remote:origin/main', 'remote:upstream/main'])
    const noRemotes = buildPillMap(refs(), { ...opts, showRemotes: false, showTags: false })
    expect(noRemotes.get('A')!.map((p) => p.label)).toEqual(['main', 'feature'])
    expect(noRemotes.get('A')![0].remotes).toEqual([])
    expect(noRemotes.has('C')).toBe(false)
  })

  it('adds a detached HEAD pill', () => {
    const map = buildPillMap(refs({ head: { sha: 'B', branch: null, detached: true, unborn: false } }), opts)
    expect(map.get('B')!.map((p) => `${p.kind}:${p.label}`)).toEqual(['detached:HEAD', 'branch:dev'])
  })

  it('returns an empty map without refs', () => {
    expect(buildPillMap(null, opts).size).toBe(0)
  })
})

describe('highlightRanges', () => {
  it('finds literal case-insensitive matches', () => {
    expect(highlightRanges('Fix bug in fix-up', 'fix')).toEqual([
      [0, 3],
      [11, 14]
    ])
    expect(highlightRanges('abc', '')).toEqual([])
    expect(highlightRanges('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4]
    ])
  })
})
