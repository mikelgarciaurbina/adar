// Conflict resolution data safety: non-UTF-8 text, symbolic links, and files edited elsewhere
// while the merge editor was open.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTmp, commitFile, configure, expectCode, git, initRepo, isolateGitConfig, makeOps, nextDate, read, tmpDir } from './helpers'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

function commitAll(dir: string, message: string): void {
  git(dir, ['add', '-A'])
  const date = nextDate()
  git(dir, ['commit', '-q', '-m', message], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
}

/** Run a git command expected to stop on conflicts. */
function gitConflict(dir: string, args: string[]): void {
  expect(() => git(dir, args)).toThrow()
}

const conflicted = (dir: string) => [...new Set(git(dir, ['ls-files', '-u', '-z']).split('\0').filter(Boolean).map((r) => r.split('\t')[1]))]

describe('non-UTF-8 text conflicts', () => {
  const latin1 = (s: string) => Buffer.from(s, 'latin1')

  /** f.txt in Latin-1: main changes value to 3, other to 2. */
  function latin1Conflict(): string {
    const dir = initRepo()
    const file = path.join(dir, 'f.txt')
    fs.writeFileSync(file, latin1('// Fran\xe7ois M\xfcller\nvalue=1\nfooter \xa9\n'))
    commitAll(dir, 'base')
    git(dir, ['checkout', '-q', '-b', 'other'])
    fs.writeFileSync(file, latin1('// Fran\xe7ois M\xfcller\nvalue=2\nfooter \xa9\n'))
    commitAll(dir, 'theirs')
    git(dir, ['checkout', '-q', 'main'])
    fs.writeFileSync(file, latin1('// Fran\xe7ois M\xfcller\nvalue=3\nfooter \xa9\n'))
    commitAll(dir, 'ours')
    gitConflict(dir, ['merge', 'other'])
    return dir
  }

  it('reports them like binary files (whole-side resolutions only) and flags nonUtf8', async () => {
    const { ops } = makeOps()
    const dir = latin1Conflict()
    const v = await ops.getConflictVersions(dir, 'f.txt')
    expect(v).toMatchObject({ kind: 'both-modified', binary: true, nonUtf8: true, base: '', ours: '', theirs: '', merged: '' })
    expect(v.symlink).toBeUndefined()

    // "ours" keeps every byte (git checkout --ours).
    await ops.resolveConflict(dir, 'f.txt', { kind: 'ours' })
    expect(fs.readFileSync(path.join(dir, 'f.txt'))).toEqual(latin1('// Fran\xe7ois M\xfcller\nvalue=3\nfooter \xa9\n'))
    expect(conflicted(dir)).toEqual([])
  })

  it('refuses a content resolution built from the lossy UTF-8 decode, leaving the bytes alone', async () => {
    const { ops } = makeOps()
    const dir = latin1Conflict()
    const file = path.join(dir, 'f.txt')
    const before = fs.readFileSync(file)
    // What the merge editor used to send: the conflict chunk resolved in text decoded as UTF-8.
    const content = before.toString('utf8').replace(/<<<<<<<[\s\S]*?>>>>>>> other\n/, 'value=3\n')
    expect(content).toContain('Fran�ois')
    await expectCode(ops.resolveConflict(dir, 'f.txt', { kind: 'content', content }), 'INVALID_ARGUMENT')
    expect(fs.readFileSync(file)).toEqual(before)
    expect(conflicted(dir)).toEqual(['f.txt'])
  })

  it('still accepts content with a genuine U+FFFD in UTF-8 files', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'u.txt', 'x �\nbase\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'u.txt', 'x �\ntheirs\n', 'theirs')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'u.txt', 'x �\nours\n', 'ours')
    gitConflict(dir, ['merge', 'other'])
    const v = await ops.getConflictVersions(dir, 'u.txt')
    expect(v).toMatchObject({ binary: false, ours: 'x �\nours\n' })
    expect(v.nonUtf8).toBeUndefined()
    await ops.resolveConflict(dir, 'u.txt', { kind: 'content', content: 'x �\nboth\n', expected: v.merged })
    expect(read(dir, 'u.txt')).toBe('x �\nboth\n')
    expect(conflicted(dir)).toEqual([])
  })
})

describe('files changed on disk while the editor was open', () => {
  function conflictRepo(): string {
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'import a\n\nbase\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'f.txt', 'import a\n\ntheirs\n', 'theirs')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'f.txt', 'import a\n\nours\n', 'ours')
    gitConflict(dir, ['merge', 'other'])
    return dir
  }

  it('refuses (CONFLICT) to overwrite external edits made after the versions were loaded', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    const file = path.join(dir, 'f.txt')
    const v = await ops.getConflictVersions(dir, 'f.txt')

    // The user fixes the imports in their editor, outside the conflict chunk.
    fs.writeFileSync(file, read(dir, 'f.txt').replace('import a', 'import a, b'))
    const err = await expectCode(
      ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: v.merged!.replace(/<<<<<<<[\s\S]*>>>>>>> other\n/, 'ours\n'), expected: v.merged }),
      'CONFLICT'
    )
    expect(err.message).toMatch(/changed on disk/)
    expect(read(dir, 'f.txt')).toContain('import a, b')
    expect(conflicted(dir)).toEqual(['f.txt'])

    // An absent file was expected but one exists.
    await expectCode(ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'x\n', expected: null }), 'CONFLICT')

    // After reloading, the save goes through.
    const fresh = await ops.getConflictVersions(dir, 'f.txt')
    const content = fresh.merged!.replace(/<<<<<<<[\s\S]*>>>>>>> other\n/, 'ours\n')
    await ops.resolveConflict(dir, 'f.txt', { kind: 'content', content, expected: fresh.merged })
    expect(read(dir, 'f.txt')).toBe('import a, b\n\nours\n')
    expect(conflicted(dir)).toEqual([])
  })

  it('keeps accepting resolutions without `expected` (whole-content writes)', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    await ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'resolved\n' })
    expect(read(dir, 'f.txt')).toBe('resolved\n')
    await expectCode(ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'x', expected: 42 as unknown as string }), 'INVALID_ARGUMENT')
  })
})

describe.skipIf(process.platform === 'win32')('symbolic link conflicts', () => {
  /**
   * base: link → a.txt; feature: link → b.txt; main (upstream): link → ../secret, a file outside the
   * repository. Rebasing feature onto main leaves the upstream link in the worktree.
   */
  function symlinkConflict(): { dir: string; secret: string } {
    const parent = tmpDir('adar-wtest-sym-')
    const secret = path.join(parent, 'secret')
    fs.writeFileSync(secret, 'TOP SECRET KEY\n')
    const dir = path.join(parent, 'repo')
    fs.mkdirSync(dir)
    git(dir, ['init', '-q', '-b', 'main'])
    configure(dir)
    const link = path.join(dir, 'link')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
    fs.symlinkSync('a.txt', link)
    commitAll(dir, 'base')
    git(dir, ['checkout', '-q', '-b', 'feature'])
    fs.rmSync(link)
    fs.symlinkSync('b.txt', link)
    commitAll(dir, 'feature link')
    git(dir, ['checkout', '-q', 'main'])
    fs.rmSync(link)
    fs.symlinkSync('../secret', link)
    commitAll(dir, 'upstream link')
    git(dir, ['checkout', '-q', 'feature'])
    gitConflict(dir, ['rebase', 'main'])
    return { dir, secret }
  }

  it('never reads through the worktree link and offers whole-side resolutions only', async () => {
    const { ops } = makeOps()
    const { dir } = symlinkConflict()
    expect(fs.readlinkSync(path.join(dir, 'link'))).toBe('../secret')
    const v = await ops.getConflictVersions(dir, 'link')
    expect(v).toMatchObject({ binary: true, symlink: true, base: '', ours: '', theirs: '', merged: '' })
    expect(JSON.stringify(v)).not.toContain('SECRET')
  })

  it('refuses a content resolution (it would replace the link with a regular file) and resolves by side', async () => {
    const { ops } = makeOps()
    const { dir } = symlinkConflict()
    const link = path.join(dir, 'link')
    await expectCode(ops.resolveConflict(dir, 'link', { kind: 'content', content: 'TOP SECRET KEY\n' }), 'INVALID_ARGUMENT')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(git(dir, ['ls-files', '-s', '--', 'link'])).not.toMatch(/^100644/m)
    expect(conflicted(dir)).toEqual(['link'])

    // "theirs" (the commit being rebased) restores its link as a link.
    await ops.resolveConflict(dir, 'link', { kind: 'theirs' })
    expect(fs.readlinkSync(link)).toBe('b.txt')
    expect(git(dir, ['ls-files', '-s', '--', 'link'])).toMatch(/^120000 /)
  })
})
