// Working tree & index: staging, discarding, partial patches, commits, .gitignore.

import { isUtf8 } from 'node:buffer'
import { constants as fsConstants, promises as fs } from 'node:fs'
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
  O_NOFOLLOW,
  PATHSPEC_STDIN,
  pathspecInput,
  createSafeResolver,
  readWorktreeEntry,
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

/** Paths named by `--numstat -z` output: "add\tdel\tpath\0" (or "add\tdel\t\0old\0new\0" as git diff prints renames). */
export function parseApplyNumstatZ(stdout: string): string[] {
  const out: string[] = []
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const m = /^(?:-|\d+)\t(?:-|\d+)\t([\s\S]*)$/.exec(parts[i])
    if (!m) continue
    if (m[1]) out.push(m[1])
    else {
      if (parts[i + 1]) out.push(parts[i + 1])
      if (parts[i + 2]) out.push(parts[i + 2])
      i += 2
    }
  }
  return [...new Set(out)]
}

export function createWorktreeOps(ctx: GitContext): WorktreeOps {
  const addPaths = (repo: string, paths: string[]) =>
    ctx.git(repo, ['add', '-A', ...PATHSPEC_STDIN], { input: pathspecInput(paths), env: LITERAL_ENV })

  /** Blob of `rev` (e.g. "HEAD:path", ":0:path") as bytes, or null when it does not exist. */
  const blob = async (repo: string, rev: string): Promise<Buffer | null> => {
    const res = await ctx.git(repo, ['cat-file', 'blob', rev], { binary: true, allowFailure: true })
    return res.code === 0 ? (res.stdoutBuffer ?? null) : null
  }

  /**
   * Files touched by `patch` whose HEAD, index or worktree content is not valid UTF-8. A patch built
   * from such a diff decoded as UTF-8 carries U+FFFD in place of the original bytes, and applying it
   * would write EF BF BD into the index / worktree.
   */
  const nonUtf8Targets = async (repo: string, patch: string): Promise<string[]> => {
    // Forward numstat names the new path of a rename, --reverse the old one.
    const paths = new Set<string>()
    for (const dir of [[], ['--reverse']]) {
      const res = await ctx.git(repo, ['apply', '--numstat', '-z', '--recount', ...dir, '-'], { input: patch, allowFailure: true })
      if (res.code !== 0) return [] // the real apply reports what is wrong with the patch
      for (const p of parseApplyNumstatZ(res.stdout)) paths.add(p)
    }
    const resolve = createSafeResolver(repo)
    const bad: string[] = []
    for (const rel of paths) {
      let worktree: Buffer | null = null
      try {
        const entry = await readWorktreeEntry(await resolve(rel))
        if (entry.type === 'file') worktree = entry.data
      } catch {
        /* unreadable or outside the repository: git apply decides */
      }
      const sources = [worktree, await blob(repo, `:0:${rel}`), await blob(repo, `HEAD:${rel}`)]
      if (sources.some((b) => b !== null && !isUtf8(b))) bad.push(rel)
    }
    return bad
  }

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
        const conflicts = await ctx.conflictedPaths(repo)
        if (!conflicts.length) {
          await ctx.git(repo, ['add', '-A'])
          return
        }
        // `git add -A` would also stage unresolved files as they are (conflict markers included), which
        // marks them resolved and drops their ours/theirs stages. Stage every other change instead: an
        // `:(exclude)` pathspec does not work here (git add still picks up unmerged entries).
        const skip = new Set(conflicts)
        const res = await ctx.git(repo, ['ls-files', '-z', '--modified', '--deleted', '--others', '--exclude-standard', '--directory', '--no-empty-directory'])
        const changed = [...new Set(res.stdout.split('\0'))].filter((p) => p && !skip.has(p))
        if (changed.length) await addPaths(repo, changed)
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
        if (input.includes('\uFFFD')) {
          const bad = await nonUtf8Targets(repo, input)
          if (bad.length) {
            throw invalid(
              `Cannot apply part of ${bad.join(', ')}: the file is not UTF-8 text, so its other bytes would be replaced. Stage, unstage or discard the whole file instead.`
            )
          }
        }
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
        // Git never reads a .gitignore that is a symbolic link, and writing through one (a cloned repo may
        // point it at .git/config or ~/.something) would modify a file the user never meant to touch.
        const notRegular = (what: string) =>
          invalid(`.gitignore is ${what}: Git does not read it, so Adar will not write through it.`)
        const ioError = (err: unknown, what: string) => {
          // ELOOP (EMLINK on BSDs): O_NOFOLLOW met a symbolic link swapped in after the check.
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ELOOP' || code === 'EMLINK') return notRegular('a symbolic link')
          return new AdarError({ message: `Could not ${what} .gitignore: ${(err as Error).message}`, code: 'UNKNOWN' })
        }
        let entry
        try {
          entry = await readWorktreeEntry(file)
        } catch (err) {
          throw ioError(err, 'read')
        }
        if (entry.type === 'symlink') throw notRegular('a symbolic link')
        if (entry.type === 'other') throw notRegular('not a regular file')
        const existing = entry.type === 'file' ? entry.data.toString('utf8') : null
        const next = appendIgnorePattern(existing, p)
        if (next === null) return
        // Only append: the existing bytes stay untouched (even when they are not valid UTF-8).
        const suffix = Buffer.from(next.slice((existing ?? '').length), 'utf8')
        let handle
        try {
          handle = await fs.open(file, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT | O_NOFOLLOW, 0o666)
        } catch (err) {
          throw ioError(err, 'write')
        }
        try {
          await handle.writeFile(suffix)
        } finally {
          await handle.close()
        }
      })
    }
  }
}
