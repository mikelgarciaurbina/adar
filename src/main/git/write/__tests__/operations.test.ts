import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTmp,
  commitFile,
  exists,
  expectCode,
  git,
  head,
  initRepo,
  isolateGitConfig,
  makeOps,
  read,
  status,
  subjects,
  write
} from './helpers'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

/** main: base → "ours" change on f.txt; other: base → "theirs" change on f.txt. */
function conflictRepo(): string {
  const dir = initRepo()
  commitFile(dir, 'f.txt', 'base\n', 'base')
  git(dir, ['checkout', '-q', '-b', 'other'])
  commitFile(dir, 'f.txt', 'theirs\n', 'theirs change', { GIT_AUTHOR_NAME: 'Original Author', GIT_AUTHOR_EMAIL: 'orig@example.com' })
  git(dir, ['checkout', '-q', 'main'])
  commitFile(dir, 'f.txt', 'ours\n', 'ours change')
  return dir
}

describe('merge', () => {
  it('fast-forwards by default and creates a merge commit with noFf', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['checkout', '-q', '-b', 'feature'])
    const tip = commitFile(dir, 'b.txt', 'b\n', 'b')
    git(dir, ['checkout', '-q', 'main'])
    git(dir, ['branch', 'main2'])

    const ff = await ops.merge(dir, 'feature')
    expect(ff).toMatchObject({ ok: true, conflicts: [], state: 'none' })
    expect(head(dir)).toBe(tip)

    git(dir, ['checkout', '-q', 'main2'])
    const noff = await ops.merge(dir, 'feature', { noFf: true, message: 'Merge feature into main2' })
    expect(noff.ok).toBe(true)
    expect(git(dir, ['log', '-1', '--format=%P']).trim().split(' ')).toHaveLength(2)
    expect(subjects(dir)[0]).toBe('Merge feature into main2')

    const again = await ops.merge(dir, 'feature')
    expect(again.ok).toBe(true)
    expect(again.message).toMatch(/up to date/i)
  })

  it('squash merges without committing', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['checkout', '-q', '-b', 'feature'])
    commitFile(dir, 'b.txt', 'b\n', 'b')
    commitFile(dir, 'c.txt', 'c\n', 'c')
    git(dir, ['checkout', '-q', 'main'])
    const res = await ops.merge(dir, 'feature', { squash: true })
    expect(res).toMatchObject({ ok: true, state: 'none' })
    expect(status(dir)).toBe('A  b.txt\nA  c.txt')
    await expectCode(ops.merge(dir, 'feature', { squash: true, noFf: true }), 'INVALID_ARGUMENT')
  })

  it('stops on conflicts, resolves with content and continues', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    const res = await ops.merge(dir, 'other')
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'merge' })

    const versions = await ops.getConflictVersions(dir, 'f.txt')
    expect(versions).toMatchObject({
      path: 'f.txt',
      kind: 'both-modified',
      base: 'base\n',
      ours: 'ours\n',
      theirs: 'theirs\n',
      oursLabel: 'main',
      theirsLabel: 'other',
      binary: false
    })
    expect(versions.merged).toContain('<<<<<<<')

    const early = await ops.continueOperation(dir)
    expect(early).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'merge' })

    await ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'resolved\n' })
    expect(read(dir, 'f.txt')).toBe('resolved\n')
    const done = await ops.continueOperation(dir)
    expect(done).toMatchObject({ ok: true, conflicts: [], state: 'none' })
    expect(git(dir, ['log', '-1', '--format=%B']).trim()).toBe("Merge branch 'other'")
    expect(git(dir, ['log', '-1', '--format=%P']).trim().split(' ')).toHaveLength(2)
  })

  it('continues a merge with a custom message and aborts another', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    await ops.merge(dir, 'other')
    await ops.resolveConflict(dir, 'f.txt', { kind: 'theirs' })
    expect(read(dir, 'f.txt')).toBe('theirs\n')
    const res = await ops.continueOperation(dir, { message: 'Custom merge\n\n#42 kept' })
    expect(res.ok).toBe(true)
    expect(git(dir, ['log', '-1', '--format=%B']).trim()).toBe('Custom merge\n\n#42 kept')

    git(dir, ['reset', '-q', '--hard', 'HEAD~1'])
    const before = head(dir)
    await ops.merge(dir, 'other')
    await ops.abortOperation(dir)
    expect(head(dir)).toBe(before)
    expect(status(dir)).toBe('')
    await expectCode(ops.abortOperation(dir), 'INVALID_ARGUMENT')
  })

  it('resolves modify/delete conflicts by keeping or deleting the file', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'base\n', 'base')
    commitFile(dir, 'g.txt', 'g\n', 'g')
    git(dir, ['checkout', '-q', '-b', 'other'])
    git(dir, ['rm', '-q', 'f.txt', 'g.txt'])
    git(dir, ['commit', '-q', '-m', 'delete both'])
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'f.txt', 'changed\n', 'change f')
    commitFile(dir, 'g.txt', 'changed\n', 'change g')
    const res = await ops.merge(dir, 'other')
    expect(res.conflicts.sort()).toEqual(['f.txt', 'g.txt'])
    const v = await ops.getConflictVersions(dir, 'f.txt')
    expect(v.kind).toBe('deleted-by-them')
    expect(v.theirs).toBeNull()

    await ops.resolveConflict(dir, 'f.txt', { kind: 'theirs' }) // their side deleted it
    expect(exists(dir, 'f.txt')).toBe(false)
    await ops.resolveConflict(dir, 'g.txt', { kind: 'ours' })
    expect(read(dir, 'g.txt')).toBe('changed\n')
    expect((await ops.continueOperation(dir)).ok).toBe(true)
    expect(git(dir, ['ls-files']).trim()).toBe('g.txt')
  })

  it('markResolved stages files as they are', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    await ops.merge(dir, 'other')
    write(dir, 'f.txt', 'hand edited\n')
    await ops.markResolved(dir, ['f.txt'])
    expect(await ops.getConflictVersions(dir, 'f.txt').catch((e) => e.code)).toBe('NOT_FOUND')
    expect((await ops.continueOperation(dir)).ok).toBe(true)
    expect(read(dir, 'f.txt')).toBe('hand edited\n')
  })

  it('surfaces untracked files that would be overwritten as DIRTY_WORKTREE', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['checkout', '-q', '-b', 'feature'])
    commitFile(dir, 'new.txt', 'from feature\n', 'add new')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'm.txt', 'm\n', 'm')
    write(dir, 'new.txt', 'untracked local\n')
    await expectCode(ops.merge(dir, 'feature'), 'DIRTY_WORKTREE')
  })
})

describe('rebase', () => {
  it('rebases cleanly and reports up to date', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['checkout', '-q', '-b', 'feature'])
    commitFile(dir, 'f.txt', 'f\n', 'feature work')
    git(dir, ['checkout', '-q', 'main'])
    const mainTip = commitFile(dir, 'm.txt', 'm\n', 'main work')
    git(dir, ['checkout', '-q', 'feature'])
    write(dir, 'dirty.txt', 'autostash me\n')
    git(dir, ['add', 'dirty.txt'])
    const res = await ops.rebase(dir, 'main')
    expect(res).toMatchObject({ ok: true, state: 'none' })
    expect(head(dir, 'HEAD~1')).toBe(mainTip)
    expect(exists(dir, 'dirty.txt')).toBe(true)
    expect((await ops.rebase(dir, 'main')).ok).toBe(true)
  })

  it('stops on conflicts with labels, then skip finishes it', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    git(dir, ['checkout', '-q', 'other'])
    commitFile(dir, 'other2.txt', 'x\n', 'other second')
    const res = await ops.rebase(dir, 'main')
    // git writes rebase-merge/interactive for plain merge-backend rebases too: still a plain rebase.
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'rebase' })

    const v = await ops.getConflictVersions(dir, 'f.txt')
    expect(v.oursLabel).toBe('main (upstream)')
    expect(v.theirsLabel).toMatch(/^[0-9a-f]{7,} theirs change$/)
    expect(v.ours).toBe('ours\n')
    expect(v.theirs).toBe('theirs\n')

    const skipped = await ops.skipOperation(dir)
    expect(skipped).toMatchObject({ ok: true, state: 'none' })
    expect(subjects(dir)).toEqual(['other second', 'ours change', 'base'])
  })

  it('aborts a conflicted rebase', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    git(dir, ['checkout', '-q', 'other'])
    const before = head(dir)
    await ops.rebase(dir, 'main')
    await ops.abortOperation(dir)
    expect(head(dir)).toBe(before)
    expect(git(dir, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('other')
  })

  it('continues with a new message, keeping the original author', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    git(dir, ['checkout', '-q', 'other'])
    await ops.rebase(dir, 'main')
    await ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'merged\n' })
    const res = await ops.continueOperation(dir, { message: 'Reworded during rebase\n\n#7 stays' })
    expect(res).toMatchObject({ ok: true, state: 'none' })
    expect(git(dir, ['log', '-1', '--format=%an|%B']).trim()).toBe('Original Author|Reworded during rebase\n\n#7 stays')
  })

  it('drops a commit that becomes empty when continuing', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    git(dir, ['checkout', '-q', 'other'])
    await ops.rebase(dir, 'main')
    await ops.resolveConflict(dir, 'f.txt', { kind: 'ours' })
    const res = await ops.continueOperation(dir)
    expect(res).toMatchObject({ ok: true, state: 'none' })
    expect(subjects(dir)).toEqual(['ours change', 'base'])
  })
})

describe('cherry-pick', () => {
  it('picks several commits oldest first regardless of the given order', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'source'])
    const c1 = commitFile(dir, 'one.txt', '1\n', 'one')
    const c2 = commitFile(dir, 'two.txt', '2\n', 'two')
    const c3 = commitFile(dir, 'three.txt', '3\n', 'three')
    git(dir, ['checkout', '-q', 'main'])
    const res = await ops.cherryPick(dir, [c3, c1, c2])
    expect(res).toMatchObject({ ok: true, state: 'none' })
    expect(subjects(dir)).toEqual(['three', 'two', 'one', 'base'])
  })

  it('orders commits made in the same second topologically', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const same = { GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: '1700000000 +0000' }
    commitFile(dir, 'a.txt', 'a\n', 'base', same)
    git(dir, ['checkout', '-q', '-b', 'source'])
    const shas = ['one', 'two', 'three', 'four'].map((n) => commitFile(dir, `${n}.txt`, `${n}\n`, n, same))
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'm.txt', 'm\n', 'main work', same)
    const res = await ops.cherryPick(dir, [shas[2], shas[0], shas[3], shas[1]])
    expect(res.ok).toBe(true)
    expect(subjects(dir).slice(0, 4)).toEqual(['four', 'three', 'two', 'one'])
  })

  it('skips commits that are already applied', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'source'])
    const c1 = commitFile(dir, 'one.txt', '1\n', 'one')
    const c2 = commitFile(dir, 'two.txt', '2\n', 'two')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'one.txt', '1\n', 'one again')
    const res = await ops.cherryPick(dir, [c1, c2])
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/Skipped 1 commit/)
    expect(subjects(dir)).toEqual(['two', 'one again', 'base'])
  })

  it('stops on conflicts and continues', async () => {
    const { ops } = makeOps()
    const dir = conflictRepo()
    const theirs = head(dir, 'other')
    const res = await ops.cherryPick(dir, [theirs])
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'cherry-pick' })
    const v = await ops.getConflictVersions(dir, 'f.txt')
    expect(v.oursLabel).toBe('main')
    expect(v.theirsLabel).toMatch(/theirs change$/)
    await ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'both\n' })
    const done = await ops.continueOperation(dir, { message: 'Picked with edits' })
    expect(done).toMatchObject({ ok: true, state: 'none' })
    expect(git(dir, ['log', '-1', '--format=%an|%s']).trim()).toBe('Original Author|Picked with edits')
  })

  it('continues a multi-commit cherry-pick after a conflict, with and without a message', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'base\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'source'])
    const c1 = commitFile(dir, 'f.txt', 'source\n', 'conflicting one')
    const c2 = commitFile(dir, 'g.txt', 'g\n', 'clean two')
    const c3 = commitFile(dir, 'f.txt', 'source again\n', 'conflicting three')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'f.txt', 'main\n', 'main change')

    const res = await ops.cherryPick(dir, [c1, c2, c3])
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'cherry-pick' })
    await ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'resolved one\n' })
    const next = await ops.continueOperation(dir, { message: 'one, edited' })
    // c2 applies cleanly, c3 conflicts again.
    expect(next).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'cherry-pick' })
    await ops.resolveConflict(dir, 'f.txt', { kind: 'content', content: 'final\n' })
    const done = await ops.continueOperation(dir)
    expect(done).toMatchObject({ ok: true, state: 'none' })
    expect(subjects(dir)).toEqual(['conflicting three', 'clean two', 'one, edited', 'main change', 'base'])
    expect(read(dir, 'f.txt')).toBe('final\n')
  })

  it('cherry-picks with noCommit and merge commits with -m 1', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'feature'])
    commitFile(dir, 'f.txt', 'f\n', 'feature')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'm.txt', 'm\n', 'main')
    git(dir, ['merge', '-q', '--no-ff', '--no-edit', 'feature'])
    const mergeSha = head(dir)
    git(dir, ['checkout', '-q', '-b', 'target', 'HEAD~2'])
    const res = await ops.cherryPick(dir, [mergeSha], { noCommit: true })
    expect(res.ok).toBe(true)
    expect(status(dir)).toBe('A  f.txt')
  })
})

describe('revert', () => {
  it('reverts a commit and a merge commit with a mainline', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'base')
    const change = commitFile(dir, 'a.txt', 'b\n', 'change a')
    const res = await ops.revert(dir, change)
    expect(res).toMatchObject({ ok: true, state: 'none' })
    expect(read(dir, 'a.txt')).toBe('a\n')
    expect(subjects(dir)[0]).toBe('Revert "change a"')

    git(dir, ['checkout', '-q', '-b', 'feature'])
    commitFile(dir, 'f.txt', 'f\n', 'feature')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'm.txt', 'm\n', 'main')
    git(dir, ['merge', '-q', '--no-ff', '--no-edit', 'feature'])
    const mergeSha = head(dir)
    await expectCode(ops.revert(dir, mergeSha), 'GIT_FAILED')
    const merged = await ops.revert(dir, mergeSha, { mainline: 1 })
    expect(merged.ok).toBe(true)
    expect(exists(dir, 'f.txt')).toBe(false)
    expect(exists(dir, 'm.txt')).toBe(true)
    await expectCode(ops.revert(dir, mergeSha, { mainline: 0 }), 'INVALID_ARGUMENT')
  })

  it('stops on conflicts with a revert label', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'v1\n', 'v1')
    const v2 = commitFile(dir, 'f.txt', 'v2\n', 'v2')
    commitFile(dir, 'f.txt', 'v3\n', 'v3')
    const res = await ops.revert(dir, v2)
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'revert' })
    const v = await ops.getConflictVersions(dir, 'f.txt')
    expect(v.theirsLabel).toBe(`revert of ${v2.slice(0, v.theirsLabel.length - 'revert of '.length)}`)
    await ops.abortOperation(dir)
    expect(status(dir)).toBe('')
  })
})

describe('continue / skip guards', () => {
  it('rejects continue and skip without an operation', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    await expectCode(ops.continueOperation(dir), 'INVALID_ARGUMENT')
    await expectCode(ops.skipOperation(dir), 'INVALID_ARGUMENT')
  })
})
