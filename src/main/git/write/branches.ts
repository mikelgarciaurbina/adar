// Branches & HEAD: checkout, create/delete/rename, upstreams, fast-forward, reset.

import type { ResetMode } from '@shared/types'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import {
  arg,
  currentBranch,
  invalid,
  listRemotes,
  mapInvalid,
  nameArg,
  notFound,
  optionalArg,
  reclassifyDirty,
  refExists,
  resolveCommit,
  splitRemoteRef
} from './util'

type BranchOps = Pick<
  WriteOps,
  'checkout' | 'createBranch' | 'deleteBranch' | 'renameBranch' | 'setUpstream' | 'fastForwardBranch' | 'reset'
>

const RESET_MODES: readonly ResetMode[] = ['soft', 'mixed', 'hard']

export function createBranchOps(ctx: GitContext): BranchOps {
  /** Run a command that changes the worktree, surfacing local-change refusals as DIRTY_WORKTREE. */
  const worktreeCmd = async (repo: string, args: string[]) => {
    try {
      await ctx.git(repo, args)
    } catch (err) {
      throw reclassifyDirty(err)
    }
  }

  /** "origin/HEAD" → "origin/main" (symbolic remote HEAD). */
  const derefRemoteHead = async (repo: string, ref: string): Promise<string> => {
    const res = await ctx.git(repo, ['symbolic-ref', '--quiet', `refs/remotes/${ref}`], { allowFailure: true })
    const target = res.stdout.trim()
    return res.code === 0 && target.startsWith('refs/remotes/') ? target.slice('refs/remotes/'.length) : ref
  }

  return {
    async checkout(repo, ref, opts = {}) {
      const raw = arg(ref, 'ref')
      const force = opts.force ? ['--force'] : []
      await ctx.exclusive(repo, async () => {
        const localName = raw.startsWith('refs/heads/') ? raw.slice('refs/heads/'.length) : raw
        if (await refExists(ctx, repo, `refs/heads/${localName}`)) {
          await worktreeCmd(repo, ['checkout', ...force, localName, '--'])
          return
        }
        let target = raw.startsWith('refs/remotes/') ? raw.slice('refs/remotes/'.length) : raw
        if (await refExists(ctx, repo, `refs/remotes/${target}`)) {
          const remotes = await listRemotes(ctx, repo)
          let split = splitRemoteRef(target, remotes)
          if (split?.branch === 'HEAD') {
            target = await derefRemoteHead(repo, target)
            split = splitRemoteRef(target, remotes)
          }
          // Remote-tracking ref of a remote that is no longer configured: use the first path segment.
          const local = split?.branch ?? target.slice(target.indexOf('/') + 1)
          if (local && local !== 'HEAD') {
            if (await refExists(ctx, repo, `refs/heads/${local}`)) {
              await worktreeCmd(repo, ['checkout', ...force, local, '--'])
            } else {
              await worktreeCmd(repo, ['checkout', ...force, '-b', local, '--track', target, '--'])
            }
            return
          }
        }
        await resolveCommit(ctx, repo, raw)
        await worktreeCmd(repo, ['checkout', ...force, '--detach', raw, '--'])
      })
    },

    async createBranch(repo, name, startPoint, opts = {}) {
      const branch = nameArg(name, 'branch name')
      const start = optionalArg(startPoint, 'start point')
      await ctx.exclusive(repo, async () => {
        const args = opts.checkout ? ['checkout', '-b', branch] : ['branch', branch]
        if (start) args.push(start)
        try {
          await ctx.git(repo, args)
        } catch (err) {
          throw mapInvalid(reclassifyDirty(err), /already exists|not a valid branch name|not a valid object name/i)
        }
      })
    },

    async deleteBranch(repo, name, opts = {}) {
      const branch = nameArg(name, 'branch name')
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, ['branch', opts.force ? '-D' : '-d', branch])
        } catch (err) {
          throw mapInvalid(err, /cannot delete branch .* (checked out|used by worktree)/i)
        }
      })
    },

    async renameBranch(repo, oldName, newName) {
      const from = nameArg(oldName, 'branch name')
      const to = nameArg(newName, 'new branch name')
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, ['branch', '-m', from, to])
        } catch (err) {
          throw mapInvalid(err, /already exists|not a valid branch name/i)
        }
      })
    },

    async setUpstream(repo, branch, upstream) {
      const b = nameArg(branch, 'branch name')
      await ctx.exclusive(repo, async () => {
        if (upstream === null || upstream === undefined || upstream === '') {
          const res = await ctx.git(repo, ['branch', '--unset-upstream', b], { allowFailure: true })
          if (res.code !== 0 && !/has no upstream information/i.test(res.stderr)) {
            await ctx.git(repo, ['branch', '--unset-upstream', b]) // rethrow with the standard error
          }
          return
        }
        const up = arg(upstream, 'upstream')
        const res = await ctx.git(repo, ['branch', `--set-upstream-to=${up}`, b], { allowFailure: true })
        if (res.code === 0) return
        // The remote branch may not exist yet (never pushed): write the config directly.
        if (/does not exist|not a valid|no such branch/i.test(res.stderr)) {
          if (!(await refExists(ctx, repo, `refs/heads/${b}`))) throw notFound(`Branch ${b} does not exist`)
          const split = splitRemoteRef(up, await listRemotes(ctx, repo))
          if (split) {
            await ctx.git(repo, ['config', `branch.${b}.remote`, split.remote])
            await ctx.git(repo, ['config', `branch.${b}.merge`, `refs/heads/${split.branch}`])
            return
          }
        }
        await ctx.git(repo, ['branch', `--set-upstream-to=${up}`, b])
      })
    },

    async fastForwardBranch(repo, branch, to) {
      const b = nameArg(branch, 'branch name')
      const target = arg(to, 'target')
      await ctx.exclusive(repo, async () => {
        if (!(await refExists(ctx, repo, `refs/heads/${b}`))) throw notFound(`Branch ${b} does not exist`)
        if ((await currentBranch(ctx, repo)) === b) {
          await worktreeCmd(repo, ['merge', '--ff-only', target])
          return
        }
        // Refuse to move a branch checked out in another worktree.
        const wt = await ctx.git(repo, ['worktree', 'list', '--porcelain'], { allowFailure: true })
        if (wt.code === 0 && wt.stdout.split('\n').some((l) => l.trim() === `branch refs/heads/${b}`)) {
          throw invalid(`${b} is checked out in another worktree`)
        }
        const toSha = await resolveCommit(ctx, repo, target)
        const oldSha = await resolveCommit(ctx, repo, `refs/heads/${b}`)
        if (oldSha === toSha) return
        const anc = await ctx.git(repo, ['merge-base', '--is-ancestor', oldSha, toSha], { okCodes: [0, 1] })
        if (anc.code !== 0) throw invalid(`Cannot fast-forward ${b} to ${target}: not a fast-forward`)
        await ctx.git(repo, ['update-ref', '-m', `adar: fast-forward ${b} to ${target}`, `refs/heads/${b}`, toSha, oldSha])
      })
    },

    async reset(repo, target, mode) {
      const t = arg(target, 'target')
      if (!RESET_MODES.includes(mode)) throw invalid(`Invalid reset mode: ${String(mode)}`)
      await ctx.exclusive(repo, async () => {
        await resolveCommit(ctx, repo, t)
        await worktreeCmd(repo, ['reset', '-q', `--${mode}`, t, '--'])
      })
    }
  }
}
