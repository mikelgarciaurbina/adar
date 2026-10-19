import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTmp, commitFile, configure, exists, expectCode, git, head, initRepo, isolateGitConfig, makeOps, read, status, tmpDir, write } from './helpers'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

const WEIRD = ['with space.txt', 'ünïcödé-ñ.txt', 'star*.txt', 'q?[x].txt', '-dash.txt']

const staged = (dir: string) =>
  git(dir, ['diff', '--cached', '--name-only', '-z'])
    .split('\0')
    .filter(Boolean)
    .sort()

describe('staging', () => {
  it('stages and unstages specific files, including weird names, without globbing', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'base.txt', 'base\n', 'base')
    for (const f of WEIRD) write(dir, f, `${f}\n`)
    write(dir, 'starX.txt', 'must not match star*\n')

    await ops.stageFiles(dir, ['star*.txt'])
    expect(staged(dir)).toEqual(['star*.txt'])

    await ops.stageFiles(dir, WEIRD)
    expect(staged(dir)).toEqual([...WEIRD].sort())

    await ops.unstageFiles(dir, ['star*.txt', 'with space.txt'])
    expect(staged(dir)).toEqual(WEIRD.filter((f) => f !== 'star*.txt' && f !== 'with space.txt').sort())
    expect(exists(dir, 'star*.txt')).toBe(true)

    await ops.stageAll(dir)
    expect(staged(dir)).toContain('starX.txt')
    await ops.unstageAll(dir)
    expect(staged(dir)).toEqual([])
  })

  it('stages deletions and modifications', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    commitFile(dir, 'b.txt', 'b\n', 'b')
    fs.rmSync(path.join(dir, 'a.txt'))
    write(dir, 'b.txt', 'changed\n')
    await ops.stageFiles(dir, ['a.txt', 'b.txt'])
    expect(status(dir)).toBe('D  a.txt\nM  b.txt')
  })

  it('works on an unborn branch', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    write(dir, 'one.txt', '1\n')
    write(dir, 'two words.txt', '2\n')
    await ops.stageFiles(dir, ['one.txt', 'two words.txt'])
    expect(staged(dir)).toEqual(['one.txt', 'two words.txt'])
    await ops.unstageFiles(dir, ['two words.txt'])
    expect(staged(dir)).toEqual(['one.txt'])
    await ops.unstageAll(dir)
    expect(staged(dir)).toEqual([])
    expect(exists(dir, 'one.txt')).toBe(true)
  })

  it('keeps an in-progress merge when unstaging everything', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'base\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'g.txt', 'g\n', 'g')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'h.txt', 'h\n', 'h')
    git(dir, ['merge', '--no-commit', '--no-ff', 'other'])
    await ops.unstageAll(dir)
    expect(exists(dir, '.git/MERGE_HEAD')).toBe(true)
  })

  it('does not resolve conflicted files when unstaging everything', async () => {
    const { ops, ctx } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'base\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'f.txt', 'theirs\n', 'theirs')
    commitFile(dir, 'clean.txt', 'clean\n', 'clean')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'f.txt', 'ours\n', 'ours')
    await ops.merge(dir, 'other')
    expect(staged(dir)).toContain('clean.txt')
    await ops.unstageAll(dir)
    expect(await ctx.conflictedPaths(dir)).toEqual(['f.txt'])
    expect(status(dir)).toBe('UU f.txt\n?? clean.txt')
  })

  it('stageAll never stages unresolved conflicts (their markers would be committed as resolved)', async () => {
    const { ops, ctx } = makeOps()
    const dir = initRepo()
    const weird = '-dash [x]*.txt'
    commitFile(dir, 'f.txt', 'base\n', 'base')
    commitFile(dir, weird, 'base\n', 'weird base')
    commitFile(dir, 'g.txt', 'g\n', 'g')
    commitFile(dir, 'gone.txt', 'gone\n', 'gone')
    commitFile(dir, '.gitignore', '*.log\n', 'ignore')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'f.txt', 'theirs\n', 'theirs')
    commitFile(dir, weird, 'theirs\n', 'weird theirs')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'f.txt', 'ours\n', 'ours')
    commitFile(dir, weird, 'ours\n', 'weird ours')
    expect(() => git(dir, ['merge', 'other'])).toThrow()
    // Unrelated tweaks, including a name the weird conflicted path would match as a glob.
    write(dir, 'g.txt', 'g changed\n')
    write(dir, '-dash [x]-glob.txt', 'new\n')
    write(dir, 'new dir/a.txt', 'a\n')
    write(dir, 'new dir/sub/b.txt', 'b\n')
    write(dir, 'new dir/skip.log', 'ignored\n')
    fs.rmSync(path.join(dir, 'gone.txt'))

    await ops.stageAll(dir)
    expect((await ctx.conflictedPaths(dir)).sort()).toEqual([weird, 'f.txt'].sort())
    expect(read(dir, 'f.txt')).toContain('<<<<<<<')
    expect(status(dir).split('\n').sort()).toEqual(
      ['A  "-dash [x]-glob.txt"', 'A  "new dir/a.txt"', 'A  "new dir/sub/b.txt"', 'D  gone.txt', 'M  g.txt', 'UU "-dash [x]*.txt"', 'UU f.txt'].sort()
    )
    expect(exists(dir, '.git/MERGE_HEAD')).toBe(true)

    // Without conflicts it stages everything, as before.
    await ops.resolveConflict(dir, 'f.txt', { kind: 'ours' })
    await ops.resolveConflict(dir, weird, { kind: 'theirs' })
    write(dir, 'late.txt', 'late\n')
    await ops.stageAll(dir)
    expect(status(dir)).toContain('A  late.txt')
  })

  it('ignores empty path lists', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    write(dir, 'x.txt', 'x\n')
    await ops.stageFiles(dir, [])
    expect(staged(dir)).toEqual([])
  })
})

describe('discard', () => {
  it('reverts tracked files and deletes untracked ones (files and directories)', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'tracked.txt', 'original\n', 'base')
    commitFile(dir, 'keep.txt', 'keep\n', 'keep')
    write(dir, 'tracked.txt', 'modified\n')
    write(dir, 'keep.txt', 'keep modified\n')
    write(dir, 'new file*.txt', 'new\n')
    write(dir, 'newdir/a.txt', 'a\n')
    write(dir, 'newdir/sub/b.txt', 'b\n')
    write(dir, '.gitignore', 'ignored.log\n')
    write(dir, 'newdir/ignored.log', 'stay\n')

    await ops.discardFiles(dir, ['tracked.txt', 'new file*.txt', 'newdir/'])
    expect(read(dir, 'tracked.txt')).toBe('original\n')
    expect(read(dir, 'keep.txt')).toBe('keep modified\n')
    expect(exists(dir, 'new file*.txt')).toBe(false)
    expect(exists(dir, 'newdir/a.txt')).toBe(false)
    expect(exists(dir, 'newdir/sub')).toBe(false)
    // Ignored files are kept (like git clean without -x), so the directory survives.
    expect(exists(dir, 'newdir/ignored.log')).toBe(true)
  })

  it('keeps staged changes when discarding unstaged ones', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'v1\n', 'base')
    write(dir, 'f.txt', 'v2\n')
    git(dir, ['add', 'f.txt'])
    write(dir, 'f.txt', 'v3\n')
    await ops.discardFiles(dir, ['f.txt'])
    expect(read(dir, 'f.txt')).toBe('v2\n')
    expect(status(dir)).toBe('M  f.txt')
  })

  it('rejects paths that escape the repository', async () => {
    const { ops } = makeOps()
    const parent = tmpDir()
    const dir = path.join(parent, 'repo')
    fs.mkdirSync(dir)
    git(dir, ['init', '-q', '-b', 'main'])
    fs.writeFileSync(path.join(parent, 'outside.txt'), 'precious\n')
    await expectCode(ops.discardFiles(dir, ['../outside.txt']), 'INVALID_ARGUMENT')
    await expectCode(ops.discardFiles(dir, [path.join(parent, 'outside.txt')]), 'INVALID_ARGUMENT')
    expect(fs.readFileSync(path.join(parent, 'outside.txt'), 'utf8')).toBe('precious\n')
  })

  it('discardAll reverts everything unstaged and removes untracked files but keeps ignored ones', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, '.gitignore', '*.log\n', 'ignore')
    commitFile(dir, 'a.txt', 'a\n', 'a')
    write(dir, 'a.txt', 'changed\n')
    write(dir, 'staged.txt', 'staged\n')
    git(dir, ['add', 'staged.txt'])
    write(dir, 'untracked/x.txt', 'x\n')
    write(dir, 'debug.log', 'log\n')
    await ops.discardAll(dir)
    expect(read(dir, 'a.txt')).toBe('a\n')
    expect(exists(dir, 'untracked')).toBe(false)
    expect(exists(dir, 'debug.log')).toBe(true)
    expect(status(dir)).toBe('A  staged.txt')
  })

  it('discardAll works in a fresh repository', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    write(dir, 'x.txt', 'x\n')
    await ops.discardAll(dir)
    expect(exists(dir, 'x.txt')).toBe(false)
  })
})

describe('applyPatch', () => {
  const base = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n'

  it('stages a single hunk and unstages it again with --reverse', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', base, 'base')
    write(dir, 'f.txt', base.replace('line1\n', 'LINE1\n').replace('line10\n', 'LINE10\n'))
    const hunk = ['diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt', '@@ -1,3 +1,3 @@', '-line1', '+LINE1', ' line2', ' line3', ''].join('\n')

    await ops.applyPatch(dir, hunk, { cached: true })
    const cachedDiff = git(dir, ['diff', '--cached', '-U0'])
    expect(cachedDiff).toContain('+LINE1')
    expect(cachedDiff).not.toContain('LINE10')
    expect(git(dir, ['diff', '-U0'])).toContain('+LINE10')

    await ops.applyPatch(dir, hunk, { cached: true, reverse: true })
    expect(git(dir, ['diff', '--cached'])).toBe('')
  })

  it('discards a hunk from the working tree with --reverse (no trailing newline in patch)', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', base, 'base')
    write(dir, 'f.txt', base.replace('line1\n', 'LINE1\n').replace('line10\n', 'LINE10\n'))
    const hunk = ['--- a/f.txt', '+++ b/f.txt', '@@ -8,3 +8,3 @@', ' line8', ' line9', '-line10', '+LINE10'].join('\n')
    await ops.applyPatch(dir, hunk, { reverse: true })
    expect(read(dir, 'f.txt')).toBe(base.replace('line1\n', 'LINE1\n'))
  })

  it('rejects empty and non-applying patches', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', base, 'base')
    await expectCode(ops.applyPatch(dir, '   '), 'INVALID_ARGUMENT')
    const bad = ['--- a/f.txt', '+++ b/f.txt', '@@ -1,2 +1,2 @@', '-nope', '+NOPE', ' line2', ''].join('\n')
    await expectCode(ops.applyPatch(dir, bad, { cached: true }), 'GIT_FAILED')
  })
})

describe('commit', () => {
  it('commits staged changes and returns the new sha', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    write(dir, 'a.txt', 'a\n')
    git(dir, ['add', 'a.txt'])
    const sha = await ops.commit(dir, { message: 'First commit\n\n#123 keeps hash lines\n' })
    expect(sha).toBe(head(dir))
    expect(git(dir, ['log', '-1', '--format=%B']).trim()).toBe('First commit\n\n#123 keeps hash lines')
  })

  it('reports nothing to commit as INVALID_ARGUMENT', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    await expectCode(ops.commit(dir, { message: 'empty' }), 'INVALID_ARGUMENT')
    commitFile(dir, 'a.txt', 'a\n', 'a')
    write(dir, 'a.txt', 'unstaged\n')
    const err = await expectCode(ops.commit(dir, { message: 'nothing staged' }), 'INVALID_ARGUMENT')
    expect(err.message).toBe('Nothing staged to commit')
    await expectCode(ops.commit(dir, { message: '  ' }), 'INVALID_ARGUMENT')
  })

  it('amends (message only, and with staged changes), allow-empty, signoff', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'original')
    const before = head(dir)
    await ops.commit(dir, { message: 'reworded', amend: true })
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('reworded')
    expect(git(dir, ['rev-list', '--count', 'HEAD']).trim()).toBe('1')
    expect(head(dir)).not.toBe(before)

    write(dir, 'b.txt', 'b\n')
    git(dir, ['add', 'b.txt'])
    await ops.commit(dir, { message: 'reworded + b', amend: true })
    expect(git(dir, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort()).toEqual(['a.txt', 'b.txt'])

    await ops.commit(dir, { message: 'empty one', allowEmpty: true, signoff: true })
    expect(git(dir, ['log', '-1', '--format=%B'])).toContain('Signed-off-by: Test User <test@example.com>')
  })

  it('honours noVerify', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const hook = path.join(dir, '.git/hooks/pre-commit')
    fs.writeFileSync(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 })
    write(dir, 'a.txt', 'a\n')
    git(dir, ['add', 'a.txt'])
    const err = await expectCode(ops.commit(dir, { message: 'blocked' }), 'GIT_FAILED')
    expect(err.stderr).toContain('hook says no')
    await ops.commit(dir, { message: 'skips hook', noVerify: true })
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('skips hook')
  })
})

describe('addToGitignore', () => {
  it('creates, appends on a new line and skips duplicates', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    await ops.addToGitignore(dir, '*.log')
    expect(read(dir, '.gitignore')).toBe('*.log\n')
    fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\nbuild')
    await ops.addToGitignore(dir, 'dist/')
    expect(read(dir, '.gitignore')).toBe('*.log\nbuild\ndist/\n')
    await ops.addToGitignore(dir, 'dist/')
    expect(read(dir, '.gitignore')).toBe('*.log\nbuild\ndist/\n')
    await expectCode(ops.addToGitignore(dir, 'a\nb'), 'INVALID_ARGUMENT')
  })

  it('appends without re-encoding existing bytes that are not UTF-8', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    fs.writeFileSync(path.join(dir, '.gitignore'), Buffer.from('# caf\xe9\r\n*.log', 'latin1'))
    await ops.addToGitignore(dir, 'dist/')
    expect(fs.readFileSync(path.join(dir, '.gitignore'))).toEqual(Buffer.from('# caf\xe9\r\n*.log\r\ndist/\r\n', 'latin1'))
  })

  it.skipIf(process.platform === 'win32')('refuses to write through a symlinked .gitignore (into .git/config or outside the repo)', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const config = fs.readFileSync(path.join(dir, '.git/config'))
    fs.symlinkSync('.git/config', path.join(dir, '.gitignore'))
    const err = await expectCode(ops.addToGitignore(dir, '*.log'), 'INVALID_ARGUMENT')
    expect(err.message).toMatch(/symbolic link/)
    expect(fs.readFileSync(path.join(dir, '.git/config'))).toEqual(config)
    expect(fs.lstatSync(path.join(dir, '.gitignore')).isSymbolicLink()).toBe(true)

    // A dangling link must not create its target either.
    const parent = tmpDir()
    const repo = path.join(parent, 'repo')
    fs.mkdirSync(repo)
    git(repo, ['init', '-q', '-b', 'main'])
    configure(repo)
    fs.symlinkSync('../victim.txt', path.join(repo, '.gitignore'))
    await expectCode(ops.addToGitignore(repo, '/build/'), 'INVALID_ARGUMENT')
    expect(fs.existsSync(path.join(parent, 'victim.txt'))).toBe(false)

    // Nor a directory named .gitignore.
    const other = initRepo()
    fs.mkdirSync(path.join(other, '.gitignore'))
    await expectCode(ops.addToGitignore(other, '*.tmp'), 'INVALID_ARGUMENT')
  })
})
