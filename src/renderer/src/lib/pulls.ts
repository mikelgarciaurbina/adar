// Pure helpers for pull requests in the UI: which pull request belongs to which branch label,
// and the short texts the chips, the left panel and the details panel show.

import { PROVIDER_NAMES, sameCommit, type HostingProvider, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import type { Ref, RefsResult } from '@shared/types'
import { pluralize } from './format'

export interface PullIndex {
  /** Local branch name → its pull request. */
  byLocal: Map<string, PullRequest>
  /** Remote branch ("origin/feat/x") → its pull request. */
  byRemote: Map<string, PullRequest>
  /** Open and draft pull requests, as GitHub lists them (most recently updated first). */
  open: PullRequest[]
}

const isOpen = (pr: PullRequest) => pr.state === 'open' || pr.state === 'draft'

/**
 * Attach pull requests to branches. An open pull request wins; a merged or closed one only labels
 * a branch that still points at the pull request's last commit (a reused branch name is not its).
 */
export function indexPulls(data: RepoPullRequests | null | undefined, refs: RefsResult | null): PullIndex {
  const index: PullIndex = { byLocal: new Map(), byRemote: new Map(), open: [] }
  if (!data) return index
  const remotes = new Map((refs?.remotes ?? []).map((r) => [r.name, r]))
  const locals = refs?.branches ?? []
  for (const pr of data.pulls) {
    const open = isOpen(pr)
    if (open) index.open.push(pr)
    const fits = (ref: Ref | undefined) => !!ref && (open || sameCommit(ref.sha, pr.headSha))
    if (pr.headFork) {
      const local = locals.find((b) => b.name === forkBranch(pr))
      if (fits(local) && !index.byLocal.has(local!.name)) index.byLocal.set(local!.name, pr)
      continue
    }
    const remoteName = `${data.remote}/${pr.headRef}`
    const remote = remotes.get(remoteName)
    if ((fits(remote) || (open && !remote)) && !index.byRemote.has(remoteName)) index.byRemote.set(remoteName, pr)
    for (const b of locals) {
      const tracks = b.upstream ? b.upstream === remoteName : b.name === pr.headRef
      if (tracks && fits(b) && !index.byLocal.has(b.name)) index.byLocal.set(b.name, pr)
    }
  }
  return index
}

/** The pull request a branch label stands for (a local branch, or a remote branch "origin/x"). */
export function pullForRef(index: PullIndex, ref: Pick<Ref, 'name' | 'type'>): PullRequest | undefined {
  if (ref.type === 'branch') return index.byLocal.get(ref.name)
  if (ref.type === 'remote') return index.byRemote.get(ref.name)
  return undefined
}

/** "GitHub", "GitLab" or "Bitbucket". */
export const providerName = (pr: Pick<PullRequest, 'provider'>) => PROVIDER_NAMES[pr.provider]

/** What the provider calls them: GitLab has merge requests, the others pull requests. */
export const pullNoun = (provider: HostingProvider | null | undefined, plural = false) =>
  `${provider === 'gitlab' ? 'merge request' : 'pull request'}${plural ? 's' : ''}`

/** The same, starting a sentence ("Merge request"). */
export const PullNoun = (provider: HostingProvider | null | undefined, plural = false) => {
  const noun = pullNoun(provider, plural)
  return noun[0].toUpperCase() + noun.slice(1)
}

/** How the provider writes a pull request's number: !12 on GitLab, #12 elsewhere. */
export const pullRef = (pr: Pick<PullRequest, 'provider' | 'number'>) => `${pr.provider === 'gitlab' ? '!' : '#'}${pr.number}`

/** The local branch a pull request from a fork is checked out as: pr/<n> (GitLab: mr/<n>). */
export const forkBranch = (pr: Pick<PullRequest, 'provider' | 'number'>) => `${pr.provider === 'gitlab' ? 'mr' : 'pr'}/${pr.number}`

const isBitbucket = (pr: Pick<PullRequest, 'provider'>) => pr.provider === 'bitbucket-cloud' || pr.provider === 'bitbucket-server'

export function stateLabel(pr: PullRequest): string {
  if (pr.state === 'closed' && isBitbucket(pr)) return 'Declined'
  return { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' }[pr.state]
}

export function checksLabel(pr: PullRequest): string | null {
  // Bitbucket calls them builds; GitLab runs a pipeline of jobs.
  const word = isBitbucket(pr) ? 'build' : pr.provider === 'gitlab' ? 'job' : 'check'
  const all = pr.provider === 'gitlab' ? 'The pipeline' : `${word[0].toUpperCase()}${word.slice(1)}s`
  const failed = pr.checkRuns.filter((c) => c.state === 'failed').length
  const total = pr.checkRuns.length
  switch (pr.checks) {
    case 'passed':
      return total ? (total === 1 ? `The ${word} passed` : `All ${total} ${word}s passed`) : `${all} passed`
    case 'failed':
      return total && failed ? `${failed} of ${pluralize(total, word)} failed` : `${all} failed`
    case 'running': {
      const running = pr.checkRuns.filter((c) => c.state === 'running').length
      return running ? `${running} of ${pluralize(total, word)} running` : `${all} ${pr.provider === 'gitlab' ? 'is' : 'are'} running`
    }
    default:
      return null
  }
}

export function reviewLabel(pr: PullRequest): string | null {
  const names = (list: string[]) => (list.length > 2 ? `${list.slice(0, 2).join(', ')} and ${list.length - 2} more` : list.join(' and '))
  if (pr.changesRequestedBy.length && pr.provider === 'bitbucket-server') return `${names(pr.changesRequestedBy)} marked it as needing work`
  if (pr.changesRequestedBy.length) return `Changes requested by ${names(pr.changesRequestedBy)}`
  // GitLab says that changes were requested, not by whom.
  if (pr.review === 'changes-requested') return 'Changes requested'
  if (pr.review === 'approved') return pr.approvedBy.length ? `Approved by ${names(pr.approvedBy)}` : 'Approved'
  if (pr.reviewRequests.length) return `Waiting for review from ${names(pr.reviewRequests)}`
  if (pr.review === 'review-required') return 'Needs a review'
  if (pr.approvedBy.length) return `Approved by ${names(pr.approvedBy)}`
  return null
}

/** One line for tooltips: "feat/x → main · Mikel Garcia · approved · 4 checks passed". */
export function pullTitle(pr: PullRequest): string {
  const parts = [`${pullRef(pr)} ${pr.title}`, `${pr.headFork ? `${pr.headFork.split('/')[0]}:` : ''}${pr.headRef} → ${pr.baseRef}`, `${stateLabel(pr)} · ${pr.authorName ?? pr.author}`]
  const review = reviewLabel(pr)
  const checks = checksLabel(pr)
  if (pr.reviewRequested) parts.push('Your review is requested')
  else if (review) parts.push(review)
  if (checks) parts.push(checks)
  return parts.join('\n')
}

/** What stands between this pull request and merging it, or null when it can be merged. */
export function mergeBlocker(pr: PullRequest, data: Pick<RepoPullRequests, 'canMerge'>): string | null {
  if (!data.canMerge) return 'You do not have permission to merge in this repository.'
  if (pr.state === 'draft') return `It is a draft. Mark it ready for review on ${providerName(pr)} first.`
  if (pr.mergeable === 'conflicts') return `It conflicts with ${pr.baseRef}.`
  if (pr.checks === 'failed' && pr.mergeBlocked) return `${pr.baseRef} needs passing checks.`
  if (pr.mergeBlocked) return `${pr.baseRef} needs ${pr.checks === 'running' ? 'the checks to finish' : 'an approving review'} first.`
  return null
}

/** A provider's merge checks as one sentence: "Bitbucket says: it conflicts with main, and …" (GitLab: its merge status). */
export function mergeChecksText(reasons: string[], service = 'Bitbucket'): string {
  const parts = reasons
    .map((r) => r.trim().replace(/[.\s]+$/, ''))
    .filter(Boolean)
    // Lower-case the first word unless it is an acronym ("PR", "CI").
    .map((r) => (/^[A-Z][^A-Z]/.test(r) ? r[0].toLowerCase() + r.slice(1) : r))
  if (!parts.length) return `${service} says it cannot be merged yet.`
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
  return `${service} says: ${list}.`
}

/** A title for a new pull request: the only commit's subject, else the branch name in words. */
export function suggestTitle(branch: string, subjects: string[]): string {
  if (subjects.length === 1) return subjects[0]
  const last = branch.split('/').pop() ?? branch
  const words = last.replace(/[-_]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : branch
}

/** A description listing the branch's commits (oldest first) when there are several. */
export function suggestBody(subjects: string[]): string {
  return subjects.length > 1 ? [...subjects].reverse().map((s) => `- ${s}`).join('\n') : ''
}

/** What creating a pull request for a local branch needs first, and its name on the remote. */
export type PushPlan =
  /** Already on the remote as `head`. */
  | { kind: 'none'; head: string }
  /** Not on the remote yet: pushed (and tracked) under its own name. */
  | { kind: 'publish'; head: string }
  /** `ahead` commits to push first. */
  | { kind: 'push'; head: string; ahead: number }
  /** The remote branch has commits the local one does not: pull first. */
  | { kind: 'behind'; head: string; behind: number }
  /** Tracks a branch on another remote (pull requests between forks are not supported). */
  | { kind: 'other-remote'; head: string; upstream: string }

export function pushPlan(branch: Pick<Ref, 'name' | 'upstream' | 'upstreamGone' | 'ahead' | 'behind'>, remote: string): PushPlan {
  const up = branch.upstream
  if (!up || branch.upstreamGone) return { kind: 'publish', head: branch.name }
  if (!up.startsWith(remote + '/')) return { kind: 'other-remote', head: branch.name, upstream: up }
  const head = up.slice(remote.length + 1)
  if (branch.behind) return { kind: 'behind', head, behind: branch.behind }
  if (branch.ahead) return { kind: 'push', head, ahead: branch.ahead }
  return { kind: 'none', head }
}

/** The local branch a pull request was checked out as (its own branch, or pr/<n> / mr/<n> for a fork). */
export function localBranchFor(pr: PullRequest, refs: RefsResult | null, remote: string): Ref | undefined {
  const branches = refs?.branches ?? []
  if (pr.headFork) return branches.find((b) => b.name === forkBranch(pr))
  return branches.find((b) => b.upstream === `${remote}/${pr.headRef}`) ?? branches.find((b) => b.name === pr.headRef && !b.upstream)
}
