// Server-render smoke test: exercises the component's hooks and row rendering
// for loading, error, populated and filtered states without a DOM.
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { RepoTab } from '@renderer/store/appStore'
import type { RefsResult } from '@shared/types'

vi.mock('@renderer/api/client', () => ({
  api: new Proxy({}, { get: () => vi.fn(() => Promise.resolve()) }),
  newOpId: () => 'op-1',
  isMac: true,
  isElectron: false,
  platform: 'darwin',
  setZoom: vi.fn(),
  onAdarEvent: vi.fn(() => () => undefined)
}))

const { LeftPanel } = await import('./LeftPanel')

const sha = (c: string) => c.repeat(40)

const refs: RefsResult = {
  head: { sha: sha('a'), branch: 'main', detached: false, unborn: false },
  branches: [
    { name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: sha('a'), isHead: true, upstream: 'origin/main', ahead: 2, behind: 1 },
    { name: 'feature/login', fullName: 'refs/heads/feature/login', type: 'branch', sha: sha('b') },
    { name: 'stale', fullName: 'refs/heads/stale', type: 'branch', sha: sha('c'), upstream: 'origin/stale', upstreamGone: true }
  ],
  remotes: [
    { name: 'origin/HEAD', fullName: 'refs/remotes/origin/HEAD', type: 'remote', sha: sha('a'), remote: 'origin', isSymbolic: true },
    { name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', sha: sha('a'), remote: 'origin' }
  ],
  tags: [{ name: 'v1.0.0', fullName: 'refs/tags/v1.0.0', type: 'tag', sha: sha('d'), annotated: true, tagMessage: 'First' }],
  stashes: [{ index: 0, ref: 'stash@{0}', sha: sha('e'), baseSha: sha('a'), message: 'WIP on main: abc wip', branch: 'main', date: 0 }],
  submodules: [{ path: 'vendor/lib', url: 'git@github.com:x/lib.git', sha: null, status: 'uninitialized' }]
}

function makeTab(patch: Partial<RepoTab> = {}): RepoTab {
  return {
    path: '/repo',
    name: 'repo',
    info: {
      path: '/repo',
      name: 'repo',
      gitDir: '/repo/.git',
      isBare: false,
      head: refs.head,
      state: 'none',
      remotes: [{ name: 'origin', fetchUrl: 'git@github.com:me/repo.git', pushUrl: 'git@github.com:me/repo.git' }]
    },
    refs,
    commits: [],
    hasMore: false,
    status: null,
    loading: { log: false, refs: false, status: false, more: false },
    error: null,
    selection: { kind: 'none' },
    multiSelect: [],
    center: { kind: 'graph' },
    search: { open: false, query: '', mode: 'message', results: [], index: 0, loading: false },
    hiddenRefs: ['refs/tags/v1.0.0'],
    soloRef: null,
    undoStack: [],
    redoStack: [],
    draft: { summary: '', description: '', amend: false },
    lastFetch: null,
    ...patch
  }
}

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('LeftPanel (SSR smoke)', () => {
  it('renders the filter box with its shortcut hint', () => {
    const html = renderToString(<LeftPanel tab={makeTab()} />)
    expect(html).toContain('Filter (⌥⌘F)')
    expect(html).toContain('role="tree"')
  })

  it('renders sections and rows', () => {
    const html = renderToString(<LeftPanel tab={makeTab()} />)
    const t = text(html)
    for (const s of ['Local', 'Remote', 'Tags', 'Stashes', 'Submodules', 'main', 'feature', 'origin', 'v1.0.0', 'WIP on main: abc wip', 'vendor/lib']) {
      expect(t).toContain(s)
    }
    expect(t).toContain('↑2')
    expect(t).toContain('↓1')
    expect(html).toContain('sb-head') // current branch styling
    expect(html).toContain('sb-hidden') // hidden tag is dimmed
    expect(html).toContain('no longer exists') // upstream gone warning
    expect(html).not.toContain('origin/HEAD')
  })

  it('renders a skeleton while refs load and an error state on failure', () => {
    expect(renderToString(<LeftPanel tab={makeTab({ refs: null, loading: { log: true, refs: true, status: false, more: false } })} />)).toContain(
      'sb-skeleton'
    )
    const err = renderToString(<LeftPanel tab={makeTab({ refs: null, error: 'fatal: boom' })} />)
    expect(err).toContain('fatal: boom')
    expect(err).toContain('Retry')
  })

  it('renders a detached HEAD row and solo highlighting', () => {
    const detached = { ...refs, head: { sha: sha('f'), branch: null, detached: true, unborn: false }, branches: refs.branches.map((b) => ({ ...b, isHead: false })) }
    const html = renderToString(<LeftPanel tab={makeTab({ refs: detached, soloRef: 'refs/heads/main' })} />)
    expect(text(html)).toContain(`HEAD (detached at ${sha('f').slice(0, 7)})`)
    expect(html).toContain('sb-solo-mode')
    expect(html).toContain('sb-is-solo')
  })
})
