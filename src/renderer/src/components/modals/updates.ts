// Pure helpers for the update controls in Settings → General and the About modal.
// No DOM / store access so they can be unit-tested in node.

import { relativeTime } from '@renderer/lib/format'
import { UPDATE_REPO, type UpdateStatus } from '@shared/update'

/** Public source repository (also where releases are published). */
export const REPO_URL = `https://github.com/${UPDATE_REPO}`

/** What the primary update button does for a status (null = no button). */
export type UpdateAction = 'update' | 'retry' | 'install' | 'open-installer' | null

export interface UpdateSummary {
  /** One-line description of the update state ("Adar 1.2.0 is available"). */
  text: string
  tone: 'muted' | 'accent' | 'error'
  action: UpdateAction
  /** Label of the action button. */
  actionLabel?: string
  /** True while the action is running (download in progress). */
  busy?: boolean
}

export interface DescribeUpdateOptions {
  isElectron: boolean
  /** A user-initiated check is in flight (the backend does not emit 'checking'). */
  checking?: boolean
  /** settings.checkForUpdates */
  automatic?: boolean
  now?: number
}

/** Describe the updater status for the Settings "Updates" rows. */
export function describeUpdateStatus(status: UpdateStatus | null, opts: DescribeUpdateOptions): UpdateSummary {
  if (!opts.isElectron) return { text: 'Updates are available in the desktop app.', tone: 'muted', action: null }
  const version = status?.info?.latestVersion
  switch (status?.state) {
    case 'available':
      if (version) return { text: `Adar ${version} is available`, tone: 'accent', action: 'update', actionLabel: 'Update' }
      break
    case 'downloading':
      if (version)
        return {
          text: `Downloading Adar ${version}… ${Math.max(0, Math.min(100, Math.round(status.progress ?? 0)))}%`,
          tone: 'accent',
          action: 'update',
          actionLabel: 'Update',
          busy: true
        }
      break
    case 'downloaded':
      if (version)
        return status.canInstall
          ? { text: `Adar ${version} is ready to install — Adar will restart.`, tone: 'accent', action: 'install', actionLabel: 'Restart to update' }
          : { text: `Adar ${version} was downloaded. Open it to finish installing.`, tone: 'accent', action: 'open-installer', actionLabel: 'Open installer' }
      break
    case 'error':
      if (version) return { text: `Updating to ${version} failed: ${status.error ?? 'unknown error'}`, tone: 'error', action: 'retry', actionLabel: 'Retry' }
      if (!opts.checking) return { text: `Couldn't check for updates: ${status.error ?? 'unknown error'}`, tone: 'error', action: null }
      break
  }
  if (opts.checking || status?.state === 'checking') return { text: 'Checking for updates…', tone: 'muted', action: null }
  if (status?.state === 'not-available') {
    const when = status.checkedAt ? ` Last checked ${relativeTime(Math.floor(status.checkedAt / 1000), opts.now)}.` : ''
    return { text: `You're up to date.${when}`, tone: 'muted', action: null }
  }
  return {
    text: opts.automatic === false ? 'Automatic checks are off.' : 'Not checked yet.',
    tone: 'muted',
    action: null
  }
}
