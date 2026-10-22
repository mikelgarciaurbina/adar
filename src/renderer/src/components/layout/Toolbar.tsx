// Repository toolbar (GitKraken style): repository & branch dropdowns on the left,
// big icon buttons with labels in the centre, utilities on the right. Empty space
// is a window drag region.

import { useState, type ReactNode } from 'react'
import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Archive,
  ChevronDown,
  Code,
  FolderOpen,
  GitBranchPlus,
  Network,
  Redo2,
  RefreshCw,
  Search,
  Settings,
  SquareTerminal,
  Terminal,
  Undo2,
  UserRound
} from 'lucide-react'
import { isMac } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { Spinner } from '@renderer/components/common/Button'
import { showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { getCommand, runCommand } from '@renderer/commands'
import { shortcutLabel } from '@renderer/lib/keys'
import { currentBranch } from '@renderer/lib/refs'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { PullMode } from '@shared/types'
import { BranchDot } from './BranchDot'
import { BranchPicker } from './BranchPicker'
import { badgeCount, distinctParents, isBusyFor } from './chrome'
import { repoLifecycleItems } from './TabBar'
import './layout.css'

const PULL_MODE_LABEL: Record<PullMode, string> = {
  merge: 'Pull (fast-forward if possible)',
  'ff-only': 'Pull (fast-forward only)',
  rebase: 'Pull (rebase)'
}

/** "Label (⌘X)" using the shortcut registered for a command id. */
function withShortcut(text: string, commandId: string): string {
  const spec = getCommand(commandId)?.shortcut
  return spec ? `${text} (${shortcutLabel(spec)})` : text
}

function shortcutOf(commandId: string): string | undefined {
  const spec = getCommand(commandId)?.shortcut
  return spec ? shortcutLabel(spec) : undefined
}

interface ToolButtonProps {
  icon: ReactNode
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  badge?: string
  className?: string
}

function ToolButton({ icon, label, title, onClick, disabled, busy, badge, className }: ToolButtonProps) {
  return (
    <button className={`tb-tool${className ? ' ' + className : ''}`} onClick={onClick} disabled={disabled} title={title} aria-label={title}>
      <span className="tb-tool-icon">
        {busy ? <Spinner size="md" /> : icon}
        {badge && !busy && <span className="tb-badge">{badge}</span>}
      </span>
      <span className="tb-tool-label">{label}</span>
    </button>
  )
}

function UtilityButton({ icon, title, onClick, active }: { icon: ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button className={`tb-util${active ? ' tb-util-active' : ''}`} onClick={onClick} title={title} aria-label={title} aria-pressed={active}>
      {icon}
    </button>
  )
}

export function Toolbar({ tab }: { tab: RepoTab }) {
  const repo = tab.path
  const busy = useApp((s) => s.busy)
  const defaultPullMode = useApp((s) => s.settings.defaultPullMode)
  const consoleOpen = useApp((s) => s.consoleOpen)
  const [branchAnchor, setBranchAnchor] = useState<HTMLElement | null>(null)

  const head = tab.refs?.head ?? tab.info?.head ?? null
  const cur = currentBranch(tab.refs)
  const ahead = cur?.ahead ?? 0
  const behind = cur?.behind ?? 0
  const stashCount = tab.refs?.stashes.length ?? 0
  const lastUndo = tab.undoStack[tab.undoStack.length - 1]
  const lastRedo = tab.redoStack[tab.redoStack.length - 1]
  const status = tab.status
  const clean = !!status && status.staged.length === 0 && status.unstaged.length === 0 && status.conflicted.length === 0

  const fetching = isBusyFor(busy, 'fetch', repo)
  const pulling = isBusyFor(busy, 'pull', repo) || fetching
  const pushing = isBusyFor(busy, 'push', repo)
  const stashing = isBusyFor(busy, 'stash', repo)

  const branchLabel = head ? (head.branch ?? (head.detached ? 'detached HEAD' : 'no branch')) : '…'
  const branchTitle = head?.detached && head.sha ? `HEAD detached at ${head.sha.slice(0, 7)}` : head?.unborn ? `${branchLabel} (no commits yet)` : branchLabel

  const openRepoMenu = (el: HTMLElement) => {
    const s = useApp.getState()
    // Open tabs first (in case they are not in recents yet), then recent repos.
    const entries: Array<{ path: string; name: string }> = []
    const seen = new Set<string>()
    for (const r of [...s.tabs.map((t) => ({ path: t.path, name: t.name })), ...s.recent]) {
      if (seen.has(r.path)) continue
      seen.add(r.path)
      entries.push({ path: r.path, name: r.name })
    }
    const shown = entries.slice(0, 15)
    const hints = distinctParents(shown)
    const items: MenuItem[] = [{ type: 'header', label: 'Repositories' }]
    for (const e of shown) {
      const hint = hints.get(e.path)
      items.push({
        label: hint ? `${e.name} — ${hint}` : e.name,
        checked: e.path === repo,
        onClick: () => (e.path === repo ? undefined : git.openRepoAt(e.path))
      })
    }
    items.push(
      { type: 'separator' },
      ...repoLifecycleItems(),
      { type: 'separator' },
      { label: 'Manage Remotes…', icon: <Network size={14} />, onClick: () => s.openModal({ kind: 'remotes', repo }) },
      { label: 'Author Identity…', icon: <UserRound size={14} />, onClick: () => s.openModal({ kind: 'identity', repo }) },
      { label: isMac ? 'Reveal in Finder' : 'Show in Folder', icon: <FolderOpen size={14} />, shortcut: shortcutOf('open-in-finder'), onClick: () => git.showInFolder(repo) },
      { label: 'Open in Editor', icon: <Code size={14} />, onClick: () => git.openInEditor(repo) },
      { label: 'Refresh', icon: <RefreshCw size={14} />, shortcut: shortcutOf('refresh'), onClick: () => s.refresh(repo) }
    )
    showMenuBelow(el, items)
  }

  const openPullMenu = (el: HTMLElement) => {
    const setDefault = (mode: PullMode) => void useApp.getState().updateSettings({ defaultPullMode: mode })
    const modes: PullMode[] = ['merge', 'ff-only', 'rebase']
    showMenuBelow(el, [
      { label: 'Fetch All', icon: <RefreshCw size={14} />, shortcut: shortcutOf('fetch'), disabled: fetching, onClick: () => git.fetchAll(repo) },
      { type: 'separator' },
      ...modes.map<MenuItem>((m) => ({
        label: PULL_MODE_LABEL[m],
        // The default mode is what the Pull button and its shortcut run.
        shortcut: defaultPullMode === m ? (shortcutOf('pull') ?? 'default') : undefined,
        disabled: pulling,
        onClick: () => git.pull(repo, m)
      })),
      { type: 'separator' },
      {
        label: 'Set Default',
        submenu: modes.map<MenuItem>((m) => ({ label: PULL_MODE_LABEL[m], checked: defaultPullMode === m, onClick: () => setDefault(m) }))
      }
    ])
  }

  const pullTitle =
    withShortcut(PULL_MODE_LABEL[defaultPullMode], 'pull') + (behind && cur?.upstream ? ` — ${behind} commit${behind === 1 ? '' : 's'} behind ${cur.upstream}` : '')
  const pushTitle =
    withShortcut('Push', 'push') +
    (ahead && cur?.upstream ? ` — ${ahead} commit${ahead === 1 ? '' : 's'} ahead of ${cur.upstream}` : cur && !cur.upstream ? ` — ${cur.name} has no upstream yet` : '')

  return (
    <div className="tb-toolbar">
      <div className="tb-toolbar-left">
        <button className="tb-dropdown" onClick={(e) => openRepoMenu(e.currentTarget)} title={repo}>
          <span className="tb-dropdown-caption">repository</span>
          <span className="tb-dropdown-value">
            <span className="tb-dropdown-text">{tab.name}</span>
            <ChevronDown size={13} />
          </span>
        </button>
        <span className="tb-dropdown-sep" aria-hidden="true">
          /
        </span>
        <button
          className={`tb-dropdown${branchAnchor ? ' tb-dropdown-open' : ''}`}
          onClick={(e) => setBranchAnchor(branchAnchor ? null : e.currentTarget)}
          title={branchTitle}
          aria-haspopup="dialog"
          aria-expanded={!!branchAnchor}
        >
          <span className="tb-dropdown-caption">branch</span>
          <span className="tb-dropdown-value">
            <BranchDot repo={tab.path} sha={head?.sha ?? null} />
            <span className={`tb-dropdown-text${head?.detached ? ' tb-detached' : ''}`}>{branchLabel}</span>
            <ChevronDown size={13} />
          </span>
        </button>
        {branchAnchor && <BranchPicker tab={tab} anchor={branchAnchor} onClose={() => setBranchAnchor(null)} />}
      </div>

      <div className="tb-toolbar-center">
        <ToolButton
          icon={<Undo2 size={18} />}
          label="Undo"
          title={lastUndo ? withShortcut(`Undo: ${lastUndo.label}`, 'undo') : 'Nothing to undo'}
          disabled={!lastUndo}
          onClick={() => void git.undo(repo)}
        />
        <ToolButton
          icon={<Redo2 size={18} />}
          label="Redo"
          title={lastRedo ? withShortcut(`Redo: ${lastRedo.label}`, 'redo') : 'Nothing to redo'}
          disabled={!lastRedo}
          onClick={() => void git.redo(repo)}
        />
        <span className="tb-tool-sep" aria-hidden="true" />
        <div className="tb-split">
          <ToolButton
            icon={<ArrowDownToLine size={18} />}
            label="Pull"
            title={pullTitle}
            busy={pulling}
            badge={badgeCount(behind)}
            onClick={() => !pulling && void git.pull(repo)}
          />
          <button className="tb-split-caret" title="Pull options" aria-label="Pull options" onClick={(e) => openPullMenu(e.currentTarget.parentElement ?? e.currentTarget)}>
            <ChevronDown size={12} />
          </button>
        </div>
        <ToolButton
          icon={<ArrowUpFromLine size={18} />}
          label="Push"
          title={pushTitle}
          busy={pushing}
          badge={badgeCount(ahead)}
          onClick={() => !pushing && void git.push(repo)}
        />
        <span className="tb-tool-sep" aria-hidden="true" />
        <ToolButton
          icon={<GitBranchPlus size={18} />}
          label="Branch"
          title={withShortcut('Create branch', 'create-branch')}
          onClick={() => void git.createBranch(repo)}
        />
        <ToolButton
          icon={<Archive size={18} />}
          label="Stash"
          title={clean ? 'No local changes to stash' : withShortcut('Stash changes', 'stash')}
          busy={stashing}
          disabled={clean}
          onClick={() => !stashing && void git.stash(repo)}
        />
        <ToolButton
          icon={<ArchiveRestore size={18} />}
          label="Pop"
          title={stashCount ? withShortcut(`Pop stash@{0}${tab.refs?.stashes[0] ? ` — ${tab.refs.stashes[0].message}` : ''}`, 'pop-stash') : 'No stashes'}
          disabled={!stashCount || stashing}
          badge={stashCount > 1 ? badgeCount(stashCount) : undefined}
          onClick={() => void git.popStash(repo)}
        />
      </div>

      <div className="tb-toolbar-right">
        <UtilityButton icon={<Search size={16} />} title={withShortcut('Find commit', 'search-commits')} onClick={() => runCommand('search-commits')} />
        <UtilityButton icon={<SquareTerminal size={16} />} title={withShortcut('Open in terminal', 'open-in-terminal')} onClick={() => void git.openInTerminal(repo)} />
        <UtilityButton
          icon={<Terminal size={16} />}
          title={withShortcut(consoleOpen ? 'Hide Git console' : 'Show Git console', 'git-console')}
          active={consoleOpen}
          onClick={() => useApp.getState().setConsoleOpen(!consoleOpen)}
        />
        <UtilityButton icon={<Settings size={16} />} title={withShortcut('Settings', 'settings')} onClick={() => useApp.getState().openModal({ kind: 'settings' })} />
      </div>
    </div>
  )
}
