import { describe, expect, it } from 'vitest'
import type { BlameLine, DiffTarget } from '@shared/types'
import { followLogArgs, groupBlame, heatScale, isUncommittedSha, parseFollowLog } from './history'
import { blameRev, contentSources, describeTarget, formatBytes, imageMime, modeChangeText, sameTarget, shortRev } from './targets'

describe('parseFollowLog', () => {
  it('maps commits to the file path and status, following renames', () => {
    const sha1 = 'a'.repeat(40)
    const sha2 = 'b'.repeat(40)
    const sha3 = 'c'.repeat(40)
    const sha4 = 'd'.repeat(40)
    const out = [
      '\x01' + sha1,
      '',
      'M\tsrc/new name.ts',
      '\x01' + sha2,
      '',
      'R087\tsrc/old.ts\tsrc/new name.ts',
      '\x01' + sha3,
      '',
      'A\tsrc/old.ts',
      '\x01' + sha4,
      ''
    ].join('\n')
    const map = parseFollowLog(out)
    expect(map.get(sha1)).toEqual({ status: 'modified', path: 'src/new name.ts' })
    expect(map.get(sha2)).toEqual({ status: 'renamed', oldPath: 'src/old.ts', path: 'src/new name.ts' })
    expect(map.get(sha3)).toEqual({ status: 'added', path: 'src/old.ts' })
    expect(map.has(sha4)).toBe(false) // merge commit without name-status
  })

  it('builds the git arguments', () => {
    expect(followLogArgs('a b.txt', 10)).toEqual([
      'log',
      '--follow',
      '-M',
      '--name-status',
      '--format=%x01%H',
      '--max-count=10',
      '--',
      'a b.txt'
    ])
  })
})

const bl = (lineNo: number, sha: string, authorDate: number): BlameLine => ({
  lineNo,
  content: `line ${lineNo}`,
  sha,
  authorName: 'A',
  authorEmail: 'a@x',
  authorDate,
  summary: 's',
  origLineNo: lineNo
})

describe('blame helpers', () => {
  const zero = '0'.repeat(40)
  const lines = [bl(1, 'aaa', 100), bl(2, 'aaa', 100), bl(3, 'bbb', 300), bl(4, zero, 999), bl(5, 'aaa', 100), bl(6, 'ccc', 200)]

  it('groups consecutive lines of the same commit', () => {
    const { groups, groupOf } = groupBlame(lines)
    expect(groups.map((g) => [g.start, g.end, g.line.sha])).toEqual([
      [0, 2, 'aaa'],
      [2, 3, 'bbb'],
      [3, 4, zero],
      [4, 5, 'aaa'],
      [5, 6, 'ccc']
    ])
    expect([...groupOf]).toEqual([0, 0, 1, 2, 3, 4])
  })

  it('ranks ages for the heat stripe, ignoring uncommitted lines', () => {
    const heat = heatScale(lines)
    expect(heat(100)).toBe(0)
    expect(heat(200)).toBe(0.5)
    expect(heat(300)).toBe(1)
    expect(heat(250)).toBe(1)
    expect(heatScale([bl(1, 'a', 5)])(5)).toBe(1)
    expect(isUncommittedSha(zero)).toBe(true)
    expect(isUncommittedSha('a0')).toBe(false)
  })
})

describe('target helpers', () => {
  const commit: DiffTarget = { kind: 'commit', sha: '0123456789abcdef0123456789abcdef01234567', path: 'img/a.png' }

  it('describes targets', () => {
    expect(describeTarget({ kind: 'unstaged', path: 'x' })).toBe('Unstaged changes')
    expect(describeTarget({ kind: 'staged', path: 'x' })).toBe('Staged changes')
    expect(describeTarget(commit)).toBe('commit 0123456')
    expect(describeTarget({ kind: 'compare', from: 'main', to: 'abcdef0123456789', path: 'x' })).toBe('main ↔ abcdef0')
    expect(describeTarget({ kind: 'stash', index: 2, path: 'x' })).toBe('stash@{2}')
    expect(shortRev('feature/x')).toBe('feature/x')
  })

  it('compares targets', () => {
    expect(sameTarget(commit, { ...commit })).toBe(true)
    expect(sameTarget(commit, { ...commit, sha: 'f'.repeat(40) })).toBe(false)
    expect(sameTarget({ kind: 'unstaged', path: 'a' }, { kind: 'staged', path: 'a' })).toBe(false)
    expect(sameTarget({ kind: 'stash', index: 1, path: 'a' }, { kind: 'stash', index: 1, path: 'a' })).toBe(true)
  })

  it('resolves content sources per target', () => {
    expect(contentSources({ kind: 'unstaged', path: 'a.png' }, { status: 'modified' })).toEqual({
      old: { path: 'a.png', rev: 'INDEX' },
      new: { path: 'a.png', rev: 'WORKTREE', fallbackRev: undefined }
    })
    expect(contentSources({ kind: 'staged', path: 'a.png' }, { status: 'added' }).old).toBeNull()
    expect(contentSources(commit, { status: 'renamed', oldPath: 'img/old.png' })).toEqual({
      old: { path: 'img/old.png', rev: `${commit.sha}^` },
      new: { path: 'img/a.png', rev: commit.sha, fallbackRev: undefined }
    })
    expect(contentSources(commit, { status: 'deleted' }).new).toBeNull()
    expect(contentSources({ kind: 'stash', index: 0, path: 'n.png' }, { status: 'untracked' }).new).toEqual({
      path: 'n.png',
      rev: 'stash@{0}',
      fallbackRev: 'stash@{0}^3'
    })
  })

  it('blame revisions, mime types, sizes and mode changes', () => {
    expect(blameRev(commit)).toBe(commit.sha)
    expect(blameRev({ kind: 'unstaged', path: 'a' })).toBeUndefined()
    expect(blameRev({ kind: 'compare', from: 'a', to: 'b', path: 'x' })).toBe('b')
    expect(imageMime('x/Y.JPG')).toBe('image/jpeg')
    expect(imageMime('x.svg')).toBe('image/svg+xml')
    expect(formatBytes(812)).toBe('812 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(modeChangeText({ oldMode: '100644', newMode: '100755' })).toBe('File mode changed from 100644 to 100755')
    expect(modeChangeText({ oldMode: '100644', newMode: '100644' })).toBeNull()
  })
})
