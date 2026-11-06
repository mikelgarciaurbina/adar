// Reviewing an agent's work before its pull request: everything a worktree has that its base branch lacks — the
// commits of its branch and the changes not committed yet — as one comparison base..head. With changes not committed,
// `head` is a snapshot tree of the working tree, written through a throwaway copy of the worktree's index: its own
// index, HEAD and branches stay as they are, and git's gc removes the snapshot's objects once they are old. The same
// files give the same tree, so Viewed marks and "since your review" keep pointing at the same version.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { WorkReviewRange } from '@shared/review'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import { baseBranch } from './activity'
import { assertRepo } from './common'

const READ = { allowFailure: true, env: { GIT_OPTIONAL_LOCKS: '0' } }
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** Files with changes not committed beyond which the review shows the commits only (build output nobody ignored…). */
export const MAX_SNAPSHOT_FILES = 5000

const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })

/** Files in `git status --porcelain -z` output (a rename's original path is not one more). */
export function countStatus(out: string): number {
  const parts = out.split('\0')
  let n = 0
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    n++
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  return n
}

/** The working tree of `dir` as a tree object: tracked changes, staged or not, and files not ignored nor tracked yet. */
export async function snapshotTree(ctx: GitContext, dir: string, tip: string): Promise<string> {
  const where = await ctx.git(dir, ['rev-parse', '--git-path', 'index'], READ)
  const index = path.resolve(dir, where.stdout.trim() || '.git/index')
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'adar-review-'))
  const copy = path.join(tmp, 'index')
  try {
    // A copy keeps the index's file stats, so only files that changed are read again.
    const copied = await fs.copyFile(index, copy).then(
      () => true,
      () => false
    )
    const env = { GIT_INDEX_FILE: copy, GIT_OPTIONAL_LOCKS: '0' }
    if (!copied) await ctx.git(dir, ['read-tree', tip], { env })
    await ctx.git(dir, ['add', '--all'], { env })
    const tree = (await ctx.git(dir, ['write-tree'], { env })).stdout.trim()
    if (!OBJECT_ID.test(tree)) throw invalid('Git did not give a snapshot of the changes not committed')
    return tree
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
}

function parseSince(raw: unknown): { head: string; tip: string } | null {
  if (raw == null) return null
  const s = raw as { head?: unknown; tip?: unknown }
  if (typeof s !== 'object' || typeof s.head !== 'string' || typeof s.tip !== 'string' || !OBJECT_ID.test(s.head) || !OBJECT_ID.test(s.tip)) throw invalid('Invalid commit')
  return { head: s.head, tip: s.tip }
}

export async function prepareWorkReview(ctx: GitContext, repo: string, rawSince: unknown): Promise<WorkReviewRange> {
  const since = parseSince(rawSince)
  const run = (args: string[]) => ctx.git(repo, args, READ)
  const tip = (await run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).stdout.trim()
  if (!OBJECT_ID.test(tip)) throw invalid('This worktree has no commits yet')
  const sym = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const branch = sym.code === 0 ? sym.stdout.trim() || null : null

  // The base branch's own worktree ("main" with origin/main) shows what the remote lacks; without a base, only what is not committed.
  let baseRef = await baseBranch(ctx, repo)
  if (baseRef && branch && baseRef === branch) baseRef = null
  const mb = baseRef ? await run(['merge-base', tip, baseRef]) : null
  const base = mb?.code === 0 && OBJECT_ID.test(mb.stdout.trim()) ? mb.stdout.trim() : tip

  const status = await run(['status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=dirty'])
  if (status.code !== 0) throw invalid(status.stderr.trim() || 'Git could not read the worktree’s changes')
  const files = countStatus(status.stdout)
  const leftOut = files > MAX_SNAPSHOT_FILES ? files : 0
  const head = files && !leftOut ? await snapshotTree(ctx, repo, tip) : tip

  const range: WorkReviewRange = {
    base,
    head,
    since: null,
    sinceState: since ? 'missing' : 'none',
    sinceCommits: 0,
    onlyMerges: false,
    branch,
    baseRef,
    tip,
    uncommitted: leftOut ? 0 : files,
    uncommittedLeftOut: leftOut
  }
  if (!since || (await run(['cat-file', '-e', since.head])).code !== 0) return range
  range.since = since.head
  if (since.head === head) return { ...range, sinceState: 'ancestor' }
  const tipKnown = (await run(['cat-file', '-e', `${since.tip}^{commit}`])).code === 0
  if (!tipKnown || (await run(['merge-base', '--is-ancestor', since.tip, tip])).code !== 0) return { ...range, sinceState: 'rewritten' }
  const firsts = (await run(['rev-list', '--first-parent', '--parents', `${since.tip}..${tip}`])).stdout.split('\n').filter(Boolean)
  return {
    ...range,
    sinceState: 'ancestor',
    sinceCommits: firsts.length,
    // Only the base branch merged in, and nothing that was not committed then or now: the work itself is the same.
    onlyMerges: firsts.length > 0 && firsts.every((l) => l.trim().split(' ').length > 2) && since.head === since.tip && head === tip
  }
}

export function createWorkReviewOps(ctx: GitContext): Pick<ReadOps, 'prepareWorkReview'> {
  return {
    async prepareWorkReview(repo, opts) {
      await assertRepo(ctx, repo)
      return prepareWorkReview(ctx, repo, opts?.since)
    }
  }
}
