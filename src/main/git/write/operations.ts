// Merge, rebase, cherry-pick, revert and the continue / abort / skip controls
// of in-progress operations.

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { OperationResult, RepoOperationState } from '@shared/types'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import type { GitResult } from '../runner'
import { cleanupRebaseFiles } from './interactive'
import {
  arg,
  combinedOutput,
  describeCommit,
  failure,
  FAMILY,
  familyOf,
  finishOperation,
  hasStagedChanges,
  invalid,
  runOperation
} from './util'

type OperationOps = Pick<
  WriteOps,
  'merge' | 'rebase' | 'cherryPick' | 'revert' | 'continueOperation' | 'abortOperation' | 'skipOperation'
>

const EMPTY_PICK_RE = /previous cherry-pick is now empty/i
const NOTHING_TO_COMMIT_RE = /nothing to commit|no changes - did you forget|nothing added to commit|is now empty/i

const LABEL: Record<RepoOperationState, string> = {
  none: 'operation',
  merge: 'merge',
  rebase: 'rebase',
  'rebase-interactive': 'rebase',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
  bisect: 'bisect',
  am: 'patch application'
}

/** Add a hint to results that stopped because the current commit has nothing left to commit. */
function suggestSkip(result: OperationResult, output: string): OperationResult {
  if (result.ok || result.conflicts.length || !NOTHING_TO_COMMIT_RE.test(output)) return result
  return {
    ...result,
    message: `Nothing left to commit for the current commit: its changes are already present. Use Skip to drop it.\n${result.message}`
  }
}

export function createOperationOps(ctx: GitContext): OperationOps {
  /**
   * Full shas of `revs`, oldest first whatever order the selection came in.
   * Date order (`--no-walk=sorted`) is ambiguous for commits made in the same
   * second, so the topological order of the history between the commits and
   * their common ancestor is used when it is available.
   */
  const oldestFirst = async (repo: string, revs: string[]): Promise<string[]> => {
    const sorted = await ctx.git(repo, ['rev-list', '--no-walk=sorted', '--reverse', ...revs, '--'])
    const byDate = [...new Set(sorted.stdout.split('\n').map((l) => l.trim()).filter(Boolean))]
    if (byDate.length < 2) return byDate
    const mb = await ctx.git(repo, ['merge-base', '--octopus', ...byDate], { allowFailure: true })
    const bases = mb.code === 0 ? mb.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : []
    if (!bases.length) return byDate
    const walk = await ctx.git(repo, ['rev-list', '--topo-order', '--reverse', ...byDate, ...bases.map((b) => `^${b}`), '--'], {
      allowFailure: true
    })
    if (walk.code !== 0) return byDate
    const wanted = new Set(byDate)
    // A selected commit that is the common ancestor of the others is excluded by ^base: it goes first.
    const topo = [...bases.filter((b) => wanted.has(b)), ...walk.stdout.split('\n').filter((s) => wanted.has(s.trim()))]
    const unique = [...new Set(topo.map((s) => s.trim()))]
    return unique.length === byDate.length ? unique : byDate
  }

  /** Commit the resolved state of a cherry-pick / revert with a custom message (authorship comes from CHERRY_PICK_HEAD). */
  const commitWithMessage = async (repo: string, message: string): Promise<GitResult> =>
    ctx.git(repo, ['commit', '-F', '-', '--cleanup=whitespace'], { input: message, allowFailure: true })

  const continueRebase = async (repo: string, message: string | undefined): Promise<OperationResult> => {
    const gitDir = await ctx.gitDir(repo)
    const mergeDir = path.join(gitDir, 'rebase-merge')
    const pre: string[] = []
    if (message) {
      if (existsSync(mergeDir)) {
        if (existsSync(path.join(mergeDir, 'amend'))) {
          // Stopped at an `edit`: amend HEAD with the staged changes and the new message.
          const args = ['commit', '--amend', '-F', '-', '--cleanup=whitespace', '--allow-empty']
          const res = await ctx.git(repo, args, { input: message, allowFailure: true })
          if (res.code !== 0) return finishOperation(ctx, repo, args, res, FAMILY.rebase)
        } else {
          // Stopped on conflicts: git commits the resolution with rebase-merge/message and the
          // original author when continuing. Scissors cleanup keeps lines starting with '#'
          // while dropping the template git appends below the scissors line.
          await fs.writeFile(path.join(mergeDir, 'message'), message.endsWith('\n') ? message : `${message}\n`, 'utf8')
          pre.push('-c', 'commit.cleanup=scissors')
        }
      } else if (await hasStagedChanges(ctx, repo)) {
        const args = ['commit', '-F', '-', '--cleanup=whitespace']
        const res = await ctx.git(repo, args, { input: message, allowFailure: true })
        if (res.code !== 0) return finishOperation(ctx, repo, args, res, FAMILY.rebase)
      }
    }
    const args = [...pre, 'rebase', '--continue']
    const res = await ctx.git(repo, args, { allowFailure: true })
    return suggestSkip(await finishOperation(ctx, repo, args, res, FAMILY.rebase), combinedOutput(res))
  }

  const continueSequencer = async (
    repo: string,
    cmd: 'cherry-pick' | 'revert',
    message: string | undefined
  ): Promise<OperationResult> => {
    const family = cmd === 'cherry-pick' ? FAMILY.cherryPick : FAMILY.revert
    if (message) {
      const res = await commitWithMessage(repo, message)
      if (res.code !== 0) {
        return suggestSkip(await finishOperation(ctx, repo, ['commit', '-F', '-'], res, family), combinedOutput(res))
      }
      // A single pick is complete once committed; a sequence continues with the next commit.
      if (!family.includes(await ctx.operationState(repo))) {
        return { ok: true, conflicts: [], message: combinedOutput(res), state: await ctx.operationState(repo) }
      }
    }
    const args = [cmd, '--continue']
    const res = await ctx.git(repo, args, { allowFailure: true })
    return suggestSkip(await finishOperation(ctx, repo, args, res, family), combinedOutput(res))
  }

  return {
    async merge(repo, ref, opts = {}) {
      const r = arg(ref, 'ref')
      const modes = [opts.noFf, opts.ffOnly, opts.squash].filter(Boolean).length
      if (modes > 1) throw invalid('Choose only one of no-ff, ff-only and squash')
      const args = ['merge', '--no-edit']
      if (opts.noFf) args.push('--no-ff')
      if (opts.ffOnly) args.push('--ff-only')
      if (opts.squash) args.push('--squash')
      if (!opts.squash && typeof opts.message === 'string' && opts.message.trim()) args.push('-m', opts.message)
      args.push(r)
      return ctx.exclusive(repo, () => runOperation(ctx, repo, args, FAMILY.merge))
    },

    async rebase(repo, onto) {
      const o = arg(onto, 'branch')
      return ctx.exclusive(repo, () => runOperation(ctx, repo, ['rebase', '--autostash', o], FAMILY.rebase))
    },

    async cherryPick(repo, shas, opts = {}) {
      if (!Array.isArray(shas) || shas.length === 0) throw invalid('No commits to cherry-pick')
      const list = shas.map((s) => arg(s, 'commit'))
      return ctx.exclusive(repo, async () => {
        const ordered = await oldestFirst(repo, list)
        if (!ordered.length) throw invalid('No commits to cherry-pick')
        const parents = await ctx.git(repo, ['rev-list', '--no-walk', '--parents', ...ordered, '--'])
        const hasMerge = parents.stdout.split('\n').some((l) => l.trim().split(' ').length > 2)

        const args = ['cherry-pick']
        if (opts.noCommit) args.push('--no-commit')
        if (hasMerge) args.push('-m', '1')
        args.push(...ordered)
        let res = await ctx.git(repo, args, { allowFailure: true })

        // Commits whose changes are already present: skip them instead of stopping.
        const skipped: string[] = []
        for (let i = 0; i < ordered.length && res.code !== 0 && EMPTY_PICK_RE.test(combinedOutput(res)); i++) {
          if ((await ctx.conflictedPaths(repo)).length) break
          skipped.push((await describeCommit(ctx, repo, 'CHERRY_PICK_HEAD')) ?? 'a commit')
          res = await ctx.git(repo, ['cherry-pick', '--skip'], { allowFailure: true })
        }
        const extra = skipped.length
          ? `Skipped ${skipped.length} commit${skipped.length === 1 ? '' : 's'} whose changes are already present: ${skipped.join('; ')}`
          : undefined
        return finishOperation(ctx, repo, args, res, FAMILY.cherryPick, extra)
      })
    },

    async revert(repo, sha, opts = {}) {
      const s = arg(sha, 'commit')
      if (opts.mainline !== undefined && opts.mainline !== null && (!Number.isInteger(opts.mainline) || opts.mainline < 1)) {
        throw invalid('Invalid mainline parent number')
      }
      const args = ['revert', '--no-edit']
      if (opts.noCommit) args.push('--no-commit')
      if (opts.mainline) args.push('-m', String(opts.mainline))
      args.push(s)
      return ctx.exclusive(repo, () => runOperation(ctx, repo, args, FAMILY.revert))
    },

    async continueOperation(repo, opts = {}) {
      const message = typeof opts.message === 'string' && opts.message.trim() ? opts.message : undefined
      return ctx.exclusive(repo, async () => {
        const state = await ctx.operationState(repo)
        if (state === 'none') throw invalid('There is no operation in progress')
        if (state === 'bisect') throw invalid('A bisect has no continue step')
        const conflicts = await ctx.conflictedPaths(repo)
        if (conflicts.length) {
          return {
            ok: false,
            conflicts,
            message: `Resolve ${conflicts.length} conflicted file${conflicts.length === 1 ? '' : 's'} before continuing the ${LABEL[state]}.`,
            state
          }
        }
        let result: OperationResult
        switch (state) {
          case 'merge': {
            const args = message
              ? ['commit', '-F', '-', '--cleanup=whitespace']
              : // MERGE_MSG lists the conflicted files as '#' comments: strip them.
                ['commit', '--no-edit', '--cleanup=strip']
            const res = await ctx.git(repo, args, { input: message, allowFailure: true })
            result = await finishOperation(ctx, repo, args, res, FAMILY.merge)
            break
          }
          case 'rebase':
          case 'rebase-interactive':
            result = await continueRebase(repo, message)
            break
          case 'cherry-pick':
          case 'revert':
            result = await continueSequencer(repo, state, message)
            break
          case 'am':
            result = await runOperation(ctx, repo, ['am', '--continue'], FAMILY.am)
            break
        }
        await cleanupRebaseFiles(ctx, repo)
        return result
      })
    },

    async abortOperation(repo) {
      await ctx.exclusive(repo, async () => {
        const state = await ctx.operationState(repo)
        const args: Record<RepoOperationState, string[] | null> = {
          none: null,
          merge: ['merge', '--abort'],
          rebase: ['rebase', '--abort'],
          'rebase-interactive': ['rebase', '--abort'],
          'cherry-pick': ['cherry-pick', '--abort'],
          revert: ['revert', '--abort'],
          am: ['am', '--abort'],
          bisect: ['bisect', 'reset']
        }
        const cmd = args[state]
        if (!cmd) throw invalid('There is no operation in progress')
        const res = await ctx.git(repo, cmd, { allowFailure: true })
        await cleanupRebaseFiles(ctx, repo)
        if (res.code !== 0) throw failure(cmd, res)
      })
    },

    async skipOperation(repo) {
      return ctx.exclusive(repo, async () => {
        const state = await ctx.operationState(repo)
        let args: string[]
        switch (state) {
          case 'rebase':
          case 'rebase-interactive':
            args = ['rebase', '--skip']
            break
          case 'cherry-pick':
            args = ['cherry-pick', '--skip']
            break
          case 'revert':
            args = ['revert', '--skip']
            break
          case 'am':
            args = ['am', '--skip']
            break
          case 'none':
            throw invalid('There is no operation in progress')
          default:
            throw invalid(`A ${LABEL[state]} cannot skip commits`)
        }
        const result = await runOperation(ctx, repo, args, familyOf(state))
        await cleanupRebaseFiles(ctx, repo)
        return result
      })
    }
  }
}
