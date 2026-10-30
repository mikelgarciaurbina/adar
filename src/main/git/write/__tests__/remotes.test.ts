import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdarEvent } from '@shared/types'
import { createGitContext } from '../../context'
import { keptBranches } from '../config'
import { createWriteOps } from '../index'
import {
  cleanupTmp,
  cloneSetup,
  commitFile,
  expectCode,
  fakePlatform,
  git,
  head,
  initRepo,
  isolateGitConfig,
  makeOps,
  read,
  subjects,
  tmpDir
} from './helpers'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

const remoteHead = (origin: string, ref: string) => git(origin, ['rev-parse', ref]).trim()

describe('tags', () => {
  it('creates lightweight and annotated tags, pushes and deletes them remotely', async () => {
    const { ops } = makeOps()
    const { origin, repo } = cloneSetup()
    const sha = head(repo)
    await ops.createTag(repo, 'v1.0', sha)
    expect(git(repo, ['cat-file', '-t', 'v1.0']).trim()).toBe('commit')
    await ops.createTag(repo, 'v2.0', sha, { message: 'Release 2\n\n#notes' })
    expect(git(repo, ['cat-file', '-t', 'v2.0']).trim()).toBe('tag')
    expect(git(repo, ['tag', '-l', '--format=%(contents)', 'v2.0']).trim()).toBe('Release 2\n\n#notes')
    await expectCode(ops.createTag(repo, 'v1.0', sha), 'INVALID_ARGUMENT')
    await expectCode(ops.createTag(repo, '-bad', sha), 'INVALID_ARGUMENT')

    await ops.pushTag(repo, 'origin', 'v2.0')
    expect(git(origin, ['tag', '-l']).trim()).toBe('v2.0')
    await ops.deleteRemoteTag(repo, 'origin', 'v2.0')
    expect(git(origin, ['tag', '-l']).trim()).toBe('')

    await ops.deleteTag(repo, 'v1.0')
    expect(git(repo, ['tag', '-l']).trim()).toBe('v2.0')
  })
})

describe('fetch / pull / push', () => {
  it('treats fetching a repository without remotes as a no-op', async () => {
    const { ops } = makeOps()
    const local = initRepo()
    commitFile(local, 'a.txt', 'a\n', 'init')
    await ops.fetch(local, {})
    await ops.fetch(local, { all: true, prune: true })
    await expectCode(ops.fetch(local, { remote: 'origin' }), 'GIT_FAILED')
  })

  it('fetches with progress events and prunes', async () => {
    const events: AdarEvent[] = []
    const ctx = createGitContext(fakePlatform, (e) => events.push(e))
    const ops = createWriteOps(ctx)
    const { repo, clone } = cloneSetup()
    const other = clone()
    git(other, ['checkout', '-q', '-b', 'gone'])
    git(other, ['push', '-q', 'origin', 'gone'])
    commitFile(other, 'x.txt', 'x\n', 'x')
    git(other, ['push', '-q', 'origin', 'gone'])

    await ops.fetch(repo, { opId: 'f1' })
    expect(git(repo, ['branch', '-r'])).toContain('origin/gone')
    expect(events.some((e) => e.type === 'progress' && e.opId === 'f1' && e.done)).toBe(true)

    git(other, ['push', '-q', 'origin', '--delete', 'gone'])
    await ops.fetch(repo, { all: true, prune: true })
    expect(git(repo, ['branch', '-r'])).not.toContain('origin/gone')
    await ops.fetch(repo, { remote: 'origin' })
  })

  it('pulls fast-forward, reports divergence, and merges or rebases on request', async () => {
    const { ops } = makeOps()
    const { repo, clone } = cloneSetup()
    const other = clone()
    commitFile(other, 'remote1.txt', '1\n', 'remote one')
    git(other, ['push', '-q', 'origin', 'main'])

    const ff = await ops.pull(repo, { mode: 'ff-only' })
    expect(ff).toMatchObject({ ok: true, state: 'none' })
    expect(subjects(repo)[0]).toBe('remote one')
    expect((await ops.pull(repo)).message).toMatch(/up to date/i)

    commitFile(other, 'remote2.txt', '2\n', 'remote two')
    git(other, ['push', '-q', 'origin', 'main'])
    commitFile(repo, 'local.txt', 'l\n', 'local one')

    const diverged = await ops.pull(repo, { mode: 'ff-only' })
    expect(diverged.ok).toBe(false)
    expect(diverged.conflicts).toEqual([])
    expect(diverged.message).toMatch(/not possible to fast-forward|diverg/i)

    const rebased = await ops.pull(repo, { mode: 'rebase' })
    expect(rebased).toMatchObject({ ok: true, state: 'none' })
    expect(subjects(repo).slice(0, 2)).toEqual(['local one', 'remote two'])

    commitFile(other, 'remote3.txt', '3\n', 'remote three')
    git(other, ['push', '-q', 'origin', 'main'])
    commitFile(repo, 'local2.txt', 'l\n', 'local two')
    const merged = await ops.pull(repo, { mode: 'merge' })
    expect(merged.ok).toBe(true)
    expect(git(repo, ['log', '-1', '--format=%P']).trim().split(' ')).toHaveLength(2)
  })

  it('returns conflicts from a pull', async () => {
    const { ops } = makeOps()
    const { repo, clone } = cloneSetup()
    const other = clone()
    commitFile(other, 'README.md', 'remote\n', 'remote edit')
    git(other, ['push', '-q', 'origin', 'main'])
    commitFile(repo, 'README.md', 'local\n', 'local edit')
    const res = await ops.pull(repo, { mode: 'merge' })
    expect(res).toMatchObject({ ok: false, conflicts: ['README.md'], state: 'merge' })
    const v = await ops.getConflictVersions(repo, 'README.md')
    expect(v).toMatchObject({ oursLabel: 'main', theirsLabel: 'origin/main', ours: 'local\n', theirs: 'remote\n' })
    await ops.abortOperation(repo)
  })

  it('requires an upstream and a branch to pull', async () => {
    const { ops } = makeOps()
    const { repo } = cloneSetup()
    git(repo, ['checkout', '-q', '-b', 'no-upstream'])
    const err = await expectCode(ops.pull(repo), 'INVALID_ARGUMENT')
    expect(err.message).toBe('no-upstream has no upstream')
    git(repo, ['checkout', '-q', '--detach'])
    await expectCode(ops.pull(repo), 'INVALID_ARGUMENT')
  })

  it('pushes with upstream setup, rejects non-fast-forwards and force-pushes with lease', async () => {
    const { ops } = makeOps()
    const { origin, repo, clone } = cloneSetup()

    git(repo, ['checkout', '-q', '-b', 'feature'])
    commitFile(repo, 'f.txt', 'f\n', 'feature')
    await ops.push(repo, { setUpstream: true, remoteBranch: 'feature-remote' })
    expect(remoteHead(origin, 'refs/heads/feature-remote')).toBe(head(repo))
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'feature@{upstream}']).trim()).toBe('origin/feature-remote')

    // Subsequent pushes go to the upstream branch name.
    commitFile(repo, 'f2.txt', 'f\n', 'feature 2')
    await ops.push(repo)
    expect(remoteHead(origin, 'refs/heads/feature-remote')).toBe(head(repo))

    // Someone else pushes to main → our push of main is rejected.
    const other = clone()
    commitFile(other, 'o.txt', 'o\n', 'other main')
    git(other, ['push', '-q', 'origin', 'main'])
    git(repo, ['checkout', '-q', 'main'])
    commitFile(repo, 'mine.txt', 'm\n', 'my main')
    const err = await expectCode(ops.push(repo), 'GIT_FAILED')
    expect(err.stderr).toMatch(/rejected/)

    // The lease is stale until we fetch. Fetching alone does not satisfy it either: the fetched commit was
    // never part of our main (push.useForceIfIncludes), so it would be overwritten unseen.
    const theirs = remoteHead(origin, 'refs/heads/main')
    await expectCode(ops.push(repo, { force: 'with-lease' }), 'GIT_FAILED')
    git(repo, ['fetch', '-q'])
    await expectCode(ops.push(repo, { force: 'with-lease' }), 'GIT_FAILED')
    expect(remoteHead(origin, 'refs/heads/main')).toBe(theirs)
    // Once main has contained it (merged, then deliberately dropped again), the lease passes.
    git(repo, ['merge', '-q', '--no-edit', 'origin/main'])
    git(repo, ['reset', '-q', '--hard', 'HEAD~1'])
    await ops.push(repo, { force: 'with-lease' })
    expect(remoteHead(origin, 'refs/heads/main')).toBe(head(repo))
  })

  it('force-with-lease never overwrites commits that only a background fetch brought in', async () => {
    const { ops } = makeOps()
    const { origin, repo, clone } = cloneSetup()
    commitFile(repo, 'mine.txt', 'm\n', 'mine')
    await ops.push(repo)

    // Rewriting our own pushed commit and force pushing it is the normal case.
    git(repo, ['commit', '-q', '--amend', '-m', 'mine (amended)'])
    await ops.push(repo, { force: 'with-lease' })
    expect(remoteHead(origin, 'refs/heads/main')).toBe(head(repo))

    // A coworker pushes; auto-fetch silently moves origin/main to their commit; we amend again.
    const other = clone()
    commitFile(other, 'o.txt', 'o\n', 'coworker')
    git(other, ['push', '-q', 'origin', 'main'])
    const coworker = head(other)
    git(repo, ['commit', '-q', '--amend', '-m', 'mine (amended twice)'])
    await ops.fetch(repo, { all: true, prune: true })
    expect(head(repo, 'origin/main')).toBe(coworker)

    const err = await expectCode(ops.push(repo, { force: 'with-lease' }), 'GIT_FAILED')
    expect(err.message).toMatch(/Force push refused: origin\/main has commits your local main has never contained/)
    expect(remoteHead(origin, 'refs/heads/main')).toBe(coworker)
  })

  it('force-with-lease works in a fresh clone, whose remote-tracking refs have no reflog yet', async () => {
    const { ops } = makeOps()
    const { origin, repo, clone } = cloneSetup()
    expect(fs.existsSync(path.join(repo, '.git', 'logs', 'refs', 'remotes', 'origin', 'main'))).toBe(false)
    git(repo, ['commit', '-q', '--amend', '--only', '-m', 'Initial commit (reworded)'])
    await ops.push(repo, { force: 'with-lease' })
    expect(remoteHead(origin, 'refs/heads/main')).toBe(head(repo))

    // Without that reflog the check is done by hand, and still protects commits main never contained.
    const other = clone()
    commitFile(other, 'o.txt', 'o\n', 'coworker')
    git(other, ['push', '-q', 'origin', 'main'])
    const coworker = head(other)
    git(repo, ['fetch', '-q'])
    fs.rmSync(path.join(repo, '.git', 'logs', 'refs', 'remotes', 'origin', 'main'))
    git(repo, ['commit', '-q', '--amend', '--only', '-m', 'Initial commit (reworded twice)'])
    const err = await expectCode(ops.push(repo, { force: 'with-lease' }), 'GIT_FAILED')
    expect(err.message).toMatch(/Force push refused: origin\/main has commits your local main has never contained/)
    expect(remoteHead(origin, 'refs/heads/main')).toBe(coworker)
  })

  it('force-with-lease also works once gc has emptied the remote-tracking reflog, with signatures shown in logs', async () => {
    const { ops } = makeOps()
    const { origin, repo } = cloneSetup()
    // Signed commits + log.showSignature: git log prints verification lines between the shas.
    const key = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-wtest-key-')), 'id')
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
    for (const [k, v] of [['gpg.format', 'ssh'], ['user.signingkey', key], ['commit.gpgSign', 'true'], ['log.showSignature', 'true']]) git(repo, ['config', k, v])
    commitFile(repo, 'a.txt', 'a\n', 'A')
    await ops.push(repo)
    commitFile(repo, 'b.txt', 'b\n', 'B')
    expect(git(repo, ['log', '-g', '--format=%H', 'main'])).toMatch(/signature/i)
    git(repo, ['reflog', 'expire', '--expire=now', 'refs/remotes/origin/main']) // what gc does after 90 days
    expect(fs.statSync(path.join(repo, '.git', 'logs', 'refs', 'remotes', 'origin', 'main')).size).toBe(0)
    git(repo, ['rebase', '-q', '--force-rebase', 'HEAD~2']) // rewrites the pushed A
    await ops.push(repo, { force: 'with-lease' })
    expect(remoteHead(origin, 'refs/heads/main')).toBe(head(repo))
  })

  it('validates push arguments', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    await expectCode(ops.push(dir), 'INVALID_ARGUMENT') // no remotes
    git(dir, ['checkout', '-q', '--detach'])
    await expectCode(ops.push(dir), 'INVALID_ARGUMENT') // detached
    await expectCode(ops.push(dir, { branch: 'main', remote: '--exec=evil' }), 'INVALID_ARGUMENT')
  })

  it('pushes tags with followTags and deletes remote branches', async () => {
    const { ops } = makeOps()
    const { origin, repo } = cloneSetup()
    commitFile(repo, 'a.txt', 'a\n', 'tagged')
    git(repo, ['tag', '-a', '-m', 'v', 'v3'])
    await ops.push(repo, { tags: true })
    expect(git(origin, ['tag', '-l']).trim()).toBe('v3')

    git(repo, ['push', '-q', 'origin', 'main:to-delete'])
    await ops.deleteRemoteBranch(repo, 'origin', 'to-delete')
    expect(git(origin, ['branch', '--list', 'to-delete']).trim()).toBe('')
  })
})

describe('remotes & config', () => {
  it('adds, renames, re-points and removes remotes', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    const other = path.join(tmpDir(), 'other.git')
    await ops.addRemote(dir, 'upstream', 'https://example.com/a.git')
    expect(git(dir, ['remote', 'get-url', 'upstream']).trim()).toBe('https://example.com/a.git')
    await expectCode(ops.addRemote(dir, 'upstream', 'https://example.com/b.git'), 'INVALID_ARGUMENT')
    await expectCode(ops.addRemote(dir, 'x', '--upload-pack=touch /tmp/pwned'), 'INVALID_ARGUMENT')
    await expectCode(ops.addRemote(dir, 'bad name', 'https://example.com/b.git'), 'INVALID_ARGUMENT')

    await ops.renameRemote(dir, 'upstream', 'fork')
    await ops.setRemoteUrl(dir, 'fork', other)
    expect(git(dir, ['remote', '-v'])).toContain(`fork\t${other} (fetch)`)
    await ops.removeRemote(dir, 'fork')
    expect(git(dir, ['remote']).trim()).toBe('')
    await expectCode(ops.removeRemote(dir, 'fork'), 'INVALID_ARGUMENT')
  })

  it('sets the local identity', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    await ops.setIdentity(dir, '  Ada Lovelace ', 'ada@example.com')
    expect(git(dir, ['config', '--local', 'user.name']).trim()).toBe('Ada Lovelace')
    expect(git(dir, ['config', '--local', 'user.email']).trim()).toBe('ada@example.com')
    await expectCode(ops.setIdentity(dir, 'Bad <name>', 'a@b'), 'INVALID_ARGUMENT')
    await expectCode(ops.setIdentity(dir, 'Name', ''), 'INVALID_ARGUMENT')
  })

  it('keeps branches out of Clean up branches in the repository config, shared by its worktrees', async () => {
    const { ctx, ops } = makeOps()
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['config', 'extensions.worktreeConfig', 'true'])
    const linked = path.join(tmpDir(), 'linked')
    git(dir, ['worktree', 'add', '-q', '-b', 'feat/x', linked])

    await ops.keepBranch(dir, 'pre', true)
    await ops.keepBranch(linked, 'env/*', true)
    await ops.keepBranch(dir, 'pre', true)
    await ops.keepBranch(dir, 'fix(1).a+b', true)
    expect(git(dir, ['config', '--local', '--get-all', 'adar.keepBranch']).trim().split('\n')).toEqual(['pre', 'env/*', 'fix(1).a+b'])
    expect(await keptBranches(ctx, linked)).toEqual(['pre', 'env/*', 'fix(1).a+b'])
    expect(fs.existsSync(path.join(dir, '.git', 'worktrees', 'linked', 'config.worktree'))).toBe(false)

    // Removing matches the exact value only (not as a regular expression).
    await ops.keepBranch(dir, 'fix(1)xa+b', false)
    await ops.keepBranch(dir, 'fix(1).a+b', false)
    await ops.keepBranch(linked, 'pre', false)
    expect(await keptBranches(ctx, dir)).toEqual(['env/*'])
    await ops.keepBranch(dir, 'env/*', false)
    expect(await keptBranches(ctx, dir)).toEqual([])

    await expectCode(ops.keepBranch(dir, '-pre', true), 'INVALID_ARGUMENT')
    await expectCode(ops.keepBranch(dir, 'a b', true), 'INVALID_ARGUMENT')
    await expectCode(ops.keepBranch(dir, 'a..b', true), 'INVALID_ARGUMENT')
    await expectCode(ops.keepBranch(dir, '', true), 'INVALID_ARGUMENT')
  })

  it('reads only valid kept names', async () => {
    const { ctx } = makeOps()
    const dir = initRepo()
    git(dir, ['config', '--add', 'adar.keepBranch', 'qa'])
    git(dir, ['config', '--add', 'adar.keepBranch', '--force'])
    git(dir, ['config', '--add', 'adar.keepBranch', 'qa'])
    git(dir, ['config', '--add', 'adar.keepBranch', 'release/*'])
    expect(await keptBranches(ctx, dir)).toEqual(['qa', 'release/*'])
  })

  it('sets the global identity in the (isolated) global config', async () => {
    const { ops } = makeOps()
    await ops.setIdentity(null, 'Global Name', 'global@example.com')
    const file = process.env.GIT_CONFIG_GLOBAL as string
    expect(fs.readFileSync(file, 'utf8')).toContain('Global Name')
  })

  it('updates submodules', async () => {
    const { ops } = makeOps()
    const sub = initRepo()
    commitFile(sub, 's.txt', 's\n', 'sub')
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'a\n', 'a')
    git(dir, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'libs/sub'])
    git(dir, ['commit', '-q', '-m', 'add sub'])
    const parent = tmpDir()
    git(parent, ['clone', '-q', dir, 'clone'])
    const cloned = path.join(parent, 'clone')
    // Local-path submodule clones need this since git 2.38.1 (goes to the isolated global config).
    git(cloned, ['config', '--global', 'protocol.file.allow', 'always'])
    await ops.updateSubmodules(cloned, { init: true, recursive: true })
    expect(read(cloned, 'libs/sub/s.txt')).toBe('s\n')
  })
})
