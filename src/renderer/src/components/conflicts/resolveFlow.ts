// Glue between the conflict tool and the store: write a resolution, refresh,
// then open the next conflicted file or go back to the graph with a
// "Continue <operation>" toast, withdrawn as soon as it no longer applies.

import { api } from '@renderer/api/client'
import { continueOperation, markResolved, openConflict, showGraph } from '@renderer/actions/git'
import { choose } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { joinMessage } from '@renderer/components/details/message'
import { basename } from '@renderer/lib/format'
import { useApp, type AppState, type RepoTab } from '@renderer/store/appStore'
import { toErrorPayload } from '@shared/errors'
import type { ConflictResolution } from '@shared/types'
import { nextConflictPath } from './conflictParser'
import { operationInfo, type ActiveOperation } from './operationInfo'

const tabOf = (repo: string) => useApp.getState().tabs.find((t) => t.path === repo)
const conflictOrder = (repo: string) => (tabOf(repo)?.status?.conflicted ?? []).map((c) => c.path)

export function resolveBusyKey(repo: string): string {
  return `resolve:${repo}`
}

export interface ResolveOptions {
  /**
   * For content resolutions that carry `expected`: offered as "Reload from disk" when the backend
   * refuses because the file changed on disk since the editor loaded it.
   */
  onReload?: () => void
}

/**
 * The backend's refusal of a content resolution whose `expected` text no longer matches the
 * working-tree file (it was edited outside Adar after the merge tool loaded it).
 */
export function isChangedOnDisk(err: unknown, resolution: ConflictResolution): boolean {
  return resolution.kind === 'content' && resolution.expected !== undefined && toErrorPayload(err).code === 'CONFLICT'
}

type ChangedOnDiskChoice = 'reload' | 'overwrite'

function askChangedOnDisk(path: string, canReload: boolean): Promise<ChangedOnDiskChoice | null> {
  const name = basename(path)
  return choose<ChangedOnDiskChoice>({
    title: `${name} changed on disk`,
    message: `${name} was modified outside Adar (for example in an editor) after the merge tool loaded it. Saving now would replace those changes.`,
    options: [
      ...(canReload
        ? [
            {
              value: 'reload' as const,
              label: 'Reload from disk',
              description: 'Show the file as it is now. Your selections and edits in the merge tool are discarded.'
            }
          ]
        : []),
      {
        value: 'overwrite' as const,
        label: 'Overwrite',
        description: `Replace the changes on disk with the output shown here and mark ${name} resolved.`,
        danger: true
      }
    ]
  })
}

/** Write + stage a resolution, then advance. Returns false when it failed (already toasted) or was abandoned. */
export async function resolveAndAdvance(repo: string, path: string, resolution: ConflictResolution, opts: ResolveOptions = {}): Promise<boolean> {
  const order = conflictOrder(repo)
  const key = resolveBusyKey(repo)
  let attempt = resolution
  for (;;) {
    useApp.getState().setBusy(key, `Resolving ${basename(path)}…`)
    try {
      await api.resolveConflict(repo, path, attempt)
      break
    } catch (err) {
      if (!isChangedOnDisk(err, attempt)) {
        toast.error(err)
        return false
      }
    } finally {
      useApp.getState().setBusy(key, null)
    }
    // The file changed on disk since it was loaded: never overwrite it without asking.
    const choice = await askChangedOnDisk(path, !!opts.onReload)
    if (choice === 'reload') opts.onReload?.()
    if (choice !== 'overwrite' || attempt.kind !== 'content') return false
    attempt = { kind: 'content', content: attempt.content }
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
  const state = tab.info?.state ?? 'none'
  if (state !== 'none' && operationInfo(state)?.canContinue) offerContinue(repo, state)
  else toast.success('All conflicts resolved')
}

// ── "All conflicts resolved — Continue <operation>" offer ─────────────────

/** How long the offer stays up (the toast closes itself after this). */
export const CONTINUE_OFFER_MS = 10_000

interface ContinueOffer {
  toastId: number
  /** Stops watching the store (does not touch the toast). */
  dispose: () => void
}

/** At most one pending offer per repository. */
const continueOffers = new Map<string, ContinueOffer>()

/**
 * The offer is stale once the operation is over (e.g. the merge was committed from the
 * composer or aborted), another operation took its place, conflicts came back, a continue is
 * already running (banner / composer) or the tab was closed.
 */
function offerIsStale(s: AppState, repo: string, state: ActiveOperation, statusAtOffer: RepoTab['status']): boolean {
  const tab = s.tabs.find((t) => t.path === repo)
  if (!tab || tab.info?.state !== state) return true
  // Only a newer status counts: the one the offer was made from is known to be resolved.
  if (tab.status !== statusAtOffer && (tab.status?.conflicted.length ?? 0) > 0) return true
  return `continue:${repo}` in s.busy
}

/** Forget the pending offer of `repo` (if it is still `toastId` when given) without touching its toast. */
function releaseOffer(repo: string, toastId?: number): ContinueOffer | undefined {
  const offer = continueOffers.get(repo)
  if (!offer || (toastId !== undefined && offer.toastId !== toastId)) return undefined
  continueOffers.delete(repo)
  offer.dispose()
  return offer
}

/** Withdraw the pending "Continue <operation>" toast of `repo`, if any. */
export function dismissContinueOffer(repo: string): void {
  const offer = releaseOffer(repo)
  if (offer) toast.dismiss(offer.toastId)
}

/** True while a "Continue <operation>" toast is offered for `repo` (for tests and callers that want to know). */
export function hasContinueOffer(repo: string): boolean {
  return continueOffers.has(repo)
}

function offerContinue(repo: string, state: ActiveOperation): void {
  const info = operationInfo(state)
  if (!info) return
  dismissContinueOffer(repo)
  const statusAtOffer = tabOf(repo)?.status ?? null
  const toastId = toast.success('All conflicts resolved', {
    actions: [
      {
        label: `Continue ${info.noun}`,
        onClick: () => {
          releaseOffer(repo, toastId)
          void continueFromOffer(repo, state)
        }
      }
    ],
    duration: CONTINUE_OFFER_MS
  })
  // The toast closes itself after CONTINUE_OFFER_MS: stop watching then.
  const timer = setTimeout(() => releaseOffer(repo, toastId), CONTINUE_OFFER_MS)
  const unsubscribe = useApp.subscribe((s) => {
    if (continueOffers.get(repo)?.toastId === toastId && offerIsStale(s, repo, state, statusAtOffer)) dismissContinueOffer(repo)
  })
  continueOffers.set(repo, {
    toastId,
    dispose: () => {
      clearTimeout(timer)
      unsubscribe()
    }
  })
}

/** The toast's action: the store may have moved on since the toast appeared, so check again. */
async function continueFromOffer(repo: string, state: ActiveOperation): Promise<void> {
  const current = tabOf(repo)?.info?.state ?? 'none'
  if (current !== state) {
    // Typically the merge was already committed from the composer (or aborted) meanwhile.
    toast.info(`Nothing to continue: the ${operationInfo(state)?.noun ?? 'operation'} is no longer in progress`)
    return
  }
  await continueWithDraft(repo)
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
