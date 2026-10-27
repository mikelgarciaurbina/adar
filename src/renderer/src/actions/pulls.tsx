// User-level pull request actions (GitHub, GitLab and Bitbucket): turning them on, creating one (pushing the
// branch first), checking one out, merging it and cleaning up afterwards, bringing the base branch in.
// Everything that touches the repository goes through actions/git so it behaves like the rest.

import { api } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { hostingOn, pullIndexOf, repoHosting, usePulls, type RepoHosting } from '@renderer/components/pulls/pullStore'
import { localBranchFor, providerName, pullNoun, pullRef, pushPlan } from '@renderer/lib/pulls'
import { currentBranch } from '@renderer/lib/refs'
import { pluralize } from '@renderer/lib/format'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { sameCommit, type CreatePullOptions, type HostingProvider, type MergeMethod, type PullRequest, type RepoPullRequests } from '@shared/hosting'
import * as git from './git'
import { finishWorktree, useWorktrees } from './worktrees'
import { folderName } from '@renderer/lib/tabGroups'

const store = () => useApp.getState()
const tabOf = (repo: string): RepoTab | undefined => store().tabs.find((t) => t.path === repo)
const pulls = () => usePulls.getState()

const commits = (pr: PullRequest) => (pr.commitCount ? pluralize(pr.commitCount, 'commit') : 'commits')

export const MERGE_LABELS: Record<MergeMethod, { button: string; menu: string; hint: (pr: PullRequest) => string }> = {
  squash: { button: 'Squash and merge', menu: 'Squash and merge', hint: (pr) => `One commit on ${pr.baseRef}` },
  merge: { button: 'Merge', menu: 'Merge commit', hint: (pr) => `The ${commits(pr)} plus a merge commit` },
  rebase: { button: 'Rebase and merge', menu: 'Rebase and merge', hint: (pr) => `The ${commits(pr)}, rebased onto ${pr.baseRef}` },
  'fast-forward': { button: 'Fast-forward', menu: 'Fast-forward', hint: (pr) => `The ${commits(pr)} as they are, only if ${pr.baseRef} has not moved` }
}

/** The merge menu's label: Bitbucket's and GitLab's own names for their ways of merging. */
export function mergeMenuLabel(method: MergeMethod, provider: HostingProvider): string {
  if (provider === 'github') return MERGE_LABELS[method].menu
  if (provider === 'gitlab') return { merge: 'Merge commit', squash: 'Squash commits', rebase: 'Rebase', 'fast-forward': 'Fast-forward merge' }[method]
  return { merge: 'Merge commit', squash: 'Squash', rebase: 'Rebase', 'fast-forward': 'Fast-forward' }[method]
}

const methodKey = (provider: HostingProvider) => `adar.pullMergeMethod.${provider}`

/** The way of merging used last time with this provider, when the repository allows it, else its first (default) one. */
export function preferredMergeMethod(data: Pick<RepoPullRequests, 'mergeMethods' | 'provider'>): MergeMethod {
  let last: string | null = null
  try {
    last = localStorage.getItem(methodKey(data.provider))
  } catch {
    /* storage unavailable */
  }
  return data.mergeMethods.find((m) => m === last) ?? data.mergeMethods[0] ?? 'merge'
}

function rememberMergeMethod(method: MergeMethod, provider: HostingProvider): void {
  try {
    localStorage.setItem(methodKey(provider), method)
  } catch {
    /* storage unavailable */
  }
}

export function selectPull(repo: string, number: number): void {
  if (store().rightCollapsed) store().toggleRight()
  store().select(repo, { kind: 'pull', number })
}

/** Turn pull requests on for a repository's hosting, or for GitHub (the sign-in dialog), then run `next`. */
export function openConnect(hosting: Pick<RepoHosting, 'provider' | 'server' | 'host'> | null = null, next?: () => void): void {
  store().openModal({
    kind: 'pulls-connect',
    provider: hosting?.provider ?? 'github',
    server: hosting?.server,
    remoteHost: hosting?.provider === 'bitbucket-server' || hosting?.provider === 'gitlab' ? hosting.host : undefined,
    next
  })
}

export async function turnOffPullRequests(): Promise<void> {
  try {
    pulls().setConnection(await api.disconnectGithub())
    toast.success('GitHub pull requests are off')
  } catch (err) {
    toast.error(err)
  }
}

/** Take the Bitbucket and GitLab settings the backend changed (servers decide which remotes count as theirs). */
export async function syncHostingSettings(): Promise<void> {
  const s = await api.getSettings()
  useApp.setState((st) => ({
    settings: { ...st.settings, bitbucketAuth: s.bitbucketAuth, bitbucketEmail: s.bitbucketEmail, bitbucketServers: s.bitbucketServers, gitlabServers: s.gitlabServers }
  }))
}

export async function turnOffBitbucket(target: { kind: 'cloud' } | { kind: 'server'; url: string }): Promise<void> {
  try {
    pulls().setBitbucket(await api.disconnectBitbucket(target))
    await syncHostingSettings()
    toast.success(target.kind === 'cloud' ? 'Bitbucket pull requests are off' : `Pull requests from ${new URL(target.url).host} are off`)
  } catch (err) {
    toast.error(err)
  }
}

export async function turnOffGitlab(url: string): Promise<void> {
  try {
    pulls().setGitlab(await api.disconnectGitlab(url))
    await syncHostingSettings()
    toast.success(`Merge requests from ${new URL(url).host} are off`)
  } catch (err) {
    toast.error(err)
  }
}

export function openWebPage(url: string): void {
  api.openExternal(url).catch((err) => toast.error(err))
}

export function copyPullLink(pr: PullRequest): void {
  void git.copyText(pr.url, `Copied the link to ${pullRef(pr)}`)
}

/** Open the create dialog for `head` (default: the checked-out branch), or show its pull request when it has one. */
export async function startPullRequest(repo: string, opts: { head?: string; base?: string } = {}): Promise<void> {
  const tab = tabOf(repo)
  const hosting = repoHosting(tab)
  if (!hosting) {
    toast.warning('This repository has no GitHub, GitLab or Bitbucket remote')
    return
  }
  if (!hostingOn(hosting)) {
    openConnect(hosting, () => void startPullRequest(repo, opts))
    return
  }
  const head = opts.head ?? currentBranch(tab?.refs ?? null)?.name
  if (!head) {
    toast.warning(`Check out a branch to create a ${pullNoun(hosting.provider)} from it`)
    return
  }
  const data = await pulls().load(repo)
  if (!data) {
    toast.error(pulls().repos[repo]?.error ?? `Could not read the ${pullNoun(hosting.provider, true)}`)
    return
  }
  const existing = pullIndexOf(data, tabOf(repo)?.refs ?? null).byLocal.get(head)
  if (existing && (existing.state === 'open' || existing.state === 'draft')) {
    selectPull(repo, existing.number)
    toast.info(`${head} already has ${pullNoun(existing.provider)} ${pullRef(existing)}`)
    return
  }
  store().openModal({ kind: 'create-pull', repo, head, base: opts.base })
}

/** Push the branch when needed, then create the pull request. Throws (with a message for the dialog) on failure. */
export async function createPullRequest(repo: string, data: RepoPullRequests, opts: CreatePullOptions): Promise<PullRequest> {
  const branch = tabOf(repo)?.refs?.branches.find((b) => b.name === opts.head)
  if (!branch) throw new Error(`${opts.head} is not a local branch`)
  const plan = pushPlan(branch, data.remote)
  if (plan.kind === 'behind') throw new Error(`${data.remote}/${plan.head} has ${pluralize(plan.behind, 'commit')} that ${opts.head} does not have. Pull first.`)
  const noun = pullNoun(data.provider)
  if (plan.kind === 'other-remote') throw new Error(`${opts.head} tracks ${plan.upstream}. ${noun[0].toUpperCase()}${noun.slice(1)}s from other remotes are not supported yet.`)
  store().setBusy(`push:${repo}`, plan.kind === 'none' ? `Creating ${noun}…` : 'Pushing…')
  try {
    if (plan.kind === 'publish') await api.push(repo, { branch: opts.head, remote: data.remote, remoteBranch: plan.head, setUpstream: true })
    else if (plan.kind === 'push') await api.push(repo, { branch: opts.head })
    store().setBusy(`push:${repo}`, `Creating ${noun}…`)
    const pr = await api.createPullRequest(repo, { ...opts, head: plan.head })
    toast.success(`Created ${noun} ${pullRef(pr)}`, { actions: [{ label: `Open on ${providerName(pr)}`, onClick: () => openWebPage(pr.url) }] })
    await pulls().load(repo, { force: true })
    selectPull(repo, pr.number)
    return pr
  } finally {
    store().setBusy(`push:${repo}`, null)
    void git.refresh(repo, ['refs', 'log', 'info'])
  }
}

/** Check out a pull request: its branch, tracking the remote, or pr/<n> (GitLab: mr/<n>) for one from a fork. */
export async function checkoutPull(repo: string, pr: PullRequest): Promise<boolean> {
  store().setBusy(`checkout:${repo}`, `Getting ${pullRef(pr)}…`)
  let branch: string
  try {
    branch = await api.pullRequestBranch(repo, pr.number)
  } catch (err) {
    toast.error(err)
    return false
  } finally {
    store().setBusy(`checkout:${repo}`, null)
  }
  return git.checkout(repo, branch)
}

/** Merge the base branch into the pull request's branch here (conflicts open in the conflict view); then Push. */
export async function bringBaseIn(repo: string, pr: PullRequest, data: RepoPullRequests): Promise<void> {
  const refs = tabOf(repo)?.refs ?? null
  const local = localBranchFor(pr, refs, data.remote)
  if (!local) {
    if (!(await checkoutPull(repo, pr))) return
  } else if (!local.isHead && !(await git.checkout(repo, local.name))) return
  try {
    await api.fetch(repo, { remote: data.remote })
  } catch (err) {
    toast.error(err)
    return
  }
  await git.merge(repo, `${data.remote}/${pr.baseRef}`)
}

/** Merge on the provider (after one confirmation), then optionally clean up here. */
export async function mergePull(repo: string, pr: PullRequest, data: RepoPullRequests, method: MergeMethod, cleanUp: boolean): Promise<boolean> {
  const local = localBranchFor(pr, tabOf(repo)?.refs ?? null, data.remote)
  const what = {
    // Bitbucket and GitLab write their own message for the squashed commit.
    squash: pr.provider === 'github' ? `${pr.baseRef} gets one commit, “${pr.title} (#${pr.number})”.` : `${pr.baseRef} gets one commit with the changes of the ${commits(pr)}.`,
    rebase: `The ${commits(pr)} ${pr.commitCount === 1 ? 'is' : 'are'} added to ${pr.baseRef} one by one.`,
    merge: `${pr.baseRef} gets the ${commits(pr)} and a merge commit.`,
    'fast-forward': `${pr.baseRef} moves forward to the ${commits(pr)} as they are.`
  }[method]
  const tab = tabOf(repo)
  const inWorktree = !!tab?.info?.mainWorktree && !!local?.isHead
  const after = !cleanUp || !local
    ? ''
    : inWorktree
      ? ` Then Adar removes the worktree ${tab!.name} and its folder, deletes ${local.name} here${!pr.headFork && !data.deleteBranchOnMerge ? ` and on ${data.remote}` : ''}, and takes you to ${folderName(tab!.info!.mainWorktree!)} with ${pr.baseRef} pulled.`
      : ` Then Adar switches to ${pr.baseRef}, pulls, and deletes ${local.name}.`
  const ok = await confirm({
    title: `${MERGE_LABELS[method].button} ${pullRef(pr)} into ${pr.baseRef}?`,
    message: `${what}${after}`,
    confirmLabel: MERGE_LABELS[method].button
  })
  if (!ok) return false
  store().setBusy(`merge-pr:${repo}`, `Merging ${pullRef(pr)}…`)
  try {
    await api.mergePullRequest(repo, pr.number, { method, headSha: pr.headSha })
  } catch (err) {
    toast.error(err)
    void pulls().load(repo, { force: true })
    return false
  } finally {
    store().setBusy(`merge-pr:${repo}`, null)
  }
  rememberMergeMethod(method, data.provider)
  toast.success(`Merged ${pullRef(pr)} into ${pr.baseRef}`)
  if (cleanUp && local) await cleanUpAfterMerge(repo, { ...pr, state: 'merged' }, data)
  else {
    await api.fetch(repo, { remote: data.remote, prune: true }).catch(() => undefined)
    void git.refresh(repo)
  }
  void pulls().load(repo, { force: true })
  return true
}

/**
 * After a merge on the provider: fetch, switch from the pull request's branch to the base branch and pull it,
 * delete the branch here and (unless the provider already did) on the remote. Undo brings the local branch back.
 */
export async function cleanUpAfterMerge(repo: string, pr: PullRequest, data: RepoPullRequests): Promise<void> {
  // In a linked worktree that has the branch, the base branch cannot be checked out (the main folder has it):
  // remove the worktree instead.
  const tab = tabOf(repo)
  const here = localBranchFor(pr, tab?.refs ?? null, data.remote)
  if (tab?.info?.mainWorktree && here?.isHead) {
    const changes = (await useWorktrees.getState().load(repo)).find((w) => w.isCurrent)?.changes ?? 0
    // Uncommitted changes are never dropped unasked: the merged pull request's panel offers "Remove anyway".
    if (changes > 0) toast.warning(`${tab.name} has changes that are not committed, so the worktree stays`)
    else await finishWorktree(repo, { path: repo, name: tab.name, branch: here.name, changes }, pr, data)
    return
  }
  const remote = data.remote
  store().setBusy(`cleanup:${repo}`, 'Cleaning up…')
  try {
    await api.fetch(repo, { remote, prune: true }).catch(() => undefined)
    await git.refresh(repo, ['refs', 'info'])
    let refs = tabOf(repo)?.refs ?? null
    const local = localBranchFor(pr, refs, remote)
    if (local?.isHead) {
      const base = refs?.branches.find((b) => b.upstream === `${remote}/${pr.baseRef}`) ?? refs?.branches.find((b) => b.name === pr.baseRef)
      const baseRemote = refs?.remotes.find((r) => r.name === `${remote}/${pr.baseRef}`)
      const switched = base ? await git.checkout(repo, base.name, { silent: true }) : baseRemote ? await git.checkoutRemote(repo, baseRemote) : false
      if (!switched) return
      await git.refresh(repo, ['refs', 'info'])
      if (currentBranch(tabOf(repo)?.refs ?? null)?.upstream) await git.pull(repo)
      refs = tabOf(repo)?.refs ?? null
    }
    const branch = local ? refs?.branches.find((b) => b.name === local.name) : undefined
    if (branch) {
      if (sameCommit(branch.sha, pr.headSha)) {
        // Exactly what the provider merged (a squash or rebase merge leaves it "unmerged" for git): safe to delete.
        await api.deleteBranch(repo, branch.name, { force: true })
        store().pushHistory(repo, {
          label: `Delete branch ${branch.name}`,
          undo: async () => {
            await api.createBranch(repo, branch.name, branch.sha, { checkout: false })
            await git.refresh(repo)
          },
          redo: async () => {
            await api.deleteBranch(repo, branch.name, { force: true })
            await git.refresh(repo)
          }
        })
      } else await git.deleteBranch(repo, branch)
    }
    const remoteRef = refs?.remotes.find((r) => r.name === `${remote}/${pr.headRef}`)
    if (!pr.headFork && remoteRef && !data.deleteBranchOnMerge) {
      await api.deleteRemoteBranch(repo, remote, pr.headRef).catch(() => undefined)
    }
    toast.success(`Cleaned up after ${pullRef(pr)}`)
  } catch (err) {
    toast.error(`Could not finish cleaning up: ${describeError(err)}`)
  } finally {
    store().setBusy(`cleanup:${repo}`, null)
    void git.refresh(repo)
  }
}

/** Delete the local branch of a pull request that was closed (declined) without merging. */
export async function deleteClosedBranch(repo: string, pr: PullRequest, data: RepoPullRequests): Promise<void> {
  const branch = localBranchFor(pr, tabOf(repo)?.refs ?? null, data.remote)
  if (branch) await git.deleteBranch(repo, branch)
}
