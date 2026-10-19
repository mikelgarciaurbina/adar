// Integration tests for repository lifecycle, settings, watchers, identity and the git console.
import { cleanupTempDirs, commitAll, git, initTestRepo, isolateGitConfig, makeBackend, tempDir, waitFor, write } from './helpers'

const globalConfig = isolateGitConfig()

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_METHODS } from '@shared/api'
import type { AdarEvent } from '@shared/types'
import type { Backend } from '../../../backend'
import { deriveCloneDirName } from '../repo'

let backend: Backend
let events: AdarEvent[]
let userDataDir: string

beforeAll(() => {
  ;({ backend, events, userDataDir } = makeBackend())
})

afterAll(async () => {
  await backend.dispose()
  cleanupTempDirs()
})

describe('createBackend', () => {
  it('exposes every AdarApi method plus dispose', () => {
    for (const m of API_METHODS) expect(typeof backend[m]).toBe('function')
    expect(typeof backend.dispose).toBe('function')
  })
})

describe('deriveCloneDirName', () => {
  it('derives folder names like git does', () => {
    expect(deriveCloneDirName('https://github.com/org/repo.git')).toBe('repo')
    expect(deriveCloneDirName('https://github.com/org/repo')).toBe('repo')
    expect(deriveCloneDirName('https://github.com/org/repo.git/')).toBe('repo')
    expect(deriveCloneDirName('git@github.com:org/my-repo.git')).toBe('my-repo')
    expect(deriveCloneDirName('git@host:repo.git')).toBe('repo')
    expect(deriveCloneDirName('ssh://git@host:2222/org/team/project.git')).toBe('project')
    expect(deriveCloneDirName('/srv/git/local.git')).toBe('local')
    expect(deriveCloneDirName('/srv/git/work/.git')).toBe('work')
    expect(deriveCloneDirName('file:///tmp/x/bare.git')).toBe('bare')
    expect(deriveCloneDirName('C:\\src\\winrepo')).toBe('winrepo')
    expect(() => deriveCloneDirName('https://')).toThrow()
  })
})

describe('openRepo / getRepoInfo', () => {
  it('opens a repo from a subdirectory or file and records it in recents', async () => {
    const repo = initTestRepo()
    write(repo, 'src/deep/file.ts', 'x\n')
    const sha = commitAll(repo, 'init')
    git(repo, ['remote', 'add', 'origin', 'git@github.com:me/private.git'])

    const info = await backend.openRepo(path.join(repo, 'src', 'deep'))
    expect(info).toEqual({
      path: repo,
      name: path.basename(repo),
      gitDir: path.join(repo, '.git'),
      isBare: false,
      head: { sha, branch: 'main', detached: false, unborn: false },
      state: 'none',
      remotes: [{ name: 'origin', fetchUrl: 'git@github.com:me/private.git', pushUrl: 'git@github.com:me/private.git' }]
    })
    const fromFile = await backend.openRepo(path.join(repo, 'src', 'deep', 'file.ts'))
    expect(fromFile.path).toBe(repo)

    const recents = await backend.getRecentRepos()
    expect(recents[0]).toMatchObject({ path: repo, name: path.basename(repo) })
    await backend.removeRecentRepo(repo)
    expect((await backend.getRecentRepos()).some((r) => r.path === repo)).toBe(false)
    await backend.closeRepo(repo)
  })

  it('reports detached HEAD', async () => {
    const repo = initTestRepo()
    const first = commitAll(repo, 'one')
    commitAll(repo, 'two')
    git(repo, ['checkout', '-q', first])
    const info = await backend.getRepoInfo(repo)
    expect(info.head).toEqual({ sha: first, branch: null, detached: true, unborn: false })
  })

  it('opens bare repositories', async () => {
    const base = tempDir()
    const bare = path.join(base, 'b.git')
    git(base, ['init', '-q', '--bare', bare])
    const info = await backend.openRepo(bare)
    expect(info.isBare).toBe(true)
    expect(info.path).toBe(bare)
    const st = await backend.getStatus(info.path)
    expect(st.staged).toEqual([])
    await backend.closeRepo(info.path)
  })

  it('rejects folders that are not repositories', async () => {
    await expect(backend.openRepo(tempDir())).rejects.toMatchObject({ code: 'NOT_A_REPO' })
    // A missing folder is NOT_FOUND (the UI must not offer to initialise it).
    await expect(backend.openRepo('/no/such/folder/anywhere')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(backend.getRepoInfo(tempDir())).rejects.toMatchObject({ code: 'NOT_A_REPO' })
    await expect(backend.getRepoInfo('relative/path')).rejects.toMatchObject({ code: 'NOT_A_REPO' })
  })

  it('reports a missing repository folder as NOT_FOUND on every path', async () => {
    const parent = tempDir()
    writeFileSync(path.join(parent, 'a-file'), 'x')
    for (const p of [path.join(parent, 'gone'), `${path.join(parent, 'gone')}/`, path.join(parent, 'a-file', 'sub'), '~/adar-definitely-missing-folder']) {
      await expect(backend.openRepo(p)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    await expect(backend.getRepoInfo(path.join(parent, 'gone'))).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // Opened, then moved/deleted while open: reads, writes, operation controls and file-based ops.
    const repo = initTestRepo()
    write(repo, 'a.txt', 'a\n')
    commitAll(repo, 'a')
    await backend.openRepo(repo)
    await backend.getStatus(repo)
    rmSync(repo, { recursive: true, force: true })
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['openRepo', () => backend.openRepo(repo)],
      ['getRepoInfo', () => backend.getRepoInfo(repo)],
      ['getStatus', () => backend.getStatus(repo)],
      ['getLog', () => backend.getLog(repo)],
      ['getRefs', () => backend.getRefs(repo)],
      ['stageAll', () => backend.stageAll(repo)],
      ['checkout', () => backend.checkout(repo, 'main')],
      ['stashApply', () => backend.stashApply(repo, 0)],
      ['continueOperation', () => backend.continueOperation(repo)],
      ['abortOperation', () => backend.abortOperation(repo)],
      ['skipOperation', () => backend.skipOperation(repo)],
      ['addToGitignore', () => backend.addToGitignore(repo, 'dist/')],
      ['getMergeMessage', () => backend.getMergeMessage(repo)],
      ['runGit', () => backend.runGit(repo, ['status'])]
    ]
    for (const [name, call] of calls) {
      const err = await call().then(
        () => null,
        (e: unknown) => e as { code: string; message: string }
      )
      expect({ name, code: err?.code }).toEqual({ name, code: 'NOT_FOUND' })
      expect(err?.message).toMatch(/not found/i)
    }
    await backend.closeRepo(repo)
  })
})

describe('initRepo', () => {
  it('creates nested folders and an unborn branch', async () => {
    const target = path.join(tempDir(), 'a', 'b', 'new-repo')
    const info = await backend.initRepo(target, { initialBranch: 'develop' })
    expect(info.path).toBe(target)
    expect(info.head).toEqual({ sha: null, branch: 'develop', detached: false, unborn: true })
    expect(await backend.getLog(info.path)).toEqual({ commits: [], hasMore: false })
    const st = await backend.getStatus(info.path)
    expect(st.branch).toBe('develop')
    await backend.closeRepo(info.path)
    const def = await backend.initRepo(path.join(tempDir(), 'default'))
    expect(def.head.branch).toBe('main')
    await backend.closeRepo(def.path)
    await expect(backend.initRepo(path.join(tempDir(), 'bad'), { initialBranch: 'bad..name' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('cloneRepo', () => {
  it('clones a local bare repository with progress events', async () => {
    const base = tempDir()
    const src = initTestRepo(path.join(base, 'src'))
    write(src, 'readme.md', '# hi\n')
    commitAll(src, 'readme')
    const bare = path.join(base, 'project.git')
    git(base, ['clone', '-q', '--bare', src, bare])

    const parent = path.join(base, 'clones')
    const opId = 'clone-1'
    const info = await backend.cloneRepo(`file://${bare}`, parent, { opId })
    expect(info.path).toBe(path.join(parent, 'project'))
    expect(info.head.branch).toBe('main')
    expect(info.remotes[0]).toMatchObject({ name: 'origin', fetchUrl: `file://${bare}` })
    const progress = events.filter((e) => e.type === 'progress' && e.opId === opId)
    expect(progress.length).toBeGreaterThan(1)
    expect(progress.some((e) => e.type === 'progress' && !e.done && e.message.length > 0)).toBe(true)
    expect(progress[progress.length - 1]).toMatchObject({ done: true })
    await backend.closeRepo(info.path)

    const custom = await backend.cloneRepo(bare, parent, { dirName: 'custom', depth: 1 })
    expect(custom.path).toBe(path.join(parent, 'custom'))
    const log = await backend.getLog(custom.path)
    expect(log.commits).toHaveLength(1)
    await backend.closeRepo(custom.path)

    await expect(backend.cloneRepo(bare, parent)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.cloneRepo('--upload-pack=evil', parent)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.cloneRepo(bare, parent, { dirName: '../escape' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.cloneRepo(path.join(base, 'missing.git'), parent)).rejects.toMatchObject({ code: expect.any(String) })
  })
})

describe('settings via the backend', () => {
  it('persists across backend instances', async () => {
    const merged = await backend.updateSettings({ theme: 'light', graphPageSize: 500 })
    expect(merged.theme).toBe('light')
    expect(merged.graphPageSize).toBe(500)
    expect(merged.zoom).toBe(1)
    const second = makeBackend(userDataDir)
    try {
      const s = await second.backend.getSettings()
      expect(s.theme).toBe('light')
      expect(s.graphPageSize).toBe(500)
    } finally {
      await second.backend.dispose()
    }
  })

  it('reports app info with the git version', async () => {
    const info = await backend.getAppInfo()
    expect(info.gitVersion).toMatch(/^\d+\.\d+/)
    expect(info.isElectron).toBe(false)
    expect(info.version).toBe('0.0.0-test')
  })

  it('ignores unknown credential answers', async () => {
    await expect(backend.answerCredentialRequest('unknown-id', 'x')).resolves.toBeUndefined()
  })
})

describe('getIdentity', () => {
  it('reads local and global identities with their scope', async () => {
    const repo = initTestRepo()
    expect(await backend.getIdentity(repo)).toEqual({ name: 'Test User', email: 'test@example.com', scope: 'local' })
    expect(await backend.getIdentity(null)).toEqual({ name: '', email: '', scope: 'none' })
    writeFileSync(globalConfig, '[user]\n\tname = Global Person\n\temail = global@example.com\n')
    try {
      expect(await backend.getIdentity(null)).toEqual({ name: 'Global Person', email: 'global@example.com', scope: 'global' })
      const bare = initTestRepo()
      git(bare, ['config', '--unset', 'user.name'])
      git(bare, ['config', '--unset', 'user.email'])
      expect(await backend.getIdentity(bare)).toEqual({ name: 'Global Person', email: 'global@example.com', scope: 'global' })
    } finally {
      writeFileSync(globalConfig, '')
    }
  })
})

describe('runGit', () => {
  it('runs console commands without throwing on failure', async () => {
    const repo = initTestRepo()
    commitAll(repo, 'one')
    const ok = await backend.runGit(repo, ['git', 'log', '--format=%s'])
    expect(ok).toEqual({ stdout: 'one\n', stderr: '', code: 0 })
    const bad = await backend.runGit(repo, ['checkout', 'no-such-branch'])
    expect(bad.code).not.toBe(0)
    expect(bad.stderr).toMatch(/no-such-branch/)
    await expect(backend.runGit(repo, [])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.runGit(tempDir(), ['status'])).rejects.toMatchObject({ code: 'NOT_A_REPO' })
  })
})

describe('watcher', () => {
  it('emits repo-changed for worktree edits and new branches', { timeout: 60_000 }, async () => {
    const repo = initTestRepo()
    write(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    mkdirSync(path.join(repo, 'node_modules'), { recursive: true })
    const info = await backend.openRepo(repo)
    // Let the watcher take its baselines (fs.watch, or the polling fallback when FSEvents is silent).
    await new Promise((r) => setTimeout(r, 1500))
    const changed = () => events.filter((e): e is Extract<AdarEvent, { type: 'repo-changed' }> => e.type === 'repo-changed' && e.repoPath === info.path)
    const start = changed().length

    write(repo, 'a.txt', 'edited\n')
    expect(await waitFor(() => changed().slice(start).some((e) => e.scopes.includes('worktree')), 15_000)).toBe(true)

    const mark = changed().length
    git(repo, ['branch', 'feature/new'])
    expect(await waitFor(() => changed().slice(mark).some((e) => e.scopes.includes('refs')))).toBe(true)

    const mark2 = changed().length
    git(repo, ['add', 'a.txt'])
    expect(await waitFor(() => changed().slice(mark2).some((e) => e.scopes.includes('index')))).toBe(true)

    await backend.closeRepo(info.path)
    await new Promise((r) => setTimeout(r, 400))
    const afterClose = changed().length
    write(repo, 'a.txt', 'after close\n')
    await new Promise((r) => setTimeout(r, 800))
    expect(changed().length).toBe(afterClose)
  })
})
