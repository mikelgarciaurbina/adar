// Renders the application modal stored in store.modal.

import { useApp } from '@renderer/store/appStore'
import { AboutModal } from './AboutModal'
import { IdentityModal } from './IdentityModal'
import { RemotesModal } from './RemotesModal'
import { CloneModal, InitModal, OpenModal } from './RepoModals'
import { SettingsModal } from './SettingsModal'
import './modals.css'

export function ModalHost() {
  const modal = useApp((s) => s.modal)
  if (!modal) return null
  switch (modal.kind) {
    case 'clone':
      return <CloneModal key={`clone:${modal.url ?? ''}`} initialUrl={modal.url} />
    case 'init':
      return <InitModal />
    case 'open':
      return <OpenModal />
    case 'settings':
      return <SettingsModal key={modal.section ?? ''} section={modal.section} />
    case 'identity':
      return <IdentityModal key={modal.repo ?? ''} repo={modal.repo} />
    case 'remotes':
      return <RemotesModal key={modal.repo} repo={modal.repo} />
    case 'about':
      return <AboutModal />
    default:
      return null
  }
}
