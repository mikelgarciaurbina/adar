// getDiff for every DiffTarget kind (unstaged, untracked, staged, commit, compare, stash).

import { isUtf8 } from 'node:buffer'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DiffOptions, DiffTarget, FileDiff, FileStatusCode } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import type { GitResult } from '../runner'
import { emptyFileDiff, parseUnifiedDiff } from '../parsers/diff'
import { parseNameStatusZ } from '../parsers/files'
import { gitAtLeast } from '../write/util'
import {
  LITERAL_PATHSPECS,
  assertRepo,
  clampInt,
  countNewlines,
  failed,
  invalidArgument,
  notFound,
  revParents,
  validateRelPath,
  validateRev
} from './common'

/** Diffs above either limit are returned without hunks (tooLarge). */
export const MAX_DIFF_BYTES = 5 * 1024 * 1024
export const MAX_DIFF_LINES = 20_000
/** Hard cap on what we read from git at all. */
const MAX_DIFF_BUFFER = 64 * 1024 * 1024

export function diffFlags(opts: DiffOptions = {}): string[] {
  const context = clampInt(opts.context, 3, 0, 1_000_000)
  const flags = [
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    // Neutralise diff.noprefix / diff.mnemonicPrefix so headers are always a/ b/.
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-M',
    `-U${context}`
  ]
  if (opts.ignoreWhitespace) flags.push('-w')
  return flags
}

/** Choose the entry for `p` among parsed files (falls back to the only/first entry). */
export function pickFileDiff(files: FileDiff[], p: string, oldPath?: string): FileDiff | undefined {
  return (
    files.find((f) => f.path === p) ??
    files.find((f) => f.oldPath === p || (oldPath !== undefined && f.oldPath === oldPath)) ??
    (oldPath ? files.find((f) => f.path === oldPath) : undefined) ??
    files[0]
  )
}

/**
 * True when git's raw output was not valid UTF-8 (a file in a legacy encoding): its decoded text
 * carries U+FFFD in place of the original bytes, so patches built from it would corrupt the file.
 * (Run the command with `binary: true`.)
 */
export function isLossyOutput(res: Pick<GitResult, 'stdoutBuffer' | 'truncated'>): boolean {
  return !res.truncated && !!res.stdoutBuffer && !isUtf8(res.stdoutBuffer)
}

/** Parse raw diff output into one FileDiff, applying the size limits. */
export function toFileDiff(
  stdout: string,
  truncated: boolean,
  p: string,
  fallbackStatus: FileStatusCode,
  oldPath?: string,
  encodingLossy = false
): FileDiff | null {
  if (!stdout.trim() && !truncated) return null
  const tooLarge = truncated || Buffer.byteLength(stdout, 'utf8') > MAX_DIFF_BYTES || countNewlines(stdout, MAX_DIFF_LINES) > MAX_DIFF_LINES
  const files = parseUnifiedDiff(stdout, { countOnly: tooLarge })
  const picked = pickFileDiff(files, p, oldPath)
  if (!picked) {
    if (!tooLarge) return null
    const d = emptyFileDiff(p, fallbackStatus, oldPath)
    d.tooLarge = true
    return d
  }
  if (tooLarge) {
    picked.hunks = []
    picked.tooLarge = true
  }
  if (encodingLossy) picked.encodingLossy = true
  return picked
}

export function createDiffOps(ctx: GitContext): Pick<ReadOps, 'getDiff'> {
  const run = async (repo: string, args: string[], okCodes = [0]) => {
    const res = await ctx.git(repo, args, { allowFailure: true, maxBuffer: MAX_DIFF_BUFFER, env: LITERAL_PATHSPECS, binary: true })
    if (!res.truncated && !okCodes.includes(res.code)) failed(args, res)
    return res
  }

  const diffOf = async (
    repo: string,
    args: string[],
    p: string,
    fallbackStatus: FileStatusCode,
    oldPath?: string,
    okCodes?: number[]
  ): Promise<FileDiff | null> => {
    const res = await run(repo, args, okCodes)
    return toFileDiff(res.stdout, !!res.truncated, p, fallbackStatus, oldPath, isLossyOutput(res))
  }

  const pathspec = (p: string, oldPath?: string) => (oldPath && oldPath !== p ? [oldPath, p] : [p])

  return {
    async getDiff(repo, target: DiffTarget, opts: DiffOptions = {}): Promise<FileDiff> {
      await assertRepo(ctx, repo)
      if (!target || typeof target !== 'object') throw invalidArgument('Missing diff target')
      const p = validateRelPath(target.path)
      const flags = diffFlags(opts)

      switch (target.kind) {
        case 'unstaged': {
          const others = await ctx.git(repo, ['ls-files', '--others', '--exclude-standard', '-z', '--', p], {
            allowFailure: true,
            env: LITERAL_PATHSPECS
          })
          const isUntracked = others.code === 0 && others.stdout.split('\0').some((f) => f === p || f === p + '/')
          if (isUntracked) {
            let isFile = true
            try {
              const st = await fs.lstat(path.join(repo, p))
              isFile = !st.isDirectory()
            } catch {
              isFile = false
            }
            if (!isFile) return emptyFileDiff(p, 'untracked')
            const d = await diffOf(repo, ['diff', '--no-index', ...flags, '--', '/dev/null', p], p, 'untracked', undefined, [0, 1])
            const out = d ?? emptyFileDiff(p, 'untracked')
            out.status = 'untracked'
            out.path = p
            return out
          }
          // Plumbing diff-files: porcelain `git diff` refreshes and rewrites .git/index (even with
          // GIT_OPTIONAL_LOCKS=0), which the watcher reports as an index change → refresh loop.
          return (await diffOf(repo, ['diff-files', '-p', ...flags, '--', p], p, 'modified')) ?? emptyFileDiff(p, 'modified')
        }

        case 'staged': {
          const d = await diffOf(repo, ['diff', '--cached', ...flags, '--', p], p, 'modified')
          if (d && d.status === 'added') {
            // A staged rename only shows as such when both paths are in the pathspec.
            const renames = await ctx.git(repo, ['diff', '--cached', '-M', '--name-status', '-z', '--diff-filter=R'], { allowFailure: true })
            const hit = parseNameStatusZ(renames.stdout).find((e) => e.path === p && e.oldPath)
            if (hit?.oldPath) {
              const r = await diffOf(repo, ['diff', '--cached', ...flags, '--', hit.oldPath, p], p, 'renamed', hit.oldPath)
              if (r) return r
            }
          }
          return d ?? emptyFileDiff(p, 'modified')
        }

        case 'commit': {
          const sha = validateRev(target.sha, 'commit')
          const oldPath = target.oldPath ? validateRelPath(target.oldPath, 'oldPath') : undefined
          if (await gitAtLeast(ctx, 2, 31)) {
            // One process: root commits diff against the empty tree, merges against their first parent.
            const args = ['show', '--format=', '--no-show-signature', '--diff-merges=first-parent', ...flags, `${sha}^{commit}`, '--', ...pathspec(p, oldPath)]
            const res = await ctx.git(repo, args, { allowFailure: true, maxBuffer: MAX_DIFF_BUFFER, env: LITERAL_PATHSPECS, binary: true })
            if (!res.truncated && res.code !== 0) {
              if (/bad revision|unknown revision|bad object|not a valid object|ambiguous argument/i.test(res.stderr)) {
                throw notFound(`Commit ${sha} was not found in this repository`)
              }
              failed(args, res)
            }
            return toFileDiff(res.stdout, !!res.truncated, p, 'modified', oldPath, isLossyOutput(res)) ?? emptyFileDiff(p, 'modified', oldPath)
          }
          const info = await revParents(ctx, repo, `${sha}^{commit}`)
          if (!info) throw notFound(`Commit ${sha} was not found in this repository`)
          const args = info.parents.length
            ? ['diff', ...flags, info.parents[0], info.sha, '--', ...pathspec(p, oldPath)]
            : ['diff-tree', '-p', '-r', '--root', '--no-commit-id', ...flags, info.sha, '--', ...pathspec(p, oldPath)]
          return (await diffOf(repo, args, p, 'modified', oldPath)) ?? emptyFileDiff(p, 'modified', oldPath)
        }

        case 'compare': {
          const from = validateRev(target.from, 'revision')
          const to = validateRev(target.to, 'revision')
          const oldPath = target.oldPath ? validateRelPath(target.oldPath, 'oldPath') : undefined
          const args = ['diff', ...flags, from, to, '--', ...pathspec(p, oldPath)]
          return (await diffOf(repo, args, p, 'modified', oldPath)) ?? emptyFileDiff(p, 'modified', oldPath)
        }

        case 'stash': {
          const index = target.index
          if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw invalidArgument(`Invalid stash index: ${index}`)
          const info = await revParents(ctx, repo, `stash@{${index}}`)
          if (!info || !info.parents.length) throw notFound(`stash@{${index}} does not exist`)
          const tracked = await diffOf(repo, ['diff', ...flags, info.parents[0], info.sha, '--', p], p, 'modified')
          if (tracked) return tracked
          const untrackedSha = info.parents[2]
          if (untrackedSha) {
            // The third parent is a root commit holding the untracked files.
            const u = await diffOf(
              repo,
              ['diff-tree', '-p', '-r', '--root', '--no-commit-id', ...flags, untrackedSha, '--', p],
              p,
              'untracked'
            )
            if (u) {
              u.status = 'untracked'
              return u
            }
          }
          return emptyFileDiff(p, 'modified')
        }

        default:
          throw invalidArgument(`Unknown diff target: ${(target as { kind?: unknown }).kind}`)
      }
    }
  }
}
