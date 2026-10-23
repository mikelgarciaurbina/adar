// What's new: the release notes of the running version, shown once after an update and from the
// "What's New in Adar" command. The notes are build/release-notes.md (the GitHub release body),
// bundled at build time, so showing them needs no network.

import { ExternalLink, Sparkles } from 'lucide-react'
import releaseNotes from '../../../../../build/release-notes.md?raw'
import { api, isElectron } from '@renderer/api/client'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { toast } from '@renderer/components/common/toast'
import { AdarLogo } from '@renderer/components/layout/Logo'
import { closeIfTopmost } from '@renderer/components/modals/controls'
import { REPO_URL } from '@renderer/components/modals/updates'
import { useApp } from '@renderer/store/appStore'
import { updatedFrom, withoutInstallSection } from '@shared/update'
import { ReleaseNotes } from './ReleaseNotes'
import './update.css'

const NOTES = withoutInstallSection(releaseNotes)

/** First run after an update (desktop app): open What's new once and remember this version. */
export function showWhatsNewAfterUpdate(): void {
  const { appInfo, settings, modal, updateSettings, openModal } = useApp.getState()
  if (!isElectron || !appInfo || settings.lastRunVersion === appInfo.version) return
  const from = updatedFrom(settings.lastRunVersion, appInfo.version)
  // Another dialog came first (a folder opened from the command line, say): show it on the next launch.
  if (from !== null && modal) return
  void updateSettings({ lastRunVersion: appInfo.version })
  if (from !== null) openModal({ kind: 'whats-new', from })
}

function subtitle(from: string | undefined): string {
  if (from) return `Updated from ${from}`
  return from === '' ? 'Just updated' : 'The version you are running'
}

export function WhatsNewModal({ from }: { from?: string }) {
  const version = useApp((s) => s.appInfo?.version ?? '')
  const close = () => closeIfTopmost('up-whats-new')

  return (
    <Modal
      title={
        <span className="md-title">
          <Sparkles size={16} /> What&apos;s new
        </span>
      }
      className="md-modal up-whats-new"
      width={560}
      onClose={close}
      footer={
        <>
          <Button
            className="md-footer-start"
            icon={<ExternalLink size={14} />}
            title="Release notes of every version on GitHub"
            onClick={() => api.openExternal(`${REPO_URL}/releases`).catch((err) => toast.error(err))}
          >
            All releases
          </Button>
          <Button variant="primary" onClick={close} autoFocus>
            Got it
          </Button>
        </>
      }
    >
      <div className="up-wn-head">
        <AdarLogo size={40} />
        <div>
          <div className="up-wn-version">Adar {version}</div>
          <div className="up-wn-sub">{subtitle(from)}</div>
        </div>
      </div>
      <ReleaseNotes markdown={NOTES} />
    </Modal>
  )
}
