import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GitContext } from '../../context'
import { createStashOps } from '../stash'
import { cleanupTmp, commitFile, exists, expectCode, git, initRepo, isolateGitConfig, makeOps, read, status, write } from './helpers'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

const stashList = (dir: string) => git(dir, ['stash', 'list', '--format=%gs']).split('\n').filter(Boolean)

describe('stash', () => {
  it('saves with a message and untracked files, then pops restoring the index', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    write(dir, 'a.txt', 'staged\n')
    git(dir, ['add', 'a.txt'])
    write(dir, 'new file.txt', 'untracked\n')

    await ops.stashSave(dir, { message: 'my work', includeUntracked: true })
    expect(status(dir)).toBe('')
    expect(stashList(dir)[0]).toMatch(/my work$/)

    const res = await ops.stashApply(dir, 0, { pop: true, restoreIndex: true })
    expect(res).toMatchObject({ ok: true, conflicts: [], state: 'none' })
    expect(status(dir)).toBe('M  a.txt\n?? "new file.txt"')
    expect(stashList(dir)).toEqual([])
  })

  it('reports nothing to stash as INVALID_ARGUMENT', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    const err = await expectCode(ops.stashSave(dir), 'INVALID_ARGUMENT')
    expect(err.message).toMatch(/No local changes/)
    write(dir, 'untracked.txt', 'x\n')
    await expectCode(ops.stashSave(dir, { includeUntracked: false }), 'INVALID_ARGUMENT')
  })

  it('stashes only the given paths and supports keepIndex', async () => {
    const { ops } = makeOps()
    // A glob as a literal file name ('*' is not allowed in Windows file names: a bracket glob there).
    const glob = process.platform === 'win32' ? 'b[X].txt' : 'b*.txt'
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    commitFile(dir, glob, 'b\n', 'b')
    commitFile(dir, 'bX.txt', 'x\n', 'x')
    write(dir, 'a.txt', 'a2\n')
    write(dir, glob, 'b2\n')
    write(dir, 'bX.txt', 'x2\n')
    await ops.stashSave(dir, { paths: [glob] })
    expect(status(dir)).toBe(' M a.txt\n M bX.txt')
    expect(read(dir, glob)).toBe('b\n')

    git(dir, ['add', 'a.txt'])
    await ops.stashSave(dir, { keepIndex: true })
    expect(status(dir)).toBe('M  a.txt')
  })

  it('applies keeping the stash, drops, and validates indexes', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    write(dir, 'a.txt', 'one\n')
    await ops.stashSave(dir, { message: 'one' })
    write(dir, 'a.txt', 'two\n')
    await ops.stashSave(dir, { message: 'two' })

    const res = await ops.stashApply(dir, 1)
    expect(res.ok).toBe(true)
    expect(read(dir, 'a.txt')).toBe('one\n')
    expect(stashList(dir)).toHaveLength(2)

    git(dir, ['checkout', '--', 'a.txt'])
    await ops.stashDrop(dir, 0)
    expect(stashList(dir)).toHaveLength(1)
    expect(stashList(dir)[0]).toMatch(/one$/)

    await expectCode(ops.stashDrop(dir, 5), 'NOT_FOUND')
    await expectCode(ops.stashApply(dir, -1), 'INVALID_ARGUMENT')
  })

  it('returns conflicts when popping onto a changed file and keeps the stash', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'base\n', 'base')
    write(dir, 'f.txt', 'stashed\n')
    await ops.stashSave(dir)
    commitFile(dir, 'f.txt', 'committed\n', 'change')
    const res = await ops.stashApply(dir, 0, { pop: true, restoreIndex: true })
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'none' })
    expect(stashList(dir)).toHaveLength(1)
    const v = await ops.getConflictVersions(dir, 'f.txt')
    expect(v).toMatchObject({ ours: 'committed\n', theirs: 'stashed\n', kind: 'both-modified' })
  })

  it('refuses to apply over local changes that would be overwritten', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'base\n', 'base')
    write(dir, 'f.txt', 'stashed\n')
    await ops.stashSave(dir)
    write(dir, 'f.txt', 'dirty\n')
    await expectCode(ops.stashApply(dir, 0), 'DIRTY_WORKTREE')
    expect(read(dir, 'f.txt')).toBe('dirty\n')
    expect(exists(dir, 'f.txt')).toBe(true)
  })

  it('keeps staged changes (incl. a rename) when applying with restoreIndex, and applies the stash', async () => {
    // Original data-loss scenario: `git stash apply --index` with a dirty index reset the index to
    // HEAD, then failed with "would be overwritten by merge ... Index was not unstashed".
    const { ops } = makeOps()
    const dir = initRepo()
    write(dir, 'README.md', 'hello\n')
    write(dir, 'a.txt', 'a\n')
    commitFile(dir, 'old.txt', 'old\n', 'base')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', 'files'])
    write(dir, 'a.txt', 'a\nstashed\n')
    write(dir, 'staged-in-stash.txt', 'idx\n')
    git(dir, ['add', 'staged-in-stash.txt'])
    await ops.stashSave(dir, { message: 'other work' })
    expect(status(dir)).toBe('')

    write(dir, 'README.md', 'hello\nstaged\n')
    git(dir, ['add', 'README.md'])
    git(dir, ['mv', 'old.txt', 'new.txt'])
    const staged = git(dir, ['write-tree']).trim()

    const res = await ops.stashApply(dir, 0, { pop: true, restoreIndex: true })
    expect(res).toMatchObject({ ok: true, conflicts: [], state: 'none' })
    expect(res.message).toMatch(/staging was kept/)
    // The user's staging survived...
    expect(git(dir, ['diff', '--cached', '--name-status', '-M', 'HEAD']).trim().split('\n')).toEqual([
      'M\tREADME.md',
      'R100\told.txt\tnew.txt',
      'A\tstaged-in-stash.txt'
    ])
    expect(read(dir, 'README.md')).toBe('hello\nstaged\n')
    // ...and the stash was applied (its tracked change unstaged) and dropped.
    expect(read(dir, 'a.txt')).toBe('a\nstashed\n')
    expect(git(dir, ['diff', '--name-only']).trim()).toBe('a.txt')
    expect(stashList(dir)).toEqual([])
    expect(staged).not.toBe(git(dir, ['rev-parse', 'HEAD^{tree}']).trim())
  })

  it('falls back to applying without the index when the staged part no longer applies', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
    commitFile(dir, 'f.txt', `${lines.join('\n')}\n`, 'base')
    const stashed = [...lines]
    stashed[1] = 'line 2 stashed'
    write(dir, 'f.txt', `${stashed.join('\n')}\n`)
    git(dir, ['add', 'f.txt'])
    await ops.stashSave(dir)
    // A nearby committed change breaks the context of the stash's index patch, not the 3-way merge.
    const committed = [...lines]
    committed[4] = 'line 5 committed'
    commitFile(dir, 'f.txt', `${committed.join('\n')}\n`, 'change')

    const res = await ops.stashApply(dir, 0, { restoreIndex: true })
    expect(res).toMatchObject({ ok: true, conflicts: [] })
    expect(res.message).toMatch(/applied as unstaged changes/)
    expect(read(dir, 'f.txt')).toContain('line 2 stashed\nline 3\nline 4\nline 5 committed\n')
    expect(status(dir)).toBe(' M f.txt')
  })

  it('restores the index saved before a failed --index attempt, then applies without --index', async () => {
    const base = makeOps().ctx
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    commitFile(dir, 'b.txt', 'b\n', 'b')
    write(dir, 'a.txt', 'stashed\n')
    await createStashOps(base).stashSave(dir)
    write(dir, 'b.txt', 'b2\n')
    // Simulate git resetting/altering the index and then failing the --index apply.
    const ctx: GitContext = {
      ...base,
      git: async (repo, args, opts) => {
        if (args[0] === 'stash' && args.includes('--index')) {
          git(repo, ['add', 'b.txt'])
          return { code: 1, stdout: '', stderr: 'error: Your local changes to the following files would be overwritten by merge:\n  b.txt\nIndex was not unstashed.\n' }
        }
        return base.git(repo, args, opts)
      }
    }
    const res = await createStashOps(ctx).stashApply(dir, 0, { restoreIndex: true })
    expect(res).toMatchObject({ ok: true, conflicts: [] })
    expect(status(dir)).toBe(' M a.txt\n M b.txt')
    expect(read(dir, 'a.txt')).toBe('stashed\n')
  })
})
