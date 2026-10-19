// History reads: log (graph), commit details, comparisons, file history, blame, stashes.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Commit, CommitDetails, CommitPage, FileChange, LogOptions } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import { parseBlamePorcelain } from '../parsers/blame'
import { parseNumstatZ, parseRawNumstatZ, totals } from '../parsers/files'
import { LOG_FORMAT, RECORD_SEPARATOR, parseLog } from '../parsers/log'
import { gitAtLeast } from '../write/util'
import { trimTrailingNewlines } from '../parsers/util'
import {
  LITERAL_PATHSPECS,
  assertRepo,
  clampInt,
  failed,
  invalidArgument,
  isUnborn,
  notFound,
  validateRelPath,
  validateRev
} from './common'

/** Default revisions for the graph: every ref except stash/notes/prefetch (HEAD is part of --all). */
export const DEFAULT_LOG_REVISIONS = ['--exclude=refs/stash', '--exclude=refs/notes/*', '--exclude=refs/prefetch/*', '--all']

const MAX_PAGE = 1_000_000

type HistoryOps = Pick<
  ReadOps,
  'getLog' | 'getCommitDetails' | 'getCompareFiles' | 'getFileHistory' | 'getBlame' | 'getHeadMessage' | 'getMergeMessage' | 'getStashDetails'
>

/** Build `git log` arguments for getLog (exported for tests). */
export function buildLogArgs(
  opts: LogOptions,
  extra: { follow: boolean; maxCount: number; skip: number }
): { args: string[]; literal: boolean } {
  const args = ['log', '--date-order', '--no-show-signature', '--no-color', `--format=${LOG_FORMAT}`]
  // --follow mis-handles --skip (it skips before tracking renames), so paginate locally.
  if (extra.follow) {
    args.push('--follow', `--max-count=${extra.skip + extra.maxCount + 1}`)
  } else {
    args.push(`--max-count=${extra.maxCount + 1}`)
    if (extra.skip > 0) args.push(`--skip=${extra.skip}`)
  }
  const pathspecs: string[] = []
  let literal = false
  if (opts.path) {
    pathspecs.push(validateRelPath(opts.path))
    literal = true
  }
  const search = opts.search
  const text = search?.text?.trim()
  if (search && text) {
    switch (search.mode) {
      case 'message':
        args.push(`--grep=${text}`, '-i', '-F')
        break
      case 'author':
        args.push(`--author=${text}`, '-i', '-F')
        break
      case 'content':
        args.push(`-G${text}`)
        break
      case 'path':
        pathspecs.push(text)
        literal = false // allow globs when searching by path
        break
      default:
        break
    }
  }
  if (opts.revisions && opts.revisions.length) {
    for (const r of opts.revisions) args.push(validateRev(r))
  } else {
    args.push(...DEFAULT_LOG_REVISIONS)
  }
  args.push('--')
  args.push(...pathspecs)
  return { args, literal }
}

/** Changed files with counts from one `git diff|diff-tree --raw --numstat -z ...` run. */
async function listFiles(ctx: GitContext, repo: string, base: string[]): Promise<FileChange[]> {
  const res = await ctx.git(repo, [...base.slice(0, 1), '--raw', '--numstat', ...base.slice(1)])
  return parseRawNumstatZ(res.stdout)
}

/** Files changed by a commit (vs first parent; root commits vs the empty tree). */
export async function commitFiles(ctx: GitContext, repo: string, commit: Commit): Promise<FileChange[]> {
  if (commit.parents.length <= 1) {
    return listFiles(ctx, repo, ['diff-tree', '-r', '-M', '--root', '--no-commit-id', '-z', commit.sha, '--'])
  }
  return listFiles(ctx, repo, ['diff', '--no-ext-diff', '--no-textconv', '-M', '-z', commit.parents[0], commit.sha, '--'])
}

async function showCommit(ctx: GitContext, repo: string, rev: string): Promise<Commit | null> {
  const res = await ctx.git(repo, ['show', '-s', '--no-show-signature', '--no-color', `--format=${LOG_FORMAT}`, `${rev}^{commit}`, '--'], {
    allowFailure: true
  })
  if (res.code !== 0) return null
  return parseLog(res.stdout)[0] ?? null
}

export function createHistoryOps(ctx: GitContext): HistoryOps {
  return {
    async getLog(repo, opts = {}): Promise<CommitPage> {
      await assertRepo(ctx, repo)
      const maxCount = clampInt(opts.maxCount, 2000, 1, MAX_PAGE)
      const skip = clampInt(opts.skip, 0, 0, Number.MAX_SAFE_INTEGER)
      const search = opts.search
      const text = search?.text?.trim()

      if (search && text && search.mode === 'sha') {
        if (skip > 0 || text.startsWith('-') || /\s/.test(text)) return { commits: [], hasMore: false }
        const r = await ctx.git(repo, ['rev-parse', '--verify', '--quiet', `${text}^{commit}`], { allowFailure: true })
        if (r.code !== 0) return { commits: [], hasMore: false }
        const commit = await showCommit(ctx, repo, r.stdout.trim())
        return { commits: commit ? [commit] : [], hasMore: false }
      }

      let follow = false
      if (opts.path && !(search && text && search.mode === 'path')) {
        try {
          const rel = validateRelPath(opts.path)
          follow = (await fs.stat(path.join(repo, rel))).isFile()
        } catch {
          follow = false
        }
      }
      const { args, literal } = buildLogArgs(opts, { follow, maxCount, skip })
      const res = await ctx.git(repo, args, { allowFailure: true, env: literal ? LITERAL_PATHSPECS : undefined })
      if (res.code !== 0) {
        if (await isUnborn(ctx, repo)) return { commits: [], hasMore: false }
        failed(args, res)
      }
      let commits = parseLog(res.stdout)
      if (follow && skip > 0) commits = commits.slice(skip)
      return { commits: commits.slice(0, maxCount), hasMore: commits.length > maxCount }
    },

    async getCommitDetails(repo, sha): Promise<CommitDetails> {
      await assertRepo(ctx, repo)
      const rev = validateRev(sha, 'commit')
      if (await gitAtLeast(ctx, 2, 31)) {
        // Header and changed files (merges: vs the first parent) from a single process.
        const res = await ctx.git(
          repo,
          [
            'show',
            '--no-show-signature',
            '--no-color',
            '--no-ext-diff',
            '--no-textconv',
            `--format=${LOG_FORMAT}`,
            '-M',
            '--raw',
            '--numstat',
            '-z',
            '--diff-merges=first-parent',
            `${rev}^{commit}`,
            '--'
          ],
          { allowFailure: true }
        )
        const sep = res.stdout.indexOf(RECORD_SEPARATOR)
        const commit = res.code === 0 && sep >= 0 ? parseLog(res.stdout.slice(0, sep + 1))[0] : undefined
        if (!commit) throw notFound(`Commit ${rev} was not found in this repository`)
        const files = parseRawNumstatZ(res.stdout.slice(sep + 1))
        return { commit, files, ...totals(files) }
      }
      const commit = await showCommit(ctx, repo, rev)
      if (!commit) throw notFound(`Commit ${rev} was not found in this repository`)
      const files = await commitFiles(ctx, repo, commit)
      return { commit, files, ...totals(files) }
    },

    async getCompareFiles(repo, from, to) {
      await assertRepo(ctx, repo)
      const a = validateRev(from, 'revision')
      const b = validateRev(to, 'revision')
      return listFiles(ctx, repo, ['diff', '--no-ext-diff', '--no-textconv', '-M', '-z', a, b, '--'])
    },

    async getFileHistory(repo, p, opts = {}) {
      await assertRepo(ctx, repo)
      const rel = validateRelPath(p)
      const maxCount = clampInt(opts.maxCount, 500, 1, MAX_PAGE)
      const args = ['log', '--follow', '-M', '--no-show-signature', '--no-color', `--format=${LOG_FORMAT}`, '-n', String(maxCount), '--', rel]
      const res = await ctx.git(repo, args, { allowFailure: true, env: LITERAL_PATHSPECS })
      if (res.code !== 0) {
        if (await isUnborn(ctx, repo)) return []
        failed(args, res)
      }
      return parseLog(res.stdout)
    },

    async getBlame(repo, p, rev) {
      await assertRepo(ctx, repo)
      const rel = validateRelPath(p)
      const args = ['blame', '--porcelain']
      if (rev !== undefined && rev !== null && rev !== '') args.push(validateRev(rev))
      args.push('--', rel)
      const res = await ctx.git(repo, args, { allowFailure: true, env: LITERAL_PATHSPECS })
      if (res.code !== 0) {
        if (/no such path|no such ref|bad revision|unknown revision|does not have any commits/i.test(res.stderr)) {
          throw notFound(`Cannot blame "${rel}"${rev ? ` at ${rev}` : ''}: the file is not in the repository history`, res.stderr)
        }
        failed(args, res)
      }
      return parseBlamePorcelain(res.stdout)
    },

    async getHeadMessage(repo) {
      await assertRepo(ctx, repo)
      const res = await ctx.git(repo, ['log', '-1', '--no-show-signature', '--no-color', '--format=%B', 'HEAD', '--'], { allowFailure: true })
      if (res.code !== 0) return ''
      return trimTrailingNewlines(res.stdout)
    },

    async getMergeMessage(repo) {
      await assertRepo(ctx, repo)
      try {
        const dir = await ctx.gitDir(repo)
        const raw = await fs.readFile(path.join(dir, 'MERGE_MSG'), 'utf8')
        const lines = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#'))
        return trimTrailingNewlines(lines.join('\n')).trim()
      } catch {
        return ''
      }
    },

    async getStashDetails(repo, index): Promise<CommitDetails> {
      await assertRepo(ctx, repo)
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw invalidArgument(`Invalid stash index: ${index}`)
      const commit = await showCommit(ctx, repo, `stash@{${index}}`)
      if (!commit) throw notFound(`stash@{${index}} does not exist`)
      const base = commit.parents[0]
      const tracked = base
        ? await listFiles(ctx, repo, ['diff', '--no-ext-diff', '--no-textconv', '-M', '-z', base, commit.sha, '--'])
        : []
      let untracked: FileChange[] = []
      const untrackedSha = commit.parents[2]
      if (untrackedSha) {
        const res = await ctx.git(repo, ['diff-tree', '-r', '--root', '--no-commit-id', '-z', '--numstat', untrackedSha, '--'])
        untracked = parseNumstatZ(res.stdout).map((n) => {
          const fc: FileChange = { path: n.path, status: 'untracked', additions: n.additions, deletions: n.deletions }
          if (n.binary) fc.binary = true
          return fc
        })
      }
      const trackedPaths = new Set(tracked.map((f) => f.path))
      const files = [...tracked, ...untracked.filter((f) => !trackedPaths.has(f.path))]
      return { commit, files, ...totals(files) }
    }
  }
}
