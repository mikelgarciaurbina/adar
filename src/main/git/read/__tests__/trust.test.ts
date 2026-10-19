// Trust gate for repositories whose own config makes git run commands, and ".git"-equivalent
// clone / init folder names. Integration tests with throwaway repositories.
import { cleanupTempDirs, commitAll, git, initTestRepo, isolateGitConfig, makeBackend, tempDir, write } from './helpers'

isolateGitConfig()

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdarEvent } from '@shared/types'
import type { Backend } from '../../../backend'
import { commandRunningConfig, deriveCloneDirName, isDotGitName, parseConfigList } from '../repo'

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

/** Executable script that records each run in `marker`. */
function markerScript(dir: string, marker: string): string {
  const script = path.join(dir, 'payload.sh')
  writeFileSync(script, `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`)
  chmodSync(script, 0o755)
  return script
}

/** A repository as it arrives in an archive: its .git/config runs `payload.sh` on every `git status`. */
function fsmonitorRepo(): { repo: string; marker: string } {
  const repo = initTestRepo()
  write(repo, 'a.txt', 'a\n')
  commitAll(repo, 'init')
  const outside = tempDir('adar-payload-')
  const marker = path.join(outside, 'ran')
  git(repo, ['config', 'core.fsmonitor', markerScript(outside, marker)])
  return { repo, marker }
}

describe('commandRunningConfig', () => {
  it('flags only entries that make git run a command', () => {
    const entries = parseConfigList(
      [
        'core.fsmonitor\n/tmp/x.sh',
        'core.filemode\ntrue',
        'credential.helper\n',
        'credential.https://host.helper\nstore',
        'filter.lfs.process\ngit-lfs filter-process',
        'diff.bin.textconv\nhexdump',
        'remote.Origin.uploadpack\n/tmp/up',
        'remote.origin.url\nhttps://host/x.git',
        'alias.st\nstatus',
        'alias.x\n!touch /tmp/p',
        'protocol.ext.allow\nalways',
        'protocol.file.allow\nalways',
        'include.path\n../shared.cfg',
        'core.hookspath\n.husky',
        'user.name\nMe',
        'gpg.ssh.program\n/tmp/sign'
      ].join('\0') + '\0'
    )
    expect(commandRunningConfig(entries)).toEqual([
      'core.fsmonitor = /tmp/x.sh',
      'credential.https://host.helper = store',
      'filter.lfs.process = git-lfs filter-process',
      'diff.bin.textconv = hexdump',
      'remote.Origin.uploadpack = /tmp/up',
      'alias.x = !touch /tmp/p',
      'protocol.ext.allow = always',
      'include.path = ../shared.cfg',
      'core.hookspath = .husky',
      'gpg.ssh.program = /tmp/sign'
    ])
    // core.fsmonitor as a boolean selects the built-in daemon (or nothing): no external command.
    for (const v of ['true', 'false', '0', '1', 'yes', 'off', '']) {
      expect(commandRunningConfig([{ key: 'core.fsmonitor', value: v }])).toEqual([])
    }
    expect(commandRunningConfig([{ key: 'core.fsmonitor', value: null }])).toEqual([])
    expect(commandRunningConfig([{ key: 'core.sshCommand', value: 'ssh -o ProxyCommand=evil\nx' }])).toEqual([
      'core.sshCommand = ssh -o ProxyCommand=evil x'
    ])
  })
})

describe('openRepo trust gate', () => {
  it('refuses an unseen repository whose config runs a command, without running it or watching the repo', async () => {
    const { repo, marker } = fsmonitorRepo()
    const err = await backend.openRepo(repo).then(
      () => null,
      (e: unknown) => e as { code: string; message: string; details?: string[] }
    )
    expect(err).toMatchObject({ code: 'UNTRUSTED_REPO' })
    expect(err?.details).toEqual([expect.stringMatching(/^core\.fsmonitor = .*payload\.sh$/)])
    expect(err?.message).toContain(repo)
    // Also when picked through a subfolder or a file inside it.
    await expect(backend.openRepo(path.join(repo, 'a.txt'))).rejects.toMatchObject({ code: 'UNTRUSTED_REPO' })

    expect(existsSync(marker)).toBe(false)
    expect((await backend.getRecentRepos()).some((r) => r.path === repo)).toBe(false)
    // No watcher: edits in the refused repository produce no events (and no status polling).
    write(repo, 'a.txt', 'edited\n')
    await new Promise((r) => setTimeout(r, 1500))
    expect(events.some((e) => e.type === 'repo-changed' && e.repoPath === repo)).toBe(false)
    expect(existsSync(marker)).toBe(false)

    // Once trusted it opens; the config is honoured from then on (the gate is what kept it from running).
    await backend.trustRepo(path.join(repo, 'a.txt'))
    const info = await backend.openRepo(repo)
    expect(info.path).toBe(repo)
    await backend.getStatus(repo)
    expect(existsSync(marker)).toBe(true)
    await backend.closeRepo(repo)

    // Trust is persisted.
    const second = makeBackend(userDataDir)
    try {
      await expect(second.backend.openRepo(repo)).resolves.toMatchObject({ path: repo })
      await second.backend.closeRepo(repo)
    } finally {
      await second.backend.dispose()
    }
  })

  it('reports filter drivers (which run during plain git status) and executable hooks', async () => {
    const repo = initTestRepo()
    write(repo, '.gitattributes', '*.txt filter=x\n')
    write(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    git(repo, ['config', 'filter.x.clean', 'touch /tmp/adar-should-not-run'])
    const hooks = path.join(repo, '.git', 'hooks')
    mkdirSync(hooks, { recursive: true })
    writeFileSync(path.join(hooks, 'post-checkout'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    writeFileSync(path.join(hooks, 'pre-commit.sample'), '#!/bin/sh\n', { mode: 0o755 })
    writeFileSync(path.join(hooks, 'notes.txt'), 'not executable\n', { mode: 0o644 })
    await expect(backend.openRepo(repo)).rejects.toMatchObject({
      code: 'UNTRUSTED_REPO',
      details: ['filter.x.clean = touch /tmp/adar-should-not-run', `hook: ${path.join('.git', 'hooks', 'post-checkout')}`]
    })
  })

  it('opens repositories without command-running config, but does not trust them for later', async () => {
    const repo = initTestRepo()
    commitAll(repo, 'init')
    git(repo, ['config', 'core.fsmonitor', 'false'])
    git(repo, ['config', 'credential.helper', ''])
    git(repo, ['config', 'alias.st', 'status'])
    await expect(backend.openRepo(repo)).resolves.toMatchObject({ path: repo })
    await backend.closeRepo(repo)
    // A folder replaced at the same path (another archive extracted there) is checked again.
    git(repo, ['config', 'core.sshCommand', 'touch /tmp/adar-should-not-run'])
    await expect(backend.openRepo(repo)).rejects.toMatchObject({ code: 'UNTRUSTED_REPO' })
  })

  it('trusts repositories Adar cloned or initialised itself, and the linked worktrees of trusted ones', async () => {
    const base = tempDir()
    const created = await backend.initRepo(path.join(base, 'fresh'))
    await backend.closeRepo(created.path)
    git(created.path, ['config', 'core.hooksPath', 'hooks'])
    await expect(backend.openRepo(created.path)).resolves.toMatchObject({ path: created.path })
    await backend.closeRepo(created.path)

    const src = initTestRepo(path.join(base, 'src'))
    write(src, 'r.md', 'x\n')
    commitAll(src, 'r')
    const cloned = await backend.cloneRepo(src, path.join(base, 'clones'))
    await backend.closeRepo(cloned.path)
    git(cloned.path, ['config', 'core.sshCommand', 'ssh -v'])
    await expect(backend.openRepo(cloned.path)).resolves.toMatchObject({ path: cloned.path })
    await backend.closeRepo(cloned.path)

    const wt = path.join(base, 'wt')
    git(cloned.path, ['worktree', 'add', '-q', '-b', 'side', wt])
    await expect(backend.openRepo(wt)).resolves.toMatchObject({ path: wt })
    await backend.closeRepo(wt)
  })

  it('does not trust an existing repository re-initialised through initRepo', async () => {
    const { repo, marker } = fsmonitorRepo()
    await expect(backend.initRepo(repo)).rejects.toMatchObject({ code: 'UNTRUSTED_REPO' })
    expect(existsSync(marker)).toBe(false)
  })

  it('trusts the repositories of existing open tabs and recents once, on the first run with the gate', async () => {
    const tab = fsmonitorRepo().repo
    const recent = fsmonitorRepo().repo
    const unknown = fsmonitorRepo().repo
    const ud = tempDir('adar-userdata-')
    writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ openTabs: [tab], activeTab: tab }))
    writeFileSync(path.join(ud, 'recents.json'), JSON.stringify([{ path: recent, name: 'r', lastOpened: 1 }]))
    const first = makeBackend(ud)
    try {
      await expect(first.backend.openRepo(tab)).resolves.toMatchObject({ path: tab })
      await expect(first.backend.openRepo(recent)).resolves.toMatchObject({ path: recent })
      await expect(first.backend.openRepo(unknown)).rejects.toMatchObject({ code: 'UNTRUSTED_REPO' })
      await Promise.all([first.backend.closeRepo(tab), first.backend.closeRepo(recent)])
    } finally {
      await first.backend.dispose()
    }
    expect(JSON.parse(readFileSync(path.join(ud, 'trusted.json'), 'utf8')).repos).toEqual(expect.arrayContaining([tab, recent]))

    // Later runs never re-import: a repository that only shows up in recents afterwards is checked.
    const ud2 = tempDir('adar-userdata-')
    writeFileSync(path.join(ud2, 'trusted.json'), JSON.stringify({ version: 1, repos: [] }))
    writeFileSync(path.join(ud2, 'recents.json'), JSON.stringify([{ path: unknown, name: 'u', lastOpened: 1 }]))
    const later = makeBackend(ud2)
    try {
      await expect(later.backend.openRepo(unknown)).rejects.toMatchObject({ code: 'UNTRUSTED_REPO' })
    } finally {
      await later.backend.dispose()
    }
  })

  it('rejects trustRepo for folders that are not repositories', async () => {
    await expect(backend.trustRepo(tempDir())).rejects.toMatchObject({ code: 'NOT_A_REPO' })
    await expect(backend.trustRepo('')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('".git" folder names', () => {
  it('recognises names that resolve to .git on common file systems', () => {
    for (const n of ['.git', '.GIT', '.Git', '.git.', '.git..', '.git ', ' .git', '.git. .', 'GIT~1', 'git~2', '.git::$INDEX_ALLOCATION', '.g\u200cit']) {
      expect({ n, dotGit: isDotGitName(n) }).toEqual({ n, dotGit: true })
    }
    for (const n of ['git', '.github', '.gitignore', '.git-repos', 'repo.git', '..git', 'my.git.']) {
      expect({ n, dotGit: isDotGitName(n) }).toEqual({ n, dotGit: false })
    }
  })

  it('never derives a .git folder from a clone URL', () => {
    for (const url of ['https://host/tools/.git.git', 'https://host/tools/.GIT.git', 'https://host/tools/.git..git', 'git@host:x/.git.git']) {
      expect(() => deriveCloneDirName(url)).toThrow(/folder name/)
    }
  })

  it('refuses to clone or init into a .git folder (which would make the parent a repository)', async () => {
    const base = tempDir()
    const src = initTestRepo(path.join(base, 'src'))
    write(src, 'config', '[core]\n\tfsmonitor = /tmp/adar-should-not-run\n')
    write(src, 'HEAD', 'ref: refs/heads/main\n')
    commitAll(src, 'looks like a git dir')
    const parent = path.join(base, 'parent')
    mkdirSync(parent)
    for (const dirName of ['.git', '.GIT', '.git.', 'GIT~1']) {
      await expect(backend.cloneRepo(src, parent, { dirName })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
    await expect(backend.cloneRepo(`file://${path.join(base, '.git.git')}`, parent)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.cloneRepo(src, path.join(parent, '.git', 'sub'), { dirName: 'x' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(backend.initRepo(path.join(parent, '.Git'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(existsSync(path.join(parent, '.git'))).toBe(false)
    expect(existsSync(path.join(parent, '.Git'))).toBe(false)
  })
})
