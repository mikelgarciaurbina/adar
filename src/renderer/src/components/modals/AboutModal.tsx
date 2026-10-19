import { Info } from 'lucide-react'
import { Button } from '@renderer/components/common/Button'
import { Modal } from '@renderer/components/common/Modal'
import { formatGitVersion } from '@renderer/components/layout/chrome'
import { AdarLogo } from '@renderer/components/layout/Logo'
import { useApp } from '@renderer/store/appStore'
import { closeIfTopmost } from './controls'

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function AboutModal() {
  const appInfo = useApp((s) => s.appInfo)
  const gitVersion = formatGitVersion(appInfo?.gitVersion)
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
        <Button variant="primary" onClick={() => closeIfTopmost('md-about')} autoFocus>
          Close
        </Button>
      }
    >
      <div className="md-about-body">
        <AdarLogo size={72} />
        <div className="md-about-name">Adar</div>
        <div className="md-about-meaning">
          <em>adar</em> · “branch” in Basque
        </div>
        <div className="md-about-tagline">A visual Git client for every repository.</div>
        <dl className="md-about-grid">
          <dt>Version</dt>
          <dd>{appInfo?.version ?? '—'}</dd>
          <dt>Git</dt>
          <dd>{gitVersion || appInfo?.gitVersion || '—'}</dd>
          <dt>Platform</dt>
          <dd>{appInfo ? `${PLATFORM_LABEL[appInfo.platform] ?? appInfo.platform}${appInfo.isElectron ? '' : ' (browser dev mode)'}` : '—'}</dd>
        </dl>
        <p className="md-about-note">Independent project inspired by GitKraken&apos;s UX; not affiliated with GitKraken/Axosoft.</p>
      </div>
    </Modal>
  )
}
