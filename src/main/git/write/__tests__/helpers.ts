// Test helpers: isolated git config, temp repos, a GitContext with a fake platform.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PlatformAdapter } from '../../../platform'
import { createGitContext, type GitContext } from '../../context'
import type { WriteOps } from '../../ops'
import { createWriteOps } from '../index'

let isolated = false

/** Point git at an empty global config and ignore the system config. */
export function isolateGitConfig(): void {
  if (isolated) return
  isolated = true
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adar-wtest-cfg-'))
  const file = path.join(dir, 'gitconfig')
  fs.writeFileSync(file, '')
  process.env.GIT_CONFIG_GLOBAL = file
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL']) {
    delete process.env[k]
  }
}

const roots: string[] = []

/** A new temporary directory, by its real path as git reports it (native: also expands Windows 8.3 names such as RUNNER~1). */
export function tmpDir(prefix = 'adar-wtest-'): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  roots.push(d)
  return d
}

export function cleanupTmp(): void {
  for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}

let clock = 1_700_000_000

/** Strictly increasing fake dates so commit order is deterministic. */
export function nextDate(): string {
  clock += 60
  return `${clock} +0000`
}

export function git(cwd: string, args: string[], opts: { env?: Record<string, string>; input?: string } = {}): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no', ...opts.env },
    input: opts.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

export function configure(dir: string): void {
  git(dir, ['config', 'user.name', 'Test User'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  git(dir, ['config', 'tag.gpgsign', 'false'])
}

export function initRepo(): string {
  const dir = tmpDir()
  git(dir, ['init', '-q', '-b', 'main'])
  configure(dir)
  return dir
}

export function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

export function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8')
}

export function exists(dir: string, rel: string): boolean {
  return fs.existsSync(path.join(dir, rel))
}

/** Write + stage + commit one file; returns the new HEAD sha. */
export function commitFile(
  dir: string,
  rel: string,
  content: string,
  message: string,
  env: Record<string, string> = {}
): string {
  write(dir, rel, content)
  git(dir, ['add', '--', rel])
  const date = nextDate()
  git(dir, ['commit', '-q', '-m', message], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, ...env } })
  return head(dir)
}

export function head(dir: string, rev = 'HEAD'): string {
  return git(dir, ['rev-parse', rev]).trim()
}

export function subjects(dir: string, range = 'HEAD'): string[] {
  return git(dir, ['log', '--format=%s', range]).split('\n').filter(Boolean)
}

export function status(dir: string): string {
  return git(dir, ['status', '--porcelain']).trimEnd()
}

export const fakePlatform: PlatformAdapter = {
  isElectron: false,
  appVersion: 'test',
  userDataDir: os.tmpdir(),
  pickDirectory: async () => null,
  openExternal: async () => undefined,
  showInFolder: async () => undefined
}

export function makeOps(): { ctx: GitContext; ops: WriteOps } {
  const ctx = createGitContext(fakePlatform, () => undefined)
  return { ctx, ops: createWriteOps(ctx) }
}

/** A bare "origin" with one commit on main, and a configured clone of it. */
export function cloneSetup(): { origin: string; repo: string; clone: () => string } {
  const origin = path.join(tmpDir('adar-wtest-origin-'), 'origin.git')
  git(path.dirname(origin), ['init', '-q', '--bare', '-b', 'main', origin])
  const seed = initRepo()
  commitFile(seed, 'README.md', 'hello\n', 'Initial commit')
  git(seed, ['remote', 'add', 'origin', origin])
  git(seed, ['push', '-q', 'origin', 'main'])
  const clone = () => {
    const parent = tmpDir('adar-wtest-clone-')
    git(parent, ['clone', '-q', origin, 'work'])
    const dir = path.join(parent, 'work')
    configure(dir)
    return dir
  }
  return { origin, repo: clone(), clone }
}

/** Expect a promise to reject with a AdarError of `code`; returns the error. */
export async function expectCode(p: Promise<unknown>, code: string): Promise<{ code: string; message: string; stderr?: string }> {
  try {
    await p
  } catch (err) {
    const e = err as { code: string; message: string; stderr?: string }
    if (e.code !== code) throw new Error(`Expected code ${code} but got ${e.code}: ${e.message}`)
    return e
  }
  throw new Error(`Expected rejection with code ${code} but the promise resolved`)
}
