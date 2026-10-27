// getBranchCleanup on a clone: branches merged into main (locally or on origin), branches whose upstream
// was deleted (with and without commits of their own), and remote branches merged into main.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTmp, cloneSetup, commitFile, git, head, isolateGitConfig, makeOps } from '../../write/__tests__/helpers'
import { createRefsOps } from '../refs'

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

describe('getBranchCleanup', () => {
  it('tells merged branches from gone ones, and counts the commits only a gone branch has', async () => {
    const { repo } = cloneSetup()
    const { ctx } = makeOps()
    const ops = createRefsOps(ctx)

    // merged: in main and pushed; squashed: its work went in as another commit; gone-empty: deleted on origin, nothing of its own.
    git(repo, ['checkout', '-q', '-b', 'merged'])
    commitFile(repo, 'a.txt', 'a\n', 'Add a')
    git(repo, ['checkout', '-q', '-b', 'gone-empty'])
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['merge', '-q', '--ff-only', 'merged'])
    git(repo, ['push', '-q', 'origin', 'main', 'merged', 'gone-empty'])
    git(repo, ['checkout', '-q', '-b', 'squashed'])
    commitFile(repo, 'b.txt', 'b\n', 'Add b')
    commitFile(repo, 'c.txt', 'c\n', 'Add c')
    git(repo, ['push', '-q', '-u', 'origin', 'squashed'])
    git(repo, ['branch', '-q', '--set-upstream-to=origin/gone-empty', 'gone-empty'])
    // Origin deletes squashed and gone-empty after a squash merge on the web; a fetch with prune notices.
    git(repo, ['push', '-q', 'origin', '--delete', 'squashed', 'gone-empty'])
    git(repo, ['fetch', '-q', '--prune', 'origin'])
    git(repo, ['checkout', '-q', 'main'])

    const info = await ops.getBranchCleanup(repo, { base: 'main', remote: 'origin' })
    expect(info.base).toBe('main')
    expect(info.baseRefs).toEqual(['refs/heads/main', 'refs/remotes/origin/main'])
    const byName = Object.fromEntries(info.local.map((b) => [b.name, b]))
    expect(byName.main).toMatchObject({ merged: true, isHead: true, upstream: 'origin/main', upstreamGone: false })
    expect(byName.merged).toMatchObject({ merged: true, unique: 0, upstreamGone: false, subject: 'Add a' })
    expect(byName['gone-empty']).toMatchObject({ merged: true, upstreamGone: true, upstream: 'origin/gone-empty' })
    expect(byName.squashed).toMatchObject({ merged: false, upstreamGone: true, unique: 2, sha: head(repo, 'squashed'), subject: 'Add c' })
    expect(byName.squashed.date).toBeGreaterThan(0)
    expect(info.remote.map((b) => [b.name, b.merged]).sort()).toEqual([
      ['main', true],
      ['merged', true]
    ])

    await expect(ops.getBranchCleanup(repo, { base: '-x', remote: 'origin' })).rejects.toThrow(/Invalid base/)
    await expect(ops.getBranchCleanup(repo, { base: 'main', remote: '--upload-pack=x' })).rejects.toThrow(/Invalid remote/)
    expect((await ops.getBranchCleanup(repo, { base: 'nope', remote: null })).baseRefs).toEqual([])
  })
})
