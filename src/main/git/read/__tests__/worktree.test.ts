// Integration tests for status, diffs (every target kind), file content and stash details.
import { PNG_1X1, cleanupTempDirs, commitAll, git, gitMayFail, initTestRepo, isolateGitConfig, makeBackend, write } from './helpers'

isolateGitConfig()

import { symlinkSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Backend } from '../../../backend'

let backend: Backend

beforeAll(() => {
  backend = makeBackend().backend
})

afterAll(async () => {
  await backend.dispose()
  cleanupTempDirs()
})

describe('getStatus', () => {
  it('reports staged, unstaged, untracked and renamed files', async () => {
    const repo = initTestRepo()
    write(repo, 'keep.txt', 'k\n')
    write(repo, 'old name.txt', 'rename me\n')
    write(repo, 'mod.txt', 'm\n')
    write(repo, 'del.txt', 'd\n')
    commitAll(repo, 'base')
    git(repo, ['mv', 'old name.txt', 'new name.txt'])
    write(repo, 'mod.txt', 'm2\n')
    git(repo, ['add', 'mod.txt'])
    write(repo, 'mod.txt', 'm3\n')
    write(repo, 'keep.txt', 'k2\n')
    write(repo, 'dir/untracked file.txt', 'u\n')
    git(repo, ['rm', '-q', 'del.txt'])

    const st = await backend.getStatus(repo)
    expect(st.branch).toBe('main')
    expect(st.upstream).toBeNull()
    expect(st.staged).toEqual([
      { path: 'del.txt', status: 'deleted' },
      { path: 'mod.txt', status: 'modified' },
      { path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed' }
    ])
    expect(st.unstaged).toEqual([
      { path: 'keep.txt', status: 'modified' },
      { path: 'mod.txt', status: 'modified' },
      { path: 'dir/untracked file.txt', status: 'untracked' }
    ])
    expect(st.conflicted).toEqual([])
  })

  it('reports conflicts only in conflicted[] and the merge state', async () => {
    const repo = initTestRepo()
    write(repo, 'c.txt', 'base\n')
    commitAll(repo, 'base')
    git(repo, ['checkout', '-q', '-b', 'other'])
    write(repo, 'c.txt', 'theirs\n')
    commitAll(repo, 'theirs')
    git(repo, ['checkout', '-q', 'main'])
    write(repo, 'c.txt', 'ours\n')
    commitAll(repo, 'ours')
    gitMayFail(repo, ['merge', 'other'])

    const st = await backend.getStatus(repo)
    expect(st.conflicted).toEqual([{ path: 'c.txt', kind: 'both-modified' }])
    expect(st.staged.map((f) => f.path)).not.toContain('c.txt')
    expect(st.unstaged.map((f) => f.path)).not.toContain('c.txt')
    const info = await backend.getRepoInfo(repo)
    expect(info.state).toBe('merge')

    const d = await backend.getDiff(repo, { kind: 'unstaged', path: 'c.txt' })
    expect(d.status).toBe('conflicted')
    expect(d.hunks.length).toBeGreaterThan(0)
    expect(d.hunks[0].lines.some((l) => l.content.startsWith('<<<<<<<'))).toBe(true)
  })

  it('works on an unborn branch and reports ahead/behind', async () => {
    const repo = initTestRepo()
    write(repo, 'a.txt', 'a\n')
    git(repo, ['add', 'a.txt'])
    const st = await backend.getStatus(repo)
    expect(st.branch).toBe('main')
    expect(st.staged).toEqual([{ path: 'a.txt', status: 'added' }])

    commitAll(repo, 'first')
    git(repo, ['branch', 'up'])
    git(repo, ['branch', '--set-upstream-to=up'])
    commitAll(repo, 'second')
    const st2 = await backend.getStatus(repo)
    expect(st2.upstream).toBe('up')
    expect(st2.ahead).toBe(1)
    expect(st2.behind).toBe(0)
  })
})

describe('getDiff', () => {
  let repo: string
  let root: string
  let second: string

  beforeAll(() => {
    repo = initTestRepo()
    write(repo, 'a.txt', 'one\ntwo\nthree\n')
    write(repo, 'ws.txt', 'alpha beta\n')
    write(repo, 'img.png', PNG_1X1)
    write(repo, 'tail.txt', 'no newline')
    write(repo, 'move me.txt', 'content that is long enough to be detected as a rename\nline 2\nline 3\n')
    root = commitAll(repo, 'root')
    write(repo, 'a.txt', 'one\nTWO\nthree\nfour\n')
    write(repo, 'tail.txt', 'no newline, changed')
    second = commitAll(repo, 'second')
  }, 120_000)

  it('diffs unstaged changes', async () => {
    write(repo, 'a.txt', 'one\nTWO\nthree\nfour\nfive\n')
    const d = await backend.getDiff(repo, { kind: 'unstaged', path: 'a.txt' })
    expect(d).toMatchObject({ path: 'a.txt', status: 'modified', binary: false, isImage: false, additions: 1, deletions: 0 })
    expect(d.hunks).toHaveLength(1)
    const added = d.hunks[0].lines.filter((l) => l.type === 'add')
    expect(added).toEqual([{ type: 'add', content: 'five', oldLine: null, newLine: 5 }])
    const ctx0 = await backend.getDiff(repo, { kind: 'unstaged', path: 'a.txt' }, { context: 0 })
    expect(ctx0.hunks[0].lines).toHaveLength(1)
    git(repo, ['checkout', '--', 'a.txt'])
    const none = await backend.getDiff(repo, { kind: 'unstaged', path: 'a.txt' })
    expect(none).toMatchObject({ path: 'a.txt', hunks: [], additions: 0, deletions: 0 })
  })

  it('diffs untracked files as all-added', async () => {
    write(repo, 'new dir/fresh.txt', 'x\ny\n')
    const d = await backend.getDiff(repo, { kind: 'unstaged', path: 'new dir/fresh.txt' })
    expect(d).toMatchObject({ path: 'new dir/fresh.txt', status: 'untracked', additions: 2, deletions: 0 })
    expect(d.hunks[0].lines.map((l) => [l.type, l.content])).toEqual([
      ['add', 'x'],
      ['add', 'y']
    ])
    write(repo, 'empty.txt', '')
    const e = await backend.getDiff(repo, { kind: 'unstaged', path: 'empty.txt' })
    expect(e).toMatchObject({ path: 'empty.txt', status: 'untracked', hunks: [] })
  })

  it('diffs staged changes, including renames', async () => {
    write(repo, 'ws.txt', 'alpha   beta\n')
    git(repo, ['add', 'ws.txt'])
    const d = await backend.getDiff(repo, { kind: 'staged', path: 'ws.txt' })
    expect(d).toMatchObject({ status: 'modified', additions: 1, deletions: 1 })
    const w = await backend.getDiff(repo, { kind: 'staged', path: 'ws.txt' }, { ignoreWhitespace: true })
    expect(w.hunks).toEqual([])

    git(repo, ['mv', 'move me.txt', 'moved.txt'])
    const r = await backend.getDiff(repo, { kind: 'staged', path: 'moved.txt' })
    expect(r).toMatchObject({ path: 'moved.txt', oldPath: 'move me.txt', status: 'renamed' })
    git(repo, ['reset', '-q', '--hard'])
  })

  it('diffs commits (root via diff-tree, others vs first parent)', async () => {
    const r = await backend.getDiff(repo, { kind: 'commit', sha: root, path: 'a.txt' })
    expect(r).toMatchObject({ path: 'a.txt', status: 'added', additions: 3, deletions: 0 })
    const s = await backend.getDiff(repo, { kind: 'commit', sha: second, path: 'a.txt' })
    expect(s).toMatchObject({ status: 'modified', additions: 2, deletions: 1 })
    const t = await backend.getDiff(repo, { kind: 'commit', sha: second, path: 'tail.txt' })
    const lines = t.hunks[0].lines
    expect(lines.find((l) => l.type === 'del')).toMatchObject({ content: 'no newline', noNewline: true })
    expect(lines.find((l) => l.type === 'add')).toMatchObject({ content: 'no newline, changed', noNewline: true })
    const img = await backend.getDiff(repo, { kind: 'commit', sha: root, path: 'img.png' })
    expect(img).toMatchObject({ binary: true, isImage: true, status: 'added', hunks: [] })
    await expect(backend.getDiff(repo, { kind: 'commit', sha: 'f'.repeat(40), path: 'a.txt' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('diffs commit renames when oldPath is given', async () => {
    git(repo, ['mv', 'move me.txt', 'renamed.txt'])
    const sha = commitAll(repo, 'rename')
    const d = await backend.getDiff(repo, { kind: 'commit', sha, path: 'renamed.txt', oldPath: 'move me.txt' })
    expect(d).toMatchObject({ path: 'renamed.txt', oldPath: 'move me.txt', status: 'renamed', hunks: [] })
  })

  it('diffs merge commits against their first parent', async () => {
    git(repo, ['checkout', '-q', '-b', 'side-diff'])
    write(repo, 'side.txt', 'side 1\nside 2\n')
    commitAll(repo, 'side')
    git(repo, ['checkout', '-q', 'main'])
    write(repo, 'main-only.txt', 'main\n')
    commitAll(repo, 'main only')
    git(repo, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side-diff'])
    const merge = git(repo, ['rev-parse', 'HEAD']).trim()
    const d = await backend.getDiff(repo, { kind: 'commit', sha: merge, path: 'side.txt' })
    expect(d).toMatchObject({ path: 'side.txt', status: 'added', additions: 2, deletions: 0 })
    // A file that only changed on the first-parent side is not part of the merge's diff.
    const none = await backend.getDiff(repo, { kind: 'commit', sha: merge, path: 'main-only.txt' })
    expect(none.hunks).toEqual([])
    await expect(backend.getDiff(repo, { kind: 'commit', sha: '--output=/tmp/x', path: 'a.txt' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('diffs arbitrary revisions', async () => {
    const d = await backend.getDiff(repo, { kind: 'compare', from: root, to: second, path: 'a.txt' })
    expect(d).toMatchObject({ status: 'modified', additions: 2, deletions: 1 })
  })

  it('diffs mode-only changes', async () => {
    git(repo, ['update-index', '--chmod=+x', 'ws.txt'])
    const d = await backend.getDiff(repo, { kind: 'staged', path: 'ws.txt' })
    expect(d).toMatchObject({ oldMode: '100644', newMode: '100755', hunks: [], additions: 0, deletions: 0 })
    git(repo, ['update-index', '--chmod=-x', 'ws.txt'])
  })

  it('diffs stashes, including untracked files from the third parent', async () => {
    write(repo, 'a.txt', 'stashed change\n')
    write(repo, 'stash-new.txt', 'brand new\n')
    git(repo, ['stash', 'push', '-q', '-u', '-m', 'with untracked'])
    const tracked = await backend.getDiff(repo, { kind: 'stash', index: 0, path: 'a.txt' })
    expect(tracked).toMatchObject({ path: 'a.txt', status: 'modified', additions: 1 })
    const untracked = await backend.getDiff(repo, { kind: 'stash', index: 0, path: 'stash-new.txt' })
    expect(untracked).toMatchObject({ path: 'stash-new.txt', status: 'untracked', additions: 1, deletions: 0 })
    expect(untracked.hunks[0].lines[0]).toMatchObject({ type: 'add', content: 'brand new' })

    const details = await backend.getStashDetails(repo, 0)
    expect(details.files).toEqual([
      { path: 'a.txt', status: 'modified', additions: 1, deletions: 4 },
      { path: 'stash-new.txt', status: 'untracked', additions: 1, deletions: 0 }
    ])
    expect(details.additions).toBe(2)
    expect(details.commit.parents).toHaveLength(3)
    await expect(backend.getStashDetails(repo, 5)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(backend.getDiff(repo, { kind: 'stash', index: 9, path: 'a.txt' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    git(repo, ['stash', 'drop', '-q'])
  })

  it('keeps CR out of content for CRLF files', async () => {
    write(repo, 'crlf.txt', 'a\r\nb\r\n')
    const d = await backend.getDiff(repo, { kind: 'unstaged', path: 'crlf.txt' })
    expect(d.hunks[0].lines.map((l) => l.content)).toEqual(['a', 'b'])
    expect(d.hunks[0].lines.every((l) => (l as { crlf?: boolean }).crlf === true)).toBe(true)
  })

  it('marks huge diffs as tooLarge without hunks', async () => {
    const big = Array.from({ length: 25_000 }, (_, i) => `line ${i}`).join('\n') + '\n'
    write(repo, 'big.txt', big)
    const d = await backend.getDiff(repo, { kind: 'unstaged', path: 'big.txt' })
    expect(d.tooLarge).toBe(true)
    expect(d.hunks).toEqual([])
    expect(d.additions).toBe(25_000)
  })

  it('validates targets', async () => {
    await expect(backend.getDiff(repo, { kind: 'unstaged', path: '../outside.txt' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.getDiff(repo, { kind: 'compare', from: '--output=x', to: 'HEAD', path: 'a.txt' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
  })

  it('works for staged files on an unborn branch', async () => {
    const empty = initTestRepo()
    write(empty, 'first.txt', 'hello\n')
    git(empty, ['add', 'first.txt'])
    const d = await backend.getDiff(empty, { kind: 'staged', path: 'first.txt' })
    expect(d).toMatchObject({ path: 'first.txt', status: 'added', additions: 1 })
  })
})

describe('getFileContent', () => {
  let repo: string

  beforeAll(() => {
    repo = initTestRepo()
    write(repo, 'f.txt', 'v1\n')
    write(repo, 'img.png', PNG_1X1)
    commitAll(repo, 'v1')
    write(repo, 'f.txt', 'v2\n')
    commitAll(repo, 'v2')
    write(repo, 'f.txt', 'staged\n')
    git(repo, ['add', 'f.txt'])
    write(repo, 'f.txt', 'worktree\n')
  }, 60_000)

  it('reads HEAD, older revisions, the index and the worktree', async () => {
    expect(await backend.getFileContent(repo, 'f.txt', 'HEAD')).toEqual({ path: 'f.txt', rev: 'HEAD', exists: true, binary: false, text: 'v2\n', size: 3 })
    expect((await backend.getFileContent(repo, 'f.txt', 'HEAD~1')).text).toBe('v1\n')
    expect((await backend.getFileContent(repo, 'f.txt', 'INDEX')).text).toBe('staged\n')
    expect((await backend.getFileContent(repo, 'f.txt', 'WORKTREE')).text).toBe('worktree\n')
  })

  it('returns base64 for binary files', async () => {
    const head = await backend.getFileContent(repo, 'img.png', 'HEAD')
    expect(head).toMatchObject({ exists: true, binary: true, size: PNG_1X1.length })
    expect(Buffer.from(head.base64!, 'base64').equals(PNG_1X1)).toBe(true)
    const wt = await backend.getFileContent(repo, 'img.png', 'WORKTREE')
    expect(wt.base64).toBe(head.base64)
  })

  it('reports missing files and rejects traversal', async () => {
    expect(await backend.getFileContent(repo, 'nope.txt', 'HEAD')).toMatchObject({ exists: false })
    expect(await backend.getFileContent(repo, 'nope.txt', 'INDEX')).toMatchObject({ exists: false })
    expect(await backend.getFileContent(repo, 'nope.txt', 'WORKTREE')).toMatchObject({ exists: false })
    expect(await backend.getFileContent(repo, 'f.txt', 'HEAD~10')).toMatchObject({ exists: false })
    await expect(backend.getFileContent(repo, '../../etc/passwd', 'WORKTREE')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.getFileContent(repo, '/etc/passwd', 'WORKTREE')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('never follows worktree symlinks', async () => {
    symlinkSync('/etc/hosts', `${repo}/link-out`)
    const c = await backend.getFileContent(repo, 'link-out', 'WORKTREE')
    expect(c).toMatchObject({ exists: true, binary: false, text: '/etc/hosts' })
  })
})

describe('partial patches of CRLF files (shared/patch.ts → applyPatch)', () => {
  it('stages, unstages and discards single lines byte-exactly', async () => {
    const { buildPartialPatch, patchApplyOptions } = await import('@shared/patch')
    const repo = initTestRepo()
    write(repo, 'crlf.txt', 'l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\r\n')
    commitAll(repo, 'crlf file')
    write(repo, 'crlf.txt', 'l1\r\nL2 changed\r\nl3\r\nl4\r\nL5 changed\r\nl6\r\n')

    const unstaged = await backend.getDiff(repo, { kind: 'unstaged', path: 'crlf.txt' })
    const lines = unstaged.hunks[0].lines
    expect(lines.every((l) => l.crlf === true && !l.content.includes('\r'))).toBe(true)
    const firstPair = [lines.findIndex((l) => l.content === 'l2'), lines.findIndex((l) => l.content === 'L2 changed')]
    const stage = buildPartialPatch(unstaged, [{ hunkIndex: 0, lineIndexes: firstPair }], 'stage')
    expect(stage).toContain('L2 changed\r\n')
    await backend.applyPatch(repo, stage!, patchApplyOptions('stage'))
    expect(git(repo, ['show', ':crlf.txt'])).toBe('l1\r\nL2 changed\r\nl3\r\nl4\r\nl5\r\nl6\r\n')

    // Unstage it again from the staged diff.
    const staged = await backend.getDiff(repo, { kind: 'staged', path: 'crlf.txt' })
    expect(staged.hunks.flatMap((h) => h.lines).every((l) => l.crlf)).toBe(true)
    const unstage = buildPartialPatch(staged, [{ hunkIndex: 0 }], 'unstage')
    await backend.applyPatch(repo, unstage!, patchApplyOptions('unstage'))
    expect(git(repo, ['show', ':crlf.txt'])).toBe('l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\r\n')

    // Discard only the second change in the working tree.
    const again = await backend.getDiff(repo, { kind: 'unstaged', path: 'crlf.txt' })
    const l = again.hunks[0].lines
    const secondPair = [l.findIndex((x) => x.content === 'l5'), l.findIndex((x) => x.content === 'L5 changed')]
    const discard = buildPartialPatch(again, [{ hunkIndex: 0, lineIndexes: secondPair }], 'discard')
    await backend.applyPatch(repo, discard!, patchApplyOptions('discard'))
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(`${repo}/crlf.txt`, 'utf8')).toBe('l1\r\nL2 changed\r\nl3\r\nl4\r\nl5\r\nl6\r\n')
  })
})

describe('read-only calls never rewrite .git/index', () => {
  it('keeps the index untouched for status, diffs and refs even with stale stat info', async () => {
    const { statSync, utimesSync } = await import('node:fs')
    const repo = initTestRepo()
    write(repo, 'a.txt', 'a\n')
    write(repo, 'b.txt', 'b\n')
    commitAll(repo, 'init')
    write(repo, 'a.txt', 'a changed\n')
    write(repo, 'new.txt', 'new\n')
    // Stale stat info for b.txt: porcelain `git diff` / `git status` would refresh and rewrite the index.
    const future = new Date(Date.now() + 5000)
    utimesSync(`${repo}/b.txt`, future, future)
    const index = `${repo}/.git/index`
    const before = statSync(index)
    await backend.getStatus(repo)
    await backend.getDiff(repo, { kind: 'unstaged', path: 'a.txt' })
    await backend.getDiff(repo, { kind: 'unstaged', path: 'b.txt' })
    await backend.getDiff(repo, { kind: 'unstaged', path: 'new.txt' })
    await backend.getDiff(repo, { kind: 'staged', path: 'a.txt' })
    await backend.getRefs(repo)
    await backend.getLog(repo)
    const after = statSync(index)
    expect([after.mtimeMs, after.ino, after.size]).toEqual([before.mtimeMs, before.ino, before.size])
    const d = await backend.getDiff(repo, { kind: 'unstaged', path: 'b.txt' })
    expect(d.hunks).toEqual([])
  })
})
