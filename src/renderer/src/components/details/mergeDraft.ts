// The merge message (MERGE_MSG) the commit composer prefills during a merge, like
// GitKraken. It is remembered per repository so that it is prefilled once per merge
// (clearing it on purpose sticks) and removed again when the merge ends some other way
// (aborted, committed from a terminal…) instead of leaking into the next regular commit.

import { api } from '@renderer/api/client'
import { useApp, type AppState, type CommitDraft } from '@renderer/store/appStore'
import { splitMessage, type SplitMessage } from './message'

const prefills = new Map<string, SplitMessage>()
let unsubscribe: (() => void) | null = null

function draftOf(repo: string): CommitDraft | undefined {
  return useApp.getState().tabs.find((t) => t.path === repo)?.draft
}

const isEmpty = (d: CommitDraft | undefined): boolean => !!d && !d.summary.trim() && !d.description.trim()

/** Prefill git's prepared merge message into an empty draft, once per merge. */
export async function prefillMergeMessage(repo: string): Promise<void> {
  if (prefills.has(repo) || !isEmpty(draftOf(repo))) return
  let msg: string
  try {
    msg = await api.getMergeMessage(repo)
  } catch {
    return
  }
  if (!msg || prefills.has(repo) || !isEmpty(draftOf(repo))) return
  const split = splitMessage(msg)
  prefills.set(repo, split)
  watch()
  useApp.getState().updateDraft(repo, { summary: split.summary, description: split.description })
}

/** The merge is over: forget its message, and clear the draft when it still holds it untouched. */
export function dropMergePrefill(repo: string): void {
  const p = prefills.get(repo)
  if (!p) return
  prefills.delete(repo)
  if (!prefills.size) stopWatching()
  const d = draftOf(repo)
  if (d && d.summary === p.summary && d.description === p.description) useApp.getState().updateDraft(repo, { summary: '', description: '' })
}

/** True while `repo` has a prefilled merge message (for tests). */
export function hasMergePrefill(repo: string): boolean {
  return prefills.has(repo)
}

/**
 * Watch the store while a prefill is pending, so an abort is noticed even when the composer
 * is not mounted. A tab whose repository cannot be read (tab.error) keeps its prefill: its
 * info is stale, not proof that the merge ended.
 */
function onStore(s: AppState): void {
  for (const repo of [...prefills.keys()]) {
    const tab = s.tabs.find((t) => t.path === repo)
    if (!tab) {
      prefills.delete(repo)
      if (!prefills.size) stopWatching()
    } else if (tab.info && !tab.error && tab.info.state !== 'merge') dropMergePrefill(repo)
  }
}

function watch(): void {
  unsubscribe ??= useApp.subscribe(onStore)
}

function stopWatching(): void {
  unsubscribe?.()
  unsubscribe = null
}
