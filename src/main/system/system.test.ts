import { execFile } from 'node:child_process'
import { mkdtempSync, promises as fs, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AdarEvent } from '@shared/types'
import { UNRECORDED_VERSION } from '@shared/update'
import { ASKPASS_TOKEN_HEADER, AskpassService, askpassShellScript, classifyPrompt, shDoubleQuote } from './askpass'
import { ignoredPaths, parseGitVersion, worktreeSignature } from './index'
import { createGitContext, ensurePrivateDir } from '../git/context'
import type { AdarError } from '@shared/errors'
import { MAX_RECENTS, SettingsStore, sanitizeSettings } from './settings'
import { extractMarkedPath, mergePathLists } from './shellEnv'
import { WatcherManager, classifyGitDirPath, classifyWorktreePath, looseRefsSignature } from './watcher'

// Isolate from the user's git configuration (no git command should depend on it).
const tmpRoots: string[] = []
{
  const cfgDir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'adar-gitcfg-')))
  tmpRoots.push(cfgDir)
  writeFileSync(path.join(cfgDir, 'gitconfig'), '')
  process.env.GIT_CONFIG_GLOBAL = path.join(cfgDir, 'gitconfig')
  process.env.GIT_CONFIG_NOSYSTEM = '1'
}
/** Real path, as git reports it (native: also expands Windows 8.3 names such as RUNNER~1). */
function tmp(prefix = 'adar-sys-'): string {
  const d = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), prefix)))
  tmpRoots.push(d)
  return d
}
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(pred: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await sleep(25)
  }
  return pred()
}
function scopesOf(events: AdarEvent[]): Set<string> {
  const out = new Set<string>()
  for (const e of events) if (e.type === 'repo-changed') e.scopes.forEach((s) => out.add(s))
  return out
}

describe('shell PATH merge', () => {
  it('keeps existing order first, dedupes and ensures extra dirs', () => {
    expect(mergePathLists('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin:/Users/me/.cargo/bin', ['/opt/homebrew/bin', '/usr/local/bin'], ':')).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin:/Users/me/.cargo/bin:/usr/local/bin'
    )
    expect(mergePathLists('', '', ['/usr/local/bin'], ':')).toBe('/usr/local/bin')
    expect(mergePathLists('/a::/b:/a', '', [], ':')).toBe('/a:/b')
  })

  it('extracts the PATH printed between markers, ignoring rc-file noise', () => {
    expect(extractMarkedPath('Welcome!\n__ADAR_PATH_7f3a__/usr/bin:/bin__ADAR_PATH_7f3a__')).toBe('/usr/bin:/bin')
    expect(extractMarkedPath('no markers')).toBeNull()
    expect(extractMarkedPath('__ADAR_PATH_7f3a__/partial')).toBeNull()
  })
})

describe('git version', () => {
  it('parses git --version output', () => {
    expect(parseGitVersion('git version 2.54.0 (Apple Git-157)\n')).toBe('2.54.0 (Apple Git-157)')
    expect(parseGitVersion('git version 2.43.0.windows.1')).toBe('2.43.0.windows.1')
    expect(parseGitVersion('')).toBe('')
  })
})

describe('askpass', () => {
  it('classifies prompts', () => {
    expect(classifyPrompt("Username for 'https://github.com': ")).toEqual({ kind: 'username', secret: false })
    expect(classifyPrompt("Password for 'https://me@github.com': ")).toEqual({ kind: 'password', secret: true })
    expect(classifyPrompt("me@host's password: ")).toEqual({ kind: 'password', secret: true })
    expect(classifyPrompt("Enter passphrase for key '/Users/me/.ssh/id_ed25519': ")).toEqual({ kind: 'passphrase', secret: true })
    expect(classifyPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toEqual({ kind: 'yesno', secret: false })
    expect(classifyPrompt('Enter PIN for authenticator:')).toEqual({ kind: 'other', secret: true })
  })

  it('quotes paths safely for sh', () => {
    expect(shDoubleQuote('/Applications/My "App".app/x$y`z\\w')).toBe('"/Applications/My \\"App\\".app/x\\$y\\`z\\\\w"')
    const script = askpassShellScript('/path with space/Adar', '/data/askpass.js')
    expect(script).toBe('#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 "/path with space/Adar" "/data/askpass.js" "$@"\n')
  })

  it('round-trips a prompt through the helper script, the server and answer()', async () => {
    const dir = tmp()
    const events: AdarEvent[] = []
    const service = new AskpassService(path.join(dir, 'askpass'), (e) => {
      events.push(e)
      if (e.type === 'credential-request') {
        setTimeout(() => service.answer(e.id, e.kind === 'username' ? null : 's3cr3t "token"'), 20)
      }
    })
    const env = await service.start()
    try {
      expect(env.SSH_ASKPASS_REQUIRE).toBe('force')
      expect(env.GIT_ASKPASS).toBe(env.SSH_ASKPASS)
      expect(env.ADAR_ASKPASS_PORT).toMatch(/^\d+$/)
      expect(readdirSync(path.join(dir, 'askpass')).sort()).toEqual(['askpass.js', 'askpass.sh'])
      // Windows has no executable bit: Git for Windows runs the helper through its sh (the shebang), and so does this test.
      const windows = process.platform === 'win32'
      if (!windows) expect((await fs.stat(env.GIT_ASKPASS)).mode & 0o111).not.toBe(0)

      const run = (prompt: string) =>
        new Promise<{ code: number; stdout: string }>((resolve) => {
          const [file, args]: [string, string[]] = windows ? ['sh', [env.GIT_ASKPASS, prompt]] : [env.GIT_ASKPASS, [prompt]]
          execFile(file, args, { env: { ...process.env, ...env } }, (err, stdout) => {
            resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout })
          })
        })

      const ok = await run("Password for 'https://me@example.com':")
      expect(ok).toEqual({ code: 0, stdout: 's3cr3t "token"\n' })
      const req = events.find((e) => e.type === 'credential-request')
      expect(req).toMatchObject({ type: 'credential-request', prompt: "Password for 'https://me@example.com':", kind: 'password', secret: true })

      const cancelled = await run("Username for 'https://example.com':")
      expect(cancelled.code).toBe(1)
      expect(cancelled.stdout).toBe('')
    } finally {
      await service.dispose()
    }
  })

  it('rejects requests without the token', async () => {
    const dir = tmp()
    const service = new AskpassService(path.join(dir, 'askpass'), () => undefined)
    const env = await service.start()
    try {
      const status = await new Promise<number>((resolve) => {
        const req = http.request(
          { host: '127.0.0.1', port: Number(env.ADAR_ASKPASS_PORT), method: 'POST', path: '/askpass', headers: { [ASKPASS_TOKEN_HEADER]: 'wrong' } },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          }
        )
        req.end('{"prompt":"x"}')
      })
      expect(status).toBe(403)
    } finally {
      await service.dispose()
    }
  })

  it('remembers which network command had a prompt cancelled (once)', async () => {
    const events: AdarEvent[] = []
    const service = new AskpassService(path.join(tmp(), 'askpass'), (e) => events.push(e))
    const p1 = service.request('Username for x:', 'op-1')
    const p2 = service.request('Password for x:', 'op-2')
    const ids = events.flatMap((e) => (e.type === 'credential-request' ? [e.id] : []))
    service.answer(ids[0], null)
    service.answer(ids[1], 'secret')
    await expect(p1).resolves.toBeNull()
    await expect(p2).resolves.toBe('secret')
    expect(service.takeCancelled('op-2')).toBe(false)
    expect(service.takeCancelled('op-1')).toBe(true)
    expect(service.takeCancelled('op-1')).toBe(false)
    await service.dispose()
  })

  it('drives real git through the helper: credentials reach the server, cancel becomes CANCELLED', async () => {
    const auth: string[] = []
    const server = http.createServer((req, res) => {
      auth.push(req.headers.authorization ?? '-')
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="adar-test"' }).end('auth required')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port
    const url = `http://127.0.0.1:${port}/private/repo.git`
    let answers: Record<string, string | null> = {}
    const prompts: string[] = []
    const service = new AskpassService(path.join(tmp(), 'askpass'), (e) => {
      if (e.type !== 'credential-request') return
      prompts.push(`${e.kind}:${e.prompt}`)
      setTimeout(() => service.answer(e.id, answers[e.kind] ?? null), 10)
    })
    const ctx = createGitContext(
      { isElectron: false, appVersion: 'test', userDataDir: tmp(), pickDirectory: async () => null, openExternal: async () => {}, showInFolder: async () => {} },
      () => undefined
    )
    try {
      ctx.setNetworkEnv(await service.start())
      ctx.setCredentialProbe(service)
      const cwd = tmp()

      answers = { username: 'qa-user', password: 'qa-pass' }
      const failed = await ctx.gitNetwork(null, ['ls-remote', url], { cwd }).then(
        () => null,
        (e: AdarError) => e
      )
      expect(failed?.code).toBe('AUTH_FAILED')
      expect(failed?.message).toContain(`Authentication failed for 127.0.0.1:${port}`)
      expect(auth).toContain(`Basic ${Buffer.from('qa-user:qa-pass').toString('base64')}`)
      expect(prompts[0]).toBe(`username:Username for 'http://127.0.0.1:${port}': `.trim())
      expect(prompts[1]).toMatch(/^password:Password for 'http:\/\/qa-user@127\.0\.0\.1:\d+':$/)

      answers = {}
      const cancelled = await ctx.gitNetwork(null, ['ls-remote', url], { cwd }).then(
        () => null,
        (e: AdarError) => e
      )
      expect(cancelled?.code).toBe('CANCELLED')
      // The git console keeps git's own output instead.
      const raw = await ctx.gitNetwork(null, ['ls-remote', url], { cwd, allowFailure: true, cancelAsError: false })
      expect(raw.code).not.toBe(0)
    } finally {
      await service.dispose()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }, 30_000)

  it('cancels pending requests on dispose', async () => {
    const service = new AskpassService(path.join(tmp(), 'askpass'), () => undefined)
    await service.start()
    const pending = service.request('Password for x:')
    await service.dispose()
    await expect(pending).resolves.toBeNull()
  })
})

describe('settings', () => {
  it('sanitises patches: unknown keys and wrong types are ignored, nested objects merged', () => {
    const s = sanitizeSettings(DEFAULT_SETTINGS, {
      theme: 'light',
      zoom: '2',
      unknownKey: 1,
      graphColumns: { author: false, bogus: true },
      openTabs: ['/a', 3],
      activeTab: '/a',
      autoFetchMinutes: Number.NaN
    })
    expect(s.theme).toBe('light')
    expect(s.zoom).toBe(DEFAULT_SETTINGS.zoom)
    expect((s as unknown as Record<string, unknown>).unknownKey).toBeUndefined()
    expect(s.graphColumns).toEqual({ author: false, date: true, sha: true })
    expect(s.openTabs).toEqual([])
    expect(s.activeTab).toBe('/a')
    expect(s.autoFetchMinutes).toBe(DEFAULT_SETTINGS.autoFetchMinutes)
    expect(sanitizeSettings(DEFAULT_SETTINGS, 'garbage')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(DEFAULT_SETTINGS, { theme: 'purple', diffViewMode: 'split' })).toMatchObject({ theme: 'dark', diffViewMode: 'split' })
  })

  it('keeps only well-formed tab groups', () => {
    const s = sanitizeSettings(DEFAULT_SETTINGS, {
      tabGroups: [
        { id: 'p', name: '  OverlayOn\n', color: 'blue', repos: ['/w/p/api', '/w/p/app', '/w/p/api', 'relative'], collapsed: true },
        { id: 'p', name: 'duplicate id', color: 'red', repos: ['/x'] },
        { id: 'q', name: 'Other', color: 'rainbow', repos: ['/w/p/app', '/w/q'], collapsed: 'yes' },
        { id: 'empty', name: 'No repos', color: 'green', repos: ['/w/p/api'] },
        'garbage',
        { id: 'r', name: 4, color: 'pink', repos: 'nope' }
      ],
      groupSuggestionsDismissed: ['/w', 5]
    })
    // Colours saved before the Basoa palette map to their closest colour; unknown ones become mist.
    expect(s.tabGroups).toEqual([
      { id: 'p', name: 'OverlayOn', color: 'sea', repos: ['/w/p/api', '/w/p/app'], collapsed: true },
      { id: 'q', name: 'Other', color: 'mist', repos: ['/w/q'], collapsed: false }
    ])
    const kept = sanitizeSettings(DEFAULT_SETTINGS, {
      tabGroups: [
        { id: 'a', name: 'A', color: 'ember', repos: ['/w/a'] },
        { id: 'b', name: 'B', color: 'purple', repos: ['/w/b'] },
        { id: 'c', name: 'C', color: 'constructor', repos: ['/w/c'] }
      ]
    })
    expect(kept.tabGroups.map((g) => g.color)).toEqual(['ember', 'heather', 'mist'])
    expect(s.groupSuggestionsDismissed).toEqual([]) // not all strings: ignored
    expect(sanitizeSettings(DEFAULT_SETTINGS, { tabGroups: 'x' }).tabGroups).toEqual([])
  })

  it('maps the legacy hunk / inline diff modes onto layout + diffFullFile', () => {
    const full = { ...DEFAULT_SETTINGS, diffFullFile: true }
    expect(sanitizeSettings(full, { diffViewMode: 'hunk' })).toMatchObject({ diffViewMode: 'unified', diffFullFile: false })
    expect(sanitizeSettings(DEFAULT_SETTINGS, { diffViewMode: 'inline' })).toMatchObject({ diffViewMode: 'unified', diffFullFile: true })
    expect(sanitizeSettings(DEFAULT_SETTINGS, { diffViewMode: 'inline', diffFullFile: false })).toMatchObject({ diffFullFile: false })
  })

  it('persists settings atomically and reloads them', async () => {
    const dir = path.join(tmp(), 'nested', 'userData')
    const store = new SettingsStore(dir)
    expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS)
    const merged = await store.updateSettings({ theme: 'light', diffContextLines: 7, openTabs: ['/r1'] })
    expect(merged).toMatchObject({ theme: 'light', diffContextLines: 7, openTabs: ['/r1'], zoom: 1 })
    const files = readdirSync(dir)
    expect(files).toContain('settings.json')
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
    const again = await new SettingsStore(dir).getSettings()
    expect(again).toEqual(merged)
  })

  it("treats settings saved by an Adar without lastRunVersion as an update (What's new shows once)", async () => {
    const write = async (data: unknown) => {
      const dir = tmp()
      await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify(data))
      return (await new SettingsStore(dir).getSettings()).lastRunVersion
    }
    // Adar writes every setting; 0.7.0 and older did not know lastRunVersion.
    expect(await write({ theme: 'light', checkForUpdates: true, skippedUpdateVersion: '' })).toBe(UNRECORDED_VERSION)
    expect(await write({ skippedUpdateVersion: '', lastRunVersion: '0.7.0' })).toBe('0.7.0')
    // A hand-written seed (scripts/e2e.sh) and a new install have nothing to compare with.
    expect(await write({ openTabs: ['/r'], activeTab: '/r', autoFetchMinutes: 0 })).toBe('')
    expect((await new SettingsStore(tmp()).getSettings()).lastRunVersion).toBe('')
  })

  it('ignores a corrupt settings file', async () => {
    const dir = tmp()
    await fs.writeFile(path.join(dir, 'settings.json'), '{ not json')
    expect(await new SettingsStore(dir).getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps recents most-recent-first, deduped and capped', async () => {
    const dir = tmp()
    const store = new SettingsStore(dir)
    for (let i = 0; i < MAX_RECENTS + 5; i++) await store.addRecentRepo(`/repos/r${i}`)
    await store.addRecentRepo('/repos/r10')
    const recents = await store.getRecentRepos()
    expect(recents).toHaveLength(MAX_RECENTS)
    expect(recents[0]).toMatchObject({ path: '/repos/r10', name: 'r10' })
    expect(recents[1].path).toBe(`/repos/r${MAX_RECENTS + 4}`)
    expect(new Set(recents.map((r) => r.path)).size).toBe(MAX_RECENTS)
    await store.removeRecentRepo('/repos/r10')
    const reloaded = await new SettingsStore(dir).getRecentRepos()
    expect(reloaded.map((r) => r.path)).not.toContain('/repos/r10')
    expect(reloaded).toHaveLength(MAX_RECENTS - 1)
  })

  it('stores trusted repositories; a corrupt file trusts nothing and is never re-seeded from recents', async () => {
    const dir = tmp()
    await fs.writeFile(path.join(dir, 'recents.json'), JSON.stringify([{ path: '/repos/old', name: 'old', lastOpened: 1 }]))
    await fs.writeFile(path.join(dir, 'trusted.json'), '{ not json')
    const store = new SettingsStore(dir)
    expect(await store.isTrustedRepo(['/repos/old'])).toBe(false)
    await store.trustRepo('/repos/new')
    await store.trustRepo('relative/ignored')
    expect(await store.isTrustedRepo(['/x', '/repos/new'])).toBe(true)
    await store.flush()
    const reloaded = new SettingsStore(dir)
    expect(await reloaded.isTrustedRepo(['/repos/new'])).toBe(true)
    expect(await reloaded.isTrustedRepo(['/repos/old', 'relative/ignored'])).toBe(false)
  })
})

describe('watcher classification', () => {
  it('maps git-dir paths to scopes', () => {
    expect(classifyGitDirPath('HEAD')).toBe('refs')
    expect(classifyGitDirPath('ORIG_HEAD')).toBe('refs')
    expect(classifyGitDirPath('refs/heads/feature/x')).toBe('refs')
    expect(classifyGitDirPath('refs/heads/main.lock')).toBeNull()
    expect(classifyGitDirPath('packed-refs')).toBe('refs')
    expect(classifyGitDirPath('MERGE_HEAD')).toBe('refs')
    expect(classifyGitDirPath('CHERRY_PICK_HEAD')).toBe('refs')
    expect(classifyGitDirPath('REVERT_HEAD')).toBe('refs')
    expect(classifyGitDirPath('rebase-merge/done')).toBe('refs')
    expect(classifyGitDirPath('rebase-apply/next')).toBe('refs')
    expect(classifyGitDirPath('logs/refs/stash')).toBe('refs')
    expect(classifyGitDirPath('index')).toBe('index')
    expect(classifyGitDirPath('index.lock')).toBeNull()
    expect(classifyGitDirPath('objects/ab/cdef')).toBeNull()
    expect(classifyGitDirPath('logs/HEAD')).toBeNull()
    expect(classifyGitDirPath('logs/refs/heads/main')).toBeNull()
    expect(classifyGitDirPath('COMMIT_EDITMSG')).toBeNull()
    expect(classifyGitDirPath('FETCH_HEAD')).toBeNull()
    expect(classifyGitDirPath('refs\\heads\\win')).toBe('refs')
    expect(classifyGitDirPath('reftable/tables.list')).toBe('refs')
    expect(classifyGitDirPath('adar-interactive-rebase')).toBeNull()
  })

  it('maps worktree paths, excluding .git and node_modules', () => {
    expect(classifyWorktreePath('src/app.ts')).toBe('worktree')
    expect(classifyWorktreePath('.git/index')).toBeNull()
    expect(classifyWorktreePath('.git')).toBeNull()
    expect(classifyWorktreePath('node_modules/x/index.js')).toBeNull()
    expect(classifyWorktreePath('packages/a/node_modules/y.js')).toBeNull()
    expect(classifyWorktreePath('.gitignore')).toBe('worktree')
  })

  it('stat-polls git files when fs.watch is silent and marks the repo degraded', async () => {
    const dir = tmp()
    const gitDir = path.join(dir, '.git')
    await fs.mkdir(path.join(gitDir, 'refs', 'heads'), { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    const events: AdarEvent[] = []
    const w = new WatcherManager((e) => events.push(e), { fsWatch: false, pollMs: 50, graceMs: 120, debounceMs: 20, maxWaitMs: 200 })
    w.start({ repoPath: dir, gitDir, isBare: false })
    w.start({ repoPath: dir, gitDir, isBare: false }) // idempotent
    try {
      expect(w.healthOf(dir)).toBe('unknown')
      await sleep(150)
      await fs.writeFile(path.join(gitDir, 'refs', 'heads', 'main'), 'abc\n')
      await fs.writeFile(path.join(gitDir, 'index'), 'idx')
      expect(await until(() => scopesOf(events).has('refs') && scopesOf(events).has('index'))).toBe(true)
      expect(w.healthOf(dir)).toBe('degraded')
      // Degraded: further changes are emitted by the poller without the grace delay.
      const n = events.length
      const t0 = Date.now()
      await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/other\n')
      expect(await until(() => events.length > n)).toBe(true)
      expect(Date.now() - t0).toBeLessThan(1000)
    } finally {
      w.stopAll()
    }
    expect(w.isWatching(dir)).toBe(false)
  })

  it('polls nested loose refs (git branch -f feature/x) when fs.watch is silent', async () => {
    const repo = tmp()
    const run = (args: string[]) =>
      new Promise<void>((resolve, reject) => execFile('git', args, { cwd: repo }, (err) => (err ? reject(err) : resolve())))
    const commitArgs = ['-c', 'user.name=T', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty']
    await run(['init', '-q', '-b', 'main'])
    await run([...commitArgs, '-m', 'one'])
    await run([...commitArgs, '-m', 'two'])
    await run(['branch', 'feature/deep/x', 'HEAD~1'])
    await run(['update-ref', 'refs/remotes/origin/team/topic', 'HEAD~1'])
    const gitDir = path.join(repo, '.git')
    const events: AdarEvent[] = []
    const w = new WatcherManager((e) => events.push(e), { fsWatch: false, pollMs: 50, graceMs: 100, debounceMs: 20, maxWaitMs: 200 })
    w.start({ repoPath: repo, gitDir, isBare: false })
    try {
      await sleep(150)
      expect(events).toEqual([])
      await run(['branch', '-f', 'feature/deep/x', 'HEAD'])
      expect(await until(() => scopesOf(events).has('refs'))).toBe(true)
      expect(w.healthOf(repo)).toBe('degraded')
      // Degraded: a nested remote-tracking ref moving is reported as well.
      await sleep(150)
      events.length = 0
      await run(['update-ref', 'refs/remotes/origin/team/topic', 'HEAD'])
      expect(await until(() => scopesOf(events).has('refs'))).toBe(true)
    } finally {
      w.stopAll()
    }
  })

  it('computes the loose-ref signature over nested directories, with a cap', async () => {
    const refs = path.join(tmp(), 'refs')
    await fs.mkdir(path.join(refs, 'heads', 'feature', 'deep'), { recursive: true })
    await fs.mkdir(path.join(refs, 'tags'), { recursive: true })
    const s0 = await looseRefsSignature(refs)
    expect(s0.split('\n').map((l) => l.split(':')[0])).toEqual(['', 'heads', 'tags', path.join('heads', 'feature'), path.join('heads', 'feature', 'deep')])
    expect(await looseRefsSignature(refs)).toBe(s0)
    // A ref rewritten deep down (lock file + rename) changes it.
    await sleep(5)
    await fs.writeFile(path.join(refs, 'heads', 'feature', 'deep', 'x.lock'), 'abc\n')
    await fs.rename(path.join(refs, 'heads', 'feature', 'deep', 'x.lock'), path.join(refs, 'heads', 'feature', 'deep', 'x'))
    const s1 = await looseRefsSignature(refs)
    expect(s1).not.toBe(s0)
    expect((await looseRefsSignature(refs, 2)).split('\n')).toHaveLength(2)
    expect(await looseRefsSignature(path.join(refs, 'missing'))).toBe(':missing')
  })

  it('detects worktree edits through the status signature until fs.watch proves itself', async () => {
    const dir = tmp()
    const gitDir = path.join(dir, '.git')
    await fs.mkdir(gitDir, { recursive: true })
    let sig = 'a'
    let calls = 0
    const events: AdarEvent[] = []
    const w = new WatcherManager((e) => events.push(e), {
      fsWatch: false,
      pollMs: 0,
      debounceMs: 10,
      worktreeSignature: async () => {
        calls++
        return sig
      }
    })
    w.start({ repoPath: dir, gitDir, isBare: false })
    try {
      await until(() => calls >= 1)
      sig = 'b'
      // Unknown health: checked every 3 s at most.
      expect(await until(() => scopesOf(events).has('worktree'), 6000)).toBe(true)
      // A real fs.watch event proves FSEvents works: the signature poller stops.
      w.notifyFsEvent(dir, null)
      expect(w.healthOf(dir)).toBe('healthy')
      const before = calls
      await sleep(3500)
      expect(calls).toBe(before)
    } finally {
      w.stopAll()
    }
  }, 15_000)

  it('debounces fs events into one batch and drops batches of ignored paths only', async () => {
    const dir = tmp()
    const events: AdarEvent[] = []
    const asked: string[][] = []
    const w = new WatcherManager((e) => events.push(e), {
      fsWatch: false,
      pollMs: 0,
      debounceMs: 60,
      maxWaitMs: 400,
      ignoredPaths: async (_repo, paths) => {
        asked.push(paths)
        return new Set(paths.filter((p) => p.startsWith('out/')))
      }
    })
    w.start({ repoPath: dir, gitDir: path.join(dir, '.git'), isBare: false })
    try {
      w.notifyFsEvent(dir, 'worktree', 'out/main.js')
      w.notifyFsEvent(dir, 'worktree', 'out/chunk.js')
      await sleep(200)
      expect(events).toEqual([])
      expect(asked).toEqual([['out/main.js', 'out/chunk.js']])

      w.notifyFsEvent(dir, 'worktree', 'out/main.js')
      w.notifyFsEvent(dir, 'worktree', 'src/app.ts')
      w.notifyFsEvent(dir, 'refs')
      w.notifyFsEvent(dir, 'index')
      await sleep(200)
      expect(events).toHaveLength(1)
      expect(new Set((events[0] as Extract<AdarEvent, { type: 'repo-changed' }>).scopes)).toEqual(new Set(['worktree', 'refs', 'index']))

      // A continuous stream is flushed after maxWaitMs instead of being postponed forever.
      events.length = 0
      const t0 = Date.now()
      while (Date.now() - t0 < 700) {
        w.notifyFsEvent(dir, 'worktree', 'src/app.ts')
        await sleep(20)
      }
      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events.length).toBeLessThanOrEqual(3)
    } finally {
      w.stopAll()
    }
    const n = events.length
    w.notifyFsEvent(dir, 'worktree', 'src/app.ts')
    await sleep(150)
    expect(events).toHaveLength(n)
  })
})

// POSIX owners and permission bits: on Windows ensurePrivateDir() relies on the per-user %TEMP% instead.
describe.skipIf(process.platform === 'win32')('private temp dir', () => {
  it('creates an owner-only directory and tightens loose permissions', async () => {
    const dir = path.join(tmp(), 'adar-x')
    await ensurePrivateDir(dir)
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700)
    await fs.chmod(dir, 0o777)
    await ensurePrivateDir(dir)
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700)
  })

  it('refuses a symlink planted in its place', async () => {
    const base = tmp()
    await fs.mkdir(path.join(base, 'elsewhere'))
    await fs.symlink(path.join(base, 'elsewhere'), path.join(base, 'adar-y'))
    await expect(ensurePrivateDir(path.join(base, 'adar-y'))).rejects.toThrow(/Unsafe temporary directory/)
  })
})

describe('watcher fallback helpers', () => {
  it('changes the worktree signature on every edit, also of already-modified files', async () => {
    const repo = tmp()
    const run = (args: string[]) =>
      new Promise<void>((resolve, reject) => execFile('git', args, { cwd: repo }, (err) => (err ? reject(err) : resolve())))
    await run(['init', '-q', '-b', 'main'])
    await fs.writeFile(path.join(repo, '.gitignore'), 'dist/\n')
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\n')
    await run(['add', '-A'])
    await run(['-c', 'user.name=T', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'])
    const s0 = await worktreeSignature(repo)
    expect(s0).toMatch(/^[0-9a-f]{40}$/)
    expect(await worktreeSignature(repo)).toBe(s0)
    await fs.writeFile(path.join(repo, 'a.txt'), 'two\n')
    const s1 = await worktreeSignature(repo)
    expect(s1).not.toBe(s0)
    await fs.writeFile(path.join(repo, 'a.txt'), 'three, longer\n')
    const s2 = await worktreeSignature(repo)
    expect(s2).not.toBe(s1)
    // Ignored files do not change it.
    await fs.mkdir(path.join(repo, 'dist'))
    await fs.writeFile(path.join(repo, 'dist', 'out.js'), 'x')
    expect(await worktreeSignature(repo)).toBe(s2)
    expect([...(await ignoredPaths(repo, ['dist/out.js', 'a.txt', 'dist']))].sort()).toEqual(['dist', 'dist/out.js'])
    expect(await worktreeSignature(path.join(repo, 'missing'))).toBeNull()
  })
})
