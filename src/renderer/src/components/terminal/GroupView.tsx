// A tab group's own view: its terminals, started in the folder its repositories share (an agent there works across
// all of them), with the group's repositories on the left: each one's branch and changes, a click away from its tab.

import { ChevronDown, FolderGit2, FolderOpen, Settings } from 'lucide-react'
import type { TabGroup } from '@shared/types'
import { groupOwner } from '@shared/terminal'
import { api, isMac } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { renameGroup } from '@renderer/actions/groups'
import { showMenuBelow } from '@renderer/components/common/ContextMenu'
import { ErrorBoundary } from '@renderer/components/common/ErrorBoundary'
import { Resizer } from '@renderer/components/common/Resizer'
import { groupStyle } from '@renderer/components/layout/GroupTray'
import { pluralize } from '@renderer/lib/format'
import { currentBranch } from '@renderer/lib/refs'
import { commonFolder, folderName, groupFolder } from '@renderer/lib/tabGroups'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { ownerState, shortFolder } from './model'
import { StateDot } from './parts'
import { TerminalWorkspace } from './TerminalView'
import { useTerminals } from './terminalStore'
import './terminal.css'

async function chooseFolder(group: TabGroup): Promise<void> {
  const picked = await api.pickDirectory({ title: `Folder for the terminals of ${group.name || 'this group'}`, defaultPath: groupFolder(group) }).catch(() => null)
  if (picked) useApp.getState().updateGroup(group.id, { folder: picked })
}

function RepoRow({ path, tab }: { path: string; tab: RepoTab | undefined }) {
  const state = useTerminals((s) => ownerState(s.infos, path))
  const cur = currentBranch(tab?.refs ?? null)
  const head = tab?.refs?.head ?? tab?.info?.head
  const branch = head?.branch ?? (head?.sha ? head.sha.slice(0, 7) : '')
  const status = tab?.status
  const changed = status ? new Set([...status.staged, ...status.unstaged, ...status.conflicted].map((f) => f.path)).size : 0
  const ahead = cur?.ahead ?? 0
  return (
    <button
      className="tm-repo"
      title={tab ? `${path}\nOpen its tab` : `${path}\nNot open: click to open it`}
      onClick={() => (tab ? useApp.getState().setActive(path) : void git.openRepoAt(path))}
    >
      <FolderGit2 size={15} className="tm-repo-icon" />
      <span className="tm-repo-text">
        <span className="tm-repo-line">
          <span className="tm-repo-name">{tab?.name ?? folderName(path)}</span>
          {state && <StateDot state={state} />}
          <span className="tm-repo-branch">{branch}</span>
        </span>
        <span className="tm-repo-line tm-repo-detail">
          {!tab ? (
            'not open'
          ) : (
            <>
              <span className={changed ? 'tm-repo-changed' : undefined}>{changed ? `${pluralize(changed, 'file')} changed` : 'no changes'}</span>
              {ahead > 0 && <span>· ↑{ahead} not pushed</span>}
            </>
          )}
        </span>
      </span>
    </button>
  )
}

export function GroupWorkspace({ group }: { group: TabGroup }) {
  const tabs = useApp((s) => s.tabs)
  const leftWidth = useApp((s) => s.settings.leftPanelWidth)
  const leftCollapsed = useApp((s) => s.leftCollapsed)
  const updateSettings = useApp((s) => s.updateSettings)
  const folder = groupFolder(group)
  const owner = groupOwner(group.id)
  const label = group.name || 'Unnamed group'

  const folderMenu = (el: HTMLElement) =>
    showMenuBelow(el, [
      { type: 'header', label: 'The group’s terminals start here' },
      { label: 'Choose Folder…', icon: <FolderOpen size={14} />, onClick: () => void chooseFolder(group) },
      {
        label: 'Use the Folder Its Repositories Share',
        disabled: !group.folder,
        onClick: () => useApp.getState().updateGroup(group.id, { folder: undefined })
      },
      { type: 'separator' },
      { label: isMac ? 'Reveal in Finder' : 'Show in Folder', onClick: () => void git.showInFolder(folder) }
    ])

  return (
    <>
      <div className="tb-toolbar tm-group-bar" style={groupStyle(group.color)}>
        <div className="tb-toolbar-left">
          <button className="tb-dropdown" title="Rename the group" onClick={() => void renameGroup(group.id)}>
            <span className="tb-dropdown-caption">group</span>
            <span className="tb-dropdown-value">
              <span className="tb-group-mark" aria-hidden="true" />
              <span className="tb-dropdown-text">{label}</span>
            </span>
          </button>
          <span className="tb-dropdown-sep" aria-hidden="true">
            /
          </span>
          <button className="tb-dropdown" title={`${folder}${group.folder ? '' : `\nThe folder its repositories share (${commonFolder(group.repos)})`}`} onClick={(e) => folderMenu(e.currentTarget)}>
            <span className="tb-dropdown-caption">folder</span>
            <span className="tb-dropdown-value">
              <span className="tb-dropdown-text tm-group-folder">{shortFolder(folder)}</span>
              <ChevronDown size={13} />
            </span>
          </button>
        </div>
        <div className="tb-toolbar-center" />
        <div className="tb-toolbar-right">
          <button className="tb-util" title="Settings" aria-label="Settings" onClick={() => useApp.getState().openModal({ kind: 'settings', section: 'terminal' })}>
            <Settings size={16} />
          </button>
        </div>
      </div>
      <div className="app-main">
        {!leftCollapsed && (
          <>
            <div className="app-left" style={{ width: leftWidth }}>
              <div className="tm-repos-head">
                <span>Repositories</span>
                <span className="tm-repos-count">{group.repos.length}</span>
              </div>
              <div className="tm-repos">
                {group.repos.map((path) => (
                  <RepoRow key={path} path={path} tab={tabs.find((t) => t.path === path)} />
                ))}
              </div>
            </div>
            <Resizer side="left" width={leftWidth} min={180} max={520} onResize={(w) => void updateSettings({ leftPanelWidth: w })} />
          </>
        )}
        <ErrorBoundary area="the terminal" resetKey={owner}>
          <TerminalWorkspace owner={owner} cwd={folder} />
        </ErrorBoundary>
      </div>
    </>
  )
}
