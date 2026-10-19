// Glue between the conflict tool and the store: write a resolution, refresh,
// then open the next conflicted file or go back to the graph with a
// "Continue <operation>" toast.

import { api } from '@renderer/api/client'
import { continueOperation, markResolved, openConflict, showGraph } from '@renderer/actions/git'
import { toast } from '@renderer/components/common/toast'
import { joinMessage } from '@renderer/components/details/message'
import { basename } from '@renderer/lib/format'
import { useApp } from '@renderer/store/appStore'
import type { ConflictResolution } from '@shared/types'
import { nextConflictPath } from './conflictParser'
import { operationInfo } from './operationInfo'

const tabOf = (repo: string) => useApp.getState().tabs.find((t) => t.path === repo)
const conflictOrder = (repo: string) => (tabOf(repo)?.status?.conflicted ?? []).map((c) => c.path)

export function resolveBusyKey(repo: string): string {
  return `resolve:${repo}`
}

/** Write + stage a resolution, then advance. Returns false when it failed (already toasted). */
export async function resolveAndAdvance(repo: string, path: string, resolution: ConflictResolution): Promise<boolean> {
  const order = conflictOrder(repo)
  const key = resolveBusyKey(repo)
  useApp.getState().setBusy(key, `Resolving ${basename(path)}…`)
  try {
    await api.resolveConflict(repo, path, resolution)
  } catch (err) {
    toast.error(err)
    return false
  } finally {
    useApp.getState().setBusy(key, null)
  }
  await useApp.getState().refresh(repo)
  advanceAfterResolve(repo, path, order)
  return true
}

/** Stage a file as resolved as-is (e.g. after fixing it in an external editor), then advance. */
export async function markResolvedAndAdvance(repo: string, path: string): Promise<boolean> {
  const order = conflictOrder(repo)
  const key = resolveBusyKey(repo)
  useApp.getState().setBusy(key, `Marking ${basename(path)} resolved…`)
  let ok: boolean
  try {
    // The shared action toasts ("Marked … as resolved" / the error) and refreshes before resolving.
    ok = await markResolved(repo, [path])
  } finally {
    useApp.getState().setBusy(key, null)
  }
  if (ok) advanceAfterResolve(repo, path, order, { quiet: true })
  return ok
}

/**
 * After `path` was resolved and the status refreshed: open the next conflicted file (in the
 * order the files had before), or go back to the graph and offer to continue the operation.
 */
export function advanceAfterResolve(repo: string, path: string, order: readonly string[], opts: { quiet?: boolean } = {}): void {
  const tab = tabOf(repo)
  if (!tab) return
  const remaining = (tab.status?.conflicted ?? []).map((c) => c.path).filter((p) => p !== path)
  const next = nextConflictPath(order, path, remaining)
  // The user may have navigated elsewhere while we were saving — only steer when still on this file.
  const stillHere = tab.center.kind === 'conflict' && tab.center.path === path
  if (next) {
    if (!opts.quiet) toast.success(`Resolved ${basename(path)} · ${remaining.length} conflicted file${remaining.length === 1 ? '' : 's'} left`)
    if (stillHere) openConflict(repo, next)
    return
  }
  if (stillHere) showGraph(repo)
  const info = operationInfo(tab.info?.state)
  if (info?.canContinue) {
    toast.success('All conflicts resolved', {
      actions: [{ label: `Continue ${info.noun}`, onClick: () => void continueWithDraft(repo) }],
      duration: 10000
    })
  } else toast.success('All conflicts resolved')
}

/**
 * Continue the in-progress operation. A merge is committed with the message drafted in the
 * commit panel (prefilled from MERGE_MSG), or git's prepared message when there is none;
 * the draft is cleared once the merge commit exists.
 */
export async function continueWithDraft(repo: string): Promise<void> {
  const tab = tabOf(repo)
  const isMerge = tab?.info?.state === 'merge'
  const message = isMerge && tab ? joinMessage(tab.draft.summary, tab.draft.description) : ''
  await continueOperation(repo, message || undefined)
  if (isMerge && tabOf(repo)?.info?.state === 'none') {
    useApp.getState().updateDraft(repo, { summary: '', description: '', amend: false })
  }
}
