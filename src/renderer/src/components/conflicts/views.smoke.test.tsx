// Server-side render smoke tests: make sure the conflict UI renders the
// expected structure without throwing (no DOM library is available, so effects
// and interactions are not exercised here).

import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RepoTab } from '@renderer/store/appStore'
import type { Commit, ConflictVersions, RepoOperationState, WorkingStatus } from '@shared/types'
import { ConflictChooser } from './ConflictChooser'
import { ConflictView, MergeEditor, saveResolution } from './ConflictView'
import { hasConflictMarkers, parseConflicts } from './conflictParser'
import { OperationBanner } from './OperationBanner'

function makeTab(state: RepoOperationState, conflicted: WorkingStatus['conflicted']): RepoTab {
  return {
    path: '/repo',
    name: 'repo',
    info: {
      path: '/repo',
      name: 'repo',
      gitDir: '/repo/.git',
      isBare: false,
      head: { sha: 'a'.repeat(40), branch: 'main', detached: false, unborn: false },
      state,
      remotes: []
    },
    refs: null,
    commits: [],
    hasMore: false,
    status: { staged: [], unstaged: [], conflicted, branch: 'main', upstream: null, ahead: 0, behind: 0 },
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
    lastFetch: null
  }
}

const COMMIT: Commit = {
  sha: 'b'.repeat(40),
  shortSha: 'bbbbbbb',
  parents: [],
  authorName: 'Ana',
  authorEmail: 'ana@example.com',
  authorDate: 1_700_000_000,
  committerName: 'Ana',
  committerEmail: 'ana@example.com',
  committerDate: 1_700_000_000,
  subject: 'subject',
  body: ''
}

const TWO = [
  { path: 'src/a.ts', kind: 'both-modified' as const },
  { path: 'b.txt', kind: 'deleted-by-them' as const }
]

describe('OperationBanner', () => {
  it('renders nothing without an operation', () => {
    expect(renderToString(<OperationBanner tab={makeTab('none', [])} />)).toBe('')
  })

  it('shows the merge state, conflict count and a disabled "Commit merge"', () => {
    const html = renderToString(<OperationBanner tab={makeTab('merge', TWO)} />)
    expect(html).toContain('Merge in progress')
    expect(html).toContain('2 conflicted files')
    expect(html).toContain('Resolve')
    expect(html).toContain('Commit merge')
    expect(html).not.toContain('Skip')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Resolve all conflicts/)
  })

  it('offers Skip for rebases and shows where a clean rebase stopped (edit step)', () => {
    const tab = makeTab('rebase-interactive', [])
    tab.commits = [{ ...COMMIT, sha: 'a'.repeat(40), subject: 'Amend me' }]
    const html = renderToString(<OperationBanner tab={tab} />)
    expect(html).toContain('Interactive rebase in progress')
    expect(html).toContain('Stopped at')
    expect(html).toContain('aaaaaaa')
    expect(html).toContain('Amend me')
    expect(html).toContain('Skip')
    expect(html).toContain('Continue')
    expect(html).not.toContain('All conflicts resolved')
  })

  it('reports a rebase whose conflicts were resolved as ready to continue', () => {
    const tab = makeTab('rebase', [])
    tab.status!.staged = [{ path: 'a.txt', status: 'modified' }]
    const html = renderToString(<OperationBanner tab={tab} />)
    expect(html).toContain('>Rebase in progress<')
    expect(html).not.toContain('Interactive rebase')
    expect(html).toContain('Ready to continue')
    expect(html).not.toContain('Stopped at')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*title="Continue the rebase"/)
  })

  it('reports resolved merge conflicts and hides Resolve while the tool shows a conflicted file', () => {
    expect(renderToString(<OperationBanner tab={makeTab('merge', [])} />)).toContain('All conflicts resolved')
    const tab = makeTab('cherry-pick', TWO)
    tab.center = { kind: 'conflict', path: 'src/a.ts' }
    const html = renderToString(<OperationBanner tab={tab} />)
    expect(html).toContain('Cherry-pick in progress')
    expect(html).toContain('2 conflicted files')
    expect(html).not.toContain('>Resolve<')
  })

  it('has no Continue/Skip for bisect', () => {
    const html = renderToString(<OperationBanner tab={makeTab('bisect', [])} />)
    expect(html).toContain('Bisect in progress')
    expect(html).not.toContain('Continue')
    expect(html).toContain('Abort')
  })
})

describe('ConflictView', () => {
  it('renders the header and a loading state before versions arrive', () => {
    const html = renderToString(<ConflictView tab={makeTab('merge', TWO)} path="src/a.ts" />)
    expect(html).toContain('a.ts')
    expect(html).toContain('Conflicted file 1 of 2')
    expect(html).toContain('Both modified')
    expect(html).toContain('ui-spinner')
  })
})

describe('MergeEditor', () => {
  const merged = ['top', '<<<<<<< HEAD', 'mine', '=======', 'theirs', '>>>>>>> feature', 'mid', '<<<<<<< HEAD', '=======', 'added', '>>>>>>> feature', ''].join('\n')
  const versions: ConflictVersions = {
    path: 'src/a.ts',
    kind: 'both-modified',
    base: 'top\nbase\nmid\n',
    ours: 'top\nmine\nmid\n',
    theirs: 'top\ntheirs\nmid\nadded\n',
    merged,
    oursLabel: 'main',
    theirsLabel: 'feature',
    binary: false
  }

  it('renders panes, chunk navigation and the generated output', () => {
    const html = renderToString(
      <MergeEditor
        repo="/repo"
        path="src/a.ts"
        versions={versions}
        segments={parseConflicts(merged)}
        oursLabel="main"
        theirsLabel="feature"
        resolving={false}
      />
    )
    expect(html).toContain('Take all from A')
    expect(html).toContain('Take all from B')
    expect(html).toContain('Conflict <!-- -->1<!-- --> of <!-- -->2')
    expect(html).toContain('0<!-- --> of <!-- -->2<!-- --> resolved')
    expect(html).toMatch(/Use A<span class="cf-wide-only"> entirely<\/span>/)
    expect(html).toContain('Save and mark resolved')
    // Unresolved chunks are shown with their markers in the output.
    expect(html).toContain('&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD')
    expect(html).toContain('2 unresolved conflicts')
  })

  it('explains when the working copy has no markers', () => {
    const html = renderToString(
      <MergeEditor
        repo="/repo"
        path="src/a.ts"
        versions={{ ...versions, merged: 'clean\n' }}
        segments={parseConflicts('clean\n')}
        oursLabel="main"
        theirsLabel="feature"
        resolving={false}
      />
    )
    expect(html).toContain('No conflict markers found')
    expect(html).not.toContain('Take all from A')
  })
})

describe('saveResolution (what "Save and mark resolved" sends)', () => {
  const crlfMerged = ['top', '<<<<<<< HEAD', 'mine', '=======', 'theirs', '>>>>>>> feature', 'end', ''].join('\r\n')
  const crlf = { merged: crlfMerged, ours: 'top\r\nmine\r\nend\r\n' }

  it('restores CRLF on hand-edited output of a CRLF file (a textarea value is LF-only)', () => {
    const typed = 'top\nmine and theirs\nend\n'
    const r = saveResolution(typed, true, crlf, '\r\n')
    expect(r.content).toBe('top\r\nmine and theirs\r\nend\r\n')
    expect(hasConflictMarkers(r.content)).toBe(false)
  })

  it('sends generated output unchanged (it already uses the file endings)', () => {
    const generated = 'top\r\nmine\r\nend\r\n'
    expect(saveResolution(generated, false, crlf, '\r\n').content).toBe(generated)
  })

  it('carries the working-tree text it was built from as `expected` (null when the file was missing)', () => {
    expect(saveResolution('x\n', false, crlf, '\r\n').expected).toBe(crlfMerged)
    expect(saveResolution('x\n', true, { merged: null, ours: 'x\n' }, '\n')).toEqual({ kind: 'content', content: 'x\n', expected: null })
  })
})

describe('ConflictChooser', () => {
  const chooser = (patch: Partial<ConflictVersions>) =>
    renderToString(
      <ConflictChooser
        versions={{
          path: 'legacy.properties',
          kind: 'both-modified',
          base: '',
          ours: '',
          theirs: '',
          merged: '',
          oursLabel: 'main',
          theirsLabel: 'feature',
          binary: true,
          ...patch
        }}
        oursLabel="main"
        theirsLabel="feature"
        busy={false}
        onResolve={() => undefined}
      />
    )

  it('explains why a non-UTF-8 text file only offers whole-side choices', () => {
    const html = chooser({ nonUtf8: true })
    expect(html).toContain('not UTF-8 text')
    expect(html).toContain('Mark resolved as-is')
    expect(html).not.toContain('binary file')
    expect(html).toContain('Keep A&#x27;s version')
    expect(html).not.toContain('Restore common ancestor')
  })

  it('explains symbolic-link conflicts', () => {
    const html = chooser({ symlink: true })
    expect(html).toContain('symbolic link')
    expect(html).not.toContain('binary file')
  })

  it('still calls a plain binary file binary', () => {
    expect(chooser({})).toContain('This binary file cannot be merged line by line.')
  })

  it('explains a delete/modify conflict and disables the missing side', () => {
    const html = renderToString(
      <ConflictChooser
        versions={{
          path: 'b.txt',
          kind: 'deleted-by-them',
          base: 'x\n',
          ours: 'x\ny\n',
          theirs: null,
          merged: 'x\ny\n',
          oursLabel: 'main',
          theirsLabel: 'feature',
          binary: false
        }}
        oursLabel="main"
        theirsLabel="feature"
        busy={false}
        onResolve={() => undefined}
      />
    )
    expect(html).toContain('modified this file')
    expect(html).toContain('deleted this file')
    expect(html).toContain('Keep A&#x27;s version')
    expect(html).toContain('Delete file')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="feature does not have this file"/)
  })

  it('offers restoring the base when both sides deleted the file', () => {
    const html = renderToString(
      <ConflictChooser
        versions={{
          path: 'gone.txt',
          kind: 'both-deleted',
          base: 'old\n',
          ours: null,
          theirs: null,
          merged: null,
          oursLabel: 'main',
          theirsLabel: 'feature',
          binary: false
        }}
        oursLabel="main"
        theirsLabel="feature"
        busy={false}
        onResolve={() => undefined}
      />
    )
    expect(html).toContain('Restore common ancestor')
    expect(html).toContain('Recommended')
  })
})
