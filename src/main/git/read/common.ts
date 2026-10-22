// Helpers shared by the read-side operation modules.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { HeadInfo } from '@shared/types'
import type { GitContext } from '../context'
import { commandDisplay, gitError, type GitResult } from '../runner'

/** Env making pathspecs literal (no glob magic) for paths that come from file lists. */
export const LITERAL_PATHSPECS: Record<string, string> = { GIT_LITERAL_PATHSPECS: '1' }

export function invalidArgument(message: string): AdarError {
  return new AdarError({ message, code: 'INVALID_ARGUMENT' })
}

export function notFound(message: string, stderr?: string): AdarError {
  return new AdarError({ message, code: 'NOT_FOUND', stderr })
}

export function notARepo(p: string, detail?: string, stderr?: string): AdarError {
  return new AdarError({
    message: detail ?? `"${p}" is not a Git repository. Choose a folder that contains a .git directory, or initialise one.`,
    code: 'NOT_A_REPO',
    stderr
  })
}

/** Throw the standard AdarError for a failed git result. */
export function failed(args: string[], res: GitResult): never {
  throw gitError(commandDisplay(args), res)
}

/** Integer option with default and bounds. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/** Revisions are passed as arguments: refuse anything git could parse as an option. */
export function validateRev(rev: unknown, label = 'revision'): string {
  if (typeof rev !== 'string' || !rev.trim()) throw invalidArgument(`Missing ${label}`)
  const r = rev.trim()
  if (r.startsWith('-')) throw invalidArgument(`Invalid ${label}: "${r}"`)
  if (/[\0\n\r]/.test(r)) throw invalidArgument(`Invalid ${label}`)
  return r
}

/** Repo-relative path: no NUL/newline, not absolute, never escaping the repository. */
export function validateRelPath(p: unknown, label = 'path'): string {
  if (typeof p !== 'string' || !p) throw invalidArgument(`Missing ${label}`)
  if (/[\0\n\r]/.test(p)) throw invalidArgument(`Invalid ${label}`)
  const slashed = p.replace(/\\/g, '/')
  if (path.posix.isAbsolute(slashed) || /^[a-zA-Z]:\//.test(slashed)) throw invalidArgument(`${label} must be relative to the repository`)
  const keepTrailingSlash = slashed.endsWith('/')
  let n = path.posix.normalize(slashed)
  if (n === '..' || n.startsWith('../')) throw invalidArgument(`${label} is outside the repository`)
  if (n === '.' || n === './') throw invalidArgument(`Invalid ${label}`)
  if (n.endsWith('/') && !keepTrailingSlash) n = n.slice(0, -1)
  return n
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/**
 * Verify `repo` is an existing repository folder; returns its git dir.
 * Rejects with NOT_A_REPO otherwise (GIT_NOT_INSTALLED passes through).
 */
export async function assertRepo(ctx: GitContext, repo: unknown): Promise<string> {
  if (typeof repo !== 'string' || !repo.trim()) throw invalidArgument('Repository path is required')
  if (!path.isAbsolute(repo)) throw notARepo(repo)
  try {
    const st = await fs.stat(repo)
    if (!st.isDirectory()) throw notARepo(repo)
  } catch (err) {
    if (err instanceof AdarError) throw err
    // NOT_FOUND (not NOT_A_REPO): the UI offers "initialise here" for NOT_A_REPO, which must not
    // recreate a repository folder that was moved or deleted.
    throw notFound(`Repository folder not found: ${repo}`)
  }
  try {
    return await ctx.gitDir(repo)
  } catch (err) {
    if (err instanceof AdarError && err.code === 'GIT_NOT_INSTALLED') throw err
    throw notARepo(repo, undefined, err instanceof AdarError ? err.stderr : undefined)
  }
}

export async function readHead(ctx: GitContext, repo: string): Promise<HeadInfo> {
  const [sym, rev] = await Promise.all([
    ctx.git(repo, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowFailure: true }),
    ctx.git(repo, ['rev-parse', '-q', '--verify', 'HEAD'], { allowFailure: true })
  ])
  const branch = sym.code === 0 ? sym.stdout.trim() || null : null
  const sha = rev.code === 0 ? rev.stdout.trim() || null : null
  return { sha, branch, detached: branch === null, unborn: sha === null && branch !== null }
}

export async function isUnborn(ctx: GitContext, repo: string): Promise<boolean> {
  const r = await ctx.git(repo, ['rev-parse', '-q', '--verify', 'HEAD'], { allowFailure: true })
  return r.code !== 0
}

/** Parents of a commit-ish (first entry is the commit itself). */
export async function revParents(ctx: GitContext, repo: string, rev: string): Promise<{ sha: string; parents: string[] } | null> {
  const r = await ctx.git(repo, ['rev-list', '--parents', '-n', '1', rev, '--'], { allowFailure: true })
  if (r.code !== 0) return null
  const parts = r.stdout.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  return { sha: parts[0], parents: parts.slice(1) }
}

export interface RepoLocation {
  root: string
  gitDir: string
  commonDir: string
  isBare: boolean
}

/** Resolve the worktree root (or bare git dir) containing `dir`. */
export async function locateRepo(ctx: GitContext, dir: string): Promise<RepoLocation> {
  const r = await ctx.gitGlobal(['rev-parse', '--absolute-git-dir', '--is-bare-repository'], {
    cwd: dir,
    allowFailure: true,
    timeoutMs: 30_000
  })
  if (r.code !== 0) {
    if (/dubious ownership/i.test(r.stderr)) {
      throw notARepo(
        dir,
        `Git refuses to open "${dir}" because it is owned by another user. Run: git config --global --add safe.directory "${dir}"`,
        r.stderr
      )
    }
    throw notARepo(dir, undefined, r.stderr)
  }
  const [printedGitDir = '', bare = ''] = r.stdout.split('\n').map((l) => l.trim())
  if (!printedGitDir) throw notARepo(dir, undefined, r.stderr)
  // Git for Windows prints C:/x/y: keep the native form (as dialogs and the CLI give paths) so paths compare equal.
  const gitDir = path.resolve(printedGitDir)
  let commonDir = gitDir
  try {
    const rel = (await fs.readFile(path.join(gitDir, 'commondir'), 'utf8')).trim()
    if (rel) commonDir = path.resolve(gitDir, rel)
  } catch {
    /* not a linked worktree */
  }
  if (bare === 'true') return { root: gitDir, gitDir, commonDir, isBare: true }

  const top = await ctx.gitGlobal(['rev-parse', '--show-toplevel'], { cwd: dir, allowFailure: true, timeoutMs: 30_000 })
  const root = top.code === 0 && top.stdout.trim() ? path.resolve(top.stdout.trim()) : ''
  if (root) return { root, gitDir, commonDir, isBare: false }
  // Opened from inside the .git directory of a regular repository.
  if (path.basename(gitDir) === '.git') return { root: path.dirname(gitDir), gitDir, commonDir, isBare: false }
  throw notARepo(dir, undefined, top.stderr)
}

/** Count '\n' quickly (used to detect oversized diffs). */
export function countNewlines(s: string, stopAfter = Infinity): number {
  let n = 0
  let i = -1
  while ((i = s.indexOf('\n', i + 1)) !== -1) {
    if (++n > stopAfter) break
  }
  return n
}
