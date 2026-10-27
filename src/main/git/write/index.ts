// Write side of the git backend: every AdarApi method that mutates a
// repository, plus the rebase / conflict reads that belong to those flows.
// Split by area; see the individual files.

import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { createBranchOps } from './branches'
import { createConfigOps } from './config'
import { createConflictOps } from './conflicts'
import { createInteractiveOps } from './interactive'
import { createOperationOps } from './operations'
import { createRemoteOps } from './remotes'
import { createRewordOps } from './reword'
import { createStashOps } from './stash'
import { createTagOps } from './tags'
import { createWorktreeOps } from './worktree'
import { createWorktreeWriteOps } from './worktrees'

export function createWriteOps(ctx: GitContext): WriteOps {
  return {
    ...createWorktreeOps(ctx),
    ...createWorktreeWriteOps(ctx),
    ...createBranchOps(ctx),
    ...createOperationOps(ctx),
    ...createInteractiveOps(ctx),
    ...createRewordOps(ctx),
    ...createConflictOps(ctx),
    ...createTagOps(ctx),
    ...createStashOps(ctx),
    ...createRemoteOps(ctx),
    ...createConfigOps(ctx)
  }
}
