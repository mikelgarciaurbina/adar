// getWorktrees: the repository's worktrees (git worktree list) with their branch and how many files
// each has changed, and which branches are checked out in a worktree other than this one.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Worktree } from '@shared/types'
import type { GitContext } from '../context'
import type { ReadOps } from '../ops'
import { assertRepo } from './common'

/** Files listed by name for a worktree with changes (the rest are only counted). */
const NAMED_CHANGES = 5

export interface ListedWorktree {
  path: string
  sha: string | null
  /** Short branch name, or null when detached (or bare). */
  branch: string | null
  bare: boolean
  locked: boolean
  prunable: boolean
}

/** `git worktree list --porcelain` output: blocks of "key value" lines separated by blank lines. */
export function parseWorktreeList(out: string): ListedWorktree[] {
  const list: ListedWorktree[] = []
  for (const block of out.replace(/\r\n?/g, '\n').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean)
    const first = lines[0] ?? ''
    if (!first.startsWith('worktree ')) continue
    const w: ListedWorktree = { path: first.slice('worktree '.length), sha: null, branch: null, bare: false, locked: false, prunable: false }
    for (const line of lines.slice(1)) {
      if (line.startsWith('HEAD ')) w.sha = line.slice(5).trim() || null
      else if (line.startsWith('branch refs/heads/')) w.branch = line.slice('branch refs/heads/'.length)
      else if (line === 'bare') w.bare = true
      else if (line === 'locked' || line.startsWith('locked ')) w.locked = true
      else if (line === 'prunable' || line.startsWith('prunable ')) w.prunable = true
    }
    list.push(w)
  }
  return list
}

const real = (p: string) => fs.realpath(p).catch(() => path.resolve(p))

export async function listWorktrees(ctx: GitContext, repo: string): Promise<ListedWorktree[]> {
  const res = await ctx.git(repo, ['worktree', 'list', '--porcelain'], { allowFailure: true })
  return res.code === 0 ? parseWorktreeList(res.stdout).map((w) => ({ ...w, path: path.resolve(w.path) })) : []
}

/** Branches checked out in a worktree other than `repo`'s, by name → that worktree's path. */
export async function otherWorktreeBranches(ctx: GitContext, repo: string): Promise<Map<string, string>> {
  const list = await listWorktrees(ctx, repo)
  const out = new Map<string, string>()
  if (list.length < 2) return out
  const here = await real(repo)
  for (const w of list) if (w.branch && (await real(w.path)) !== here) out.set(w.branch, w.path)
  return out
}

/** Changed files of a worktree: how many, and the first few by name. */
async function changesOf(ctx: GitContext, dir: string): Promise<{ count: number; files: string[] } | null> {
  const res = await ctx.git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], { allowFailure: true })
  if (res.code !== 0) return null
  const files: string[] = []
  const parts = res.stdout.split('\0')
  let count = 0
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue
    count++
    if (files.length < NAMED_CHANGES) files.push(entry.slice(3))
    // Renames and copies are followed by their source path.
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  return { count, files }
}

export function createWorktreeReadOps(ctx: GitContext): Pick<ReadOps, 'getWorktrees'> {
  return {
    async getWorktrees(repo): Promise<Worktree[]> {
      await assertRepo(ctx, repo)
      const list = await listWorktrees(ctx, repo)
      const here = await real(repo)
      return Promise.all(
        list.map(async (w, i): Promise<Worktree> => {
          const missing = w.prunable || !(await fs.stat(w.path).then((s) => s.isDirectory()).catch(() => false))
          const changes = missing || w.bare ? null : await changesOf(ctx, w.path)
          return {
            path: w.path,
            name: path.basename(w.path) || w.path,
            branch: w.branch,
            sha: w.sha,
            isMain: i === 0,
            isCurrent: (await real(w.path)) === here,
            detached: !w.branch && !w.bare,
            locked: w.locked,
            missing,
            changes: changes?.count ?? null,
            changedFiles: changes?.files ?? []
          }
        })
      )
    }
  }
}
