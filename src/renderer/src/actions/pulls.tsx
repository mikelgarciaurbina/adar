// User-level pull request actions (GitHub): turning them on, creating one (pushing the branch
// first), checking one out, merging it and cleaning up afterwards, bringing the base branch in.
// Everything that touches the repository goes through actions/git so it behaves like the rest.

import { api } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { isGithubRepo, pullIndexOf, usePulls } from '@renderer/components/pulls/pullStore'
import { localBranchFor, pushPlan } from '@renderer/lib/pulls'
import { currentBranch } from '@renderer/lib/refs'
import { pluralize } from '@renderer/lib/format'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { CreatePullOptions, MergeMethod, PullRequest, RepoPullRequests } from '@shared/hosting'
import * as git from './git'

const store = () => useApp.getState()
const tabOf = (repo: string): RepoTab | undefined => store().tabs.find((t) => t.path === repo)
const pulls = () => usePulls.getState()

export const MERGE_LABELS: Record<MergeMethod, { button: string; menu: string; hint: (pr: PullRequest) => string }> = {
  squash: { button: 'Squash and merge', menu: 'Squash and merge', hint: (pr) => `One commit on ${pr.baseRef}` },
  merge: { button: 'Merge', menu: 'Merge commit', hint: (pr) => `The ${pluralize(pr.commitCount || 1, 'commit')} plus a merge commit` },
  rebase: { button: 'Rebase and merge', menu: 'Rebase and merge', hint: (pr) => `The ${pluralize(pr.commitCount || 1, 'commit')}, rebased onto ${pr.baseRef}` }
}

const METHOD_KEY = 'adar.pullMergeMethod'

/** The way of merging used last time, when the repository allows it, else the first one it allows. */
export function preferredMergeMethod(data: Pick<RepoPullRequests, 'mergeMethods'>): MergeMethod {
  let last: string | null = null
  try {
    last = localStorage.getItem(METHOD_KEY)
  } catch {
    /* storage unavailable */
  }
  return data.mergeMethods.find((m) => m === last) ?? data.mergeMethods[0] ?? 'merge'
}

function rememberMergeMethod(method: MergeMethod): void {
  try {
    localStorage.setItem(METHOD_KEY, method)
  } catch {
    /* storage unavailable */
  }
}

export function selectPull(repo: string, number: number): void {
  if (store().rightCollapsed) store().toggleRight()
  store().select(repo, { kind: 'pull', number })
}

/** Turn pull requests on (the sign-in dialog), then run `next`. */
export function openConnect(next?: () => void): void {
  store().openModal({ kind: 'github-connect', next })
}

export async function turnOffPullRequests(): Promise<void> {
  try {
    pulls().setConnection(await api.disconnectGithub())
    toast.success('Pull requests are off')
  } catch (err) {
    toast.error(err)
  }
}

export function openOnGithub(url: string): void {
  api.openExternal(url).catch((err) => toast.error(err))
}

export function copyPullLink(pr: PullRequest): void {
  void git.copyText(pr.url, `Copied the link to #${pr.number}`)
}

/** Open the create dialog for `head` (default: the checked-out branch), or show its pull request when it has one. */
export async function startPullRequest(repo: string, opts: { head?: string; base?: string } = {}): Promise<void> {
  if (!pulls().connection?.method) {
    openConnect(() => void startPullRequest(repo, opts))
    return
  }
  const tab = tabOf(repo)
  if (!isGithubRepo(tab)) {
    toast.warning('This repository has no GitHub remote')
    return
  }
  const head = opts.head ?? currentBranch(tab?.refs ?? null)?.name
  if (!head) {
    toast.warning('Check out a branch to create a pull request from it')
    return
  }
  const data = await pulls().load(repo)
  if (!data) {
    toast.error(pulls().repos[repo]?.error ?? 'Could not read the pull requests')
    return
  }
  const existing = pullIndexOf(data, tabOf(repo)?.refs ?? null).byLocal.get(head)
  if (existing && (existing.state === 'open' || existing.state === 'draft')) {
    selectPull(repo, existing.number)
    toast.info(`${head} already has pull request #${existing.number}`)
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
  if (plan.kind === 'other-remote') throw new Error(`${opts.head} tracks ${plan.upstream}. Pull requests from other remotes are not supported yet.`)
  store().setBusy(`push:${repo}`, plan.kind === 'none' ? 'Creating pull request…' : 'Pushing…')
  try {
    if (plan.kind === 'publish') await api.push(repo, { branch: opts.head, remote: data.remote, remoteBranch: plan.head, setUpstream: true })
    else if (plan.kind === 'push') await api.push(repo, { branch: opts.head })
    store().setBusy(`push:${repo}`, 'Creating pull request…')
    const pr = await api.createPullRequest(repo, { ...opts, head: plan.head })
    toast.success(`Created pull request #${pr.number}`, { actions: [{ label: 'Open on GitHub', onClick: () => openOnGithub(pr.url) }] })
    await pulls().load(repo, { force: true })
    selectPull(repo, pr.number)
    return pr
  } finally {
    store().setBusy(`push:${repo}`, null)
    void git.refresh(repo, ['refs', 'log', 'info'])
  }
}

/** Check out a pull request: its branch, tracking the remote, or pr/<n> for one from a fork. */
export async function checkoutPull(repo: string, pr: PullRequest): Promise<boolean> {
  store().setBusy(`checkout:${repo}`, `Getting #${pr.number}…`)
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

/** Merge on GitHub (after one confirmation), then optionally clean up here. */
export async function mergePull(repo: string, pr: PullRequest, data: RepoPullRequests, method: MergeMethod, cleanUp: boolean): Promise<boolean> {
  const local = localBranchFor(pr, tabOf(repo)?.refs ?? null, data.remote)
  const what =
    method === 'squash'
      ? `${pr.baseRef} gets one commit, “${pr.title} (#${pr.number})”.`
      : method === 'rebase'
        ? `The ${pluralize(pr.commitCount || 1, 'commit')} ${pr.commitCount === 1 ? 'is' : 'are'} added to ${pr.baseRef} one by one.`
        : `${pr.baseRef} gets the ${pluralize(pr.commitCount || 1, 'commit')} and a merge commit.`
  const after = cleanUp && local ? ` Then Adar switches to ${pr.baseRef}, pulls, and deletes ${local.name}.` : ''
  const ok = await confirm({
    title: `${MERGE_LABELS[method].button} #${pr.number} into ${pr.baseRef}?`,
    message: `${what}${after}`,
    confirmLabel: MERGE_LABELS[method].button
  })
  if (!ok) return false
  store().setBusy(`merge-pr:${repo}`, `Merging #${pr.number}…`)
  try {
    await api.mergePullRequest(repo, pr.number, { method, headSha: pr.headSha })
  } catch (err) {
    toast.error(err)
    void pulls().load(repo, { force: true })
    return false
  } finally {
    store().setBusy(`merge-pr:${repo}`, null)
  }
  rememberMergeMethod(method)
  toast.success(`Merged #${pr.number} into ${pr.baseRef}`)
  if (cleanUp && local) await cleanUpAfterMerge(repo, { ...pr, state: 'merged' }, data)
  else {
    await api.fetch(repo, { remote: data.remote, prune: true }).catch(() => undefined)
    void git.refresh(repo)
  }
  void pulls().load(repo, { force: true })
  return true
}

/**
 * After a merge on GitHub: fetch, switch from the pull request's branch to the base branch and pull it,
 * delete the branch here and (unless GitHub already did) on the remote. Undo brings the local branch back.
 */
export async function cleanUpAfterMerge(repo: string, pr: PullRequest, data: RepoPullRequests): Promise<void> {
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
      if (branch.sha === pr.headSha) {
        // Exactly what GitHub merged (a squash or rebase merge leaves it "unmerged" for git): safe to delete.
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
    toast.success(`Cleaned up after #${pr.number}`)
  } catch (err) {
    toast.error(`Could not finish cleaning up: ${describeError(err)}`)
  } finally {
    store().setBusy(`cleanup:${repo}`, null)
    void git.refresh(repo)
  }
}
