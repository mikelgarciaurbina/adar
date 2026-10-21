import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Info, RefreshCw } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { toast } from '@renderer/components/common/toast'
import { formatGitVersion } from '@renderer/components/layout/chrome'
import { AdarLogo } from '@renderer/components/layout/Logo'
import { checkForUpdatesNow } from '@renderer/components/update/UpdateNotice'
import { useApp } from '@renderer/store/appStore'
import { closeIfTopmost } from './controls'
import { REPO_URL } from './updates'

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

function openRepositoryPage(): void {
  api.openExternal(REPO_URL).catch((err) => toast.error(err))
}

export function AboutModal() {
  const appInfo = useApp((s) => s.appInfo)
  const gitVersion = formatGitVersion(appInfo?.gitVersion)
  const [checking, setChecking] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const check = async () => {
    setChecking(true)
    try {
      await checkForUpdatesNow()
    } finally {
      if (mounted.current) setChecking(false)
    }
  }

  return (
    <Modal
      title={
        <span className="md-title">
          <Info size={16} /> About
        </span>
      }
      className="md-modal md-about"
      width={420}
      onClose={() => closeIfTopmost('md-about')}
      footer={
        <>
          <Button className="md-footer-start" icon={<RefreshCw size={14} />} loading={checking} onClick={() => void check()}>
            Check for Updates…
          </Button>
          <Button variant="primary" onClick={() => closeIfTopmost('md-about')} autoFocus>
            Close
          </Button>
        </>
      }
    >
      <div className="md-about-body">
        <AdarLogo size={72} />
        <div className="md-about-name">Adar</div>
        <div className="md-about-meaning">
          <em>adar</em> · “branch” and “antler” in Basque
        </div>
        <div className="md-about-tagline">A visual Git client for every repository.</div>
        <dl className="md-about-grid">
          <dt>Version</dt>
          <dd>{appInfo?.version ?? '—'}</dd>
          <dt>Git</dt>
          <dd>{gitVersion || appInfo?.gitVersion || '—'}</dd>
          <dt>Platform</dt>
          <dd>{appInfo ? `${PLATFORM_LABEL[appInfo.platform] ?? appInfo.platform}${appInfo.isElectron ? '' : ' (browser dev mode)'}` : '—'}</dd>
          <dt>License</dt>
          <dd>MIT License</dd>
        </dl>
        <a
          className="md-about-link"
          href={REPO_URL}
          title="Open the source repository in your browser"
          onClick={(e) => {
            e.preventDefault()
            openRepositoryPage()
          }}
        >
          <ExternalLink size={13} />
          {REPO_URL.replace(/^https:\/\//, '')}
        </a>
        <p className="md-about-note">
          Free and open source under the MIT License. Independent project inspired by GitKraken&apos;s UX; not affiliated with GitKraken/Axosoft.
        </p>
      </div>
    </Modal>
  )
}
