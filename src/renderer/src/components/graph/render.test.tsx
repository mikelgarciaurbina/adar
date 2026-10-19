// Smoke test: server-render graph rows of every kind to catch render-time errors
// (no DOM needed). Interaction is covered by the pure model tests.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Commit, RefsResult, Stash } from '@shared/types'
import { GraphRow, type GraphRowProps } from './GraphRow'
import { computeGraph } from './layout'
import { buildDisplayRows, buildPillMap } from './model'
import type { GraphCtx } from './types'

const commit = (sha: string, subject: string, ...parents: string[]): Commit => ({
  sha,
  shortSha: sha.slice(0, 7),
  parents,
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  authorDate: 1_700_000_000,
  committerName: 'Ada Lovelace',
  committerEmail: 'ada@example.com',
  committerDate: 1_700_000_000,
  subject,
  body: ''
})

const commits = [
  commit('m000000000', 'Merge branch feature', 'b000000000', 'f000000000'),
  commit('f000000000', 'Add feature <b>bold</b>', 'a000000000'),
  commit('b000000000', 'Fix bug', 'a000000000'),
  commit('a000000000', 'Initial commit')
]
const stashes: Stash[] = [{ index: 0, ref: 'stash@{0}', sha: 's000000000', baseSha: 'b000000000', message: 'WIP on main: tweak', date: 1_700_000_000 }]
const refs: RefsResult = {
  head: { sha: 'm000000000', branch: 'main', detached: false, unborn: false },
  branches: [
    { name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: 'm000000000', isHead: true, upstream: 'origin/main' },
    { name: 'feature', fullName: 'refs/heads/feature', type: 'branch', sha: 'f000000000' }
  ],
  remotes: [{ name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', sha: 'm000000000', remote: 'origin' }],
  tags: [{ name: 'v1.0', fullName: 'refs/tags/v1.0', type: 'tag', sha: 'm000000000' }],
  stashes,
  submodules: []
}

const noop = () => undefined
const ctx: GraphCtx = {
  onRowClick: noop,
  onRowDoubleClick: noop,
  onRowContextMenu: noop,
  onPillDoubleClick: noop,
  onPillContextMenu: noop,
  onRefDrop: noop
}

describe('GraphRow rendering', () => {
  const layout = computeGraph(commits)
  const model = buildDisplayRows({ commits, layout, headSha: 'm000000000', showWip: true, stashes })
  const pills = buildPillMap(refs, { hidden: new Set(), showRemotes: true, showTags: true })

  const render = (i: number, extra: Partial<GraphRowProps> = {}) => {
    const row = model.rows[i]
    return renderToStaticMarkup(
      <GraphRow
        row={row}
        index={i}
        start={i * 28}
        h={28}
        graphWidth={80}
        pills={row.kind === 'commit' ? pills.get(row.commit.sha) : undefined}
        selected={false}
        multi={false}
        match={0}
        dim={false}
        hl=""
        hlField={null}
        dateMode="absolute"
        now={Date.now()}
        wip={row.kind === 'wip' ? { counts: { modified: 2, added: 1, deleted: 0, conflicts: 1 }, summary: '' } : undefined}
        ctx={ctx}
        {...extra}
      />
    )
  }

  it('renders the WIP row with counters', () => {
    const html = render(0)
    expect(html).toContain('// WIP')
    expect(html).toContain('gr-wip-node')
    expect(html).toContain('gr-wip-conflict')
    expect(html).not.toContain('gr-wip-deleted')
  })

  it('renders a merge commit with a dot, merged pill and overflow badge', () => {
    const html = render(1, { selected: true })
    expect(html).toContain('gr-merge-dot')
    expect(html).toContain('gr-pill-head')
    expect(html).toContain('+1') // v1.0 tag in the overflow
    expect(html).toContain('gr-connector')
    expect(html).toContain('gr-selected')
  })

  it('renders an avatar node, escapes text and highlights matches', () => {
    const idx = model.rows.findIndex((r) => r.key === 'f000000000')
    const html = render(idx, { match: 2, hl: 'feature', hlField: 'message' })
    expect(html).toContain('gr-node')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(html).toContain('<mark class="gr-hl">feature</mark>')
    expect(html).toContain('gr-match-current')
  })

  it('renders stash rows with a dashed connector', () => {
    const idx = model.rows.findIndex((r) => r.kind === 'stash')
    const html = render(idx)
    expect(html).toContain('stash@{0}')
    expect(html).toContain('gr-node-stash')
    expect(html).toContain('stroke-dasharray')
  })
})
