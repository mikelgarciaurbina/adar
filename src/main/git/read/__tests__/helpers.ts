// Test helpers: isolated git config, temp repos and a backend wired to a fake platform.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AdarEvent } from '@shared/types'
import { createBackend, type Backend } from '../../../backend'
import type { PlatformAdapter } from '../../../platform'

const created: string[] = []

/** Point git at an empty global config and disable the system config (call at file top). */
export function isolateGitConfig(): string {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'adar-gitcfg-')))
  created.push(dir)
  const cfg = path.join(dir, 'gitconfig')
  writeFileSync(cfg, '')
  process.env.GIT_CONFIG_GLOBAL = cfg
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  delete process.env.GIT_DIR
  delete process.env.GIT_WORK_TREE
  return cfg
}

/** A new temporary directory, by its real path as git reports it (native: also expands Windows 8.3 names such as RUNNER~1). */
export function tempDir(prefix = 'adar-test-'): string {
  const d = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), prefix)))
  created.push(d)
  return d
}

export function cleanupTempDirs(): void {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true })
}

let clock = 1_700_000_000

/** Run git synchronously in `cwd` with deterministic, increasing commit dates. */
export function git(cwd: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}): string {
  clock += 60
  const date = `${clock} +0000`
  return execFileSync('git', args, {
    cwd,
    input: opts.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, ...opts.env }
  })
}

/** git that may fail (returns combined output). */
export function gitMayFail(cwd: string, args: string[]): string {
  try {
    return git(cwd, args)
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
}

export function configureRepo(dir: string, name = 'Test User', email = 'test@example.com'): void {
  git(dir, ['config', 'user.name', name])
  git(dir, ['config', 'user.email', email])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  git(dir, ['config', 'tag.gpgsign', 'false'])
  git(dir, ['config', 'core.autocrlf', 'false'])
}

export function initTestRepo(dir = tempDir(), branch = 'main'): string {
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-q', '-b', branch])
  configureRepo(dir)
  return dir
}

export function write(repo: string, rel: string, content: string | Buffer): void {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

export function commitAll(repo: string, message: string, opts: { author?: string } = {}): string {
  git(repo, ['add', '-A'])
  const args = ['commit', '-q', '--allow-empty', '-m', message]
  if (opts.author) args.push(`--author=${opts.author}`)
  git(repo, args)
  return git(repo, ['rev-parse', 'HEAD']).trim()
}

export function fakePlatform(userDataDir: string): PlatformAdapter {
  return {
    isElectron: false,
    appVersion: '0.0.0-test',
    userDataDir,
    async pickDirectory() {
      return null
    },
    async openExternal() {},
    async showInFolder() {}
  }
}

export function makeBackend(userDataDir = tempDir('adar-userdata-')): { backend: Backend; events: AdarEvent[]; userDataDir: string } {
  const events: AdarEvent[] = []
  const backend = createBackend({
    platform: fakePlatform(userDataDir),
    emit: (e) => events.push(e),
    system: { fixShellPath: false }
  })
  return { backend, events, userDataDir }
}

/** Poll until `pred` is true or the timeout elapses. */
export async function waitFor(pred: () => boolean, timeoutMs = 8000, stepMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return pred()
}

/** 1x1 transparent PNG. */
export const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
  'hex'
)
