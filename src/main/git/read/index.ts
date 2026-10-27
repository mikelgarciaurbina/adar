// Read side of the backend: every AdarApi method that does not mutate a repository.

import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import type { SystemServices } from '../../system'
import { createAppOps } from './app'
import { createContentOps } from './content'
import { createDiffOps } from './diff'
import { createHistoryOps } from './history'
import { createRefsOps } from './refs'
import { createWorktreeReadOps } from './worktrees'
import { createRepoOps } from './repo'
import { createStatusOps } from './status'

/**
 * Read commands run with GIT_OPTIONAL_LOCKS=0: `git status` / `git diff` would otherwise
 * opportunistically rewrite .git/index (refreshed stat data), which races with mutating
 * operations and makes the watcher report an 'index' change for a pure read — a refresh loop.
 */
function readOnlyContext(ctx: GitContext): GitContext {
  return {
    ...ctx,
    git: (repo, args, opts) => ctx.git(repo, args, { ...opts, env: { GIT_OPTIONAL_LOCKS: '0', ...opts?.env } })
  }
}

export function createReadOps(ctx: GitContext, services: SystemServices): ReadOps {
  const rctx = readOnlyContext(ctx)
  const ops: ReadOps = {
    // App ops include the git console (runGit), which must behave like a normal git invocation.
    ...createAppOps(ctx, services),
    ...createRepoOps(rctx, services),
    ...createHistoryOps(rctx),
    ...createRefsOps(rctx),
    ...createWorktreeReadOps(rctx),
    ...createStatusOps(rctx),
    ...createDiffOps(rctx),
    ...createContentOps(rctx)
  }
  return ops
}
