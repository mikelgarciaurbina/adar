// Diffs of files that are not valid UTF-8 (Latin-1, CP1252...): the decoded text has U+FFFD in place
// of the original bytes, so line / hunk staging must be refused instead of writing EF BF BD.
import { cleanupTempDirs, commitAll, fakePlatform, git, initTestRepo, isolateGitConfig, tempDir, write } from './helpers'

isolateGitConfig()

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { buildPartialPatch, patchApplyOptions, supportsPartialPatch } from '@shared/patch'
import { createGitContext } from '../../context'
import { createWriteOps } from '../../write'
import { createDiffOps } from '../diff'

afterAll(cleanupTempDirs)

const ctx = createGitContext(fakePlatform(tempDir('adar-userdata-')), () => undefined)
const { getDiff } = createDiffOps(ctx)
const { applyPatch } = createWriteOps(ctx)

/** Bytes of `git show <rev>` (index ":f", "HEAD:f"...). */
const blob = (repo: string, rev: string) => execFileSync('git', ['show', rev], { cwd: repo })

const LATIN1 = Buffer.from('greeting=caf\xe9\n', 'latin1')

describe('diffs of non-UTF-8 text', () => {
  it('flags the diff as encodingLossy so no partial patch can be built (stage, unstage, discard)', async () => {
    const repo = initTestRepo()
    write(repo, 'f.properties', 'line1\nline2\nline3\nline4\n')
    commitAll(repo, 'ascii')
    write(repo, 'f.properties', Buffer.concat([Buffer.from('line1\nline2\nline3\nline4\n'), LATIN1]))

    const unstaged = await getDiff(repo, { kind: 'unstaged', path: 'f.properties' })
    expect(unstaged).toMatchObject({ status: 'modified', binary: false, encodingLossy: true })
    expect(unstaged.hunks).toHaveLength(1)
    expect(supportsPartialPatch(unstaged, 'stage')).toBe(false)
    expect(supportsPartialPatch(unstaged, 'discard')).toBe(false)
    expect(buildPartialPatch(unstaged, [{ hunkIndex: 0 }], 'stage')).toBeNull()

    // Staged (HEAD → index) and commit diffs carry the flag too.
    git(repo, ['add', 'f.properties'])
    const staged = await getDiff(repo, { kind: 'staged', path: 'f.properties' })
    expect(staged.encodingLossy).toBe(true)
    expect(buildPartialPatch(staged, [{ hunkIndex: 0 }], 'unstage')).toBeNull()
    const sha = commitAll(repo, 'latin1 line')
    expect((await getDiff(repo, { kind: 'commit', sha, path: 'f.properties' })).encodingLossy).toBe(true)
  })

  it('leaves UTF-8 diffs (including a genuine U+FFFD character) alone', async () => {
    const repo = initTestRepo()
    write(repo, 'u.txt', 'a\nb\n')
    commitAll(repo, 'base')
    write(repo, 'u.txt', 'a\nb\ncafé �\n')
    const d = await getDiff(repo, { kind: 'unstaged', path: 'u.txt' })
    expect(d.encodingLossy).toBeUndefined()
    const patch = buildPartialPatch(d, [{ hunkIndex: 0 }], 'stage')
    expect(patch).not.toBeNull()
    // applyPatch's own guard lets it through: every version of the file is valid UTF-8.
    await applyPatch(repo, patch!, patchApplyOptions('stage'))
    expect(blob(repo, ':u.txt').toString('utf8')).toBe('a\nb\ncafé �\n')
  })

  it('applyPatch refuses a patch decoded from non-UTF-8 text instead of writing U+FFFD bytes', async () => {
    const repo = initTestRepo()
    write(repo, 'f.properties', 'line1\nline2\nline3\nline4\n')
    commitAll(repo, 'ascii')
    const worktree = Buffer.concat([Buffer.from('line1\nline2\nline3\nline4\n'), LATIN1])
    write(repo, 'f.properties', worktree)

    // What an older renderer (or any caller) would build: git's diff decoded as UTF-8.
    const lossy = execFileSync('git', ['diff', '--', 'f.properties'], { cwd: repo }).toString('utf8')
    expect(lossy).toContain('caf�')
    await expect(applyPatch(repo, lossy, { cached: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(blob(repo, ':f.properties').toString('utf8')).toBe('line1\nline2\nline3\nline4\n')

    // Unstage direction: HEAD holds the Latin-1 bytes, the index a UTF-8 rewrite.
    git(repo, ['add', 'f.properties'])
    commitAll(repo, 'latin1')
    write(repo, 'f.properties', 'line1\nline2\nline3\nline4\ngreeting=café\n')
    git(repo, ['add', 'f.properties'])
    const stagedLossy = execFileSync('git', ['diff', '--cached', '--', 'f.properties'], { cwd: repo }).toString('utf8')
    await expect(applyPatch(repo, stagedLossy, { cached: true, reverse: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(blob(repo, ':f.properties').toString('utf8')).toBe('line1\nline2\nline3\nline4\ngreeting=café\n')
    expect(readFileSync(`${repo}/f.properties`, 'utf8')).toBe('line1\nline2\nline3\nline4\ngreeting=café\n')
  })

  it('also checks the old path of a staged rename (only HEAD holds the non-UTF-8 bytes)', async () => {
    const repo = initTestRepo()
    write(repo, 'old.properties', Buffer.concat([Buffer.from('line1\nline2\nline3\nline4\nline5\n'), LATIN1]))
    commitAll(repo, 'latin1')
    git(repo, ['mv', 'old.properties', 'new.properties'])
    write(repo, 'new.properties', 'line1\nline2\nline3\nline4\nline5\ngreeting=café\n')
    git(repo, ['add', 'new.properties'])
    const staged = await getDiff(repo, { kind: 'staged', path: 'new.properties' })
    expect(staged).toMatchObject({ status: 'renamed', encodingLossy: true })
    const lossy = execFileSync('git', ['diff', '--cached', '-M', '--', 'old.properties', 'new.properties'], { cwd: repo }).toString('utf8')
    expect(lossy).toContain('rename from old.properties')
    await expect(applyPatch(repo, lossy, { cached: true, reverse: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(git(repo, ['status', '--porcelain']).trim()).toBe('R  old.properties -> new.properties')
  })
})
