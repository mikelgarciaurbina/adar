// Worktrees: each repository's list (refreshed with its refs), opening one in a tab (joining the group
// of the tab it came from), creating one for a branch, a new branch or a pull request, removing (with
// undo), locking, forgetting the ones whose folder is gone, and finishing one after its pull request
// is merged: remove it and its branch, and go back to the main folder with the base branch pulled.

import { TriangleAlert } from 'lucide-react'
import { create } from 'zustand'
import { api } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { pullRef } from '@renderer/lib/pulls'
import { folderName, groupOf } from '@renderer/lib/tabGroups'
import { worktreeFolder } from '@renderer/lib/worktrees'

export { worktreeFolder }
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { PullRequest, RepoPullRequests } from '@shared/hosting'
import type { Worktree } from '@shared/types'
import * as git from './git'

const store = () => useApp.getState()
const tabOf = (repo: string) => store().tabs.find((t) => t.path === repo)

interface WorktreesState {
  /** Per repository tab: its worktrees, the main one first. */
  lists: Record<string, Worktree[]>
  load(repo: string): Promise<Worktree[]>
}

export const useWorktrees = create<WorktreesState>()((set) => ({
  lists: {},
  async load(repo) {
    try {
      const list = await api.getWorktrees(repo)
      set((s) => ({ lists: { ...s.lists, [repo]: list } }))
      return list
    } catch {
      return []
    }
  }
}))

/** Reload the worktree lists of every open tab of the same repository (they share their worktrees). */
function reloadAll(main: string): void {
  for (const t of store().tabs) if (t.path === main || t.info?.mainWorktree === main) void useWorktrees.getState().load(t.path)
}

/** The main worktree of a repository tab (the tab itself when it is the main one). */
export const mainWorktreeOf = (repo: string): string => tabOf(repo)?.info?.mainWorktree ?? repo


/** Open a worktree in a tab (or switch to it), in the group of the tab it was opened from. */
export async function openWorktree(from: string, path: string): Promise<boolean> {
  try {
    const group = groupOf(store().settings.tabGroups, from)?.id ?? null
    const opened = await store().openRepo(path)
    if (group && !groupOf(store().settings.tabGroups, opened)) store().setTabGroup(opened, group)
    return true
  } catch (err) {
    toast.error(err)
    return false
  }
}

export function newWorktree(repo: string, branch?: string): void {
  store().openModal({ kind: 'new-worktree', repo, branch })
}

/** Create a worktree (throws, for the dialog to show), then open it when asked. */
export async function createWorktree(repo: string, opts: { branch: string; from?: string; track?: boolean; path: string; open: boolean }): Promise<string> {
  const path = await api.addWorktree(repo, { path: opts.path, branch: opts.branch, from: opts.from, track: opts.track })
  toast.success(`Created worktree ${folderName(path)}`, { detail: `${opts.branch}${opts.open ? ' · opened in a new tab' : ''}` })
  void git.refresh(repo, ['refs'])
  reloadAll(mainWorktreeOf(repo))
  if (opts.open) await openWorktree(repo, path)
  return path
}

/** Check a pull request out in a new worktree next to the main one, and open it. */
export async function worktreeForPull(repo: string, pr: PullRequest): Promise<void> {
  store().setBusy(`checkout:${repo}`, `Getting ${pullRef(pr)}…`)
  try {
    const branch = await api.pullRequestBranch(repo, pr.number)
    for (let attempt = 1; ; attempt++) {
      try {
        await createWorktree(repo, { branch, path: worktreeFolder(mainWorktreeOf(repo), branch, attempt), open: true })
        return
      } catch (err) {
        if (attempt < 5 && /already exists/.test(describeError(err))) continue
        throw err
      }
    }
  } catch (err) {
    toast.error(err)
  } finally {
    store().setBusy(`checkout:${repo}`, null)
  }
}

/** "x is checked out elsewhere": offer to open that worktree instead. */
export async function offerBusyBranch(repo: string, branch: string, path: string): Promise<void> {
  const name = folderName(path)
  const ok = await confirm({
    title: `${branch} is checked out elsewhere`,
    message: `It is checked out in the worktree ${name} (${path}), and git keeps a branch in one worktree at a time.`,
    confirmLabel: `Open ${name}`
  })
  if (ok) await openWorktree(repo, path)
}

/** The tab showing a worktree, if one is open. */
const tabAt = (path: string) => store().tabs.find((t) => t.path === path)

async function closeTabOf(path: string): Promise<void> {
  if (tabAt(path)) await store().closeTab(path)
}

/** Remove a worktree after one confirmation (which names the files it would lose). */
export async function removeWorktree(repo: string, wt: Worktree): Promise<void> {
  const dirty = (wt.changes ?? 0) > 0
  const ok = await confirm({
    title: `Remove worktree ${wt.name}?`,
    message: (
      <>
        Its folder <strong>{wt.path}</strong> is deleted.
        {wt.branch && (
          <>
            {' '}
            The branch <strong>{wt.branch}</strong> stays, with all its commits.
          </>
        )}
        {dirty && (
          <span className="md-cleanup-warn" role="alert" style={{ marginTop: 12 }}>
            <TriangleAlert size={15} />
            <span>{changesText(wt)} Removing the worktree loses them.</span>
          </span>
        )}
      </>
    ),
    confirmLabel: dirty ? 'Remove anyway' : 'Remove',
    danger: true
  })
  if (!ok) return
  const main = mainWorktreeOf(repo)
  try {
    await closeTabOf(wt.path)
    await api.removeWorktree(main, wt.path, { force: dirty })
  } catch (err) {
    toast.error(err)
    reloadAll(main)
    return
  }
  const branch = wt.branch
  if (branch) {
    store().pushHistory(main, {
      label: `Remove worktree ${wt.name}`,
      undo: async () => {
        await api.addWorktree(main, { path: wt.path, branch })
        reloadAll(main)
        await git.refresh(main, ['refs'])
      },
      redo: async () => {
        await api.removeWorktree(main, wt.path, { force: true })
        reloadAll(main)
        await git.refresh(main, ['refs'])
      }
    })
  }
  toast.success(`Removed worktree ${wt.name}`, { detail: branch ? `${branch} stays` : undefined, actions: branch ? [{ label: 'Undo', onClick: () => void git.undo(main) }] : undefined })
  reloadAll(main)
  void git.refresh(main, ['refs'])
}

/** "2 files have changes that are not committed: a.ts, b.ts." */
export function changesText(wt: Pick<Worktree, 'changes' | 'changedFiles'>): string {
  const n = wt.changes ?? 0
  const more = n > wt.changedFiles.length ? ` and ${n - wt.changedFiles.length} more` : ''
  return `${n === 1 ? '1 file has' : `${n} files have`} changes that are not committed: ${wt.changedFiles.join(', ')}${more}.`
}

/**
 * After a worktree's pull request was merged: go to the main folder, remove the worktree, delete its branch here
 * and (unless the provider did) on the remote, and pull the base branch there. Undo brings back the branch and
 * the worktree (not uncommitted changes).
 */
export async function finishWorktree(
  repo: string,
  wt: Pick<Worktree, 'path' | 'name' | 'branch' | 'changes'> & { changedFiles?: string[] },
  pr: PullRequest,
  data: RepoPullRequests,
  opts: { confirmed?: boolean } = {}
): Promise<boolean> {
  const main = mainWorktreeOf(repo)
  // Uncommitted changes go only after a "Remove anyway" (the merged pull request's panel asks it itself).
  if ((wt.changes ?? 0) > 0 && !opts.confirmed) {
    const ok = await confirm({
      title: `Remove worktree ${wt.name}?`,
      message: (
        <>
          Its folder <strong>{wt.path}</strong> is deleted{wt.branch ? <>, and <strong>{wt.branch}</strong> with it</> : null}.
          <span className="md-cleanup-warn" role="alert" style={{ marginTop: 12 }}>
            <TriangleAlert size={15} />
            <span>{changesText({ changes: wt.changes, changedFiles: wt.changedFiles ?? [] })} Removing the worktree loses them.</span>
          </span>
        </>
      ),
      confirmLabel: 'Remove anyway',
      danger: true
    })
    if (!ok) return false
  }
  const branch = wt.branch
  const sha = tabOf(repo)?.refs?.branches.find((b) => b.name === branch)?.sha ?? pr.headSha
  store().setBusy(`cleanup:${main}`, `Removing worktree ${wt.name}…`)
  try {
    if (!(await openWorktree(repo, main))) return false
    await closeTabOf(wt.path)
    await api.removeWorktree(main, wt.path, { force: (wt.changes ?? 0) > 0 })
    const done: string[] = []
    if (branch) {
      await api.deleteBranch(main, branch, { force: true }).catch(() => undefined)
      done.push(`${branch} deleted here`)
      await git.refresh(main, ['refs', 'info'])
      const remoteRef = tabOf(main)?.refs?.remotes.find((r) => r.name === `${data.remote}/${pr.headRef}`)
      if (!pr.headFork && remoteRef && !data.deleteBranchOnMerge) {
        await api.deleteRemoteBranch(main, data.remote, pr.headRef).then(
          () => (done[done.length - 1] = `${branch} deleted here and on ${data.remote}`),
          () => undefined
        )
      }
    }
    const head = tabOf(main)?.refs?.branches.find((b) => b.isHead)
    if (head?.name === pr.baseRef && head.upstream) {
      await git.pull(main)
      done.push(`${pr.baseRef} pulled`)
    }
    if (branch) {
      store().pushHistory(main, {
        label: `Remove worktree ${wt.name}`,
        undo: async () => {
          await api.createBranch(main, branch, sha, { checkout: false }).catch(() => undefined)
          await api.addWorktree(main, { path: wt.path, branch })
          reloadAll(main)
          await git.refresh(main)
        },
        redo: async () => {
          await api.removeWorktree(main, wt.path, { force: true })
          await api.deleteBranch(main, branch, { force: true })
          reloadAll(main)
          await git.refresh(main)
        }
      })
    }
    toast.success(`Removed worktree ${wt.name}`, { detail: done.join(' · ') || undefined, actions: branch ? [{ label: 'Undo', onClick: () => void git.undo(main) }] : undefined })
    return true
  } catch (err) {
    toast.error(`Could not finish removing the worktree: ${describeError(err)}`)
    return false
  } finally {
    store().setBusy(`cleanup:${main}`, null)
    reloadAll(main)
    void git.refresh(main)
  }
}

export async function setWorktreeLocked(repo: string, wt: Worktree, locked: boolean): Promise<void> {
  const main = mainWorktreeOf(repo)
  try {
    await api.setWorktreeLocked(main, wt.path, locked)
    toast.success(locked ? `Locked ${wt.name}: git keeps it even when its folder is away` : `Unlocked ${wt.name}`)
  } catch (err) {
    toast.error(err)
  }
  reloadAll(main)
}

export async function forgetMissingWorktrees(repo: string): Promise<void> {
  const main = mainWorktreeOf(repo)
  try {
    await api.pruneWorktrees(main)
    toast.success('Forgot the worktrees whose folder is gone')
  } catch (err) {
    toast.error(err)
  }
  reloadAll(main)
  void git.refresh(main, ['refs'])
}
