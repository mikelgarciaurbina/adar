// Network operations (fetch / pull / push) and remote configuration.

import type { ForcePushMode, OperationResult, PullMode } from '@shared/types'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import {
  arg,
  branchUpstream,
  combinedOutput,
  currentBranch,
  FAMILY,
  finishOperation,
  invalid,
  listRemotes,
  mapInvalid,
  nameArg,
  notFound,
  refExists
} from './util'

type RemoteOps = Pick<
  WriteOps,
  'fetch' | 'pull' | 'push' | 'deleteRemoteBranch' | 'addRemote' | 'removeRemote' | 'renameRemote' | 'setRemoteUrl'
>

const PULL_MODES: readonly PullMode[] = ['ff-only', 'merge', 'rebase']
const FORCE_MODES: readonly ForcePushMode[] = [false, 'with-lease', 'force']

function urlArg(url: unknown): string {
  return arg(typeof url === 'string' ? url.trim() : url, 'remote URL')
}

export function createRemoteOps(ctx: GitContext): RemoteOps {
  return {
    async fetch(repo, opts = {}) {
      const args = ['fetch', '--progress']
      if (opts.prune) args.push('--prune')
      if (opts.all) args.push('--all')
      else if (opts.remote) args.push(arg(opts.remote, 'remote'))
      // A local-only repository has nothing to fetch (auto-fetch must not report an error).
      if (!opts.remote && !(await listRemotes(ctx, repo)).length) return
      // Not exclusive: fetching only touches remote-tracking refs and must not block local work.
      await ctx.gitNetwork(repo, args, { opId: opts.opId })
    },

    async pull(repo, opts = {}) {
      const mode = opts.mode ?? 'ff-only'
      if (!PULL_MODES.includes(mode)) throw invalid(`Invalid pull mode: ${String(mode)}`)
      return ctx.exclusive(repo, async (): Promise<OperationResult> => {
        const branch = await currentBranch(ctx, repo)
        if (!branch) throw invalid('Cannot pull: HEAD is detached')
        if (!(await branchUpstream(ctx, repo, branch))) throw invalid(`${branch} has no upstream`)
        const args = ['pull', '--progress']
        if (mode === 'ff-only') args.push('--ff-only')
        else if (mode === 'merge') args.push('--no-rebase', '--ff', '--no-edit')
        else args.push('--rebase', '--autostash')
        const res = await ctx.gitNetwork(repo, args, { opId: opts.opId, allowFailure: true })
        if (res.code !== 0 && mode === 'ff-only' && /not possible to fast-forward|diverg/i.test(res.stderr)) {
          return {
            ok: false,
            conflicts: [],
            message: `Not possible to fast-forward: ${branch} and its upstream have diverged.\n${combinedOutput(res)}`,
            state: await ctx.operationState(repo)
          }
        }
        return finishOperation(ctx, repo, args, res, FAMILY.pull)
      })
    },

    async push(repo, opts = {}) {
      const force = opts.force ?? false
      if (!FORCE_MODES.includes(force)) throw invalid(`Invalid force mode: ${String(force)}`)
      const branch = opts.branch ? nameArg(opts.branch, 'branch name') : await currentBranch(ctx, repo)
      if (!branch) throw invalid('Cannot push: HEAD is detached')
      if (!(await refExists(ctx, repo, `refs/heads/${branch}`))) throw notFound(`Branch ${branch} has no commits to push`)

      const remotes = await listRemotes(ctx, repo)
      const upstream = await branchUpstream(ctx, repo, branch)
      const upstreamRemote = upstream && remotes.includes(upstream.remote) ? upstream.remote : null
      const remote = opts.remote
        ? arg(opts.remote, 'remote')
        : (upstreamRemote ?? (remotes.includes('origin') ? 'origin' : remotes[0]))
      if (!remote) throw invalid('This repository has no remotes')

      let remoteBranch: string
      if (opts.remoteBranch) remoteBranch = nameArg(opts.remoteBranch, 'remote branch name')
      else if (upstream && remote === upstreamRemote && upstream.merge.startsWith('refs/heads/')) {
        remoteBranch = upstream.merge.slice('refs/heads/'.length)
      } else remoteBranch = branch
      remoteBranch = remoteBranch.replace(/^refs\/heads\//, '')

      const args = ['push', '--progress']
      if (opts.setUpstream) args.push('--set-upstream')
      if (force === 'with-lease') args.push('--force-with-lease')
      else if (force === 'force') args.push('--force')
      if (opts.tags) args.push('--follow-tags')
      args.push(remote, `refs/heads/${branch}:refs/heads/${remoteBranch}`)
      await ctx.gitNetwork(repo, args, { opId: opts.opId })
    },

    async deleteRemoteBranch(repo, remote, branch) {
      const r = arg(remote, 'remote')
      const b = nameArg(branch, 'branch name').replace(/^refs\/heads\//, '')
      await ctx.gitNetwork(repo, ['push', r, '--delete', `refs/heads/${b}`])
    },

    async addRemote(repo, name, url) {
      const n = nameArg(name, 'remote name')
      const u = urlArg(url)
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, ['remote', 'add', n, u])
        } catch (err) {
          throw mapInvalid(err, /already exists|not a valid remote name/i)
        }
      })
    },

    async removeRemote(repo, name) {
      const n = nameArg(name, 'remote name')
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, ['remote', 'remove', n])
        } catch (err) {
          throw mapInvalid(err, /no such remote/i)
        }
      })
    },

    async renameRemote(repo, oldName, newName) {
      const from = nameArg(oldName, 'remote name')
      const to = nameArg(newName, 'new remote name')
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, ['remote', 'rename', from, to])
        } catch (err) {
          throw mapInvalid(err, /already exists|no such remote|not a valid remote name/i)
        }
      })
    },

    async setRemoteUrl(repo, name, url) {
      const n = nameArg(name, 'remote name')
      const u = urlArg(url)
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, ['remote', 'set-url', n, u])
        } catch (err) {
          throw mapInvalid(err, /no such remote/i)
        }
      })
    }
  }
}
