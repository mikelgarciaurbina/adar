// "Clean up branches": what can go (after a fetch with prune, with the pull requests' word on squash
// merges), and deleting what the user chose: switching away from the checked-out branch first, one undo
// entry for the local branches, and the count the left panel shows after a fetch. Also the branches it
// never offers: the repository's own list (Never clean up) and what its service protects.

import { useMemo } from 'react'
import { Pin } from 'lucide-react'
import { create } from 'zustand'
import { api } from '@renderer/api/client'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import { toast } from '@renderer/components/common/toast'
import { hostingKnown, hostingOn, repoHosting, usePulls } from '@renderer/components/pulls/pullStore'
import { cleanupBase, cleanupPlan, cleanupSummary, keptBy, type CleanupItem, type CleanupPlan, type KeepRules } from '@renderer/lib/cleanup'
import { currentBranch, defaultRemote, mainBranch } from '@renderer/lib/refs'
import { folderName } from '@renderer/lib/tabGroups'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { PROVIDER_NAMES, type RepoPullRequests } from '@shared/hosting'
import type { BranchCleanupInfo } from '@shared/types'
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

export function openKeptBranches(repo: string): void {
  store().openModal({ kind: 'kept-branches', repo })
}

/** What a repository's service says about its protected branches. */
export interface ProtectedBranches {
  /** "GitHub", "GitLab" or "Bitbucket". */
  service: string
  /**
   * known: `patterns` is its answer; off: pull requests are off for it, so nothing was asked; hidden: it would not
   * say to this sign-in (Bitbucket tells only repository admins); error: it could not be asked (`patterns` is the last answer).
   */
  state: 'known' | 'off' | 'hidden' | 'error'
  patterns: string[]
  error?: string
}

interface ProtectedState {
  /** Per repository; absent until asked, null when it has no GitHub, GitLab or Bitbucket remote. */
  repos: Record<string, ProtectedBranches | null>
}

export const useProtectedBranches = create<ProtectedState>()(() => ({ repos: {} }))

/** Ask the repository's service which branches it protects (only when pull requests are on for it). */
export async function loadProtectedBranches(repo: string): Promise<ProtectedBranches | null> {
  const set = (value: ProtectedBranches | null) => {
    useProtectedBranches.setState((s) => ({ repos: { ...s.repos, [repo]: value } }))
    return value
  }
  const hosting = repoHosting(tabOf(repo))
  if (!hosting || !hostingKnown(hosting)) return set(null)
  const service = PROVIDER_NAMES[hosting.provider]
  if (!hostingOn(hosting)) return set({ service, state: 'off', patterns: [] })
  try {
    const patterns = await api.getProtectedBranches(repo)
    return set(patterns ? { service, state: 'known', patterns } : { service, state: 'hidden', patterns: [] })
  } catch (err) {
    const before = useProtectedBranches.getState().repos[repo]
    return set({ service, state: 'error', patterns: before?.patterns ?? [], error: describeError(err) })
  }
}

/** The repository's keep rules as Adar knows them now. */
export function keepRules(repo: string): KeepRules {
  return { mine: tabOf(repo)?.info?.keptBranches ?? [], protected: useProtectedBranches.getState().repos[repo]?.patterns ?? [] }
}

const NONE: readonly string[] = []

/** keepRules(repo), kept up to date. */
export function useKeepRules(repo: string): KeepRules {
  const mine = useApp((s) => s.tabs.find((t) => t.path === repo)?.info?.keptBranches ?? NONE)
  const shielded = useProtectedBranches((s) => s.repos[repo]?.patterns ?? NONE)
  return useMemo(() => ({ mine, protected: shielded }), [mine, shielded])
}

/** The name the repository goes by in messages: a linked worktree's main repository, since they share the list. */
export function keptIn(repo: string): string {
  const info = tabOf(repo)?.info
  return info?.mainWorktree ? folderName(info.mainWorktree) : (info?.name ?? folderName(repo))
}

/** Keep a branch name or pattern out of Clean up branches, or stop keeping it; a toast offers Undo. */
export async function setKept(repo: string, name: string, keep: boolean, opts: { quiet?: boolean } = {}): Promise<boolean> {
  try {
    await api.keepBranch(repo, name, keep)
  } catch (err) {
    toast.error(err)
    return false
  }
  await git.refresh(repo, ['info'])
  if (opts.quiet) return true
  const tab = tabOf(repo)
  const remote = defaultRemote(tab?.refs ?? null, tab?.info?.remotes.map((r) => r.name) ?? [])
  const undo = [{ label: 'Undo', onClick: () => void setKept(repo, name, !keep, { quiet: true }) }]
  if (keep) toast.success(`${name} is never cleaned up in ${keptIn(repo)}`, { detail: remote ? `Here and on ${remote}` : undefined, actions: undo })
  else toast.success(`${name} can be cleaned up again`, { detail: `Clean up branches offers it once its work is in the main branch`, actions: undo })
  return true
}

/**
 * "Never clean up" for a branch's menu (`name`: a local branch, or the branch's name on the remote): ticked when
 * the repository keeps it, and fixed, with the reason, when something else does (a pattern, the default branch…).
 */
export function keepMenuItem(repo: string, name: string): MenuItem {
  const refs = tabOf(repo)?.refs ?? null
  const base = cleanupBase(refs, usePulls.getState().repos[repo]?.data ?? null, mainBranch(refs))
  const why = keptBy(name, base, keepRules(repo))
  const icon = <Pin size={14} />
  if (!why) return { label: 'Never clean up', icon, onClick: () => void setKept(repo, name, true) }
  if (why.kind === 'mine' && why.rule === name) return { label: 'Never clean up', icon, checked: true, onClick: () => void setKept(repo, name, false) }
  const service = useProtectedBranches.getState().repos[repo]?.service ?? 'the service'
  const reason = why.kind === 'base' ? 'default branch' : why.kind === 'everywhere' ? 'kept everywhere' : why.kind === 'protected' ? `protected on ${service}` : `kept by ${why.rule}`
  return { label: `Never clean up (${reason})`, icon, checked: true, disabled: true }
}

export interface CleanupData {
  info: BranchCleanupInfo
  pulls: RepoPullRequests | null
  fetchError: string | null
}

/**
 * What can be cleaned up in a repository; with `fetch`, after fetching its remote with prune (errors are returned,
 * not thrown). `plan` follows the keep rules of the moment: cleanupPlan(info, pulls, rules) redoes it when they change.
 */
export async function loadCleanupPlan(repo: string, opts: { fetch?: boolean } = {}): Promise<CleanupData & { plan: CleanupPlan }> {
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
  // The count in the left panel uses what the service said last (asked once pull requests are on); the dialog asks again.
  const said = useProtectedBranches.getState().repos[repo]
  const [info] = await Promise.all([
    api.getBranchCleanup(repo, { base: cleanupBase(refs, data, mainBranch(refs)), remote }),
    opts.fetch || !said || said.state === 'off' ? loadProtectedBranches(repo) : null
  ])
  const plan = cleanupPlan(info, data, keepRules(repo))
  useSafeToDelete.getState().setSafe(repo, plan.inBase.map((i) => i.name))
  return { info, pulls: data, fetchError, plan }
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
