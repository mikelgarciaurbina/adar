// Words for the reflog view: what left each group of lost commits behind, how long git keeps them,
// and a name for a branch that brings them back. Pure.

import type { LostCommit, LostGroup, ReflogEntry, ReflogKind } from '@shared/types'

export const KIND_LABEL: Record<LostGroup['kind'], string> = {
  reset: 'Reset',
  deleted: 'Branch deleted',
  detached: 'No branch',
  rewritten: 'Rewritten',
  other: 'Left behind'
}

export const MOVE_LABEL: Record<ReflogKind, string> = {
  commit: 'commit',
  amend: 'amend',
  reset: 'reset',
  checkout: 'checkout',
  merge: 'merge',
  rebase: 'rebase',
  pull: 'pull',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
  branch: 'branch',
  other: 'other'
}

/** What a move did when git's words only repeat the commit's subject (a commit, an amend…). */
const SAME_AS_SUBJECT: Partial<Record<ReflogKind, string>> = { commit: 'new commit', amend: 'amended', 'cherry-pick': 'picked', revert: 'reverted' }

/** The "What happened" of a move. */
export function moveDetail(m: Pick<ReflogEntry, 'kind' | 'detail' | 'subject'>): string {
  return (m.detail === m.subject && SAME_AS_SUBJECT[m.kind]) || m.detail
}

const short = (sha: string | null | undefined) => (sha ?? '').slice(0, 7)
const commits = (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`

/** "main moved back 3 commits", "feat/old-cards was deleted with 4 commits"… */
export function groupTitle(g: LostGroup): string {
  const n = g.commits.length
  switch (g.kind) {
    case 'reset':
      return `${g.branch ?? 'HEAD'} moved back ${commits(n)}`
    case 'deleted':
      return `${g.branch} was deleted with ${commits(n)}`
    case 'detached':
      return `${commits(n)} made on a detached HEAD`
    case 'rewritten':
      return n === 1 ? 'An old version of a commit you rewrote' : `${n} old versions of commits you rewrote`
    default:
      return `${commits(n)} left behind`
  }
}

/** Where the move went: "moving from feat to main" → main; "moving to HEAD~3" → HEAD~3. */
export function moveTarget(move: string): string | null {
  return /moving (?:from .+ )?to (.+)$/.exec(move)?.[1]?.replace(/^refs\/heads\//, '') ?? null
}

/** The line under a group's title. */
export function groupDetail(g: LostGroup): string {
  const to = moveTarget(g.move)
  switch (g.kind) {
    case 'reset':
      return `From ${short(g.commits[0]?.sha)} to ${short(g.to)}${to && !/^[0-9a-f]{7,64}$/.test(to) ? ` (reset to ${to})` : ''}`
    case 'deleted':
      return `Its last commit, ${short(g.commits[0]?.sha)}, was checked out before you left it${to ? ` for ${to}` : ''}`
    case 'detached':
      return to ? `Then you checked out ${to}` : 'No branch was checked out'
    case 'rewritten':
      return /amend/.test(g.move) ? 'Amended: the new version is on the branch' : 'Rebased: the new versions are on the branch'
    default:
      return g.move || 'No reflog says what left it behind'
  }
}

/** "kept 24 more days", or what to say when git may forget them at its next cleanup. */
export function keptText(daysLeft: number | null): string | null {
  if (daysLeft === null) return null
  if (daysLeft <= 0) return 'git may forget them at its next cleanup'
  return `kept ${daysLeft} more ${daysLeft === 1 ? 'day' : 'days'}`
}

/** "6 old versions of commits you amended or rebased". */
export function rewrittenText(n: number): string {
  return n === 1 ? '1 old version of a commit you amended or rebased' : `${n} old versions of commits you amended or rebased`
}

/** Groups to show, then the rewritten ones (folded away). */
export function splitGroups(groups: readonly LostGroup[]): { shown: LostGroup[]; rewritten: LostGroup[] } {
  return { shown: groups.filter((g) => g.kind !== 'rewritten'), rewritten: groups.filter((g) => g.kind === 'rewritten') }
}

/** A branch name for recovered commits: recovered/<the commit's subject>, free in this repository. */
export function recoveredName(commit: Pick<LostCommit, 'sha' | 'subject'>, taken: ReadonlySet<string>): string {
  const slug = commit.subject
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  const base = `recovered/${slug || short(commit.sha)}`
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

/** The group a commit is lost in. */
export function groupOf(groups: readonly LostGroup[] | undefined, sha: string): LostGroup | undefined {
  return groups?.find((g) => g.commits.some((c) => c.sha === sha))
}
