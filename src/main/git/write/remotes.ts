// Network operations (fetch / pull / push) and remote configuration.

import { AdarError } from '@shared/errors'
import type { ForcePushMode, OperationResult, PullMode } from '@shared/types'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { clearInteractiveRebaseMarker } from './interactive'
import {
  arg,
  branchUpstream,
  currentBranch,
  FAMILY,
  finishOperation,
  invalid,
  listRemotes,
  mapInvalid,
  nameArg,
  notFound,
  refExists,
  tryResolveCommit,
  withCode
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

function leaseRefused(remote: string, remoteBranch: string, branch: string, err?: AdarError): AdarError {
  const message = `Force push refused: ${remote}/${remoteBranch} has commits your local ${branch} has never contained (someone else pushed). Pull or review them first.`
  return err ? withCode(err, err.code, message) : new AdarError({ code: 'GIT_FAILED', message })
}

/** True when `sha` is reachable from the branch's tip or from any commit its reflog recorded. */
async function branchHasContained(ctx: GitContext, repo: string, branch: string, sha: string): Promise<boolean> {
  const ref = `refs/heads/${branch}`
  const reflog = await ctx.git(repo, ['log', '-g', '--no-show-signature', '--format=%H', ref, '--'], { allowFailure: true })
  const shas = reflog.code === 0 ? reflog.stdout.split('\n').filter((l) => /^[0-9a-f]{40,64}$/.test(l)) : []
  const tips = new Set([...shas, ref])
  // (--not does not apply to --stdin, hence the ^ on every line.)
  const res = await ctx.git(repo, ['rev-list', '--count', sha, '--stdin'], { input: [...tips].map((t) => `^${t}\n`).join('') })
  return res.stdout.trim() === '0'
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
        else {
          args.push('--rebase', '--autostash')
          await clearInteractiveRebaseMarker(ctx, repo)
        }
        const res = await ctx.gitNetwork(repo, args, { opId: opts.opId, allowFailure: true })
        if (res.code !== 0 && mode === 'ff-only' && /not possible to fast-forward|diverg/i.test(res.stderr)) {
          return {
            ok: false,
            conflicts: [],
            // (git's own "fatal: Not possible to fast-forward, aborting." and its hints would only repeat this.)
            message: `Not possible to fast-forward: ${branch} and its upstream have diverged.`,
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

      // A bare --force-with-lease checks the remote against our remote-tracking ref, which a background
      // fetch (auto-fetch) silently moves to someone else's new commits — the lease would then pass and
      // overwrite them. push.useForceIfIncludes (git >= 2.30) additionally requires that the local branch
      // once contained that tip. (As config, older git ignores it instead of failing on an unknown flag.)
      // That check reads the remote-tracking ref's reflog, which a fresh clone does not have and gc empties
      // after gc.reflogExpire (git then refuses every force push): in that case do the same check here and
      // lease against the tracking ref explicitly.
      let lease = '--force-with-lease'
      if (force === 'with-lease') {
        const tracking = `refs/remotes/${remote}/${remoteBranch}`
        const expected = await tryResolveCommit(ctx, repo, tracking)
        const lastEntry = expected
          ? await ctx.git(repo, ['log', '-g', '-1', '--no-show-signature', '--format=%H', tracking, '--'], { allowFailure: true })
          : null
        if (expected && lastEntry && (lastEntry.code !== 0 || !lastEntry.stdout.trim())) {
          if (!(await branchHasContained(ctx, repo, branch, expected))) throw leaseRefused(remote, remoteBranch, branch)
          lease = `--force-with-lease=refs/heads/${remoteBranch}:${expected}`
        }
      }
      const args = force === 'with-lease' ? ['-c', 'push.useForceIfIncludes=true', 'push', '--progress'] : ['push', '--progress']
      if (opts.setUpstream) args.push('--set-upstream')
      if (force === 'with-lease') args.push(lease)
      else if (force === 'force') args.push('--force')
      if (opts.tags) args.push('--follow-tags')
      args.push(remote, `refs/heads/${branch}:refs/heads/${remoteBranch}`)
      try {
        await ctx.gitNetwork(repo, args, { opId: opts.opId })
      } catch (err) {
        if (force === 'with-lease' && err instanceof AdarError && /stale info|remote ref updated since checkout/i.test(err.stderr ?? '')) {
          throw leaseRefused(remote, remoteBranch, branch, err)
        }
        throw err
      }
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
