// Test helpers: isolated git config, temp repos, a GitContext with a fake platform.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PlatformAdapter } from '../../../platform'
import { getGitExecutable, setGitExecutable } from '../../runner'
import { createGitContext, type GitContext } from '../../context'

let isolated = false

/** Give every temporary repo and clone a test identity, isolated from the user’s config. */
export function isolateGitConfig(): void {
  setGitExecutable(process.env.ADAR_TEST_GIT ?? 'git')
  if (isolated) return
  isolated = true
  const dir = tmpDir('adar-wtest-cfg-')
  const file = path.join(dir, 'gitconfig')
  fs.writeFileSync(file, '[user]\n\tname = Test User\n\temail = test@example.com\n')
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
  isolated = false
  initialRepo = undefined
}

let clock = 1_700_000_000

/** Strictly increasing fake dates so commit order is deterministic. */
export function nextDate(): string {
  clock += 60
  return `${clock} +0000`
}

export function git(cwd: string, args: string[], opts: { env?: Record<string, string>; input?: string } = {}): string {
  return execFileSync(getGitExecutable(), args, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no', ...opts.env },
    input: opts.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

export function initRepo(): string {
  const dir = tmpDir()
  git(dir, ['init', '-q', '--template=', '-b', 'main'])
  return dir
}

/** Build a history once per suite. Each test gets its own worktree, index, refs and reflogs. */
export function repoFixture<T extends object>(populate: (dir: string) => T) {
  let template: { dir: string; data: T } | undefined
  return () => {
    if (!template) {
      const dir = initRepo()
      template = { dir, data: populate(dir) }
    }
    const dir = tmpDir()
    fs.cpSync(template.dir, dir, { recursive: true })
    return { ...template.data, dir }
  }
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

export function testContext(): GitContext {
  return createGitContext(fakePlatform, () => undefined)
}

let initialRepo: string | undefined

/** A bare "origin" with one commit on main, and a configured clone of it. */
export function cloneSetup(): { origin: string; repo: string; clone: () => string } {
  const origin = path.join(tmpDir('adar-wtest-origin-'), 'origin.git')
  if (!initialRepo) {
    initialRepo = initRepo()
    commitFile(initialRepo, 'README.md', 'hello\n', 'Initial commit')
  }
  git(path.dirname(origin), ['clone', '-q', '--bare', initialRepo, origin])
  const clone = () => {
    const parent = tmpDir('adar-wtest-clone-')
    git(parent, ['clone', '-q', origin, 'work'])
    return path.join(parent, 'work')
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
