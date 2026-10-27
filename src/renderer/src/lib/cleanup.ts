// "Clean up branches": which branches can go, in which group, and which are ticked when the dialog
// opens. Pure: the backend says what git knows (getBranchCleanup), the pull requests add squash and
// rebase merges git cannot see.

import { sameCommit, type RepoPullRequests } from '@shared/hosting'
import type { BranchCleanupInfo, Ref, RefsResult } from '@shared/types'
import { forkBranch, pullRef } from './pulls'

/** Branches nobody means to clean up, wherever they are. */
const LONG_LIVED = new Set(['main', 'master', 'develop', 'development', 'dev', 'trunk', 'staging', 'production', 'stable'])
/** Release branches: listed, never ticked for you. */
const isRelease = (name: string) => /^(release|releases|hotfix|support)[/-]/.test(name)

export type CleanupReason =
  /** git: all its commits are in the base branch. */
  | { kind: 'merged' }
  /** Its pull request was merged with this very commit (squash and rebase merges included). */
  | { kind: 'pull'; ref: string }
  /** The branch it tracked was deleted on the remote; `unique` commits are in no other branch. */
  | { kind: 'gone'; upstream: string; unique: number }

export interface CleanupItem {
  /** "local:<name>" or "remote:<name>". */
  key: string
  scope: 'local' | 'remote'
  /** Local branch name, or the branch's name on the remote. */
  name: string
  /** As shown: "feat/x", or "origin/feat/x" for a remote branch. */
  label: string
  sha: string
  subject: string
  /** Unix seconds. */
  date: number
  reason: CleanupReason
  /** The checked-out branch: Adar switches to the base branch first. */
  isHead: boolean
  /** Commits lost by deleting it (in no other branch). */
  loses: number
  /** Ticked when the dialog opens, and when its group is ticked. */
  ticked: boolean
}

export interface CleanupPlan {
  base: string
  remoteName: string | null
  /** Local branches whose work is in the base branch. */
  inBase: CleanupItem[]
  /** Local branches whose upstream was deleted, with commits not in the base branch. */
  gone: CleanupItem[]
  /** Branches of the remote already in the base branch. */
  remote: CleanupItem[]
  /** Branches always kept ("main"), for the dialog's last line. */
  kept: string[]
}

const newestFirst = (a: CleanupItem, b: CleanupItem) => b.date - a.date || a.name.localeCompare(b.name)

/** The base branch to clean up against: the hosting's default branch, else the remote's HEAD, else main/master… */
export function cleanupBase(refs: RefsResult | null, pulls: Pick<RepoPullRequests, 'defaultBranch'> | null, mainLocal: Ref | undefined): string {
  if (pulls?.defaultBranch) return pulls.defaultBranch
  const head = refs?.remotes.find((r) => r.isSymbolic && r.target && r.remote === 'origin') ?? refs?.remotes.find((r) => r.isSymbolic && r.target)
  if (head?.target && head.remote && head.target.startsWith(`${head.remote}/`)) return head.target.slice(head.remote.length + 1)
  return mainLocal?.name ?? 'main'
}

export function cleanupPlan(info: BranchCleanupInfo, pulls: RepoPullRequests | null): CleanupPlan {
  const merged = (pulls?.pulls ?? []).filter((p) => p.state === 'merged')
  const pullFor = (name: string, upstream: string | null, sha: string) =>
    merged.find((p) =>
      p.headFork
        ? forkBranch(p) === name && sameCommit(p.headSha, sha)
        : (upstream ? upstream === `${pulls!.remote}/${p.headRef}` : name === p.headRef) && sameCommit(p.headSha, sha)
    )
  const keep = (name: string) => name === info.base || LONG_LIVED.has(name)

  const inBase: CleanupItem[] = []
  const gone: CleanupItem[] = []
  // Upstreams of local branches that stay: their remote branches stay too.
  const staying = new Set<string>()
  for (const b of info.local) {
    if (keep(b.name)) {
      if (b.upstream) staying.add(b.upstream)
      continue
    }
    const pr = b.merged ? undefined : pullFor(b.name, b.upstream, b.sha)
    const item = (reason: CleanupReason, loses: number): CleanupItem => ({
      key: `local:${b.name}`,
      scope: 'local',
      name: b.name,
      label: b.name,
      sha: b.sha,
      subject: b.subject,
      date: b.date,
      reason,
      isHead: b.isHead,
      loses,
      ticked: loses === 0 && !isRelease(b.name)
    })
    if (b.merged) inBase.push(item({ kind: 'merged' }, 0))
    else if (pr) inBase.push(item({ kind: 'pull', ref: pullRef(pr) }, 0))
    else if (b.upstreamGone && b.upstream) gone.push(item({ kind: 'gone', upstream: b.upstream, unique: b.unique }, b.unique))
    else if (b.upstream) staying.add(b.upstream)
  }

  // A remote branch that a kept local branch still tracks stays, merged or not.
  const remote: CleanupItem[] = info.remoteName
    ? info.remote
        .filter((r) => r.merged && !keep(r.name) && !staying.has(`${info.remoteName}/${r.name}`))
        .map((r) => ({
          key: `remote:${r.name}`,
          scope: 'remote' as const,
          name: r.name,
          label: `${info.remoteName}/${r.name}`,
          sha: r.sha,
          subject: r.subject,
          date: r.date,
          reason: { kind: 'merged' } as const,
          isHead: false,
          loses: 0,
          ticked: !isRelease(r.name)
        }))
    : []

  const kept = [info.base, ...info.local.map((b) => b.name).filter((n) => n !== info.base && LONG_LIVED.has(n))]
  return { base: info.base, remoteName: info.remoteName, inBase: inBase.sort(newestFirst), gone: gone.sort(newestFirst), remote: remote.sort(newestFirst), kept }
}

/** What the dialog ticks when it opens: the safe local branches (the remote ones wait until asked for). */
export function defaultSelection(plan: CleanupPlan): Set<string> {
  return new Set([...plan.inBase, ...plan.gone].filter((i) => i.ticked).map((i) => i.key))
}

/** "Deleted 4 branches", "Deleted 4 branches here and 3 on origin", "Deleted 2 branches on origin". */
export function cleanupSummary(local: number, remote: number, remoteName: string | null): string {
  const n = (k: number) => `${k} ${k === 1 ? 'branch' : 'branches'}`
  if (!remote) return `Deleted ${n(local)}`
  if (!local) return `Deleted ${n(remote)} on ${remoteName ?? 'the remote'}`
  return `Deleted ${n(local)} here and ${remote} on ${remoteName ?? 'the remote'}`
}
