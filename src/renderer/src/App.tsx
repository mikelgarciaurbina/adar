import { useEffect } from 'react'
import { ContextMenuHost } from '@renderer/components/common/ContextMenu'
import { DialogHost } from '@renderer/components/common/dialogs'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
import { Resizer } from '@renderer/components/common/Resizer'
import { ToastHost } from '@renderer/components/common/toast'
import { Spinner } from '@renderer/components/common/Button'
import { ConflictView } from '@renderer/components/conflicts/ConflictView'
import { OperationBanner } from '@renderer/components/conflicts/OperationBanner'
import { RightPanel } from '@renderer/components/details/RightPanel'
import { BlameView } from '@renderer/components/diff/BlameView'
import { DiffView } from '@renderer/components/diff/DiffView'
import { FileHistoryView } from '@renderer/components/diff/FileHistoryView'
import { CommitGraph } from '@renderer/components/graph/CommitGraph'
import { StatusBar } from '@renderer/components/layout/StatusBar'
import { TabBar } from '@renderer/components/layout/TabBar'
import { Toolbar } from '@renderer/components/layout/Toolbar'
import { Welcome } from '@renderer/components/layout/Welcome'
import { CredentialDialog } from '@renderer/components/modals/CredentialDialog'
import { ModalHost } from '@renderer/components/modals/ModalHost'
import { CommandPalette } from '@renderer/components/palette/CommandPalette'
import { GitConsole } from '@renderer/components/palette/GitConsole'
import { RebaseView } from '@renderer/components/rebase/RebaseView'
import { UpdateNotice } from '@renderer/components/update/UpdateNotice'
import { LeftPanel } from '@renderer/components/sidebar/LeftPanel'
import { useAutoFetch, useBackendEvents, useGlobalShortcuts, useRefreshOnFocus, useTheme } from '@renderer/hooks/useAppEffects'
import { useActiveTab, useApp, type RepoTab } from '@renderer/store/appStore'

function CenterPanel({ tab }: { tab: RepoTab }) {
  const view = tab.center
  switch (view.kind) {
    case 'diff':
      return <DiffView key={JSON.stringify(view.target)} tab={tab} target={view.target} siblings={view.siblings} />
    case 'conflict':
      return <ConflictView key={view.path} tab={tab} path={view.path} />
    case 'rebase':
      return <RebaseView key={view.base} tab={tab} base={view.base} />
    case 'history':
      return <FileHistoryView key={view.path} tab={tab} path={view.path} />
    case 'blame':
      return <BlameView key={`${view.path}@${view.rev ?? ''}`} tab={tab} path={view.path} rev={view.rev} />
    default:
      return <CommitGraph tab={tab} />
  }
}

function RepoWorkspace({ tab }: { tab: RepoTab }) {
  const leftCollapsed = useApp((s) => s.leftCollapsed)
  const rightCollapsed = useApp((s) => s.rightCollapsed)
  const leftWidth = useApp((s) => s.settings.leftPanelWidth)
  const rightWidth = useApp((s) => s.settings.rightPanelWidth)
  const updateSettings = useApp((s) => s.updateSettings)

  return (
    <>
      <Toolbar tab={tab} />
      <div className="app-main">
        {!leftCollapsed && (
          <>
            <div className="app-left" style={{ width: leftWidth }}>
              <ErrorBoundary area="the left panel" resetKey={tab.path}>
                <LeftPanel tab={tab} />
              </ErrorBoundary>
            </div>
            <Resizer side="left" width={leftWidth} min={180} max={520} onResize={(w) => void updateSettings({ leftPanelWidth: w })} />
          </>
        )}
        <div className="app-center">
          <OperationBanner tab={tab} />
          <div className="app-center-body">
            <ErrorBoundary area="this view" resetKey={`${tab.path}:${tab.center.kind}`}>
              <CenterPanel tab={tab} />
            </ErrorBoundary>
          </div>
        </div>
        {!rightCollapsed && (
          <>
            <Resizer side="right" width={rightWidth} min={280} max={720} onResize={(w) => void updateSettings({ rightPanelWidth: w })} />
            <div className="app-right" style={{ width: rightWidth }}>
              <ErrorBoundary area="the right panel" resetKey={tab.path}>
                <RightPanel tab={tab} />
              </ErrorBoundary>
            </div>
          </>
        )}
      </div>
    </>
  )
}

export function App() {
  const ready = useApp((s) => s.ready)
  const tab = useActiveTab()

  useEffect(() => {
    void useApp.getState().init()
  }, [])
  useBackendEvents()
  useGlobalShortcuts()
  useAutoFetch()
  useRefreshOnFocus()
  useTheme()

  return (
    <div className="app">
      <TabBar />
      {!ready ? (
        <div className="app-loading">
          <Spinner size="lg" />
        </div>
      ) : tab ? (
        <RepoWorkspace key={tab.path} tab={tab} />
      ) : (
        <Welcome />
      )}
      <StatusBar />
      <GitConsole />
      <ModalHost />
      <CommandPalette />
      <CredentialDialog />
      <UpdateNotice />
      <DialogHost />
      <ContextMenuHost />
      <ToastHost />
    </div>
  )
}
