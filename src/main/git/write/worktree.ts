// Working tree & index: staging, discarding, partial patches, commits, .gitignore.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { appendIgnorePattern, normalizeIgnorePattern } from './gitignore'
import {
  failure,
  invalid,
  isUnborn,
  LITERAL_ENV,
  lsFiles,
  PATHSPEC_STDIN,
  pathspecInput,
  createSafeResolver,
  repoPaths,
  withCode
} from './util'

type WorktreeOps = Pick<
  WriteOps,
  | 'stageFiles'
  | 'stageAll'
  | 'unstageFiles'
  | 'unstageAll'
  | 'discardFiles'
  | 'discardAll'
  | 'applyPatch'
  | 'commit'
  | 'addToGitignore'
>

/** Normalise a git-style relative path for prefix comparisons. */
function specKey(p: string): string {
  let s = process.platform === 'win32' ? p.replace(/\\/g, '/') : p
  s = path.posix.normalize(s)
  while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
  if (s === './' || s === '') s = '.'
  return s
}

/** All parent directories of a repo-relative file path ("a/b/c" → ["a/b", "a"]). */
function parentDirs(file: string): string[] {
  const out: string[] = []
  let d = path.posix.dirname(file)
  while (d && d !== '.' && d !== '/') {
    out.push(d)
    d = path.posix.dirname(d)
  }
  return out
}

export function createWorktreeOps(ctx: GitContext): WorktreeOps {
  const addPaths = (repo: string, paths: string[]) =>
    ctx.git(repo, ['add', '-A', ...PATHSPEC_STDIN], { input: pathspecInput(paths), env: LITERAL_ENV })

  return {
    async stageFiles(repo, paths) {
      const list = repoPaths(repo, paths)
      if (!list.length) return
      await ctx.exclusive(repo, async () => {
        await addPaths(repo, list)
      })
    },

    async stageAll(repo) {
      await ctx.exclusive(repo, async () => {
        await ctx.git(repo, ['add', '-A'])
      })
    },

    async unstageFiles(repo, paths) {
      const list = repoPaths(repo, paths)
      if (!list.length) return
      await ctx.exclusive(repo, async () => {
        if (await isUnborn(ctx, repo)) {
          await ctx.git(repo, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', ...PATHSPEC_STDIN], {
            input: pathspecInput(list),
            env: LITERAL_ENV
          })
        } else {
          await ctx.git(repo, ['restore', '--staged', ...PATHSPEC_STDIN], { input: pathspecInput(list), env: LITERAL_ENV })
        }
      })
    },

    async unstageAll(repo) {
      await ctx.exclusive(repo, async () => {
        if (await isUnborn(ctx, repo)) {
          await ctx.git(repo, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', '.'], { env: LITERAL_ENV })
        } else {
          const conflicts = await ctx.conflictedPaths(repo)
          if (conflicts.length) {
            // Leave conflicted entries alone: resetting them would silently mark them resolved.
            const res = await ctx.git(repo, ['diff', '--cached', '--name-only', '--no-renames', '-z'])
            const skip = new Set(conflicts)
            const staged = [...new Set(res.stdout.split('\0').filter((p) => p && !skip.has(p)))]
            if (staged.length) {
              await ctx.git(repo, ['restore', '--staged', ...PATHSPEC_STDIN], { input: pathspecInput(staged), env: LITERAL_ENV })
            }
            return
          }
          // With a pathspec, reset keeps MERGE_HEAD / CHERRY_PICK_HEAD (a bare
          // `git reset` would silently drop the in-progress operation).
          await ctx.git(repo, ['reset', '-q', '--', '.'], { env: LITERAL_ENV })
        }
      })
    },

    async discardFiles(repo, paths) {
      const list = repoPaths(repo, paths)
      if (!list.length) return
      await ctx.exclusive(repo, async () => {
        const [untracked, tracked] = await Promise.all([
          lsFiles(ctx, repo, ['--others', '--exclude-standard'], list),
          lsFiles(ctx, repo, ['--cached'], list)
        ])

        // Pathspecs with tracked content (exact file or a directory containing tracked files).
        const trackedKeys = new Set<string>()
        for (const f of tracked) {
          trackedKeys.add(f)
          for (const d of parentDirs(f)) trackedKeys.add(d)
        }
        const trackedSpecs = list.filter((p) => {
          const k = specKey(p)
          return k === '.' ? tracked.length > 0 : trackedKeys.has(k)
        })

        // Resolve every deletion target first so nothing is touched when one escapes the repo.
        const resolve = createSafeResolver(repo)
        const deletions: Array<{ rel: string; abs: string }> = []
        for (const f of untracked) {
          if (f.endsWith('/')) continue // embedded repository: never deleted
          deletions.push({ rel: f, abs: await resolve(f) })
        }

        if (trackedSpecs.length) {
          await ctx.git(repo, ['restore', '--worktree', ...PATHSPEC_STDIN], {
            input: pathspecInput(trackedSpecs),
            env: LITERAL_ENV
          })
        }

        for (let i = 0; i < deletions.length; i += 64) {
          await Promise.all(deletions.slice(i, i + 64).map((d) => fs.rm(d.abs, { force: true })))
        }

        // Remove directories emptied by the deletion, but only inside directories the caller asked to discard.
        const specKeys = new Set(list.map(specKey))
        const wholeRepo = specKeys.has('.')
        const candidates = new Set<string>()
        for (const d of deletions) {
          const chain: string[] = []
          for (const dir of parentDirs(d.rel)) {
            chain.push(dir)
            if (wholeRepo || specKeys.has(dir)) {
              for (const c of chain) candidates.add(c)
              if (!wholeRepo) break
            }
          }
        }
        const ordered = [...candidates].sort((a, b) => b.split('/').length - a.split('/').length)
        for (const dir of ordered) {
          try {
            await fs.rmdir(await resolve(dir))
          } catch {
            /* not empty or already gone */
          }
        }
      })
    },

    async discardAll(repo) {
      await ctx.exclusive(repo, async () => {
        const args = ['restore', '--worktree', '--ignore-unmerged', '--', '.']
        const res = await ctx.git(repo, args, { allowFailure: true, env: LITERAL_ENV })
        // An empty index (fresh repo) has nothing to restore.
        if (res.code !== 0 && !/did not match any file/i.test(res.stderr)) throw failure(args, res)
        await ctx.git(repo, ['clean', '-f', '-d', '-q'])
      })
    },

    async applyPatch(repo, patch, opts = {}) {
      if (typeof patch !== 'string' || !patch.trim()) throw invalid('Empty patch')
      const input = patch.endsWith('\n') ? patch : `${patch}\n`
      const args = ['apply']
      if (opts.cached) args.push('--cached')
      if (opts.reverse) args.push('--reverse')
      args.push('--whitespace=nowarn', '--recount', '-')
      await ctx.exclusive(repo, async () => {
        await ctx.git(repo, args, { input })
      })
    },

    async commit(repo, opts) {
      const o = opts ?? { message: '' }
      const message = typeof o.message === 'string' ? o.message : ''
      if (!message.trim()) throw invalid('Commit message is required')
      return ctx.exclusive(repo, async () => {
        const args = ['commit', '-F', '-', '--cleanup=whitespace']
        if (o.amend) args.push('--amend')
        if (o.allowEmpty) args.push('--allow-empty')
        if (o.noVerify) args.push('--no-verify')
        if (o.signoff) args.push('--signoff')
        const res = await ctx.git(repo, args, { input: message, allowFailure: true })
        if (res.code !== 0) {
          const out = `${res.stdout}\n${res.stderr}`
          if (/nothing to commit|nothing added to commit|no changes added to commit/i.test(out)) {
            throw invalid('Nothing staged to commit')
          }
          if (/you have nothing to amend/i.test(out)) throw invalid('Nothing to amend: this branch has no commits yet')
          const err = failure(args, res)
          if (/unmerged files/i.test(out)) throw withCode(err, 'CONFLICT')
          throw err
        }
        const head = await ctx.git(repo, ['rev-parse', 'HEAD'])
        return head.stdout.trim()
      })
    },

    async addToGitignore(repo, pattern) {
      const p = normalizeIgnorePattern(pattern)
      if (!p) throw invalid('Invalid .gitignore pattern')
      await ctx.exclusive(repo, async () => {
        const file = path.join(repo, '.gitignore')
        let existing: string | null = null
        try {
          existing = await fs.readFile(file, 'utf8')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new AdarError({ message: `Could not read .gitignore: ${(err as Error).message}`, code: 'UNKNOWN' })
          }
        }
        const next = appendIgnorePattern(existing, p)
        if (next !== null) await fs.writeFile(file, next, 'utf8')
      })
    }
  }
}
