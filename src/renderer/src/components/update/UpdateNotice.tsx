// Update notice (bottom-left card) + release-notes modal for the in-app updater.
// Background checks only show the card when a newer release exists; manual checks
// ("Check for Updates…") also answer "up to date" / errors with a toast.

import { useEffect } from 'react'
import { Download, RefreshCw, Sparkles, X } from 'lucide-react'
import { api, isElectron, onAdarEvent, updates } from '@renderer/api/client'
import { Button } from '@renderer/components/common/Button'
import { showMenuBelow } from '@renderer/components/common/ContextMenu'
import { Modal } from '@renderer/components/common/Modal'
import { toast } from '@renderer/components/common/toast'
import { AdarLogo } from '@renderer/components/layout/Logo'
import type { UpdateStatus } from '@shared/update'
import { ReleaseNotes } from './ReleaseNotes'
import { useApp } from '@renderer/store/appStore'
import { installUpdate, startUpdate } from './restart'
import { useUpdates } from './updateStore'
import './update.css'

function formatBytes(n: number): string {
  if (!n) return ''
  const mb = n / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${Math.ceil(n / 1024)} KB`
}

function handleStatus(status: UpdateStatus) {
  useUpdates.getState().setStatus(status)
  if (!status.manual) return
  if (status.state === 'not-available') toast.success(`You're up to date — Adar ${status.currentVersion} is the latest version.`)
  else if (status.state === 'error') toast.error(`Couldn't check for updates: ${status.error ?? 'unknown error'}`)
  else if (status.state === 'available' && status.info) {
    useUpdates.setState({ dismissed: null })
  }
}

/** Run a user-initiated check (menu / palette). */
export async function checkForUpdatesNow(): Promise<void> {
  if (!isElectron) {
    toast.info('Updates are available in the desktop app.')
    return
  }
  const id = toast.loading('Checking for updates…')
  try {
    await updates.updateCheck(true)
  } catch (err) {
    toast.error(err)
  } finally {
    toast.dismiss(id)
  }
}

export { installUpdate, startUpdate } from './restart'

export function UpdateNotice() {
  const status = useUpdates((s) => s.status)
  const dismissed = useUpdates((s) => s.dismissed)
  const notesOpen = useUpdates((s) => s.notesOpen)

  useEffect(() => {
    if (!isElectron) return
    void updates.updateGetStatus().then(handleStatus, () => undefined)
    return onAdarEvent((ev) => {
      if (ev.type === 'update-status') handleStatus(ev.status)
    })
  }, [])

  const info = status?.info
  if (!status || !info) return null
  const visible = ['available', 'downloading', 'downloaded'].includes(status.state) || (status.state === 'error' && !!info)
  const hidden = dismissed === info.latestVersion && status.state === 'available'

  return (
    <>
      {visible && !hidden && (
        <div className="up-card" role="status">
          <AdarLogo size={34} />
          <div className="up-body">
            <div className="up-title">
              <Sparkles size={13} /> Adar {info.latestVersion} is available
            </div>
            <div className="up-sub">
              {status.state === 'downloading'
                ? `Downloading… ${status.progress ?? 0}%`
                : status.state === 'downloaded'
                  ? status.canInstall
                    ? 'Ready to install — Adar will restart.'
                    : 'Downloaded. Open it to finish installing.'
                  : status.state === 'error'
                    ? `Update failed: ${status.error ?? 'unknown error'}`
                    : `You have ${status.currentVersion}.`}
            </div>
            {status.state === 'downloading' && (
              <div className="up-progress">
                <div style={{ width: `${status.progress ?? 0}%` }} />
              </div>
            )}
            <div className="up-actions">
              {status.state === 'downloaded' ? (
                <Button size="sm" variant="primary" icon={<RefreshCw size={13} />} onClick={() => void installUpdate()}>
                  {status.canInstall ? 'Restart to update' : 'Open installer'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Download size={13} />}
                  loading={status.state === 'downloading'}
                  title="Download the update. You choose when Adar restarts to install it."
                  onClick={() => void startUpdate()}
                >
                  {status.state === 'error' ? 'Retry' : 'Update'}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => useUpdates.getState().setNotesOpen(true)}>
                What's new
              </Button>
              {status.state === 'available' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) =>
                    showMenuBelow(e.currentTarget, [
                      { label: 'Remind me later', onClick: () => useUpdates.getState().dismiss(info.latestVersion) },
                      {
                        label: `Skip version ${info.latestVersion}`,
                        onClick: () => {
                          useUpdates.getState().dismiss(info.latestVersion)
                          void updates.updateSkip(info.latestVersion)
                          void useApp.getState().updateSettings({ skippedUpdateVersion: info.latestVersion })
                        }
                      }
                    ])
                  }
                >
                  Later
                </Button>
              )}
            </div>
          </div>
          {status.state !== 'downloading' && (
            <button className="ui-icon-btn ui-icon-btn-sm up-close" aria-label="Dismiss" onClick={() => useUpdates.getState().dismiss(info.latestVersion)}>
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {notesOpen && (
        <Modal
          title={info.releaseName}
          onClose={() => useUpdates.getState().setNotesOpen(false)}
          width={560}
          footer={
            <>
              <Button onClick={() => void api.openExternal(info.releaseUrl)}>View on GitHub</Button>
              {status.state === 'downloaded' && (
                <Button variant="primary" icon={<RefreshCw size={14} />} onClick={() => void installUpdate()}>
                  {status.canInstall ? 'Restart to update' : 'Open installer'}
                </Button>
              )}
              {status.state === 'available' && (
                <Button
                  variant="primary"
                  icon={<Download size={14} />}
                  onClick={() => {
                    useUpdates.getState().setNotesOpen(false)
                    void startUpdate()
                  }}
                >
                  Update to {info.latestVersion}
                  {info.zip || info.dmg ? ` (${formatBytes((info.zip ?? info.dmg)!.size)})` : ''}
                </Button>
              )}
            </>
          }
        >
          <div className="up-meta">
            {status.currentVersion} → {info.latestVersion}
            {info.publishedAt && ` · ${new Date(info.publishedAt).toLocaleDateString()}`}
          </div>
          <ReleaseNotes markdown={info.notes} />
        </Modal>
      )}
    </>
  )
}
