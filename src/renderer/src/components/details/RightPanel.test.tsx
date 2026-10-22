// Smoke tests: render every right-panel state to static HTML (no DOM needed) to
// catch runtime errors in render paths and check the key texts appear.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { Commit, CommitDetails, RefsResult, WorkingStatus } from '@shared/types'
import { loadCached } from './cache'
import { commitDetailsKey } from './CommitPanel'
import { RightPanel } from './RightPanel'

const REPO = '/tmp/adar-smoke'

const commit = (sha: string, subject: string, parents: string[] = []): Commit => ({
  sha,
  shortSha: sha.slice(0, 7),
  parents,
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  authorDate: 1_700_000_000,
  committerName: 'Grace Hopper',
  committerEmail: 'grace@example.com',
  committerDate: 1_700_000_500,
  subject,
  body: subject === 'Second' ? 'Body with a link https://example.com/x.\nSecond line' : ''
})

const c1 = commit('1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'First')
const c2 = commit('2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Second', [c1.sha])
const c3 = commit('3333333ccccccccccccccccccccccccccccccccc', 'Third', [c2.sha])

const refs: RefsResult = {
  head: { sha: c3.sha, branch: 'main', detached: false, unborn: false },
  branches: [{ name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: c3.sha, isHead: true }],
  remotes: [{ name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', sha: c2.sha, remote: 'origin' }],
  tags: [{ name: 'v1.0.0', fullName: 'refs/tags/v1.0.0', type: 'tag', sha: c2.sha }],
  stashes: [{ index: 0, ref: 'stash@{0}', sha: 'feedfacefeedfacefeedfacefeedfacefeedface', baseSha: c3.sha, message: 'On main: try things', branch: 'main', date: 1_700_000_900 }],
  submodules: []
}

const status: WorkingStatus = {
  staged: [{ path: 'src/app.ts', status: 'modified', additions: 3, deletions: 1 }],
  unstaged: [
    { path: 'src/app.ts', status: 'modified' },
    { path: 'docs/new file.md', status: 'untracked' },
    { path: 'lib/renamed.ts', oldPath: 'lib/old.ts', status: 'renamed' }
  ],
  conflicted: [],
  branch: 'main',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0
}

function makeTab(patch: Partial<RepoTab>): RepoTab {
  return {
    path: REPO,
    name: 'adar-smoke',
    info: {
      path: REPO,
      name: 'adar-smoke',
      gitDir: `${REPO}/.git`,
      isBare: false,
      head: refs.head,
      state: 'none',
      remotes: []
    },
    refs,
    commits: [c3, c2, c1],
    hasMore: false,
    status,
    loading: { log: false, refs: false, status: false, more: false },
    error: null,
    selection: { kind: 'none' },
    multiSelect: [],
    center: { kind: 'graph' },
    search: { open: false, query: '', mode: 'message', results: [], index: 0, loading: false },
    hiddenRefs: [],
    soloRef: null,
    undoStack: [],
    redoStack: [],
    draft: { summary: '', description: '', amend: false },
    lastFetch: null,
    ...patch
  }
}

const render = (tab: RepoTab) => renderToStaticMarkup(<RightPanel tab={tab} />)

describe('RightPanel smoke', () => {
  it('shows the staging area for no selection with changes', () => {
    const html = render(makeTab({}))
    expect(html).toContain('3 file changes on')
    expect(html).toContain('Unstaged Files')
    expect(html).toContain('Staged Files')
    expect(html).toContain('Commit changes to 1 file')
    expect(html).toContain('data-commit-summary')
  })

  it('shows the empty state for no selection on a clean tree', () => {
    const html = render(makeTab({ status: { ...status, staged: [], unstaged: [] } }))
    expect(html).toContain('Select a commit to see its details')
  })

  it('renders the WIP panel in tree mode with a draft, amend and merge state', () => {
    const html = render(
      makeTab({
        selection: { kind: 'wip' },
        draft: { summary: 'x'.repeat(80), description: 'desc', amend: true },
        center: { kind: 'diff', target: { kind: 'unstaged', path: 'src/app.ts' } }
      })
    )
    expect(html).toContain('Amend previous commit with 1 file')
    expect(html).toContain('det-warn')
    const merge = render(makeTab({ selection: { kind: 'wip' }, info: { ...makeTab({}).info!, state: 'merge' } }))
    expect(merge).toContain('Commit merge')
  })

  it('shows conflicts and disables committing', () => {
    const html = render(
      makeTab({
        selection: { kind: 'wip' },
        status: { ...status, conflicted: [{ path: 'src/app.ts', kind: 'both-modified' }] }
      })
    )
    expect(html).toContain('Conflicted Files')
    expect(html).toContain('both modified')
    expect(html).toContain('Resolve 1 conflicted file before committing')
    expect(html).toContain('aria-label="Mark src/app.ts as resolved"')
  })

  it('offers bulk staging only in the section headers', () => {
    const html = render(makeTab({ selection: { kind: 'wip' } }))
    expect(html.match(/Stage all changes/g)).toHaveLength(1)
    expect(html.match(/Unstage all changes/g)).toHaveLength(1)
  })

  it('shows "Stage all & commit" when nothing is staged', () => {
    const html = render(makeTab({ selection: { kind: 'wip' }, status: { ...status, staged: [] } }))
    expect(html).toContain('Stage all &amp; commit (3 files)')
    expect(html).toContain('Enter a commit summary, or stage files')
    expect(html).not.toContain('Commit changes')
    // Amending without staged files keeps the amend button primary and offers staging as well.
    const amend = render(makeTab({ selection: { kind: 'wip' }, status: { ...status, staged: [] }, draft: { summary: 's', description: '', amend: true } }))
    expect(amend).toContain('Amend previous commit</span>')
    expect(amend).toContain('Stage all &amp; amend')
  })

  it('replaces the stale WIP lists with the repository error and disables committing', () => {
    const error = 'Repository folder not found: /tmp/adar-smoke'
    const draft = { summary: 'Keep my draft', description: '', amend: false }
    for (const tab of [makeTab({ selection: { kind: 'wip' }, error, draft }), makeTab({ error, draft }), makeTab({ selection: { kind: 'wip' }, error, draft, status: null })]) {
      const html = render(tab)
      expect(html).toContain('Repository unavailable')
      expect(html).toContain(error)
      expect(html).toContain('>Retry<')
      expect(html).not.toContain('Unstaged Files')
      expect(html).not.toContain('Staged Files')
      expect(html).not.toContain('Stage all')
      expect(html).not.toContain('Stash all changes')
      expect(html).not.toContain('Reading working tree')
      // The draft is kept (and editable) but the commit button is disabled with an explanation.
      expect(html).toContain('value="Keep my draft"')
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Commit changes/)
      expect(html).toContain('The repository is unavailable: committing is disabled')
    }
    // Stale operation info does not leak into the composer either.
    const merge = render(makeTab({ selection: { kind: 'wip' }, error, info: { ...makeTab({}).info!, state: 'merge' } }))
    expect(merge).not.toContain('Commit merge')
    // Once a refresh succeeds (tab.error cleared) the lists and the commit button are back.
    const ok = render(makeTab({ selection: { kind: 'wip' }, draft }))
    expect(ok).toContain('Unstaged Files')
    expect(ok).not.toContain('Repository unavailable')
    expect(ok).toMatch(/<button[^>]*title="Commit changes to 1 file/)
    expect(ok).not.toMatch(/<button[^>]*disabled=""[^>]*title="Commit changes/)
  })

  it('keeps the merge composer reachable when the resolved merge has no file changes', () => {
    const clean = { ...status, staged: [], unstaged: [] }
    const info = { ...makeTab({}).info!, state: 'merge' as const }
    // No selection: the right panel defaults to the staging area while a merge waits for its commit.
    const html = render(makeTab({ status: clean, info, draft: { summary: 'Merge feature', description: '', amend: false } }))
    expect(html).not.toContain('Select a commit to see its details')
    expect(html).toContain('No file changes')
    expect(html).toContain('The merge result matches main')
    expect(html).not.toContain('Your working tree is clean')
    expect(html).toContain('Merge commit')
    expect(html).toMatch(/<button[^>]*title="Commit merge/)
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*title="Commit merge/)
    // Without a merge a clean tree still shows the hint.
    expect(render(makeTab({ status: clean }))).toContain('Select a commit to see its details')
  })

  it('cannot amend during a merge, even with a leftover amend flag', () => {
    const info = { ...makeTab({}).info!, state: 'merge' as const }
    const conflicted = { ...status, conflicted: [{ path: 'README.md', kind: 'both-modified' as const }] }
    const html = render(makeTab({ selection: { kind: 'wip' }, info, status: conflicted, draft: { summary: 'Merge', description: '', amend: true } }))
    expect(html).toMatch(/<input type="checkbox" disabled=""/)
    expect(html).not.toMatch(/<input type="checkbox"[^>]*checked=""/)
    expect(html).not.toContain('Amend previous commit with')
    expect(html).toContain('Resolve 1 conflicted file before committing')
  })

  it('names the in-progress operation in the composer note', () => {
    const info = makeTab({}).info!
    expect(render(makeTab({ selection: { kind: 'wip' }, info: { ...info, state: 'rebase-interactive' } }))).toContain('An interactive rebase is in progress')
    expect(render(makeTab({ selection: { kind: 'wip' }, info: { ...info, state: 'rebase' } }))).toContain('A rebase is in progress')
  })

  it('renders a loading WIP panel without status', () => {
    expect(render(makeTab({ selection: { kind: 'wip' }, status: null }))).toContain('Reading working tree')
  })

  it('renders commit details from the list while files load', () => {
    const html = render(makeTab({ selection: { kind: 'commit', sha: c2.sha } }))
    expect(html).toContain('>Commit<')
    expect(html).toContain('2222222')
    expect(html).toContain('Second')
    expect(html).toContain('https://example.com/x')
    expect(html).toContain('committed by')
    expect(html).toContain('v1.0.0')
    expect(html).toContain('origin/main')
    expect(html).toContain('1111111')
    expect(html).toContain('Loading files')
  })

  it('renders cached commit details with files', async () => {
    const details: CommitDetails = {
      commit: c3,
      files: [
        { path: 'src/a.ts', status: 'modified', additions: 10, deletions: 2 },
        { path: 'img/logo.png', status: 'added', binary: true },
        { path: 'b.ts', oldPath: 'a/b.ts', status: 'renamed' }
      ],
      additions: 10,
      deletions: 2
    }
    await loadCached(commitDetailsKey(REPO, c3.sha), async () => details)
    const html = render(makeTab({ selection: { kind: 'commit', sha: c3.sha } }))
    expect(html).toContain('3 files changed')
    expect(html).toContain('logo.png')
    expect(html).toContain('BIN')
    expect(html).toContain('a/b.ts')
  })

  it('renders the compare and multi-select panels', () => {
    const compare = render(makeTab({ selection: { kind: 'commit', sha: c3.sha }, multiSelect: [c3.sha, c1.sha] }))
    expect(compare).toContain('Comparing')
    // older first
    expect(compare.indexOf('1111111')).toBeLessThan(compare.indexOf('3333333'))
    const multi = render(makeTab({ selection: { kind: 'commit', sha: c3.sha }, multiSelect: [c3.sha, c1.sha, c2.sha] }))
    expect(multi).toContain('3 commits selected')
    expect(multi).toContain('Cherry-pick 3 commits')
  })

  it('renders stash details and the missing-stash state', () => {
    const html = render(makeTab({ selection: { kind: 'stash', index: 0, sha: refs.stashes[0].sha } }))
    expect(html).toContain('stash@{0}')
    expect(html).toContain('try things')
    expect(html).toContain('Pop')
    expect(html).toContain('Apply')
    const gone = render(makeTab({ selection: { kind: 'stash', index: 3, sha: 'deadbeef' } }))
    expect(gone).toContain('Stash not found')
  })

  it('handles a bare repository', () => {
    const tab = makeTab({ selection: { kind: 'wip' } })
    expect(render({ ...tab, info: { ...tab.info!, isBare: true } })).toContain('Bare repository')
  })
})
