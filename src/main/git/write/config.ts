// Identity, submodules and the branches Clean up branches keeps (adar.keepBranch).

import { isKeepPattern } from '@shared/hosting'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { invalid, lineArg } from './util'

type ConfigOps = Pick<WriteOps, 'setIdentity' | 'keepBranch' | 'updateSubmodules'>

/** Multi-valued key of the repository's own config (the common one, so every worktree shares it). */
export const KEEP_BRANCH_KEY = 'adar.keepBranch'

/** The repository's kept branch names and patterns, in the order they were added. */
export async function keptBranches(ctx: GitContext, repo: string): Promise<string[]> {
  const res = await ctx.git(repo, ['config', '--local', '--get-all', KEEP_BRANCH_KEY], { allowFailure: true })
  if (res.code !== 0) return []
  return [...new Set(res.stdout.split('\n').map((l) => l.trim()).filter(isKeepPattern))]
}

/** A value pattern for git config that matches exactly `value`. */
const exactly = (value: string) => `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`

export function createConfigOps(ctx: GitContext): ConfigOps {
  return {
    async setIdentity(repo, name, email) {
      const n = lineArg(name, 'name')
      const e = lineArg(email, 'email')
      if (/[<>]/.test(n)) throw invalid('The name must not contain "<" or ">"')
      if (/[<>\s]/.test(e)) throw invalid('The email must not contain spaces, "<" or ">"')
      if (repo === null) {
        await ctx.gitGlobal(['config', '--global', '--', 'user.name', n])
        await ctx.gitGlobal(['config', '--global', '--', 'user.email', e])
        return
      }
      await ctx.exclusive(repo, async () => {
        await ctx.git(repo, ['config', '--local', '--', 'user.name', n])
        await ctx.git(repo, ['config', '--local', '--', 'user.email', e])
      })
    },

    async keepBranch(repo, name, keep) {
      if (!isKeepPattern(name)) throw invalid('Use a branch name, or a pattern such as env/*')
      if (typeof keep !== 'boolean') throw invalid('Invalid choice')
      await ctx.exclusive(repo, async () => {
        const kept = await keptBranches(ctx, repo)
        if (keep && !kept.includes(name)) await ctx.git(repo, ['config', '--local', '--add', '--', KEEP_BRANCH_KEY, name])
        else if (!keep && kept.includes(name)) await ctx.git(repo, ['config', '--local', '--unset-all', '--', KEEP_BRANCH_KEY, exactly(name)])
      })
    },

    async updateSubmodules(repo, opts = {}) {
      const args = ['submodule', 'update', '--progress']
      if (opts.init) args.push('--init')
      if (opts.recursive) args.push('--recursive')
      await ctx.exclusive(repo, async () => {
        await ctx.gitNetwork(repo, args)
      })
    }
  }
}
