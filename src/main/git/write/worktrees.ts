// Worktrees: adding one (an existing branch, or a new one from a start point), removing, locking and
// forgetting the ones whose folder is gone. Only worktrees git lists can be removed or locked, never the
// main one or the one the request comes from.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { listWorktrees } from '../read/worktrees'
import { arg, invalid, nameArg, optionalArg, withCode } from './util'
import { AdarError } from '@shared/errors'

type WorktreeOps = Pick<WriteOps, 'addWorktree' | 'removeWorktree' | 'setWorktreeLocked' | 'pruneWorktrees'>

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/

const real = (p: string) => fs.realpath(p).catch(() => path.resolve(p))

/** A folder for a new worktree: absolute, not there yet, in a folder that is. */
async function newFolder(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !value.trim()) throw invalid('Choose a folder for the worktree')
  if (CONTROL_RE.test(value)) throw invalid('Invalid folder name')
  if (!path.isAbsolute(value)) throw invalid('The worktree folder must be an absolute path')
  const abs = path.resolve(value)
  if (await fs.lstat(abs).then(() => true, () => false)) throw invalid(`${abs} already exists. Choose a folder that does not exist yet.`)
  const parent = path.dirname(abs)
  if (!(await fs.stat(parent).then((s) => s.isDirectory(), () => false))) throw invalid(`The folder ${parent} does not exist`)
  return abs
}

export function createWorktreeWriteOps(ctx: GitContext): WorktreeOps {
  /** A listed worktree other than the main one and `repo` itself. */
  const linked = async (repo: string, value: unknown) => {
    const target = path.resolve(arg(value, 'worktree'))
    const list = await listWorktrees(ctx, repo)
    const here = await real(repo)
    const i = list.findIndex((w) => w.path === target)
    if (i < 0) throw invalid(`${target} is not a worktree of this repository`)
    if (i === 0) throw invalid('The main worktree cannot be removed')
    if ((await real(target)) === here) throw invalid('Open another tab of this repository to remove this worktree')
    return list[i]
  }

  return {
    async addWorktree(repo, opts) {
      const branch = nameArg(opts?.branch, 'branch')
      const from = optionalArg(opts?.from, 'start point')
      const folder = await newFolder(opts?.path)
      const args = from
        ? ['worktree', 'add', ...(opts.track ? ['--track'] : ['--no-track']), '-b', branch, folder, from]
        : ['worktree', 'add', folder, branch]
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, args)
        } catch (err) {
          if (err instanceof AdarError && /already (checked out|used by worktree) at/i.test(`${err.stderr ?? ''} ${err.message}`)) {
            throw withCode(err, 'INVALID_ARGUMENT', `${branch} is already checked out in another worktree`)
          }
          throw err
        }
      })
      return real(folder)
    },

    async removeWorktree(repo, worktree, opts) {
      const w = await linked(repo, worktree)
      if (w.locked) throw invalid(`${path.basename(w.path)} is locked. Unlock it first.`)
      await ctx.exclusive(repo, async () => {
        try {
          await ctx.git(repo, ['worktree', 'remove', ...(opts?.force ? ['--force'] : []), w.path])
        } catch (err) {
          if (err instanceof AdarError && /modified or untracked files/i.test(`${err.stderr ?? ''} ${err.message}`)) {
            throw withCode(err, 'DIRTY_WORKTREE', `${path.basename(w.path)} has changes that are not committed`)
          }
          throw err
        }
      })
    },

    async setWorktreeLocked(repo, worktree, locked) {
      const w = await linked(repo, worktree)
      await ctx.exclusive(repo, () => ctx.git(repo, ['worktree', locked ? 'lock' : 'unlock', w.path]))
    },

    async pruneWorktrees(repo) {
      await ctx.exclusive(repo, () => ctx.git(repo, ['worktree', 'prune']))
    }
  }
}
