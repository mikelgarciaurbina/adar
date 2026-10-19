// Server-side render smoke tests for the interactive rebase screen (no DOM
// library is available, so effects and interactions are not exercised here).

import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { Commit, WorkingStatus } from '@shared/types'

const dialogs = vi.hoisted(() => ({ confirm: vi.fn(async (_opts: { title: string; message?: unknown; danger?: boolean }) => false) }))
vi.mock('@renderer/components/common/dialogs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/components/common/dialogs')>()),
  confirm: dialogs.confirm
}))

import { confirmRebaseOptions, RebaseEditor, RebaseView } from './RebaseView'

function commit(n: number): Commit {
  const sha = String(n).repeat(40).slice(0, 40)
  return {
    sha,
    shortSha: sha.slice(0, 7),
    parents: ['f'.repeat(40)],
    authorName: 'Grace Hopper',
    authorEmail: 'grace@example.com',
    authorDate: 1_700_000_000 + n,
    committerName: 'Grace Hopper',
    committerEmail: 'grace@example.com',
    committerDate: 1_700_000_000 + n,
    subject: `commit number ${n}`,
    body: ''
  }
}

function makeTab(status?: Partial<WorkingStatus>): RepoTab {
  return {
    path: '/repo',
    name: 'repo',
    info: {
      path: '/repo',
      name: 'repo',
      gitDir: '/repo/.git',
      isBare: false,
      head: { sha: 'a'.repeat(40), branch: 'feature/x', detached: false, unborn: false },
      state: 'none',
      remotes: []
    },
    refs: null,
    commits: [commit(9)],
    hasMore: false,
    status: { staged: [], unstaged: [], conflicted: [], branch: 'feature/x', upstream: null, ahead: 0, behind: 0, ...status },
    loading: { log: false, refs: false, status: false, more: false },
    error: null,
    selection: { kind: 'none' },
    multiSelect: [],
    center: { kind: 'rebase', base: '9'.repeat(40) },
    search: { open: false, query: '', mode: 'message', results: [], index: 0, loading: false },
    hiddenRefs: [],
    soloRef: null,
    undoStack: [],
    redoStack: [],
    draft: { summary: '', description: '', amend: false },
    lastFetch: null
  }
}

describe('RebaseView', () => {
  it('renders the header with branch and base subject', () => {
    const html = renderToString(<RebaseView tab={makeTab()} base={'9'.repeat(40)} />)
    expect(html).toContain('Interactive Rebase:')
    expect(html).toContain('feature/x')
    expect(html).toContain('9999999')
    expect(html).toContain('commit number 9')
  })

  it('says "from root" for ROOT', () => {
    const html = renderToString(<RebaseView tab={makeTab()} base="ROOT" />)
    expect(html).toContain('from root')
  })
})

describe('RebaseEditor', () => {
  const commits = [commit(1), commit(2), commit(3)] // oldest first

  it('lists commits newest first with actions and a summary', () => {
    const html = renderToString(<RebaseEditor tab={makeTab()} base="ROOT" commits={commits} />)
    const i3 = html.indexOf('commit number 3')
    const i1 = html.indexOf('commit number 1')
    expect(i3).toBeGreaterThan(-1)
    expect(i1).toBeGreaterThan(i3)
    expect(html).toContain('3 commits: 3 pick')
    expect(html).toContain('Start Rebase')
    expect(html).toContain('Pick')
    expect(html).toContain('Grace Hopper')
  })

  it('blocks starting with uncommitted changes', () => {
    const html = renderToString(
      <RebaseEditor tab={makeTab({ unstaged: [{ path: 'x', status: 'modified' }] })} base="ROOT" commits={commits} />
    )
    expect(html).toContain('You have uncommitted changes')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Commit or stash your changes/)
  })
})

describe('merge commits in the range (they would be flattened)', () => {
  const commits = [commit(1), commit(2)]

  it('shows a prominent warning when the range contains merges', () => {
    const html = renderToString(<RebaseEditor tab={makeTab()} base="ROOT" commits={commits} mergeCount={2} />)
    expect(html).toContain('Merge commits will be flattened.')
    expect(html).toContain('This range contains 2 merge commits')
    expect(html).toContain('role="alert"')
    expect(renderToString(<RebaseEditor tab={makeTab()} base="ROOT" commits={commits} />)).not.toContain('flattened')
  })

  it('starts without asking (and without flattenMerges) when there are no merges', async () => {
    dialogs.confirm.mockClear()
    expect(await confirmRebaseOptions(0)).toEqual({})
    expect(dialogs.confirm).not.toHaveBeenCalled()
  })

  it('asks with a danger confirm and only then passes flattenMerges: true', async () => {
    dialogs.confirm.mockClear()
    dialogs.confirm.mockResolvedValueOnce(false)
    expect(await confirmRebaseOptions(1)).toBeNull()
    expect(dialogs.confirm.mock.calls[0][0]).toMatchObject({ title: 'Flatten 1 merge commit?', danger: true })

    dialogs.confirm.mockResolvedValueOnce(true)
    expect(await confirmRebaseOptions(3)).toEqual({ flattenMerges: true })
    expect(dialogs.confirm.mock.calls[1][0].title).toBe('Flatten 3 merge commits?')
  })
})
