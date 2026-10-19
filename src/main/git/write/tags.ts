// Tags: create / delete locally, push / delete on a remote.

import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { arg, mapInvalid, nameArg } from './util'

type TagOps = Pick<WriteOps, 'createTag' | 'deleteTag' | 'pushTag' | 'deleteRemoteTag'>

export function createTagOps(ctx: GitContext): TagOps {
  return {
    async createTag(repo, name, sha, opts = {}) {
      const tag = nameArg(name, 'tag name')
      const target = arg(sha, 'commit')
      const message = typeof opts.message === 'string' && opts.message.trim() ? opts.message : undefined
      await ctx.exclusive(repo, async () => {
        try {
          if (message) await ctx.git(repo, ['tag', '-a', '-F', '-', '--cleanup=whitespace', tag, target], { input: message })
          else await ctx.git(repo, ['tag', tag, target])
        } catch (err) {
          throw mapInvalid(err, /already exists|not a valid tag name|failed to resolve/i)
        }
      })
    },

    async deleteTag(repo, name) {
      const tag = nameArg(name, 'tag name')
      await ctx.exclusive(repo, async () => {
        await ctx.git(repo, ['tag', '-d', tag])
      })
    },

    async pushTag(repo, remote, name) {
      const r = arg(remote, 'remote')
      const tag = nameArg(name, 'tag name')
      await ctx.gitNetwork(repo, ['push', r, `refs/tags/${tag}`])
    },

    async deleteRemoteTag(repo, remote, name) {
      const r = arg(remote, 'remote')
      const tag = nameArg(name, 'tag name')
      await ctx.gitNetwork(repo, ['push', r, '--delete', `refs/tags/${tag}`])
    }
  }
}
