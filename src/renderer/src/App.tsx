import { useEffect } from 'react'
import { ContextMenuHost } from '@renderer/components/common/ContextMenu'
import { DialogHost } from '@renderer/components/common/dialogs'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
import { Resizer, RowResizer } from '@renderer/components/common/Resizer'
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
import { showWhatsNewAfterUpdate } from '@renderer/components/update/WhatsNew'
import { usePullRequestSync } from '@renderer/components/pulls/pullStore'
import { ReflogView } from '@renderer/components/reflog/ReflogView'
import { ReviewView } from '@renderer/components/review/ReviewView'
import { InboxView } from '@renderer/components/pulls/InboxView'
import { useAgentSync } from '@renderer/components/agents/agentStore'
import { LeftPanel } from '@renderer/components/sidebar/LeftPanel'
import { GroupWorkspace } from '@renderer/components/terminal/GroupView'
import { TerminalWorkspace } from '@renderer/components/terminal/TerminalView'
import { useTerminalSync } from '@renderer/components/terminal/terminalStore'
import { TerminalLinkLayer } from '@renderer/components/terminal/LinkLayer'
import { MarkdownReader } from '@renderer/components/markdown/MarkdownReader'
import { showTerminal, terminalsAvailable } from '@renderer/actions/terminal'
import { useAutoFetch, useBackendEvents, useGlobalShortcuts, useOpenRequests, useRefreshOnFocus, useTheme } from '@renderer/hooks/useAppEffects'
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
    case 'reflog':
      return <ReflogView tab={tab} mode={view.mode} />
    case 'review':
      return <ReviewView key={view.number} tab={tab} view={view} />
    case 'work-review':
      return <ReviewView key="work" tab={tab} view={view} />
    case 'inbox':
      return <InboxView tab={tab} />
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
  // A review has its own file list on the left; the inbox spans the window.
  const wide = tab.center.kind === 'inbox'
  const left = !leftCollapsed && tab.center.kind !== 'review' && tab.center.kind !== 'work-review' && !wide
  const right = !rightCollapsed && !wide
  // What the tab shows: the graph, the terminal, or the graph with the terminal docked under it.
  const view = useApp((s) => (terminalsAvailable ? (s.settings.terminalViews[tab.path] ?? 'graph') : 'graph'))
  const dock = useApp((s) => s.settings.terminalDockHeight)

  if (view === 'terminal') {
    return (
      <>
        <Toolbar tab={tab} />
        <div className="app-main">
          <ErrorBoundary area="the terminal" resetKey={tab.path}>
            <TerminalWorkspace owner={tab.path} cwd={tab.path} />
          </ErrorBoundary>
        </div>
      </>
    )
  }

  return (
    <>
      <Toolbar tab={tab} />
      <div className="app-main">
        {left && (
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
        {right && (
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
      {view === 'both' && (
        <>
          <RowResizer height={dock} min={140} max={() => Math.max(180, window.innerHeight - 280)} onResize={(h) => void updateSettings({ terminalDockHeight: h })} />
          <div className="app-dock" style={{ height: dock }}>
            <ErrorBoundary area="the terminal" resetKey={tab.path}>
              <TerminalWorkspace owner={tab.path} cwd={tab.path} />
            </ErrorBoundary>
          </div>
        </>
      )}
    </>
  )
}

export function App() {
  const ready = useApp((s) => s.ready)
  const tab = useActiveTab()
  // A tab group's own view (its terminals) may be in front instead of a repository's tab.
  const group = useApp((s) => (s.groupView ? (s.settings.tabGroups.find((g) => `group:${g.id}` === s.groupView) ?? null) : null))

  useEffect(() => {
    void useApp.getState().init()
  }, [])
  useEffect(() => {
    if (ready) showWhatsNewAfterUpdate()
  }, [ready])
  useBackendEvents()
  useGlobalShortcuts()
  useAutoFetch()
  useRefreshOnFocus()
  useOpenRequests()
  useTheme()
  usePullRequestSync()
  useAgentSync()
  useTerminalSync(showTerminal)

  return (
    <div className="app">
      <TabBar />
      {!ready ? (
        <div className="app-loading">
          <Spinner size="lg" />
        </div>
      ) : group ? (
        <GroupWorkspace key={group.id} group={group} />
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
      <TerminalLinkLayer />
      <MarkdownReader />
      <ToastHost />
    </div>
  )
}
