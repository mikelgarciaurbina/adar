import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RebaseTodoItem } from '@shared/types'
import { cleanupTmp, commitFile, exists, expectCode, git, head, initRepo, isolateGitConfig, makeOps, nextDate, read, status, subjects, write } from './helpers'
import { INTERACTIVE_REBASE_MARKER } from '../../context'
import { repoKey } from '../interactive'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

/** base ← A ← B ← C ← D on main, each commit adding its own file. Returns repo + base sha. */
function linearRepo(): { dir: string; base: string } {
  const dir = initRepo()
  const base = commitFile(dir, 'base.txt', 'base\n', 'base')
  for (const name of ['A', 'B', 'C', 'D']) {
    write(dir, `${name}.txt`, `${name}\n`)
    git(dir, ['add', `${name}.txt`])
    git(dir, ['commit', '-q', '-F', '-'], { input: `${name} subject\n\n${name} body\n` })
  }
  return { dir, base }
}

const files = (dir: string) => git(dir, ['ls-files']).split('\n').filter(Boolean).sort()

describe('getRebaseCommits', () => {
  it('lists base..HEAD oldest first, and everything for ROOT', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const commits = await ops.getRebaseCommits(dir, base)
    expect(commits.map((c) => c.subject)).toEqual(['A subject', 'B subject', 'C subject', 'D subject'])
    expect(commits[0]).toMatchObject({ body: 'A body', parents: [base], authorName: 'Test User' })
    const all = await ops.getRebaseCommits(dir, 'ROOT')
    expect(all.map((c) => c.subject)[0]).toBe('base')
    expect(all).toHaveLength(5)
    await expectCode(ops.getRebaseCommits(dir, 'nope'), 'NOT_FOUND')
  })
})

describe('interactiveRebase', () => {
  const todoFrom = async (dir: string, base: string, edit: (items: RebaseTodoItem[]) => RebaseTodoItem[]) => {
    const { ops } = makeOps()
    const commits = await ops.getRebaseCommits(dir, base)
    return edit(commits.map((c) => ({ action: 'pick' as const, sha: c.sha, subject: c.subject })))
  }

  it('reorders and drops commits', async () => {
    const { ops, ctx } = makeOps()
    const { dir, base } = linearRepo()
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [d, b, { ...c, action: 'drop' }, a])
    const res = await ops.interactiveRebase(dir, base, todo)
    expect(res).toMatchObject({ ok: true, conflicts: [], state: 'none' })
    expect(subjects(dir)).toEqual(['A subject', 'B subject', 'D subject', 'base'])
    expect(files(dir)).toEqual(['A.txt', 'B.txt', 'D.txt', 'base.txt'])
    // Message/todo files of finished rebases are removed.
    // (Other tests may leave a paused rebase of their own repo behind: only look at this repo's dirs.)
    const mine = `rebase-${repoKey(dir)}-`
    const leftovers = fs.existsSync(ctx.tmpDir) ? fs.readdirSync(ctx.tmpDir).filter((f) => f.startsWith(mine)) : []
    expect(leftovers).toEqual([])
  })

  it('rewords a commit keeping its author and content', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [a, { ...b, action: 'reword', message: "New B\n\nWith 'quotes' and #hash\n" }, c, d])
    const res = await ops.interactiveRebase(dir, base, todo)
    expect(res.ok).toBe(true)
    expect(git(dir, ['log', '-1', '--format=%B', 'HEAD~2']).trim()).toBe("New B\n\nWith 'quotes' and #hash")
    expect(subjects(dir)).toEqual(['D subject', 'C subject', 'New B', 'A subject', 'base'])
    expect(files(dir)).toHaveLength(5)
  })

  it('squashes with a combined message when none is provided', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [a, { ...b, action: 'squash' }, c, d])
    expect((await ops.interactiveRebase(dir, base, todo)).ok).toBe(true)
    expect(subjects(dir)).toEqual(['D subject', 'C subject', 'A subject', 'base'])
    expect(git(dir, ['log', '-1', '--format=%B', 'HEAD~2']).trim()).toBe('A subject\n\nA body\n\nB subject\n\nB body')
    expect(git(dir, ['show', '--name-only', '--format=', 'HEAD~2']).trim().split('\n').sort()).toEqual(['A.txt', 'B.txt'])
  })

  it('squashes with a provided message', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [a, { ...b, action: 'squash', message: 'A+B+C' }, { ...c, action: 'squash' }, d])
    expect((await ops.interactiveRebase(dir, base, todo)).ok).toBe(true)
    expect(subjects(dir)).toEqual(['D subject', 'A+B+C', 'base'])
    expect(git(dir, ['show', '--name-only', '--format=', 'HEAD~1']).trim().split('\n').sort()).toEqual(['A.txt', 'B.txt', 'C.txt'])
  })

  it('fixes up into the previous commit keeping its message', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [a, b, { ...c, action: 'fixup' }, { ...d, action: 'fixup' }])
    expect((await ops.interactiveRebase(dir, base, todo)).ok).toBe(true)
    expect(subjects(dir)).toEqual(['B subject', 'A subject', 'base'])
    expect(git(dir, ['log', '-1', '--format=%B']).trim()).toBe('B subject\n\nB body')
    expect(files(dir)).toHaveLength(5)
  })

  it('stops at an edit and continues (with an amend message)', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [a, { ...b, action: 'edit' }, { ...c, action: 'reword', message: 'C reworded' }, d])
    const res = await ops.interactiveRebase(dir, base, todo)
    expect(res).toMatchObject({ ok: false, conflicts: [], state: 'rebase-interactive' })
    expect(res.message).toMatch(/paused at [0-9a-f]+ B subject/)

    write(dir, 'B.txt', 'B edited\n')
    git(dir, ['add', 'B.txt'])
    const done = await ops.continueOperation(dir, { message: 'B amended' })
    expect(done).toMatchObject({ ok: true, state: 'none' })
    expect(subjects(dir)).toEqual(['D subject', 'C reworded', 'B amended', 'A subject', 'base'])
    expect(read(dir, 'B.txt')).toBe('B edited\n')
    expect(status(dir)).toBe('')
  })

  it('stops at an edit and continues without a message', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [{ ...a, action: 'edit' }, b, c, d])
    expect((await ops.interactiveRebase(dir, base, todo)).state).toBe('rebase-interactive')
    const done = await ops.continueOperation(dir)
    expect(done.ok).toBe(true)
    expect(subjects(dir)).toEqual(['D subject', 'C subject', 'B subject', 'A subject', 'base'])
  })

  it('rebases from the root commit', async () => {
    const { ops } = makeOps()
    const { dir } = linearRepo()
    const todo = await todoFrom(dir, 'ROOT', ([root, a, ...rest]) => [{ ...root, action: 'reword', message: 'New root' }, { ...a, action: 'squash', message: 'Root + A' }, ...rest])
    const res = await ops.interactiveRebase(dir, 'ROOT', todo)
    expect(res.ok).toBe(true)
    expect(subjects(dir)).toEqual(['D subject', 'C subject', 'B subject', 'Root + A'])
    expect(git(dir, ['rev-list', '--max-parents=0', 'HEAD']).trim()).toBe(head(dir, 'HEAD~3'))
  })

  it('reports conflicts while rebasing and can be aborted', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const base = commitFile(dir, 'f.txt', '1\n', 'base')
    commitFile(dir, 'f.txt', '2\n', 'two')
    commitFile(dir, 'f.txt', '3\n', 'three')
    const before = head(dir)
    const todo = await todoFrom(dir, base, ([two, three]) => [three, two])
    const res = await ops.interactiveRebase(dir, base, todo)
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'rebase-interactive' })
    await ops.abortOperation(dir)
    expect(head(dir)).toBe(before)
  })

  it('rejects invalid todo lists without touching the repository', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    const before = head(dir)
    const commits = await ops.getRebaseCommits(dir, base)
    const pick = commits.map((c) => ({ action: 'pick' as const, sha: c.sha, subject: c.subject }))
    await expectCode(ops.interactiveRebase(dir, base, [{ ...pick[0], action: 'squash' }, ...pick.slice(1)]), 'INVALID_ARGUMENT')
    await expectCode(ops.interactiveRebase(dir, base, [pick[0], pick[0], pick[1], pick[2]]), 'INVALID_ARGUMENT')
    await expectCode(ops.interactiveRebase(dir, base, pick.slice(1)), 'INVALID_ARGUMENT')
    await expectCode(ops.interactiveRebase(dir, base, [...pick, { action: 'pick', sha: base, subject: 'base' }]), 'INVALID_ARGUMENT')
    await expectCode(ops.interactiveRebase(dir, base, []), 'INVALID_ARGUMENT')
    await expectCode(ops.interactiveRebase(dir, '--root', pick), 'INVALID_ARGUMENT')
    expect(head(dir)).toBe(before)
    expect(status(dir)).toBe('')
  })

  it('refuses to silently flatten merge commits (and the changes made in them) unless asked', async () => {
    const { ops, ctx } = makeOps()
    // A ← B ← Merge(side S, plus a fix made while merging) ← C
    const dir = initRepo()
    const a = commitFile(dir, 'a.txt', 'a\n', 'A')
    git(dir, ['checkout', '-q', '-b', 'side'])
    commitFile(dir, 's.txt', 's\n', 'S')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'b.txt', 'b\n', 'B')
    git(dir, ['merge', '-q', '--no-ff', '--no-commit', 'side'])
    write(dir, 'merge-fixup.txt', 'only in the merge\n')
    git(dir, ['add', 'merge-fixup.txt'])
    const date = nextDate()
    git(dir, ['commit', '-q', '-m', 'Merge side'], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
    commitFile(dir, 'c.txt', 'c\n', 'C')
    const before = head(dir)

    expect(await ops.getRebaseMergeCount(dir, a)).toBe(1)
    expect(await ops.getRebaseMergeCount(dir, 'ROOT')).toBe(1)
    expect(await ops.getRebaseMergeCount(dir, 'HEAD~1')).toBe(0)
    await expectCode(ops.getRebaseMergeCount(dir, 'nope'), 'NOT_FOUND')

    // The todo lists B, S, C only; starting it unchanged would linearise the history and lose merge-fixup.txt.
    const todo = await todoFrom(dir, a, (items) => items)
    expect(todo.map((t) => t.subject).sort()).toEqual(['B', 'C', 'S'])
    const err = await expectCode(ops.interactiveRebase(dir, a, todo), 'INVALID_ARGUMENT')
    expect(err.message).toMatch(/merge commit/)
    expect(head(dir)).toBe(before)
    expect(await ctx.operationState(dir)).toBe('none')
    expect(exists(dir, 'merge-fixup.txt')).toBe(true)

    // Explicit opt-in (after the UI confirmed): flattened, as git does with --no-rebase-merges.
    const res = await ops.interactiveRebase(dir, a, todo, { flattenMerges: true })
    expect(res.ok).toBe(true)
    expect(git(dir, ['rev-list', '--merges', '--count', 'HEAD']).trim()).toBe('0')

    // Linear ranges need no opt-in.
    const linear = linearRepo()
    expect(await ops.getRebaseMergeCount(linear.dir, linear.base)).toBe(0)
  })

  it('autostashes local changes', async () => {
    const { ops } = makeOps()
    const { dir, base } = linearRepo()
    write(dir, 'A.txt', 'local change\n')
    const todo = await todoFrom(dir, base, ([a, b, c, d]) => [a, b, d, c])
    expect((await ops.interactiveRebase(dir, base, todo)).ok).toBe(true)
    expect(read(dir, 'A.txt')).toBe('local change\n')
    expect(subjects(dir).slice(0, 2)).toEqual(['C subject', 'D subject'])
  })
})

describe('rebase state', () => {
  const marker = (dir: string) => path.join(dir, '.git', INTERACTIVE_REBASE_MARKER)

  /** main: base ← ours; other: base ← theirs (both change f.txt). */
  function divergedRepo(): string {
    const dir = initRepo()
    commitFile(dir, 'f.txt', 'base\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'f.txt', 'theirs\n', 'theirs')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'f.txt', 'ours\n', 'ours')
    git(dir, ['checkout', '-q', 'other'])
    return dir
  }

  it('reports a plain (merge-backend) rebase as "rebase", also when started from a terminal', async () => {
    const { ops, ctx } = makeOps()
    const dir = divergedRepo()
    const res = await ops.rebase(dir, 'main')
    expect(res).toMatchObject({ ok: false, conflicts: ['f.txt'], state: 'rebase' })
    // git itself marks it "interactive".
    expect(fs.existsSync(path.join(dir, '.git', 'rebase-merge', 'interactive'))).toBe(true)
    expect(fs.existsSync(marker(dir))).toBe(false)
    await ops.abortOperation(dir)
    expect(await ctx.operationState(dir)).toBe('none')

    // A plain rebase started from a terminal.
    expect(() => git(dir, ['rebase', 'main'])).toThrow()
    expect(await ctx.operationState(dir)).toBe('rebase')
    git(dir, ['rebase', '--abort'])
  }, 20_000)

  it('reports an interactive rebase as "rebase-interactive" and removes its marker when it ends', async () => {
    const { ops, ctx } = makeOps()
    const { dir, base } = linearRepo()
    const commits = await ops.getRebaseCommits(dir, base)
    const todo = commits.map((c, i) => ({ action: i === 1 ? ('edit' as const) : ('pick' as const), sha: c.sha, subject: c.subject }))
    expect((await ops.interactiveRebase(dir, base, todo)).state).toBe('rebase-interactive')
    expect(fs.existsSync(marker(dir))).toBe(true)
    expect(await ctx.operationState(dir)).toBe('rebase-interactive')
    expect((await ops.continueOperation(dir)).state).toBe('none')
    expect(fs.existsSync(marker(dir))).toBe(false)

    // Aborted from Adar.
    expect((await ops.interactiveRebase(dir, base, todo)).state).toBe('rebase-interactive')
    await ops.abortOperation(dir)
    expect(fs.existsSync(marker(dir))).toBe(false)
    expect(await ctx.operationState(dir)).toBe('none')
  }, 20_000)

  it('drops a stale marker once the rebase ended outside Adar, so the next plain rebase is not interactive', async () => {
    const { ops, ctx } = makeOps()
    const { dir, base } = linearRepo()
    const commits = await ops.getRebaseCommits(dir, base)
    const todo = commits.map((c, i) => ({ action: i === 0 ? ('edit' as const) : ('pick' as const), sha: c.sha, subject: c.subject }))
    expect((await ops.interactiveRebase(dir, base, todo)).state).toBe('rebase-interactive')
    git(dir, ['rebase', '--abort'])
    expect(fs.existsSync(marker(dir))).toBe(true)
    expect(await ctx.operationState(dir)).toBe('none')
    expect(fs.existsSync(marker(dir))).toBe(false)

    // A marker left behind (e.g. aborted from a terminal and never observed) does not leak into a plain rebase.
    const other = divergedRepo()
    fs.writeFileSync(marker(other), 'stale\n')
    const res = await ops.rebase(other, 'main')
    expect(res).toMatchObject({ ok: false, state: 'rebase' })
    await ops.abortOperation(other)
  }, 20_000)
})
