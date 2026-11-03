// The reflog and lost commits on a real repository: a reset, a deleted branch, work on a detached HEAD
// and an amend each leave commits behind; the reflog says how each move happened.

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTmp, commitFile, git, head, initRepo, isolateGitConfig, makeOps, nextDate } from '../../write/__tests__/helpers'
import { describeMove, expireDays, groupLostCommits, type RawMove } from '../../parsers/reflog'
import { createReflogOps } from '../reflog'

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

/** A git command whose reflog entry gets the next fake date. */
const at = (repo: string, args: string[]) => git(repo, args, { env: { GIT_COMMITTER_DATE: nextDate(), GIT_AUTHOR_DATE: nextDate() } })

describe('lost commits', () => {
  it('groups what a reset, a deleted branch, a detached HEAD and an amend left behind', async () => {
    const repo = initRepo()
    const ops = createReflogOps(makeOps().ctx)
    commitFile(repo, 'a.txt', '1\n', 'One')
    const two = commitFile(repo, 'a.txt', '2\n', 'Two')
    const three = commitFile(repo, 'a.txt', '3\n', 'Three')
    at(repo, ['checkout', '-q', '-b', 'feat/old-cards'])
    const feat = commitFile(repo, 'b.txt', 'b\n', 'Old cards')
    at(repo, ['checkout', '-q', 'main'])
    at(repo, ['branch', '-q', '-D', 'feat/old-cards'])
    const four = commitFile(repo, 'a.txt', '4\n', 'Four')
    at(repo, ['reset', '-q', '--hard', two])

    let lost = await ops.getLostCommits(repo)
    expect(lost.expireDays).toBe(30)
    expect(lost.groups.map((g) => [g.kind, g.branch, g.commits.map((c) => c.subject), g.canMoveBack, g.canRestore])).toEqual([
      ['reset', 'main', ['Four', 'Three'], true, false],
      ['deleted', 'feat/old-cards', ['Old cards'], false, true]
    ])
    expect(lost.groups[0]).toMatchObject({ move: 'reset: moving to ' + two, to: two })
    expect(lost.groups[0].commits.map((c) => c.sha)).toEqual([four, three])
    expect(lost.groups[1].commits[0]).toMatchObject({ sha: feat, parents: [three], author: 'Test User' })

    // A commit on a detached HEAD, left for main; then main moves on and amends.
    at(repo, ['checkout', '-q', '--detach', two])
    commitFile(repo, 'c.txt', 'c\n', 'Try it')
    at(repo, ['checkout', '-q', 'main'])
    commitFile(repo, 'a.txt', '5\n', 'Five')
    at(repo, ['commit', '-q', '--amend', '-m', 'Five, amended'])

    lost = await ops.getLostCommits(repo)
    expect(lost.groups.map((g) => [g.kind, g.branch, g.commits.map((c) => c.subject), g.canMoveBack])).toEqual([
      ['detached', null, ['Try it'], false],
      ['reset', 'main', ['Four', 'Three'], false],
      ['deleted', 'feat/old-cards', ['Old cards'], false],
      ['rewritten', 'main', ['Five'], false]
    ])

    // Restoring the branch makes its commits (and Three) reachable again.
    git(repo, ['branch', 'feat/old-cards', feat])
    lost = await ops.getLostCommits(repo)
    expect(lost.groups.map((g) => [g.kind, g.commits.map((c) => c.subject)])).toEqual([
      ['detached', ['Try it']],
      ['reset', ['Four']],
      ['rewritten', ['Five']]
    ])

    git(repo, ['config', 'gc.reflogExpireUnreachable', 'never'])
    expect((await ops.getLostCommits(repo)).expireDays).toBeNull()
  })

  it('lists the moves of HEAD or a branch in words, marking what is lost', async () => {
    const repo = initRepo()
    const ops = createReflogOps(makeOps().ctx)
    commitFile(repo, 'a.txt', '1\n', 'One')
    const two = commitFile(repo, 'a.txt', '2\n', 'Two')
    commitFile(repo, 'a.txt', '3\n', 'Three')
    at(repo, ['reset', '-q', '--hard', two])
    at(repo, ['checkout', '-q', '-b', 'feat'])
    at(repo, ['commit', '-q', '--allow-empty', '-m', 'Feat'])

    const moves = await ops.getReflog(repo, null)
    expect(moves.map((m) => [m.kind, m.detail, m.subject, m.lost])).toEqual([
      ['commit', 'Feat', 'Feat', false],
      ['checkout', 'moving from main to feat', 'Two', false],
      ['reset', `moving to ${two.slice(0, 7)}`, 'Two', false],
      ['commit', 'Three', 'Three', true],
      ['commit', 'Two', 'Two', false],
      ['commit', 'One', 'One', false]
    ])
    expect(moves[0].date).toBeGreaterThan(moves[1].date)
    expect((await ops.getReflog(repo, 'feat')).map((m) => m.kind)).toEqual(['commit', 'branch'])
    expect(await ops.getReflog(repo, 'nope')).toEqual([])
    await expect(ops.getReflog(repo, '--all')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(head(repo)).toBe(head(repo, 'feat'))
  })

  it('looks deeper for commits no reflog remembers: dropped stashes', async () => {
    const repo = initRepo()
    const ops = createReflogOps(makeOps().ctx)
    commitFile(repo, 'a.txt', '1\n', 'One')
    expect(await ops.findDanglingCommits(repo)).toEqual([])
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n')
    git(repo, ['stash', 'push', '-q', '-m', 'half-done notes'])
    git(repo, ['stash', 'drop', '-q'])
    const dangling = await ops.findDanglingCommits(repo)
    expect(dangling).toHaveLength(1)
    expect(dangling[0]).toMatchObject({ subject: 'On main: half-done notes', stash: true })
  })
})

describe('reflog words', () => {
  it('tells what each move did', () => {
    expect(describeMove('commit (amend): Fix rounding')).toEqual({ kind: 'amend', detail: 'Fix rounding' })
    expect(describeMove('commit (initial): One')).toEqual({ kind: 'commit', detail: 'One' })
    expect(describeMove('commit (merge): Merge feat')).toEqual({ kind: 'merge', detail: 'Merge feat' })
    expect(describeMove('merge feat/search: Fast-forward')).toEqual({ kind: 'merge', detail: 'feat/search: Fast-forward' })
    expect(describeMove('rebase (finish): returning to refs/heads/feat')).toEqual({ kind: 'rebase', detail: 'finish: returning to feat' })
    expect(describeMove('rebase -i (pick): Search')).toEqual({ kind: 'rebase', detail: 'pick: Search' })
    expect(describeMove('pull: Fast-forward')).toEqual({ kind: 'pull', detail: 'Fast-forward' })
    expect(describeMove('pull --rebase (finish): returning to refs/heads/main')).toEqual({ kind: 'rebase', detail: 'finish: returning to main' })
    expect(describeMove('cherry-pick: Fix')).toEqual({ kind: 'cherry-pick', detail: 'Fix' })
    expect(describeMove('branch: Created from HEAD')).toEqual({ kind: 'branch', detail: 'Created from HEAD' })
    expect(describeMove('Branch: renamed refs/heads/a to refs/heads/b')).toEqual({ kind: 'branch', detail: 'renamed a to b' })
    expect(describeMove('clone: from git@github.com:a/b.git')).toEqual({ kind: 'other', detail: 'clone: from git@github.com:a/b.git' })
    expect(describeMove(`merge ${'a'.repeat(40)}: Fast-forward`)).toEqual({ kind: 'merge', detail: 'aaaaaaa: Fast-forward' })
  })

  it('reads how long git keeps lost commits', () => {
    expect(expireDays(null)).toBe(30)
    expect(expireDays('30.days.ago')).toBe(30)
    expect(expireDays('2.weeks')).toBe(14)
    expect(expireDays('never')).toBeNull()
    expect(expireDays('now')).toBe(0)
    expect(expireDays('soon')).toBe(30)
  })

  it('counts the days left from the newest reflog entry of a group', () => {
    const now = 1_800_000_000
    const day = 86400
    const sha = (c: string) => c.repeat(40)
    const moves: RawMove[] = [
      { ref: 'refs/heads/main', sha: sha('b'), date: now - 2 * day, move: 'reset: moving to HEAD~1', subject: 'B', author: 'A' },
      { ref: 'refs/heads/main', sha: sha('c'), date: now - 6 * day, move: 'commit: C', subject: 'C', author: 'A' },
      { ref: 'refs/heads/main', sha: sha('b'), date: now - 7 * day, move: 'commit: B', subject: 'B', author: 'A' }
    ]
    const lost = [{ sha: sha('c'), parents: [sha('b')], subject: 'C', author: 'A', email: 'a@x', date: now - 6 * day }]
    const [group] = groupLostCommits({ moves, lost, branches: new Set(['main']), expireDays: 30, now })
    expect(group).toMatchObject({ kind: 'reset', branch: 'main', daysLeft: 28, date: now - 2 * day })
    expect(groupLostCommits({ moves, lost, branches: new Set(['main']), expireDays: null, now })[0].daysLeft).toBeNull()
  })
})
