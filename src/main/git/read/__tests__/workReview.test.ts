// Reviewing an agent's work: a worktree's commits and changes not committed against main as one snapshot, without
// touching the worktree's index or branches; the same files give the same snapshot; how the work moved on since the
// version reviewed (went on from it, rewritten, gone).

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTmp, commitFile, git, head, initRepo, isolateGitConfig, makeOps, status, tmpDir, write } from '../../write/__tests__/helpers'
import { createHistoryOps } from '../history'
import { countStatus, createWorkReviewOps } from '../workReview'

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

function setup() {
  const repo = fs.realpathSync(initRepo())
  commitFile(repo, 'a.txt', 'one\n', 'first')
  commitFile(repo, 'gone.txt', 'bye\n', 'second')
  const wt = path.join(fs.realpathSync(tmpDir('adar-wr-')), 'agent')
  git(repo, ['worktree', 'add', '-q', '-b', 'claude/feature', wt])
  const { ctx } = makeOps()
  return { repo, wt, work: createWorkReviewOps(ctx), history: createHistoryOps(ctx) }
}

const paths = (files: Array<{ path: string }>) => files.map((f) => f.path).sort()

describe('reviewing an agent’s work', () => {
  it('counts the files of git status --porcelain -z', () => {
    expect(countStatus(' M a.txt\0?? b c.txt\0R  new.txt\0old.txt\0A  d.txt\0')).toBe(4)
    expect(countStatus('')).toBe(0)
  })

  it('takes the commits and every change not committed, leaving the index and branches alone', async () => {
    const { repo, wt, work, history } = setup()
    const main = head(repo)
    commitFile(wt, 'b.txt', 'b\n', 'Add b')
    write(wt, 'a.txt', 'one\ntwo\n')
    write(wt, 'staged.txt', 'staged\n')
    git(wt, ['add', 'staged.txt'])
    fs.rmSync(path.join(wt, 'gone.txt'))
    write(wt, 'u.txt', 'untracked\n')
    write(wt, '.gitignore', 'build/\n')
    write(wt, 'build/out.js', 'ignored\n')

    const indexFile = git(wt, ['rev-parse', '--git-path', 'index']).trim()
    const indexBefore = fs.readFileSync(path.resolve(wt, indexFile))
    const statusBefore = status(wt)
    const refsBefore = git(repo, ['for-each-ref'])

    const range = await work.prepareWorkReview(wt)
    expect(range).toMatchObject({ branch: 'claude/feature', baseRef: 'main', base: main, tip: head(wt), uncommitted: 5, uncommittedLeftOut: 0, since: null, sinceState: 'none' })
    expect(git(wt, ['cat-file', '-t', range.head]).trim()).toBe('tree')
    expect(paths(await history.getCompareFiles(wt, range.base, range.head))).toEqual(['.gitignore', 'a.txt', 'b.txt', 'gone.txt', 'staged.txt', 'u.txt'])

    expect(fs.readFileSync(path.resolve(wt, indexFile)).equals(indexBefore)).toBe(true)
    expect(status(wt)).toBe(statusBefore)
    expect(git(repo, ['for-each-ref'])).toBe(refsBefore)
    // The same files, the same snapshot.
    expect((await work.prepareWorkReview(wt)).head).toBe(range.head)
  })

  it('says how the work moved on since the version reviewed', async () => {
    const { wt, work, history } = setup()
    commitFile(wt, 'b.txt', 'b\n', 'Add b')
    write(wt, 'a.txt', 'one\ntwo\n')
    const first = await work.prepareWorkReview(wt)
    const mark = { head: first.head, tip: first.tip }

    expect(await work.prepareWorkReview(wt, { since: mark })).toMatchObject({ since: first.head, sinceState: 'ancestor', sinceCommits: 0 })

    // The agent commits what was reviewed: nothing to see again.
    git(wt, ['commit', '-qam', 'Two'])
    const committed = await work.prepareWorkReview(wt, { since: mark })
    expect(committed).toMatchObject({ head: head(wt), uncommitted: 0, sinceState: 'ancestor', sinceCommits: 1, onlyMerges: false })
    expect(await history.getCompareFiles(wt, mark.head, committed.head)).toEqual([])

    // Then goes on: only that file changed since.
    write(wt, 'b.txt', 'b\nmore\n')
    const more = await work.prepareWorkReview(wt, { since: mark })
    expect(paths(await history.getCompareFiles(wt, mark.head, more.head))).toEqual(['b.txt'])

    // Amended: the commit reviewed is no longer in the branch.
    const later = { head: committed.head, tip: committed.tip }
    git(wt, ['commit', '-qa', '--amend', '-m', 'Two, amended'])
    expect((await work.prepareWorkReview(wt, { since: later })).sinceState).toBe('rewritten')

    expect((await work.prepareWorkReview(wt, { since: { head: '0'.repeat(40), tip: '0'.repeat(40) } })).sinceState).toBe('missing')
    await expect(work.prepareWorkReview(wt, { since: { head: 'HEAD', tip: 'HEAD' } })).rejects.toThrow(/Invalid commit/)
  })

  it('on the base branch itself, shows only what is not committed', async () => {
    const { repo, work, history } = setup()
    write(repo, 'a.txt', 'changed\n')
    const range = await work.prepareWorkReview(repo)
    expect(range).toMatchObject({ branch: 'main', baseRef: null, base: head(repo), tip: head(repo), uncommitted: 1 })
    expect(paths(await history.getCompareFiles(repo, range.base, range.head))).toEqual(['a.txt'])
  })
})
