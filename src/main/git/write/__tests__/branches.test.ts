import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTmp,
  cloneSetup,
  commitFile,
  expectCode,
  git,
  head,
  initRepo,
  isolateGitConfig,
  makeOps,
  read,
  status,
  write
} from './helpers'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

const current = (dir: string) => git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim()

describe('checkout', () => {
  it('checks out a local branch', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['branch', 'feature'])
    await ops.checkout(dir, 'feature')
    expect(current(dir)).toBe('feature')
    await ops.checkout(dir, 'refs/heads/main')
    expect(current(dir)).toBe('main')
  })

  it('creates a tracking branch for a remote branch, or checks out the existing local one', async () => {
    const { ops } = makeOps()
    const { repo, clone } = cloneSetup()
    const other = clone()
    git(other, ['checkout', '-q', '-b', 'feature/x'])
    commitFile(other, 'x.txt', 'x\n', 'x')
    git(other, ['push', '-q', 'origin', 'feature/x'])
    git(repo, ['fetch', '-q'])

    await ops.checkout(repo, 'origin/feature/x')
    expect(current(repo)).toBe('feature/x')
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'feature/x@{upstream}']).trim()).toBe('origin/feature/x')

    await ops.checkout(repo, 'main')
    await ops.checkout(repo, 'origin/feature/x')
    expect(current(repo)).toBe('feature/x')

    // origin/HEAD → origin/main → existing local main
    await ops.checkout(repo, 'origin/HEAD')
    expect(current(repo)).toBe('main')
  })

  it('detaches HEAD for tags and shas', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const first = commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['tag', 'v1'])
    commitFile(dir, 'a.txt', 'b\n', 'b')
    await ops.checkout(dir, 'v1')
    expect(head(dir)).toBe(first)
    expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')
    await ops.checkout(dir, 'main')
    await ops.checkout(dir, first.slice(0, 10))
    expect(head(dir)).toBe(first)
    await expectCode(ops.checkout(dir, 'does-not-exist'), 'NOT_FOUND')
  })

  it('reports local changes that would be overwritten as DIRTY_WORKTREE, and force discards them', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    // A file name containing "conflict" must not confuse the classification.
    commitFile(dir, 'conflict.txt', 'main\n', 'main')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'conflict.txt', 'other\n', 'other')
    git(dir, ['checkout', '-q', 'main'])
    write(dir, 'conflict.txt', 'local edit\n')
    const err = await expectCode(ops.checkout(dir, 'other'), 'DIRTY_WORKTREE')
    expect(err.stderr).toMatch(/would be overwritten/)
    expect(current(dir)).toBe('main')
    await ops.checkout(dir, 'other', { force: true })
    expect(current(dir)).toBe('other')
    expect(read(dir, 'conflict.txt')).toBe('other\n')
  })

  it('rejects option-looking refs', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    await expectCode(ops.checkout(dir, '--orphan=x'), 'INVALID_ARGUMENT')
  })
})

describe('branches', () => {
  it('creates (with and without checkout), renames and deletes branches', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const first = commitFile(dir, 'a.txt', 'a\n', 'a')
    commitFile(dir, 'a.txt', 'b\n', 'b')

    await ops.createBranch(dir, 'from-first', first)
    expect(head(dir, 'from-first')).toBe(first)
    expect(current(dir)).toBe('main')

    await ops.createBranch(dir, 'topic', undefined, { checkout: true })
    expect(current(dir)).toBe('topic')
    await expectCode(ops.createBranch(dir, 'topic'), 'INVALID_ARGUMENT')
    await expectCode(ops.createBranch(dir, 'bad name'), 'INVALID_ARGUMENT')
    await expectCode(ops.createBranch(dir, '-x'), 'INVALID_ARGUMENT')

    await ops.renameBranch(dir, 'topic', 'topic-renamed')
    expect(current(dir)).toBe('topic-renamed')
    await ops.checkout(dir, 'main')

    await ops.deleteBranch(dir, 'topic-renamed')
    expect(git(dir, ['branch', '--list', 'topic-renamed']).trim()).toBe('')
  })

  it('needs force to delete an unmerged branch', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['checkout', '-q', '-b', 'unmerged'])
    commitFile(dir, 'b.txt', 'b\n', 'b')
    git(dir, ['checkout', '-q', 'main'])
    const err = await expectCode(ops.deleteBranch(dir, 'unmerged'), 'GIT_FAILED')
    expect(`${err.stderr} ${err.message}`).toMatch(/not fully merged/)
    await ops.deleteBranch(dir, 'unmerged', { force: true })
    expect(git(dir, ['branch', '--list', 'unmerged']).trim()).toBe('')
  })

  it('sets and unsets upstreams (including a remote branch that does not exist yet)', async () => {
    const { ops } = makeOps()
    const { repo } = cloneSetup()
    git(repo, ['branch', 'local-only'])
    await ops.setUpstream(repo, 'local-only', 'origin/main')
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'local-only@{upstream}']).trim()).toBe('origin/main')
    await ops.setUpstream(repo, 'local-only', null)
    expect(git(repo, ['config', '--list', '--local'])).not.toMatch(/^branch\.local-only\./m)
    // Unsetting twice is a no-op.
    await ops.setUpstream(repo, 'local-only', null)

    await ops.setUpstream(repo, 'local-only', 'origin/not-pushed-yet')
    expect(git(repo, ['config', 'branch.local-only.remote']).trim()).toBe('origin')
    expect(git(repo, ['config', 'branch.local-only.merge']).trim()).toBe('refs/heads/not-pushed-yet')
  })
})

describe('fastForwardBranch', () => {
  it('fast-forwards a branch that is not checked out, and the current one', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const first = commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['branch', 'behind'])
    const second = commitFile(dir, 'a.txt', 'b\n', 'b')
    await ops.fastForwardBranch(dir, 'behind', 'main')
    expect(head(dir, 'behind')).toBe(second)
    expect(git(dir, ['reflog', '-1', '--format=%gs', 'behind']).trim()).toMatch(/^adar: fast-forward/)

    git(dir, ['checkout', '-q', '-b', 'cur', first])
    await ops.fastForwardBranch(dir, 'cur', 'main')
    expect(head(dir)).toBe(second)
    expect(status(dir)).toBe('')
  })

  it('refuses when it is not a fast-forward', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['checkout', '-q', '-b', 'diverged'])
    const tip = commitFile(dir, 'd.txt', 'd\n', 'd')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'm.txt', 'm\n', 'm')
    const err = await expectCode(ops.fastForwardBranch(dir, 'diverged', 'main'), 'INVALID_ARGUMENT')
    expect(err.message).toMatch(/not a fast-forward/)
    expect(head(dir, 'diverged')).toBe(tip)
  })
})

describe('reset', () => {
  it('supports soft, mixed and hard', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const first = commitFile(dir, 'a.txt', 'a\n', 'a')
    commitFile(dir, 'a.txt', 'b\n', 'b')
    const third = commitFile(dir, 'a.txt', 'c\n', 'c')

    await ops.reset(dir, first, 'soft')
    expect(head(dir)).toBe(first)
    expect(status(dir)).toBe('M  a.txt')

    git(dir, ['reset', '-q', '--hard', third])
    await ops.reset(dir, first, 'mixed')
    expect(status(dir)).toBe(' M a.txt')
    expect(read(dir, 'a.txt')).toBe('c\n')

    git(dir, ['reset', '-q', '--hard', third])
    await ops.reset(dir, 'HEAD~1', 'hard')
    expect(status(dir)).toBe('')
    expect(read(dir, 'a.txt')).toBe('b\n')

    await expectCode(ops.reset(dir, 'nope', 'hard'), 'NOT_FOUND')
    await expectCode(ops.reset(dir, first, 'keep' as never), 'INVALID_ARGUMENT')
  })
})
