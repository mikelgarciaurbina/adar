// Stash: save, apply / pop, drop.

import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import {
  combinedOutput,
  failure,
  FAMILY,
  finishOperation,
  hasStagedChanges,
  invalid,
  notFound,
  PATHSPEC_STDIN,
  pathspecInput,
  repoPaths
} from './util'

type StashOps = Pick<WriteOps, 'stashSave' | 'stashApply' | 'stashDrop'>

/** `git stash apply --index` failures after which the stash is applied without restoring its index. */
export const INDEX_FALLBACK_RE = /Index was not unstashed|would be overwritten by merge|conflicts in index|try without --index/i

const KEPT_STAGING_NOTE = 'You have staged changes, so the stash was applied as unstaged changes and your staging was kept.'
const NO_INDEX_NOTE = 'The staged part of the stash could not be restored separately, so it was applied as unstaged changes.'

/** Tree object of the current index, or null when it cannot be written (unmerged entries). */
async function writeTree(ctx: GitContext, repo: string): Promise<string | null> {
  const res = await ctx.git(repo, ['write-tree'], { allowFailure: true })
  const tree = res.stdout.trim()
  return res.code === 0 && /^[0-9a-f]{40,64}$/.test(tree) ? tree : null
}

/** Put the index back to `tree` when a failed command changed it (the working tree is not touched). */
async function restoreIndex(ctx: GitContext, repo: string, tree: string): Promise<void> {
  if ((await writeTree(ctx, repo)) === tree) return
  await ctx.git(repo, ['read-tree', tree])
  // read-tree drops the cached stat data: refresh it so unchanged files do not look modified.
  await ctx.git(repo, ['update-index', '-q', '--refresh'], { allowFailure: true })
}

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
        const plain = ['stash', verb, ref]
        const applyPlain = async (note?: string) =>
          finishOperation(ctx, repo, plain, await ctx.git(repo, plain, { allowFailure: true }), FAMILY.stash, note)

        if (!opts.restoreIndex) return applyPlain()
        // `git stash apply --index` resets the index to HEAD before merging the stash and does not
        // put it back when that merge fails ("Index was not unstashed"): with staged changes in the
        // index the user's staging would be lost and the stash not applied. Keep the staging and
        // apply the stash as unstaged changes instead.
        if (await hasStagedChanges(ctx, repo)) return applyPlain(KEPT_STAGING_NOTE)

        // Safety net for the remaining --index failures: snapshot the index and restore it before
        // retrying without --index.
        const saved = await writeTree(ctx, repo)
        const args = ['stash', verb, '--index', ref]
        const res = await ctx.git(repo, args, { allowFailure: true })
        if (res.code !== 0 && INDEX_FALLBACK_RE.test(combinedOutput(res)) && (await ctx.conflictedPaths(repo)).length === 0) {
          if (saved) await restoreIndex(ctx, repo, saved)
          return applyPlain(NO_INDEX_NOTE)
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
