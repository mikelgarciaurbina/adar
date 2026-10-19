// Stash: save, apply / pop, drop.

import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import {
  combinedOutput,
  failure,
  FAMILY,
  finishOperation,
  invalid,
  notFound,
  PATHSPEC_STDIN,
  pathspecInput,
  repoPaths
} from './util'

type StashOps = Pick<WriteOps, 'stashSave' | 'stashApply' | 'stashDrop'>

function stashRef(index: unknown): string {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw invalid(`Invalid stash index: ${String(index)}`)
  return `stash@{${index}}`
}

export function createStashOps(ctx: GitContext): StashOps {
  const assertExists = async (repo: string, ref: string) => {
    const res = await ctx.git(repo, ['rev-parse', '--verify', '--quiet', ref], { allowFailure: true })
    if (res.code !== 0) throw notFound(`${ref} does not exist`)
  }

  return {
    async stashSave(repo, opts = {}) {
      const paths = Array.isArray(opts.paths) && opts.paths.length ? repoPaths(repo, opts.paths) : []
      const message = typeof opts.message === 'string' ? opts.message.trim() : ''
      await ctx.exclusive(repo, async () => {
        const args = ['stash', 'push']
        if (opts.includeUntracked) args.push('--include-untracked')
        if (opts.keepIndex) args.push('--keep-index')
        if (message) args.push(`--message=${message}`)
        if (paths.length) args.push(...PATHSPEC_STDIN)
        // `git stash` uses magic pathspecs internally (":/"), which GIT_LITERAL_PATHSPECS breaks:
        // mark each user path literal with the :(literal) magic instead.
        const res = await ctx.git(repo, args, {
          allowFailure: true,
          input: paths.length ? pathspecInput(paths.map((p) => `:(literal)${p}`)) : undefined
        })
        const out = combinedOutput(res)
        if (/no local changes to save/i.test(out)) throw invalid('No local changes to stash')
        if (/do not have the initial commit/i.test(out)) throw invalid('Cannot stash before the first commit')
        if (res.code !== 0) throw failure(args, res)
      })
    },

    async stashApply(repo, index, opts = {}) {
      const ref = stashRef(index)
      return ctx.exclusive(repo, async () => {
        await assertExists(repo, ref)
        const verb = opts.pop ? 'pop' : 'apply'
        let args = ['stash', verb, ...(opts.restoreIndex ? ['--index'] : []), ref]
        let res = await ctx.git(repo, args, { allowFailure: true })
        // The staged part could not be restored separately: apply everything as unstaged changes.
        if (
          res.code !== 0 &&
          opts.restoreIndex &&
          /conflicts in index|try without --index/i.test(combinedOutput(res)) &&
          (await ctx.conflictedPaths(repo)).length === 0
        ) {
          args = ['stash', verb, ref]
          res = await ctx.git(repo, args, { allowFailure: true })
        }
        return finishOperation(ctx, repo, args, res, FAMILY.stash)
      })
    },

    async stashDrop(repo, index) {
      const ref = stashRef(index)
      await ctx.exclusive(repo, async () => {
        await assertExists(repo, ref)
        await ctx.git(repo, ['stash', 'drop', '-q', ref])
      })
    }
  }
}
