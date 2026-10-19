import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    commitFile(dir, 'b*.txt', 'b\n', 'b')
    commitFile(dir, 'bX.txt', 'x\n', 'x')
    write(dir, 'a.txt', 'a2\n')
    write(dir, 'b*.txt', 'b2\n')
    write(dir, 'bX.txt', 'x2\n')
    await ops.stashSave(dir, { paths: ['b*.txt'] })
    expect(status(dir)).toBe(' M a.txt\n M bX.txt')
    expect(read(dir, 'b*.txt')).toBe('b\n')

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
})
