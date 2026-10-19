// Hunk / line level staging, unstaging and discarding. Patches are built from a
// fresh diff (3 lines of context, exact whitespace) so they always match the
// file on disk, whatever context / whitespace options the view displays; the
// selection made on screen is re-mapped onto it by line number and content.

import { api } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { useApp } from '@renderer/store/appStore'
import { buildPartialPatch, isChange, patchApplyOptions, remapSelection, type HunkSelection, type PatchMode } from '@shared/patch'
import type { FileDiff } from '@shared/types'

export type ApplyOutcome = 'applied' | 'cancelled' | 'stale' | 'failed'

/** What the user acted on: a whole hunk, a change block (full-file view) or selected lines. */
export type PartialUnit = 'hunk' | 'block' | 'lines'

const LABELS: Record<PatchMode, { verb: string; history: string }> = {
  stage: { verb: 'stage', history: 'Stage' },
  unstage: { verb: 'unstage', history: 'Unstage' },
  discard: { verb: 'discard', history: 'Discard' }
}

/** Number of change lines a selection covers. */
export function countSelected(diff: FileDiff, selection: HunkSelection[]): number {
  let n = 0
  for (const s of selection) {
    const hunk = diff.hunks[s.hunkIndex]
    if (!hunk) continue
    if (!s.lineIndexes) n += hunk.lines.filter(isChange).length
    else n += s.lineIndexes.filter((i) => hunk.lines[i] && isChange(hunk.lines[i])).length
  }
  return n
}

/** Confirmation texts for discarding. */
export function discardPrompt(unit: PartialUnit, n: number, path: string): { title: string; message: string; confirmLabel: string } {
  const message = `The selected changes to ${path} are removed from your working directory.`
  if (unit === 'hunk') return { title: 'Discard this hunk?', message, confirmLabel: 'Discard Hunk' }
  if (unit === 'block') return { title: n === 1 ? 'Discard this changed line?' : `Discard these ${n} changed lines?`, message, confirmLabel: 'Discard Changes' }
  return { title: `Discard ${n} selected line${n === 1 ? '' : 's'}?`, message, confirmLabel: 'Discard Lines' }
}

/** Undo history label, e.g. "Stage hunk in App.tsx", "Discard 3 lines in a.ts". */
export function historyLabel(mode: PatchMode, unit: PartialUnit, n: number, path: string): string {
  const what = unit === 'hunk' ? 'hunk' : unit === 'block' ? 'change' : n === 1 ? 'line' : `${n} lines`
  return `${LABELS[mode].history} ${what} in ${path.split('/').pop() ?? path}`
}

/**
 * Apply the selected changes of `display` (the diff on screen for `kind`/`path`)
 * in `mode`. Confirms discards, toasts failures and records undo / redo.
 */
export async function applyPartial(
  repo: string,
  kind: 'unstaged' | 'staged',
  path: string,
  display: FileDiff,
  selection: HunkSelection[],
  mode: PatchMode,
  what: PartialUnit
): Promise<ApplyOutcome> {
  const n = countSelected(display, selection)
  if (!n) return 'cancelled'
  const label = LABELS[mode]

  if (mode === 'discard' && useApp.getState().settings.confirmDangerous) {
    const ok = await confirm({ ...discardPrompt(what, n, path), danger: true })
    if (!ok) return 'cancelled'
  }

  let source = display
  try {
    source = await api.getDiff(repo, { kind, path }, { context: 3, ignoreWhitespace: false })
  } catch {
    // Fall back to the displayed diff (it may still apply).
  }
  let sel = selection
  if (source !== display) {
    const mapped = remapSelection(display, selection, source)
    if (!mapped.complete || !mapped.selection.length) {
      toast.warning('The file changed since the diff was loaded. Review the refreshed diff and try again.')
      return 'stale'
    }
    sel = mapped.selection
  }

  const patch = buildPartialPatch(source, sel, mode)
  if (!patch) {
    toast.error(`Nothing to ${label.verb}`)
    return 'failed'
  }
  const opts = patchApplyOptions(mode)
  try {
    await api.applyPatch(repo, patch, opts)
  } catch (err) {
    toast.error(err)
    return 'failed'
  }

  // Undo / redo: the same patch applied in the opposite direction.
  const inverse = { ...opts, reverse: !opts.reverse }
  useApp.getState().pushHistory(repo, {
    label: historyLabel(mode, what, n, path),
    undo: () => api.applyPatch(repo, patch, inverse),
    redo: () => api.applyPatch(repo, patch, opts)
  })
  return 'applied'
}
