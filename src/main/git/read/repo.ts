// Repository lifecycle: open / close / init / clone / info.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { RepoInfo } from '@shared/types'
import type { ReadOps } from '../ops'
import type { GitContext } from '../context'
import { parseRemotesVerbose } from '../parsers/refs'
import type { SystemServices } from '../../system'
import { assertRepo, clampInt, expandHome, failed, invalidArgument, locateRepo, notFound, readHead, type RepoLocation } from './common'

/**
 * True for a folder name that the file system may resolve to ".git": case-insensitive volumes
 * (macOS, Windows), trailing dots / spaces (dropped by Windows), NTFS streams (".git::$INDEX_ALLOCATION"),
 * the 8.3 alias "GIT~1" and the code points HFS+ ignores. Cloning or initialising into such a folder
 * would turn its parent into a repository whose config comes from the cloned files.
 */
export function isDotGitName(name: string): boolean {
  const base = name
    .replace(/[\u200c-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g, '')
    .trim()
    .split(':')[0]
    .replace(/[. ]+$/, '')
    .toLowerCase()
  return base === '.git' || /^git~\d+$/.test(base)
}

/** Refuse a target folder that is, or lies inside, a ".git"-equivalent folder. */
function assertNoDotGitComponent(target: string): void {
  const parts = path.relative(path.parse(target).root, target).split(/[\\/]+/)
  if (parts.some((p) => p && isDotGitName(p))) {
    throw invalidArgument(`Refusing to create a repository in or inside a ".git" folder: "${target}"`)
  }
}

/**
 * Directory name git would pick for a clone URL:
 *   https://host/org/repo.git → repo, git@host:org/repo.git → repo,
 *   ssh://git@host:22/org/repo/ → repo, /srv/git/repo.git → repo, C:\src\repo → repo.
 */
export function deriveCloneDirName(url: string): string {
  let s = url.trim()
  s = s.replace(/[?#].*$/, '')
  s = s.replace(/[\\/]+$/, '')
  s = s.replace(/\.git$/i, '')
  s = s.replace(/[\\/]+$/, '')
  s = s.replace(/\.bundle$/i, '')
  const m = /[^/\\:]+$/.exec(s)
  const name = (m ? m[0] : '').replace(/[\0<>:"|?*]/g, '-').trim()
  if (!name || name === '.' || name === '..' || isDotGitName(name)) {
    throw invalidArgument(`Cannot derive a folder name from "${url}". Enter a folder name.`)
  }
  return name
}

function validateCloneUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) throw invalidArgument('Repository URL is required')
  const u = url.trim()
  if (u.startsWith('-') || /[\0\n\r]/.test(u)) throw invalidArgument(`Invalid repository URL: "${u}"`)
  return u
}

function validateDirName(name: string): string {
  const n = name.trim()
  if (!n || n === '.' || n === '..' || /[\\/\0]/.test(n)) throw invalidArgument(`Invalid folder name: "${name}"`)
  if (isDotGitName(n)) throw invalidArgument(`A folder cannot be named "${n}" (it would be treated as a Git directory)`)
  return n
}

async function isNonEmptyDir(p: string): Promise<'missing' | 'empty' | 'non-empty' | 'file'> {
  try {
    const st = await fs.stat(p)
    if (!st.isDirectory()) return 'file'
    const entries = await fs.readdir(p)
    return entries.length ? 'non-empty' : 'empty'
  } catch {
    return 'missing'
  }
}

// ── Trust gate ─────────────────────────────────────────────────────────────
// A folder that arrived with its .git directory (archive, shared drive, nested repo) carries a
// repo-local config that git honours in full: core.fsmonitor runs on every `git status`, filter
// drivers on status/diff, core.sshCommand / credential helpers on fetch, hooks on commit/checkout.
// openRepo() therefore refuses repositories it has not seen before when they configure any of
// these, until the user trusts them. Reading the config (`git config --local --list`) and the
// hooks directory executes nothing.

/** Keys (lower-cased; subsections matched loosely) whose value makes git run a command. */
const COMMAND_KEYS: readonly RegExp[] = [
  /^core\.(sshcommand|gitproxy|askpass|hookspath|alternaterefscommand)$/,
  // (core.editor / core.pager never run: Adar sets GIT_EDITOR and git has no tty; sequence.editor beats GIT_EDITOR.)
  /^sequence\.editor$/,
  /^credential\.(.+\.)?helper$/,
  /^remote\..+\.(uploadpack|receivepack|vcs)$/,
  /^filter\..+\.(clean|smudge|process)$/,
  /^diff\.external$/,
  /^diff\..+\.(command|textconv)$/,
  /^merge\..+\.driver$/,
  /^(difftool|mergetool)\..+\.cmd$/,
  /^gpg\.(.+\.)?program$/,
  /^gpg\.ssh\.defaultkeycommand$/,
  /^trailer\..+\.(command|cmd)$/,
  /^include\.path$/,
  /^includeif\..+\.path$/
]

const BOOLEAN_VALUE = /^(true|false|yes|no|on|off|-?\d+)?$/i

/** One "key = value" description per config entry that makes git run a command ([] when none). */
export function commandRunningConfig(entries: ReadonlyArray<{ key: string; value: string | null }>): string[] {
  const out: string[] = []
  for (const { key, value } of entries) {
    const k = key.toLowerCase()
    const v = value ?? ''
    let risky: boolean
    if (k === 'core.fsmonitor') risky = value !== null && !BOOLEAN_VALUE.test(v.trim())
    else if (k === 'protocol.allow') risky = /^(always|user)$/i.test(v.trim())
    else if (/^protocol\.ext\.allow$/.test(k)) risky = !/^never$/i.test(v.trim())
    else if (/^alias\./.test(k) || /^submodule\..+\.update$/.test(k)) risky = v.trimStart().startsWith('!')
    else risky = COMMAND_KEYS.some((re) => re.test(k)) && (value === null || v.trim() !== '')
    if (!risky) continue
    const shown = value === null ? key : `${key} = ${v.replace(/[\x00-\x1f\x7f]+/g, ' ')}`
    out.push(shown.length > 300 ? `${shown.slice(0, 299)}…` : shown)
  }
  return out
}

/** Parse `git config --null --list` output: "key\nvalue\0" (or "key\0" for a value-less key). */
export function parseConfigList(out: string): Array<{ key: string; value: string | null }> {
  const entries: Array<{ key: string; value: string | null }> = []
  for (const rec of out.split('\0')) {
    if (!rec) continue
    const nl = rec.indexOf('\n')
    entries.push(nl < 0 ? { key: rec, value: null } : { key: rec.slice(0, nl), value: rec.slice(nl + 1) })
  }
  return entries
}

async function exists(p: string): Promise<boolean> {
  return fs.stat(p).then(
    () => true,
    () => false
  )
}

/** Repo-local config entries and hooks of `loc` that would make git run a command. */
export async function findCommandRunningConfig(ctx: GitContext, loc: RepoLocation): Promise<string[]> {
  const list = async (scope: '--local' | '--worktree') => {
    const args = ['config', scope, '--null', '--list']
    const res = await ctx.gitGlobal(args, { cwd: loc.root, allowFailure: true, timeoutMs: 30_000 })
    if (res.code !== 0) failed(args, res)
    return parseConfigList(res.stdout)
  }
  const entries = (await exists(path.join(loc.commonDir, 'config'))) ? await list('--local') : []
  const worktreeConfig = entries.some((e) => e.key.toLowerCase() === 'extensions.worktreeconfig' && /^(true|yes|on|1)?$/i.test(e.value ?? ''))
  if (worktreeConfig) entries.push(...(await list('--worktree')))
  const found = commandRunningConfig(entries)

  // Hooks git would run (commit, checkout, merge, push...): executable files that are not *.sample.
  const hooksDir = path.join(loc.commonDir, 'hooks')
  const names = await fs.readdir(hooksDir).catch(() => [] as string[])
  for (const name of names.sort()) {
    if (name.endsWith('.sample') || name.startsWith('.')) continue
    const st = await fs.stat(path.join(hooksDir, name)).catch(() => null)
    if (!st?.isFile() || (process.platform !== 'win32' && (st.mode & 0o111) === 0)) continue
    found.push(`hook: ${path.relative(loc.root, path.join(hooksDir, name)) || name}`)
  }
  return found
}

/** Root of the main worktree (or the bare repository) owning a common git dir. */
function mainRootOf(loc: RepoLocation): string {
  return path.basename(loc.commonDir) === '.git' ? path.dirname(loc.commonDir) : loc.commonDir
}

type RepoOps = Pick<ReadOps, 'openRepo' | 'trustRepo' | 'closeRepo' | 'initRepo' | 'cloneRepo' | 'getRepoInfo'>

export function createRepoOps(ctx: GitContext, services: SystemServices): RepoOps {
  const getRepoInfo = async (repo: string): Promise<RepoInfo> => {
    const gitDir = await assertRepo(ctx, repo)
    const [bare, head, state, remotes] = await Promise.all([
      ctx.git(repo, ['rev-parse', '--is-bare-repository'], { allowFailure: true }),
      readHead(ctx, repo),
      ctx.operationState(repo),
      ctx.git(repo, ['remote', '-v'], { allowFailure: true })
    ])
    const root = repo.length > 1 ? repo.replace(/[\\/]+$/, '') : repo
    return {
      path: root,
      name: path.basename(root) || root,
      gitDir,
      isBare: bare.stdout.trim() === 'true',
      head,
      state,
      remotes: remotes.code === 0 ? parseRemotesVerbose(remotes.stdout) : []
    }
  }

  /** Locate the repository containing a folder (or file) the user picked. */
  const locate = async (p: unknown, emptyMessage: string): Promise<RepoLocation> => {
    if (typeof p !== 'string' || !p.trim()) throw invalidArgument(emptyMessage)
    let dir = path.resolve(expandHome(p.trim()))
    let st
    try {
      st = await fs.stat(dir)
    } catch {
      throw notFound(`Folder not found: ${dir}`)
    }
    if (!st.isDirectory()) dir = path.dirname(dir)
    return locateRepo(ctx, dir)
  }

  /** Refuse (UNTRUSTED_REPO) a repository that is not trusted and configures commands git would run. */
  const assertTrusted = async (loc: RepoLocation): Promise<void> => {
    if (await services.settings.isTrustedRepo([loc.root, mainRootOf(loc)])) return
    const found = await findCommandRunningConfig(ctx, loc)
    if (!found.length) return
    throw new AdarError({
      code: 'UNTRUSTED_REPO',
      message: `"${loc.root}" is configured to make Git run commands (${found.length === 1 ? found[0] : `${found.length} entries`}). Trust the repository to open it.`,
      details: found
    })
  }

  /**
   * openRepo(); `createdRoot` = real path of a repository Adar itself just cloned / initialised there,
   * trusted when git reports exactly that root (never a parent repository found by discovery).
   */
  const openRepoAt = async (p: string, createdRoot?: string): Promise<RepoInfo> => {
    const loc = await locate(p, 'Choose a folder to open')
    if (createdRoot && loc.root === createdRoot) await services.settings.trustRepo(loc.root)
    await assertTrusted(loc)
    const info = await getRepoInfo(loc.root)
    services.watcher.start({ repoPath: info.path, gitDir: loc.gitDir, commonDir: loc.commonDir, isBare: loc.isBare })
    await services.settings.addRecentRepo(info.path, info.name).catch(() => undefined)
    return info
  }

  const realpathIfExists = (p: string) => fs.realpath(p).catch(() => undefined)

  return {
    getRepoInfo,
    openRepo: (p) => openRepoAt(p),

    async trustRepo(p) {
      const loc = await locate(p, 'Choose a repository to trust')
      await services.settings.trustRepo(loc.root)
    },

    async closeRepo(repo) {
      if (typeof repo !== 'string') return
      services.watcher.stop(repo)
      ctx.forgetRepo(repo)
    },

    async initRepo(p, opts = {}) {
      if (typeof p !== 'string' || !p.trim()) throw invalidArgument('Choose a folder for the new repository')
      const branch = (opts.initialBranch ?? 'main').trim() || 'main'
      if (branch.startsWith('-')) throw invalidArgument(`Invalid branch name: "${branch}"`)
      const check = await ctx.gitGlobal(['check-ref-format', '--branch', branch], { allowFailure: true })
      if (check.code !== 0) throw invalidArgument(`Invalid branch name: "${branch}"`)
      const dir = path.resolve(expandHome(p.trim()))
      assertNoDotGitComponent(dir)
      // Re-running init in an existing repository keeps its config: only a new repository is trusted.
      const existed = await exists(path.join(dir, '.git'))
      await fs.mkdir(dir, { recursive: true })
      const res = await ctx.gitGlobal(['init', '-b', branch, dir], { cwd: dir, allowFailure: true })
      if (res.code !== 0) {
        // git < 2.28 has no -b: init, then point HEAD at the branch.
        if (/unknown switch|unknown option|usage:/i.test(res.stderr)) {
          await ctx.gitGlobal(['init', dir], { cwd: dir })
          await ctx.gitGlobal(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: dir })
        } else {
          failed(['init', '-b', branch, dir], res)
        }
      }
      return openRepoAt(dir, existed ? undefined : await realpathIfExists(dir))
    },

    async cloneRepo(url, parentDir, opts = {}) {
      const u = validateCloneUrl(url)
      if (typeof parentDir !== 'string' || !parentDir.trim()) throw invalidArgument('Choose where to clone the repository')
      const parent = path.resolve(expandHome(parentDir.trim()))
      const name = opts.dirName && opts.dirName.trim() ? validateDirName(opts.dirName) : deriveCloneDirName(u)
      const target = path.join(parent, name)
      assertNoDotGitComponent(target)
      const existing = await isNonEmptyDir(target)
      if (existing === 'file' || existing === 'non-empty') {
        throw invalidArgument(`"${target}" already exists and is not an empty folder. Choose another name or location.`)
      }
      await fs.mkdir(parent, { recursive: true })
      const args = ['clone', '--progress']
      if (opts.depth !== undefined && opts.depth !== null) {
        const depth = clampInt(opts.depth, 0, 0, 1_000_000_000)
        if (depth > 0) args.push('--depth', String(depth))
      }
      args.push('--', u, target)
      await ctx.gitNetwork(null, args, { opId: opts.opId, cwd: parent })
      return openRepoAt(target, await realpathIfExists(target))
    }
  }
}
