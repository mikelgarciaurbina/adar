// "Clean up branches": what can go (after a fetch with prune, with the pull requests' word on squash
// merges), and deleting what the user chose: switching away from the checked-out branch first, one undo
// entry for the local branches, and the count the left panel shows after a fetch.

import { create } from 'zustand'
import { api } from '@renderer/api/client'
import { toast } from '@renderer/components/common/toast'
import { usePulls } from '@renderer/components/pulls/pullStore'
import { cleanupBase, cleanupPlan, cleanupSummary, type CleanupItem, type CleanupPlan } from '@renderer/lib/cleanup'
import { currentBranch, defaultRemote, mainBranch } from '@renderer/lib/refs'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import * as git from './git'

const store = () => useApp.getState()
const tabOf = (repo: string) => store().tabs.find((t) => t.path === repo)

interface SafeToDelete {
  /** Per repository: local branches that can go without losing anything (the left panel counts them). */
  safe: Record<string, string[]>
  setSafe(repo: string, names: string[]): void
}

export const useSafeToDelete = create<SafeToDelete>()((set) => ({
  safe: {},
  setSafe: (repo, names) => set((s) => (s.safe[repo]?.join('\0') === names.join('\0') ? s : { safe: { ...s.safe, [repo]: names } }))
}))

export function openBranchCleanup(repo: string): void {
  store().openModal({ kind: 'branch-cleanup', repo })
}

/** What can be cleaned up in a repository; with `fetch`, after fetching its remote with prune (errors are returned, not thrown). */
export async function loadCleanupPlan(repo: string, opts: { fetch?: boolean } = {}): Promise<{ plan: CleanupPlan; fetchError: string | null }> {
  const remotes = tabOf(repo)?.info?.remotes.map((r) => r.name) ?? []
  let data = usePulls.getState().repos[repo]?.data ?? null
  const remote = data?.remote ?? defaultRemote(tabOf(repo)?.refs ?? null, remotes)
  let fetchError: string | null = null
  if (opts.fetch && remote) {
    try {
      await api.fetch(repo, { remote, prune: true })
    } catch (err) {
      fetchError = describeError(err)
    }
    await git.refresh(repo, ['refs', 'log', 'info'])
    data = (await usePulls.getState().load(repo, { force: true })) ?? data
  }
  const refs = tabOf(repo)?.refs ?? null
  const info = await api.getBranchCleanup(repo, { base: cleanupBase(refs, data, mainBranch(refs)), remote })
  const plan = cleanupPlan(info, data)
  useSafeToDelete.getState().setSafe(repo, plan.inBase.map((i) => i.name))
  return { plan, fetchError }
}

/** Delete the chosen branches (local ones forced: their work is in the base branch, or the user said so). */
export async function cleanUpBranches(repo: string, plan: CleanupPlan, chosen: CleanupItem[]): Promise<void> {
  const local = chosen.filter((i) => i.scope === 'local')
  const remote = plan.remoteName ? chosen.filter((i) => i.scope === 'remote') : []
  if (!local.length && !remote.length) return

  // Git cannot delete the checked-out branch: switch to the base branch and pull it, as after a merged pull request.
  if (local.some((i) => i.isHead)) {
    const refs = tabOf(repo)?.refs ?? null
    const base = refs?.branches.find((b) => b.name === plan.base)
    const baseRemote = plan.remoteName ? refs?.remotes.find((r) => r.name === `${plan.remoteName}/${plan.base}`) : undefined
    const switched = base ? await git.checkout(repo, base.name, { silent: true }) : baseRemote ? await git.checkoutRemote(repo, baseRemote) : false
    if (!switched) {
      toast.warning(`Nothing was deleted: Adar could not switch to ${plan.base}`)
      return
    }
    await git.refresh(repo, ['refs', 'info'])
    if (currentBranch(tabOf(repo)?.refs ?? null)?.upstream) await git.pull(repo)
  }

  const upstreams = new Map((tabOf(repo)?.refs?.branches ?? []).map((b) => [b.name, b.upstreamGone ? undefined : b.upstream]))
  const deleted: Array<CleanupItem & { upstream?: string }> = []
  const deletedRemote: CleanupItem[] = []
  const failed: string[] = []
  store().setBusy(`cleanup:${repo}`, 'Cleaning up branches…')
  try {
    for (const i of local) {
      try {
        await api.deleteBranch(repo, i.name, { force: true })
        deleted.push({ ...i, upstream: upstreams.get(i.name) })
      } catch (err) {
        failed.push(`${i.label}: ${describeError(err)}`)
      }
    }
    for (const i of remote) {
      try {
        await api.deleteRemoteBranch(repo, plan.remoteName!, i.name)
        deletedRemote.push(i)
      } catch (err) {
        failed.push(`${i.label}: ${describeError(err)}`)
      }
    }
  } finally {
    store().setBusy(`cleanup:${repo}`, null)
  }

  if (deleted.length) {
    store().pushHistory(repo, {
      label: deleted.length === 1 ? `Delete branch ${deleted[0].name}` : `Delete ${deleted.length} branches`,
      undo: async () => {
        for (const b of deleted) {
          await api.createBranch(repo, b.name, b.sha, { checkout: false })
          if (b.upstream) await api.setUpstream(repo, b.name, b.upstream).catch(() => undefined)
        }
        await git.refresh(repo)
      },
      redo: async () => {
        for (const b of deleted) await api.deleteBranch(repo, b.name, { force: true })
        await git.refresh(repo)
      }
    })
  }
  const summary = cleanupSummary(deleted.length, deletedRemote.length, plan.remoteName)
  const undo = deleted.length ? [{ label: 'Undo', onClick: () => void git.undo(repo) }] : undefined
  if (failed.length) toast.warning(`${summary}. ${failed.length === 1 ? 'One' : failed.length} could not be deleted.`, { detail: failed.join('\n'), actions: undo })
  else toast.success(summary, { detail: deleted.length && deletedRemote.length ? `Undo brings back the ${deleted.length} local ones` : deleted.map((b) => b.name).join(', '), actions: undo })

  useSafeToDelete.getState().setSafe(
    repo,
    plan.inBase.filter((i) => !deleted.some((d) => d.key === i.key)).map((i) => i.name)
  )
  await git.refresh(repo)
}
