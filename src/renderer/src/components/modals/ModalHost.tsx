// Renders the application modal stored in store.modal.

import { ConnectDialog } from '@renderer/components/pulls/ConnectDialog'
import { CreatePullDialog } from '@renderer/components/pulls/CreatePullDialog'
import { WhatsNewModal } from '@renderer/components/update/WhatsNew'
import { useApp } from '@renderer/store/appStore'
import { AboutModal } from './AboutModal'
import { BranchCleanupDialog } from './BranchCleanupDialog'
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
    case 'whats-new':
      return <WhatsNewModal from={modal.from} />
    case 'pulls-connect':
      return <ConnectDialog key={`${modal.provider}\0${modal.server ?? ''}`} provider={modal.provider} server={modal.server} remoteHost={modal.remoteHost} next={modal.next} />
    case 'branch-cleanup':
      return <BranchCleanupDialog key={modal.repo} repo={modal.repo} />
    case 'create-pull':
      return <CreatePullDialog key={`${modal.repo}\0${modal.head ?? ''}`} repo={modal.repo} head={modal.head} base={modal.base} />
    default:
      return null
  }
}
