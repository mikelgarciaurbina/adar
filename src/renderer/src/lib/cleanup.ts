// "Clean up branches": which branches can go, in which group, and which are ticked when the dialog
// opens. Pure: the backend says what git knows (getBranchCleanup), the pull requests add squash and
// rebase merges git cannot see, and the keep rules (the repository's own list, the branches its
// service protects) take long-lived branches out.

import { sameCommit, type RepoPullRequests } from '@shared/hosting'
import type { BranchCleanupInfo, Ref, RefsResult } from '@shared/types'
import { forkBranch, pullRef } from './pulls'

/** Branches nobody means to clean up, wherever they are. */
export const LONG_LIVED: readonly string[] = ['main', 'master', 'develop', 'development', 'dev', 'trunk', 'staging', 'production', 'stable']
const longLived = new Set(LONG_LIVED)
/** Release branches: listed, never ticked for you. */
const isRelease = (name: string) => /^(release|releases|hotfix|support)[/-]/.test(name)
/** Names environments' branches often have (pre-production, integration, QA…): listed, never ticked for you. */
const ENVIRONMENTS = new Set(['pre', 'preprod', 'pre-prod', 'preproduction', 'pre-production', 'int', 'integration', 'qa', 'uat', 'test', 'testing', 'stage', 'stg', 'prod', 'prd', 'sandbox', 'demo'])
export const looksLikeEnvironment = (name: string) => ENVIRONMENTS.has(name.toLowerCase())

/** What keeps a branch out of Clean up branches besides the base branch and the names kept everywhere. */
export interface KeepRules {
  /** The repository's own names and patterns (RepoInfo.keptBranches). */
  mine: readonly string[]
  /** What its hosting service protects, when it said. */
  protected: readonly string[]
}

export const NO_KEEP_RULES: KeepRules = { mine: [], protected: [] }

const patterns = new Map<string, RegExp>()

/** Whether a kept name or pattern covers a branch: "env/*" keeps "env/eu" (* stands for any text). */
export function keepMatches(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name
  let re = patterns.get(pattern)
  if (!re) {
    re = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    patterns.set(pattern, re)
  }
  return re.test(name)
}

/**
 * The branches a kept pattern covers: local ones by name, then the remote's own (as "origin/x") when no local
 * branch has that name.
 */
export function keptMatches(pattern: string, locals: readonly string[], remote: string | null, remotes: readonly string[]): string[] {
  const here = locals.filter((n) => keepMatches(pattern, n))
  const there = remote ? remotes.filter((n) => keepMatches(pattern, n) && !here.includes(n)).map((n) => `${remote}/${n}`) : []
  return [...here, ...there]
}

export type KeptReason =
  | { kind: 'base' }
  /** One of LONG_LIVED. */
  | { kind: 'everywhere' }
  /** The repository's own list: `rule` is the name itself or the pattern that covers it. */
  | { kind: 'mine'; rule: string }
  | { kind: 'protected'; rule: string }

/** Why Clean up branches never offers `name` (a local branch, or a branch's name on the remote), or null. */
export function keptBy(name: string, base: string, rules: KeepRules): KeptReason | null {
  if (name === base) return { kind: 'base' }
  if (longLived.has(name)) return { kind: 'everywhere' }
  if (rules.mine.includes(name)) return { kind: 'mine', rule: name }
  const shielded = rules.protected.find((p) => keepMatches(p, name))
  if (shielded) return { kind: 'protected', rule: shielded }
  const mine = rules.mine.find((p) => keepMatches(p, name))
  return mine ? { kind: 'mine', rule: mine } : null
}

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
  /** Its name looks like an environment's branch (pre, int, qa…): never ticked for you. */
  environment: boolean
  /** Ticked when the dialog opens, and when its group is ticked. */
  ticked: boolean
}

/** What the dialog's last line names as always kept. */
export interface KeptSummary {
  /** The default branch. */
  base: string
  /** LONG_LIVED names among the local branches. */
  everywhere: string[]
  /** What the service protects, as it wrote it. */
  protected: string[]
  /** The repository's own list (what the service also protects shows once, as protected). */
  mine: string[]
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
  /** Branches always kept, for the dialog's last line. */
  kept: KeptSummary
  /** Branches checked out in another worktree: never offered. */
  inWorktrees: string[]
}

const newestFirst = (a: CleanupItem, b: CleanupItem) => b.date - a.date || a.name.localeCompare(b.name)

/** The base branch to clean up against: the hosting's default branch, else the remote's HEAD, else main/master… */
export function cleanupBase(refs: RefsResult | null, pulls: Pick<RepoPullRequests, 'defaultBranch'> | null, mainLocal: Ref | undefined): string {
  if (pulls?.defaultBranch) return pulls.defaultBranch
  const head = refs?.remotes.find((r) => r.isSymbolic && r.target && r.remote === 'origin') ?? refs?.remotes.find((r) => r.isSymbolic && r.target)
  if (head?.target && head.remote && head.target.startsWith(`${head.remote}/`)) return head.target.slice(head.remote.length + 1)
  return mainLocal?.name ?? 'main'
}

export function cleanupPlan(info: BranchCleanupInfo, pulls: RepoPullRequests | null, rules: KeepRules = NO_KEEP_RULES): CleanupPlan {
  const merged = (pulls?.pulls ?? []).filter((p) => p.state === 'merged')
  const pullFor = (name: string, upstream: string | null, sha: string) =>
    merged.find((p) =>
      p.headFork
        ? forkBranch(p) === name && sameCommit(p.headSha, sha)
        : (upstream ? upstream === `${pulls!.remote}/${p.headRef}` : name === p.headRef) && sameCommit(p.headSha, sha)
    )
  const keep = (name: string) => keptBy(name, info.base, rules) !== null

  const inBase: CleanupItem[] = []
  const gone: CleanupItem[] = []
  // Upstreams of local branches that stay: their remote branches stay too.
  const staying = new Set<string>()
  const inWorktrees: string[] = []
  for (const b of info.local) {
    if (keep(b.name) || b.worktree) {
      if (b.worktree && !keep(b.name)) inWorktrees.push(b.name)
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
      environment: looksLikeEnvironment(b.name),
      ticked: loses === 0 && !isRelease(b.name) && !looksLikeEnvironment(b.name)
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
          environment: looksLikeEnvironment(r.name),
          ticked: !isRelease(r.name) && !looksLikeEnvironment(r.name)
        }))
    : []

  const shielded = rules.protected.filter((p) => p !== info.base)
  const kept: KeptSummary = {
    base: info.base,
    everywhere: info.local.map((b) => b.name).filter((n) => n !== info.base && longLived.has(n)),
    protected: shielded,
    mine: rules.mine.filter((p) => p !== info.base && !shielded.includes(p))
  }
  return { base: info.base, remoteName: info.remoteName, inBase: inBase.sort(newestFirst), gone: gone.sort(newestFirst), remote: remote.sort(newestFirst), kept, inWorktrees }
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
