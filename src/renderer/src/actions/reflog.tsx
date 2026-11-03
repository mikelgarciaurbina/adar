// Getting lost commits back: the reflog view, moving a reset branch back, restoring a deleted branch and
// a branch for any lost commit. Each with Undo.

import { api } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { loadLostCommits } from '@renderer/components/reflog/reflogStore'
import { recoveredName } from '@renderer/components/reflog/model'
import { relativeTime, shortSha } from '@renderer/lib/format'
import { currentBranch } from '@renderer/lib/refs'
import { useApp } from '@renderer/store/appStore'
import type { LostCommit, LostGroup } from '@shared/types'
import * as git from './git'

const store = () => useApp.getState()
const tabOf = (repo: string) => store().tabs.find((t) => t.path === repo)

export type ReflogMode = 'lost' | 'moves'

export function openReflog(repo: string, mode: ReflogMode = 'lost'): void {
  store().setCenter(repo, { kind: 'reflog', mode })
}

const afterChange = async (repo: string) => {
  await git.refresh(repo)
  void loadLostCommits(repo)
}

/** Move a reset branch back to where it was, when nothing it has now would be left behind (a fast-forward). */
export async function moveBranchBack(repo: string, group: LostGroup): Promise<void> {
  const branch = group.branch
  const tip = group.commits[0]?.sha
  const now = tabOf(repo)?.refs?.branches.find((b) => b.name === branch)?.sha
  if (!branch || !tip || !now) return
  const n = group.commits.length
  const ok = await confirm({
    title: `Move ${branch} back to ${shortSha(tip)}?`,
    message: `${branch} goes back to where it was before the reset ${relativeTime(group.date)}, and its ${n === 1 ? 'commit is' : `${n} commits are`} on it again. Uncommitted changes stay as they are; if one is in the way, nothing moves. Undo puts ${branch} back where it is now.`,
    confirmLabel: `Move ${branch} back`
  })
  if (!ok) return
  const checkedOut = () => currentBranch(tabOf(repo)?.refs ?? null)?.name === branch
  try {
    await api.fastForwardBranch(repo, branch, tip)
  } catch (err) {
    toast.error(err)
    return
  }
  store().pushHistory(repo, {
    label: `Move ${branch} back`,
    undo: async () => {
      if (checkedOut()) await api.reset(repo, now, 'keep')
      else await api.moveBranch(repo, branch, now, tip)
      await afterChange(repo)
    },
    redo: async () => {
      await api.fastForwardBranch(repo, branch, tip)
      await afterChange(repo)
    }
  })
  toast.success(`${branch} is back at ${shortSha(tip)}`, { detail: `${n} ${n === 1 ? 'commit' : 'commits'} on it again`, actions: [{ label: 'Undo', onClick: () => void git.undo(repo) }] })
  await afterChange(repo)
}

/** Bring a deleted branch back, with its name, at its last commit. */
export async function restoreBranch(repo: string, group: LostGroup): Promise<void> {
  const branch = group.branch
  const tip = group.commits[0]?.sha
  if (!branch || !tip) return
  try {
    await api.createBranch(repo, branch, tip, { checkout: false })
  } catch (err) {
    toast.error(err)
    return
  }
  store().pushHistory(repo, {
    label: `Restore ${branch}`,
    undo: async () => {
      await api.deleteBranch(repo, branch, { force: true })
      await afterChange(repo)
    },
    redo: async () => {
      await api.createBranch(repo, branch, tip, { checkout: false })
      await afterChange(repo)
    }
  })
  const n = group.commits.length
  toast.success(`${branch} is back`, { detail: `${n} ${n === 1 ? 'commit' : 'commits'}, at ${shortSha(tip)}`, actions: [{ label: 'Undo', onClick: () => void git.undo(repo) }] })
  await afterChange(repo)
}

/** A new branch at a lost commit, named recovered/<its subject>. */
export async function branchFromLost(repo: string, commit: Pick<LostCommit, 'sha' | 'subject'>): Promise<void> {
  const taken = new Set(tabOf(repo)?.refs?.branches.map((b) => b.name) ?? [])
  await git.createBranch(repo, commit.sha, { checkout: false, name: recoveredName(commit, taken) })
  void loadLostCommits(repo)
}
