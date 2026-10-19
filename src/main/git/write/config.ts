// Identity and submodules.

import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { invalid, lineArg } from './util'

type ConfigOps = Pick<WriteOps, 'setIdentity' | 'updateSubmodules'>

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
