// Interactive rebase: list the commits of a rebase and run `git rebase -i`
// non-interactively with a todo built from the UI's list.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Commit, OperationResult } from '@shared/types'
import type { GitContext } from '../context'
import type { WriteOps } from '../ops'
import { getGitExecutable } from '../runner'
import { LOG_FORMAT, parseLog } from './log'
import { buildTodo, messagesNeeded, resolveTodo } from './rebaseTodo'
import { arg, describeCommit, FAMILY, finishOperation, gitAtLeast, invalid, isUnborn, resolveCommit, shellPath, shellQuote } from './util'

type InteractiveOps = Pick<WriteOps, 'getRebaseCommits' | 'interactiveRebase'>

/** Prefix key of a repository's rebase scratch dirs (exported for tests). */
export function repoKey(repo: string): string {
  return createHash('sha1').update(repo).digest('hex').slice(0, 12)
}

/**
 * Remove the message files of finished interactive rebases of `repo`. Message
 * files must outlive the `git rebase -i` call while the rebase is stopped
 * (edit / conflicts): the remaining exec lines still reference them.
 */
export async function cleanupRebaseFiles(ctx: GitContext, repo: string): Promise<void> {
  try {
    if ((await ctx.operationState(repo)) !== 'none') return
    const prefix = `rebase-${repoKey(repo)}-`
    const entries = await fs.readdir(ctx.tmpDir)
    await Promise.all(
      entries.filter((e) => e.startsWith(prefix)).map((e) => fs.rm(path.join(ctx.tmpDir, e), { recursive: true, force: true }))
    )
  } catch {
    /* tmp dir missing or unreadable: nothing to clean */
  }
}

export async function loadRebaseCommits(ctx: GitContext, repo: string, base: string): Promise<Commit[]> {
  if (await isUnborn(ctx, repo)) return []
  const range = base === 'ROOT' ? 'HEAD' : `${arg(base, 'base')}..HEAD`
  if (base !== 'ROOT') await resolveCommit(ctx, repo, base)
  const res = await ctx.git(repo, ['log', '--no-show-signature', '--reverse', '--topo-order', '--no-merges', '-z', `--format=${LOG_FORMAT}`, range, '--'])
  return parseLog(res.stdout)
}

export function createInteractiveOps(ctx: GitContext): InteractiveOps {
  return {
    getRebaseCommits(repo, base) {
      return loadRebaseCommits(ctx, repo, base)
    },

    async interactiveRebase(repo, base, todo) {
      const isRoot = base === 'ROOT'
      if (!isRoot) arg(base, 'base')
      return ctx.exclusive(repo, async (): Promise<OperationResult> => {
        const before = await ctx.operationState(repo)
        if (before !== 'none') throw invalid(`Cannot start an interactive rebase while a ${before} is in progress`)
        const commits = await loadRebaseCommits(ctx, repo, base)
        if (!commits.length) throw invalid('There are no commits to rebase')
        const items = resolveTodo(todo, commits)

        const fullMessages = new Map<string, string>()
        for (const sha of messagesNeeded(items)) {
          const res = await ctx.git(repo, ['log', '-1', '--no-show-signature', '--format=%B', sha, '--'])
          fullMessages.set(sha, res.stdout)
        }
        const steps = buildTodo(items, fullMessages)

        const tmp = await ctx.ensureTmpDir()
        const dir = await fs.mkdtemp(path.join(tmp, `rebase-${repoKey(repo)}-`))
        const todoFile = path.join(dir, 'git-rebase-todo')
        const git = shellQuote(shellPath(getGitExecutable()))
        const lines: string[] = []
        let n = 0
        for (const step of steps) {
          if (step.kind === 'line') {
            lines.push(step.text)
            continue
          }
          const file = path.join(dir, `message-${++n}.txt`)
          await fs.writeFile(file, step.message, 'utf8')
          lines.push(
            `exec ${git} commit --amend --only --allow-empty --no-verify --cleanup=whitespace -F ${shellQuote(shellPath(file))}`
          )
        }
        await fs.writeFile(todoFile, `${lines.join('\n')}\n`, 'utf8')

        const args = ['rebase', '-i', '--autostash', '--no-autosquash', '--no-rebase-merges']
        if (await gitAtLeast(ctx, 2, 38)) args.push('--no-update-refs')
        args.push(isRoot ? '--root' : base)

        let result: OperationResult
        try {
          const res = await ctx.git(repo, args, {
            allowFailure: true,
            env: { GIT_SEQUENCE_EDITOR: `cp ${shellQuote(shellPath(todoFile))}`, GIT_EDITOR: 'true' }
          })
          result = await finishOperation(ctx, repo, args, res, FAMILY.rebase)
        } finally {
          await fs.rm(todoFile, { force: true }).catch(() => undefined)
          await cleanupRebaseFiles(ctx, repo)
        }

        if (!result.ok && !result.conflicts.length) {
          const stopped = await describeCommit(ctx, repo, 'HEAD')
          const intro = stopped
            ? `Rebase paused at ${stopped}. Make your changes, then Continue.`
            : 'Rebase paused. Make your changes, then Continue.'
          result = { ...result, message: `${intro}\n${result.message}`.trim() }
        }
        return result
      })
    }
  }
}
