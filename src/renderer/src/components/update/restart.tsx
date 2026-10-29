// Installing a downloaded update quits Adar. Nothing restarts it behind the user's
// back: "Update" only downloads, and "Restart to update" first checks for work a
// restart would interrupt (running git operations) or lose (commit drafts and
// merge-tool edits that only live in memory) and asks before going ahead. When Adar
// cannot replace itself (the administrator password was cancelled, a read-only copy),
// it explains how to install the download by hand.

import { updates } from '@renderer/api/client'
import { confirm } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { unsavedConflictEdits } from '@renderer/components/conflicts/editorCache'
import { basename, pluralize } from '@renderer/lib/format'
import { useApp, type AppState } from '@renderer/store/appStore'
import type { ManualInstall } from '@shared/update'
import { useUpdates } from './updateStore'

/** What a restart would interrupt or discard, one human-readable line each (empty = nothing). */
export function workLostOnRestart(state: Pick<AppState, 'busy' | 'tabs'>, conflictEdits: ReadonlyArray<{ repo: string; path: string }>): string[] {
  const lines: string[] = []
  for (const label of Object.values(state.busy)) lines.push(`${label.replace(/[.…]+$/, '')} (still running)`)
  const nameOf = (repo: string) => state.tabs.find((t) => t.path === repo)?.name ?? basename(repo)
  for (const tab of state.tabs) {
    if (tab.draft.summary.trim() || tab.draft.description.trim()) lines.push(`Unsaved commit message in ${tab.name}`)
  }
  const editsByRepo = new Map<string, number>()
  for (const e of conflictEdits) editsByRepo.set(e.repo, (editsByRepo.get(e.repo) ?? 0) + 1)
  for (const [repo, n] of editsByRepo) lines.push(`Unsaved merge-tool changes to ${pluralize(n, 'conflicted file')} in ${nameOf(repo)}`)
  return lines
}

/** True when it is fine to restart now: nothing would be lost, or the user agreed. */
export async function confirmRestartForUpdate(): Promise<boolean> {
  const lost = workLostOnRestart(useApp.getState(), unsavedConflictEdits())
  if (!lost.length) return true
  return confirm({
    title: 'Restart Adar to update?',
    message: (
      <>
        <p>Adar quits to install the update. This would interrupt or discard:</p>
        <ul className="up-restart-list">
          {lost.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <p>Finish or save your work first, or restart anyway.</p>
      </>
    ),
    confirmLabel: 'Restart anyway',
    cancelLabel: 'Not now',
    danger: true
  })
}

/** "Restart to update" / "Open installer". Only the in-place install restarts Adar, so only it asks. */
export async function installUpdate(): Promise<void> {
  const restarts = useUpdates.getState().status?.canInstall !== false
  if (restarts && !(await confirmRestartForUpdate())) return
  // Unpacking and checking the update takes a few seconds before Adar quits (or macOS asks for a password).
  const busy = restarts ? toast.loading('Preparing the update…') : null
  try {
    const manual = await updates.updateInstall()
    if (busy !== null) toast.dismiss(busy)
    if (manual) await offerManualInstall(manual)
  } catch (err) {
    if (busy !== null) toast.dismiss(busy)
    toast.error(err)
  }
}

/** What to tell the user when Adar could not replace itself with version `version`. */
export function manualInstallText(manual: ManualInstall, version: string): { title: string; reason: string; steps: string } {
  const steps = `To install ${version ? `Adar ${version}` : 'the update'} yourself, show the download in Finder, quit Adar, then open the .zip and drag Adar to Applications.`
  if (manual.reason === 'read-only') {
    return {
      title: 'Move Adar to Applications',
      reason: 'Adar is running from a disk image or from a download macOS keeps apart until it is moved, so it cannot replace itself.',
      steps: 'Show the download in Finder, quit Adar, open the .zip and drag Adar to Applications. Open it from there: later updates install by themselves.'
    }
  }
  if (manual.reason === 'cancelled') {
    return {
      title: 'Update not installed',
      reason: `Adar needs an administrator's name and password to replace itself in ${manual.folder}.`,
      steps: `${steps} Tip: in the Applications folder of your home folder (~/Applications), Adar updates without a password.`
    }
  }
  // The title says it failed; the error says why ("Could not get administrator rights to replace Adar: …").
  const error = (manual.error || 'Adar could not replace itself').replace(/[.\s]+$/, '')
  return { title: 'Update not installed', reason: `${error}.`, steps }
}

async function offerManualInstall(manual: ManualInstall): Promise<void> {
  const text = manualInstallText(manual, useUpdates.getState().status?.info?.latestVersion ?? '')
  const show = await confirm({
    title: text.title,
    message: (
      <>
        <p>{text.reason}</p>
        <p>{text.steps}</p>
      </>
    ),
    confirmLabel: 'Show in Finder',
    cancelLabel: 'Not now'
  })
  if (show) await updates.updateShowDownload()
}

/** "Update": download only. The card, release notes and Settings then offer "Restart to update". */
export async function startUpdate(): Promise<void> {
  try {
    await updates.updateDownload()
  } catch (err) {
    toast.error(err)
  }
}

/** Cmd+Q / quitting: ask before interrupting running git operations or losing unsaved work. */
export async function confirmQuit(): Promise<boolean> {
  const lost = workLostOnRestart(useApp.getState(), unsavedConflictEdits())
  if (!lost.length) return true
  return confirm({
    title: 'Quit Adar?',
    message: (
      <>
        <p>Quitting now would interrupt or discard:</p>
        <ul className="up-restart-list">
          {lost.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </>
    ),
    confirmLabel: 'Quit anyway',
    cancelLabel: 'Cancel',
    danger: true
  })
}
