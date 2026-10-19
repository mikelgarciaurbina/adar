// Shared helpers for the write-side git operations: argument validation,
// pathspec plumbing, ref lookups and the conflict-aware operation runner.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { OperationResult, AdarErrorCode, RepoOperationState } from '@shared/types'
import type { GitContext } from '../context'
import { commandDisplay, friendlyMessage, gitError, type GitResult, type GitRunOptions } from '../runner'

// ── Errors ─────────────────────────────────────────────────────────────────

export function invalid(message: string): AdarError {
  return new AdarError({ message, code: 'INVALID_ARGUMENT' })
}

export function notFound(message: string): AdarError {
  return new AdarError({ message, code: 'NOT_FOUND' })
}

/** Copy of `err` with a different code (AdarError fields are read-only). */
export function withCode(err: AdarError, code: AdarErrorCode, message?: string): AdarError {
  return new AdarError({ ...err.toPayload(), code, message: message ?? err.message })
}

const DIRTY_RE =
  /would be overwritten|commit your changes or stash them|please move or remove them|you have unstaged changes|your local changes to the following files/i

/**
 * The runner checks for "conflict" before the dirty-worktree patterns, so a
 * checkout refused because of local changes to e.g. `conflict.txt` would be
 * reported as CONFLICT. Re-check the text and fix the code.
 */
export function reclassifyDirty(err: unknown): unknown {
  if (!(err instanceof AdarError)) return err
  if (err.code === 'DIRTY_WORKTREE' || err.code === 'AUTH_FAILED' || err.code === 'NETWORK' || err.code === 'CANCELLED') return err
  const text = `${err.stderr ?? ''}\n${err.message}`
  if (DIRTY_RE.test(text)) return withCode(err, 'DIRTY_WORKTREE', friendlyMessage('DIRTY_WORKTREE', text) ?? err.message)
  return err
}

/** Re-map errors whose text matches `re` to INVALID_ARGUMENT (e.g. "already exists"). */
export function mapInvalid(err: unknown, re: RegExp): unknown {
  if (err instanceof AdarError && err.code === 'GIT_FAILED' && re.test(`${err.stderr ?? ''}\n${err.message}`)) {
    return withCode(err, 'INVALID_ARGUMENT')
  }
  return err
}

export function displayCommand(args: string[]): string {
  return commandDisplay(args)
}

/** Throw the standard AdarError for a failed result obtained with allowFailure. */
export function failure(args: string[], res: GitResult): AdarError {
  return gitError(displayCommand(args), res)
}

/** stdout + stderr, trimmed, for toasts. */
export function combinedOutput(res: GitResult): string {
  return [res.stdout.trim(), res.stderr.trim()].filter(Boolean).join('\n')
}

// ── Argument validation ────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/

/**
 * Validate a user-provided ref / name / sha / remote / URL that is passed as a
 * git argument: non-empty string, no control characters, and never starting
 * with '-' (option injection).
 */
export function arg(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(`Missing ${what}`)
  if (CONTROL_RE.test(value)) throw invalid(`Invalid ${what}: contains control characters`)
  if (value.startsWith('-')) throw invalid(`Invalid ${what}: "${value}" must not start with "-"`)
  return value
}

/** Like arg() but additionally rejects whitespace (branch, tag and remote names). */
export function nameArg(value: unknown, what: string): string {
  const v = arg(value, what)
  if (/\s/.test(v)) throw invalid(`Invalid ${what}: "${v}" must not contain spaces`)
  return v
}

/** Optional ref: undefined / empty string → undefined. */
export function optionalArg(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return arg(value, what)
}

/** Free-form single-line text (identity values). */
export function lineArg(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`Missing ${what}`)
  if (CONTROL_RE.test(value)) throw invalid(`Invalid ${what}: must be a single line`)
  return value.trim()
}

export function isInside(root: string, abs: string): boolean {
  const rel = path.relative(root, abs)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/**
 * Validate repo-relative paths (lexically inside the repo root, no NUL) and
 * de-duplicate them, keeping order.
 */
export function repoPaths(repo: string, paths: unknown): string[] {
  if (!Array.isArray(paths)) throw invalid('Expected a list of paths')
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) throw invalid('Invalid empty path')
    if (p.includes('\0')) throw invalid('Invalid path: contains a NUL character')
    if (!isInside(repo, path.resolve(repo, p))) throw invalid(`Path is outside the repository: ${p}`)
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/** Single repo-relative path. */
export function repoPath(repo: string, p: unknown): string {
  return repoPaths(repo, [p])[0]
}

/**
 * Resolve `rel` against the repo and make sure its parent directory (following
 * symbolic links) stays inside the repo. The target itself may be a symlink:
 * callers unlink it rather than follow it.
 */
export function safeResolve(repo: string, rel: string): Promise<string> {
  return createSafeResolver(repo)(rel)
}

/** safeResolve() with the realpath lookups cached, for resolving many paths at once. */
export function createSafeResolver(repo: string): (rel: string) => Promise<string> {
  let rootReal: Promise<string> | null = null
  const dirs = new Map<string, Promise<string | null>>()
  const realDir = (dir: string): Promise<string | null> => {
    let p = dirs.get(dir)
    if (!p) {
      p = fs.realpath(dir).catch(() => null)
      dirs.set(dir, p)
    }
    return p
  }
  return async (rel: string) => {
    const abs = path.resolve(repo, rel)
    if (!isInside(repo, abs)) throw invalid(`Path is outside the repository: ${rel}`)
    rootReal ??= fs.realpath(repo)
    const root = await rootReal
    // Nearest existing ancestor directory.
    let dir = path.dirname(abs)
    for (;;) {
      const real = await realDir(dir)
      if (real !== null) {
        if (!isInside(root, real)) throw invalid(`Path escapes the repository through a symbolic link: ${rel}`)
        break
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return abs
  }
}

// ── Pathspecs ──────────────────────────────────────────────────────────────

/** Treat pathspecs literally (file names containing * ? [ are not globs). */
export const LITERAL_ENV: Record<string, string> = { GIT_LITERAL_PATHSPECS: '1' }

/** Flags to read NUL-separated pathspecs from stdin. */
export const PATHSPEC_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul']

export function pathspecInput(paths: string[]): string {
  return paths.join('\0')
}

/** Run a command once per chunk of pathspecs passed as arguments after `--` (for commands without --pathspec-from-file). */
export async function chunkedPathspecs(
  paths: string[],
  fn: (chunk: string[]) => Promise<void>,
  maxChars = 60_000
): Promise<void> {
  let chunk: string[] = []
  let size = 0
  for (const p of paths) {
    if (chunk.length && size + p.length + 1 > maxChars) {
      await fn(chunk)
      chunk = []
      size = 0
    }
    chunk.push(p)
    size += p.length + 1
  }
  if (chunk.length) await fn(chunk)
}

/** git ls-files -z <flags> -- <paths> (chunked), returning repo-relative paths. */
export async function lsFiles(ctx: GitContext, repo: string, flags: string[], paths: string[]): Promise<string[]> {
  const out: string[] = []
  await chunkedPathspecs(paths, async (chunk) => {
    const res = await ctx.git(repo, ['ls-files', '-z', ...flags, '--', ...chunk], { env: LITERAL_ENV })
    for (const f of res.stdout.split('\0')) if (f) out.push(f)
  })
  return out
}

// ── Refs & repository facts ────────────────────────────────────────────────

export async function refExists(ctx: GitContext, repo: string, fullRef: string): Promise<boolean> {
  const res = await ctx.git(repo, ['show-ref', '--verify', '--quiet', fullRef], { allowFailure: true })
  return res.code === 0
}

/** Checked-out branch short name, or null when detached. */
export async function currentBranch(ctx: GitContext, repo: string): Promise<string | null> {
  const res = await ctx.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
  return res.code === 0 ? res.stdout.trim() || null : null
}

/** True when HEAD has no commit yet. */
export async function isUnborn(ctx: GitContext, repo: string): Promise<boolean> {
  const res = await ctx.git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFailure: true })
  return res.code !== 0
}

/** Full sha of a commit-ish, or NOT_FOUND. */
export async function resolveCommit(ctx: GitContext, repo: string, rev: string): Promise<string> {
  const res = await ctx.git(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], {
    allowFailure: true
  })
  const sha = res.stdout.trim()
  if (res.code !== 0 || !sha) throw notFound(`Unknown revision: ${rev}`)
  return sha
}

/** Full sha of a commit-ish, or null when it does not resolve. */
export async function tryResolveCommit(ctx: GitContext, repo: string, rev: string): Promise<string | null> {
  try {
    return await resolveCommit(ctx, repo, rev)
  } catch {
    return null
  }
}

export async function listRemotes(ctx: GitContext, repo: string): Promise<string[]> {
  const res = await ctx.git(repo, ['remote'])
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Split "origin/feature/x" into remote + branch using the longest matching remote name. */
export function splitRemoteRef(ref: string, remotes: string[]): { remote: string; branch: string } | null {
  let best: string | null = null
  for (const r of remotes) {
    if (ref.startsWith(`${r}/`) && ref.length > r.length + 1 && (!best || r.length > best.length)) best = r
  }
  return best ? { remote: best, branch: ref.slice(best.length + 1) } : null
}

export async function getConfig(ctx: GitContext, repo: string, key: string): Promise<string | null> {
  const res = await ctx.git(repo, ['config', '--get', key], { allowFailure: true })
  return res.code === 0 ? res.stdout.trim() : null
}

/** Upstream of a local branch from config (works even if the remote branch is gone). */
export async function branchUpstream(
  ctx: GitContext,
  repo: string,
  branch: string
): Promise<{ remote: string; merge: string } | null> {
  const remote = await getConfig(ctx, repo, `branch.${branch}.remote`)
  const merge = await getConfig(ctx, repo, `branch.${branch}.merge`)
  return remote && merge ? { remote, merge } : null
}

/** True when the index differs from HEAD (any staged change). */
export async function hasStagedChanges(ctx: GitContext, repo: string): Promise<boolean> {
  if (await isUnborn(ctx, repo)) {
    const res = await ctx.git(repo, ['ls-files', '--cached', '-z'])
    return res.stdout.length > 0
  }
  const res = await ctx.git(repo, ['diff', '--cached', '--quiet'], { okCodes: [0, 1] })
  return res.code === 1
}

let gitVersionCache: Promise<number[]> | null = null

/** Installed git version as [major, minor, patch]. */
export function gitVersion(ctx: GitContext): Promise<number[]> {
  if (!gitVersionCache) {
    gitVersionCache = ctx
      .gitGlobal(['version'])
      .then((r) => {
        const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(r.stdout)
        return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : [0, 0, 0]
      })
      .catch(() => [0, 0, 0])
  }
  return gitVersionCache
}

export async function gitAtLeast(ctx: GitContext, major: number, minor: number): Promise<boolean> {
  const [a, b] = await gitVersion(ctx)
  return a > major || (a === major && b >= minor)
}

// ── Conflict-aware operations ──────────────────────────────────────────────

/** States that mean "the operation is still in progress" for each family. */
export const FAMILY: Record<'merge' | 'rebase' | 'cherryPick' | 'revert' | 'am' | 'stash' | 'pull', readonly RepoOperationState[]> = {
  merge: ['merge'],
  rebase: ['rebase', 'rebase-interactive'],
  cherryPick: ['cherry-pick'],
  revert: ['revert'],
  am: ['am'],
  stash: [],
  pull: ['merge', 'rebase', 'rebase-interactive']
}

export function familyOf(state: RepoOperationState): readonly RepoOperationState[] {
  switch (state) {
    case 'merge':
      return FAMILY.merge
    case 'rebase':
    case 'rebase-interactive':
      return FAMILY.rebase
    case 'cherry-pick':
      return FAMILY.cherryPick
    case 'revert':
      return FAMILY.revert
    case 'am':
      return FAMILY.am
    default:
      return [state]
  }
}

/**
 * Turn the result of a command that may stop on conflicts into an
 * OperationResult:
 *  - fatal exits (>= 128) throw;
 *  - exit 0 → ok unless the repo is still in an operation of `family` (e.g. a
 *    rebase stopped at an `edit`), or conflicts remain;
 *  - other exits → ok:false when conflicts exist or the operation is still in
 *    progress (stopped), otherwise throw.
 */
export async function finishOperation(
  ctx: GitContext,
  repo: string,
  args: string[],
  res: GitResult,
  family: readonly RepoOperationState[],
  extraMessage?: string
): Promise<OperationResult> {
  // `git am` reports a patch that does not apply with exit 128 but stays in progress.
  if (res.code >= 128 && !(family.includes('am') && (await ctx.operationState(repo)) === 'am')) {
    throw reclassifyDirty(failure(args, res))
  }
  const [conflicts, state] = await Promise.all([ctx.conflictedPaths(repo), ctx.operationState(repo)])
  const message = [extraMessage, combinedOutput(res)].filter(Boolean).join('\n')
  const inProgress = family.includes(state)
  if (res.code === 0) return { ok: !inProgress && conflicts.length === 0, conflicts, message, state }
  if (conflicts.length > 0 || inProgress) return { ok: false, conflicts, message, state }
  throw reclassifyDirty(failure(args, res))
}

/** Run a conflict-capable command and convert its outcome with finishOperation(). */
export async function runOperation(
  ctx: GitContext,
  repo: string,
  args: string[],
  family: readonly RepoOperationState[],
  opts: Omit<GitRunOptions, 'cwd' | 'allowFailure'> = {}
): Promise<OperationResult> {
  const res = await ctx.git(repo, args, { ...opts, allowFailure: true })
  return finishOperation(ctx, repo, args, res, family)
}

/** Short sha + subject of a commit-ish ("abc1234 Fix the thing"), or null. */
export async function describeCommit(ctx: GitContext, repo: string, rev: string): Promise<string | null> {
  const res = await ctx.git(repo, ['log', '-1', '--no-show-signature', '--format=%h %s', rev, '--'], {
    allowFailure: true
  })
  const out = res.stdout.trim()
  return res.code === 0 && out ? out : null
}

/** Shell single-quote a string for sh (used only for GIT_SEQUENCE_EDITOR / exec lines). */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Path as written into sh command lines (forward slashes on Windows for MSYS sh). */
export function shellPath(p: string): string {
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p
}
