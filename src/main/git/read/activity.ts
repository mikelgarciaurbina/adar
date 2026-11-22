// What the commit tracker (src/main/system/activity.ts) reads from a repository's folder or worktree: where its HEAD
// and upstream are, and the commits between two points with the agents their Co-Authored-By trailers name. Read
// commands only, with GIT_OPTIONAL_LOCKS=0, so a look never takes the index.lock an agent's own git may need.

import { agentsNamed, type AgentCommit } from '@shared/agents'
import type { GitContext } from '../context'

const READ = { allowFailure: true, env: { GIT_OPTIONAL_LOCKS: '0' } }
const SHA = /^[0-9a-f]{7,64}$/

export interface HeadLook {
  head: string | null
  /** null on a detached HEAD. */
  branch: string | null
  /** "origin/main"; null without an upstream. */
  upstream: string | null
  upstreamSha: string | null
}

/** Where a folder's HEAD and its branch's upstream are; null when git cannot say (the folder went away). */
export async function lookAtHead(ctx: GitContext, dir: string): Promise<HeadLook | null> {
  // A folder that is gone fails to start git at all, whatever the command.
  const read = await Promise.all([
    ctx.git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'], READ),
    ctx.git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'], READ),
    ctx.git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], READ),
    ctx.git(dir, ['rev-parse', '--verify', '--quiet', '@{upstream}'], READ)
  ]).catch(() => null)
  if (!read) return null
  const [head, branch, upstream, upstreamSha] = read
  // Not a repository any more (an unborn branch still has a branch name).
  if (head.code !== 0 && branch.code !== 0) return null
  const sha = (out: string) => (SHA.test(out.trim()) ? out.trim() : null)
  const name = upstream.code === 0 ? upstream.stdout.trim() : ''
  return {
    head: head.code === 0 ? sha(head.stdout) : null,
    branch: branch.code === 0 ? branch.stdout.trim() || null : null,
    upstream: name && name !== '@{upstream}' ? name : null,
    upstreamSha: upstreamSha.code === 0 ? sha(upstreamSha.stdout) : null
  }
}

/** `git log --format=%H%x1f%ct%x1f%s%x1f<trailers>%x1e` output. */
export function parseAgentLog(out: string): { commits: AgentCommit[]; coAuthors: string[] } {
  const commits: AgentCommit[] = []
  const who: string[] = []
  for (const rec of out.split('\x1e')) {
    const [sha, ct, subject, trailers] = rec.replace(/^\n+/, '').split('\x1f')
    if (!sha || !SHA.test(sha)) continue
    commits.push({ sha, subject: subject ?? '', at: Number(ct) * 1000 || 0 })
    if (trailers) who.push(...trailers.split('\x1d').map((s) => s.trim()).filter(Boolean))
  }
  return { commits, coAuthors: agentsNamed(who.reverse()) }
}

/** The newest commits of `from..to` (at most `max`), with the agents their trailers name. */
export async function commitsBetween(ctx: GitContext, dir: string, from: string, to: string, max = 5): Promise<{ commits: AgentCommit[]; coAuthors: string[] }> {
  const res = await ctx.git(
    dir,
    ['log', `-n${max}`, '--format=%H%x1f%ct%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e', `${from}..${to}`, '--'],
    READ
  )
  return res.code === 0 ? parseAgentLog(res.stdout) : { commits: [], coAuthors: [] }
}

/** The branch work goes to: the remote's default branch (origin/HEAD), else main or master, local or remote. */
export async function baseBranch(ctx: GitContext, repo: string): Promise<string | null> {
  const sym = await ctx.git(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], READ)
  const fromRemote = sym.code === 0 ? sym.stdout.trim() : ''
  if (fromRemote && !fromRemote.startsWith('-')) return fromRemote
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const res = await ctx.git(repo, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], READ)
    if (res.code === 0) return candidate
  }
  return null
}

/** Files changed between two commits (for "committed · 4 files"). */
export async function filesBetween(ctx: GitContext, dir: string, from: string, to: string): Promise<number> {
  const res = await ctx.git(dir, ['diff', '--name-only', '-z', from, to, '--'], READ)
  return res.code === 0 ? res.stdout.split('\0').filter(Boolean).length : 0
}

/** Commits in `from..to` (0 when git cannot say). */
export async function countBetween(ctx: GitContext, dir: string, from: string, to: string): Promise<number> {
  const res = await ctx.git(dir, ['rev-list', '--count', `${from}..${to}`], READ)
  return res.code === 0 ? Number(res.stdout.trim()) || 0 : 0
}

/** A commit's subject ('' when git cannot say). */
export async function subjectOf(ctx: GitContext, dir: string, sha: string): Promise<string> {
  const res = await ctx.git(dir, ['log', '-1', '--format=%s', sha, '--'], READ)
  return res.code === 0 ? res.stdout.trim() : ''
}

/** Is `ancestor` an ancestor of (or equal to) `of`? */
export async function isAncestor(ctx: GitContext, dir: string, ancestor: string, of: string): Promise<boolean> {
  const res = await ctx.git(dir, ['merge-base', '--is-ancestor', ancestor, of], READ)
  return res.code === 0
}
