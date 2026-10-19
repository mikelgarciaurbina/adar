// getStatus: staged / unstaged / untracked / conflicted files and branch tracking info.

import type { WorkingStatus } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import { parseStatusV2 } from '../parsers/status'
import { assertRepo, failed } from './common'

export function createStatusOps(ctx: GitContext): Pick<ReadOps, 'getStatus'> {
  return {
    async getStatus(repo): Promise<WorkingStatus> {
      await assertRepo(ctx, repo)
      const args = ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']
      // GIT_OPTIONAL_LOCKS=0: never take index.lock just to refresh stat info (avoids racing writes).
      const res = await ctx.git(repo, args, { allowFailure: true, env: { GIT_OPTIONAL_LOCKS: '0' } })
      if (res.code !== 0) {
        if (/must be run in a work tree/i.test(res.stderr)) {
          // Bare repository: no working tree, nothing to stage.
          return { staged: [], unstaged: [], conflicted: [], branch: null, upstream: null, ahead: 0, behind: 0 }
        }
        failed(args, res)
      }
      return parseStatusV2(res.stdout)
    }
  }
}
