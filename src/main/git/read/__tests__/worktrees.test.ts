// Worktrees on a real repository: adding (existing and new branches), listing with changes, branches
// checked out elsewhere in refs and in the cleanup data, removing (refused with changes unless forced),
// locking, and forgetting one whose folder is gone.

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTmp, commitFile, git, initRepo, isolateGitConfig, makeOps, tmpDir } from '../../write/__tests__/helpers'
import { createRefsOps } from '../refs'
import { createRepoOps } from '../repo'
import { createWorktreeReadOps, parseWorktreeList } from '../worktrees'

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

describe('worktrees', () => {
  it('parses git worktree list --porcelain', () => {
    expect(
      parseWorktreeList('worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r-x\nHEAD bbb\ndetached\nlocked on a drive\n\nworktree /gone\nHEAD ccc\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n')
    ).toEqual([
      { path: '/r', sha: 'aaa', branch: 'main', bare: false, locked: false, prunable: false },
      { path: '/r-x', sha: 'bbb', branch: null, bare: false, locked: true, prunable: false },
      { path: '/gone', sha: 'ccc', branch: 'old', bare: false, locked: false, prunable: true }
    ])
  })

  it('adds, lists, marks, locks, removes and forgets worktrees', async () => {
    const repo = fs.realpathSync(initRepo())
    commitFile(repo, 'a.txt', 'a\n', 'first')
    git(repo, ['branch', 'feat/x'])
    const { ctx, ops } = makeOps()
    const read = createWorktreeReadOps(ctx)
    const parent = fs.realpathSync(tmpDir('adar-wt-'))

    const x = await ops.addWorktree(repo, { path: path.join(parent, 'repo-x'), branch: 'feat/x' })
    expect(x).toBe(path.join(parent, 'repo-x'))
    const y = await ops.addWorktree(repo, { path: path.join(parent, 'repo-y'), branch: 'feat/y', from: 'main' })
    await expect(ops.addWorktree(repo, { path: path.join(parent, 'repo-z'), branch: 'feat/x' })).rejects.toThrow(/already checked out/)
    await expect(ops.addWorktree(repo, { path: x, branch: 'main' })).rejects.toThrow(/already exists/)
    await expect(ops.addWorktree(repo, { path: 'relative', branch: 'main' })).rejects.toThrow(/absolute/)
    fs.writeFileSync(path.join(x, 'b.txt'), 'b\n')

    const list = await read.getWorktrees(repo)
    expect(list.map((w) => [w.name, w.branch, w.isMain, w.isCurrent, w.changes, w.changedFiles])).toEqual([
      [path.basename(repo), 'main', true, true, 0, []],
      ['repo-x', 'feat/x', false, false, 1, ['b.txt']],
      ['repo-y', 'feat/y', false, false, 0, []]
    ])
    // From the worktree, the main one is not "current".
    expect((await read.getWorktrees(x)).find((w) => w.isCurrent)?.name).toBe('repo-x')

    const refs = await createRefsOps(ctx).getRefs(repo)
    expect(Object.fromEntries(refs.branches.map((b) => [b.name, b.worktree ?? null]))).toEqual({ main: null, 'feat/x': x, 'feat/y': y })
    const cleanup = await createRefsOps(ctx).getBranchCleanup(repo, { base: 'main', remote: null })
    expect(cleanup.local.find((b) => b.name === 'feat/y')?.worktree).toBe(y)

    const repoOps = createRepoOps(ctx, { settings: {}, watcher: {} } as never)
    expect((await repoOps.getRepoInfo(x)).mainWorktree).toBe(repo)
    expect((await repoOps.getRepoInfo(repo)).mainWorktree).toBeNull()

    await expect(ops.removeWorktree(repo, x)).rejects.toMatchObject({ code: 'DIRTY_WORKTREE' })
    await expect(ops.removeWorktree(repo, repo)).rejects.toThrow(/main worktree/)
    await expect(ops.removeWorktree(x, x)).rejects.toThrow(/another tab/)
    await ops.setWorktreeLocked(repo, y, true)
    expect((await read.getWorktrees(repo)).find((w) => w.name === 'repo-y')?.locked).toBe(true)
    await expect(ops.removeWorktree(repo, y)).rejects.toThrow(/locked/)
    await ops.setWorktreeLocked(repo, y, false)
    await ops.removeWorktree(repo, x, { force: true })
    expect(fs.existsSync(x)).toBe(false)
    expect(git(repo, ['branch', '--list', 'feat/x']).trim()).toContain('feat/x')

    fs.rmSync(y, { recursive: true, force: true })
    expect((await read.getWorktrees(repo)).find((w) => w.name === 'repo-y')).toMatchObject({ missing: true, changes: null })
    await ops.pruneWorktrees(repo)
    expect((await read.getWorktrees(repo)).map((w) => w.name)).toEqual([path.basename(repo)])
  })
})
