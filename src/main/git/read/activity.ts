// One look at a worktree for Agents at work: its changes not committed (status, lines added and removed, when each
// file last changed), its branch and upstream, and the commits it has that the base branch lacks, with the agents
// their Co-Authored-By trailers name. Read commands only, with GIT_OPTIONAL_LOCKS=0, so a look never takes the
// index.lock an agent's own git may be about to need.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { agentsNamed, MAX_AGENT_COMMITS, type AgentCommit, type AgentFile } from '@shared/agents'
import type { GitContext } from '../context'

const READ = { allowFailure: true, env: { GIT_OPTIONAL_LOCKS: '0' } }
/** Untracked files whose lines are counted (the newest first), and how much of each is read. */
const COUNTED_UNTRACKED = 40
const COUNT_BYTES = 256 * 1024
/** Files whose modification time is read; beyond that they count as unchanged. */
const MAX_STAT = 2000

export interface WorktreeLook {
  head: string | null
  branch: string | null
  upstream: string | null
  /** Commits the upstream lacks (null without an upstream). */
  unpushed: number | null
  /** Every file with changes, the latest first; `at` is 0 for a file that is gone (the tracker dates it). */
  files: AgentFile[]
  added: number
  removed: number
  ahead: number
  commits: AgentCommit[]
  coAuthors: string[]
}

interface StatusLook {
  head: string | null
  branch: string | null
  upstream: string | null
  ahead: number | null
  entries: Array<{ path: string; status: AgentFile['status'] }>
}

function letter(xy: string): AgentFile['status'] {
  const c = xy[0] !== '.' ? xy[0] : xy[1]
  if (c === 'A' || c === 'C') return 'A'
  if (c === 'D') return 'D'
  if (c === 'R') return 'R'
  return 'M'
}

/** The rest of a status v2 line after `n` space-separated fields (paths may contain spaces). */
function after(entry: string, n: number): string | null {
  let at = 0
  for (let i = 0; i < n; i++) {
    at = entry.indexOf(' ', at)
    if (at < 0) return null
    at++
  }
  return entry.slice(at)
}

/** `git status --porcelain=v2 -z --branch` output. */
export function parseStatusLook(out: string): StatusLook {
  const look: StatusLook = { head: null, branch: null, upstream: null, ahead: null, entries: [] }
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue
    if (t.startsWith('# ')) {
      const [key, ...rest] = t.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') look.head = /^[0-9a-f]{7,64}$/.test(value) ? value : null
      else if (key === 'branch.head') look.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') look.upstream = value || null
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -\d+$/.exec(value)
        if (m) look.ahead = Number(m[1])
      }
    } else if (t[0] === '?') {
      look.entries.push({ path: t.slice(2), status: '?' })
    } else if (t[0] === '1') {
      const p = after(t, 8)
      if (p) look.entries.push({ path: p, status: letter(t.slice(2, 4)) })
    } else if (t[0] === '2') {
      const p = after(t, 9)
      if (p) look.entries.push({ path: p, status: letter(t.slice(2, 4)) })
      i++ // the source path
    } else if (t[0] === 'u') {
      const p = after(t, 10)
      if (p) look.entries.push({ path: p, status: 'U' })
    }
  }
  return look
}

/** `git diff --numstat -z` output: path → [added, removed] (binary files count 0). */
export function parseNumstat(out: string): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>()
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue
    const parts = t.split('\t')
    if (parts.length < 3) continue
    const add = Number(parts[0]) || 0
    const del = Number(parts[1]) || 0
    let p = parts.slice(2).join('\t')
    if (!p) {
      // A rename: the source and the destination follow.
      p = tokens[i + 2] ?? ''
      i += 2
    }
    if (p) map.set(p, [add, del])
  }
  return map
}

/** `git log --format=%H%x1f%ct%x1f%s%x1f<trailers>%x1e` output. */
export function parseAgentLog(out: string): { commits: AgentCommit[]; coAuthors: string[] } {
  const commits: AgentCommit[] = []
  const who: string[] = []
  for (const rec of out.split('\x1e')) {
    const [sha, ct, subject, trailers] = rec.replace(/^\n+/, '').split('\x1f')
    if (!sha || !/^[0-9a-f]{7,64}$/.test(sha)) continue
    commits.push({ sha, subject: subject ?? '', at: Number(ct) * 1000 || 0 })
    if (trailers) who.push(...trailers.split('\x1d').map((s) => s.trim()).filter(Boolean))
  }
  return { commits, coAuthors: agentsNamed(who.reverse()) }
}

async function countLines(file: string): Promise<number> {
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(file, 'r')
    const buf = Buffer.alloc(COUNT_BYTES)
    const { bytesRead } = await handle.read(buf, 0, COUNT_BYTES, 0)
    const data = buf.subarray(0, bytesRead)
    if (data.subarray(0, 8000).includes(0)) return 0
    let n = 0
    for (const b of data) if (b === 10) n++
    if (bytesRead > 0 && data[bytesRead - 1] !== 10) n++
    return n
  } catch {
    return 0
  } finally {
    await handle?.close().catch(() => undefined)
  }
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

/** Short name of a base ("origin/main" → "main"). */
export const baseName = (base: string): string => base.replace(/^origin\//, '')

/** Look at a worktree; null when git cannot (the folder went away, not a repository). */
export async function lookAtWorktree(ctx: GitContext, dir: string, base: string | null): Promise<WorktreeLook | null> {
  const status = await ctx.git(dir, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--ignore-submodules=dirty'], READ)
  if (status.code !== 0) return null
  const st = parseStatusLook(status.stdout)
  const ownBase = base && st.branch !== baseName(base) && st.branch !== base ? base : null
  const [numstat, log] = await Promise.all([
    st.head ? ctx.git(dir, ['diff', '--numstat', '-z', 'HEAD', '--'], READ) : null,
    st.head && ownBase
      ? ctx.git(
          dir,
          ['log', '--first-parent', `-n${MAX_AGENT_COMMITS}`, '--format=%H%x1f%ct%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e', `${ownBase}..HEAD`, '--'],
          READ
        )
      : null
  ])
  const counts = numstat?.code === 0 ? parseNumstat(numstat.stdout) : new Map<string, [number, number]>()
  const own = log?.code === 0 ? parseAgentLog(log.stdout) : { commits: [], coAuthors: [] }
  let ahead = own.commits.length
  if (ahead >= MAX_AGENT_COMMITS && ownBase) {
    const res = await ctx.git(dir, ['rev-list', '--count', `${ownBase}..HEAD`], READ)
    if (res.code === 0) ahead = Number(res.stdout.trim()) || ahead
  }

  const stamps = await Promise.all(
    st.entries.slice(0, MAX_STAT).map((e) =>
      e.status === 'D'
        ? Promise.resolve(0)
        : fs.lstat(path.join(dir, e.path)).then(
            (s) => s.mtimeMs,
            () => 0
          )
    )
  )
  const files: AgentFile[] = st.entries.map((e, i) => {
    const [added, removed] = counts.get(e.path) ?? [0, 0]
    return { path: e.path, status: e.status, added, removed, at: stamps[i] ?? 0 }
  })
  const untracked = files.filter((f) => f.status === '?').sort((a, b) => b.at - a.at)
  await Promise.all(
    untracked.slice(0, COUNTED_UNTRACKED).map(async (f) => {
      f.added = await countLines(path.join(dir, f.path))
    })
  )
  files.sort((a, b) => b.at - a.at || a.path.localeCompare(b.path))
  let added = 0
  let removed = 0
  for (const f of files) {
    added += f.added
    removed += f.removed
  }
  return {
    head: st.head,
    branch: st.branch,
    upstream: st.upstream,
    unpushed: st.upstream ? (st.ahead ?? 0) : null,
    files,
    added,
    removed,
    ahead,
    commits: own.commits,
    coAuthors: own.coAuthors
  }
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

/** Is `ancestor` an ancestor of (or equal to) `of`? */
export async function isAncestor(ctx: GitContext, dir: string, ancestor: string, of: string): Promise<boolean> {
  const res = await ctx.git(dir, ['merge-base', '--is-ancestor', ancestor, of], READ)
  return res.code === 0
}
