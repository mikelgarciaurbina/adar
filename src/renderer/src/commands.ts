// Command registry shared by the native menu, keyboard shortcuts and the
// command palette. The palette may add dynamic entries (branches, files...)
// on top of these.

import * as git from '@renderer/actions/git'
import { checkForUpdatesNow } from '@renderer/components/update/UpdateNotice'
import { getActiveTab, useApp } from '@renderer/store/appStore'
import type { MenuCommand } from '@shared/types'

export interface Command {
  id: string
  label: string
  /** Group shown in the palette. */
  group: 'Repository' | 'Branch' | 'Remote' | 'Stash' | 'View' | 'App' | 'Changes'
  /** Shortcut spec for display, e.g. "Mod+Shift+S" (see lib/keys.ts shortcutLabel). */
  shortcut?: string
  /** Hidden from the palette when it returns false. */
  when?: () => boolean
  run: () => void | Promise<void>
}

const hasRepo = () => !!getActiveTab()
const repoPath = () => getActiveTab()?.path ?? ''
const withRepo = (fn: (repo: string) => unknown) => () => {
  const repo = repoPath()
  if (repo) void fn(repo)
}

const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
function zoom(dir: 1 | -1 | 0) {
  const s = useApp.getState()
  if (dir === 0) return void s.updateSettings({ zoom: 1 })
  const cur = s.settings.zoom || 1
  const idx = ZOOM_STEPS.findIndex((z) => z >= cur - 0.001)
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (idx < 0 ? 4 : idx) + dir))]
  void s.updateSettings({ zoom: next })
}

function cycleTab(dir: 1 | -1) {
  const s = useApp.getState()
  if (!s.tabs.length) return
  const i = s.tabs.findIndex((t) => t.path === s.activePath)
  s.setActive(s.tabs[(i + dir + s.tabs.length) % s.tabs.length].path)
}

export const COMMANDS: Command[] = [
  { id: 'open-repo', label: 'Open Repository…', group: 'App', shortcut: 'Mod+O', run: () => git.openRepoDialog() },
  { id: 'clone-repo', label: 'Clone Repository…', group: 'App', shortcut: 'Mod+Shift+N', run: () => useApp.getState().openModal({ kind: 'clone' }) },
  { id: 'init-repo', label: 'Init Repository…', group: 'App', shortcut: 'Mod+Alt+N', run: () => useApp.getState().openModal({ kind: 'init' }) },
  { id: 'close-tab', label: 'Close Tab', group: 'App', shortcut: 'Mod+W', when: hasRepo, run: withRepo((r) => useApp.getState().closeTab(r)) },
  { id: 'next-tab', label: 'Next Tab', group: 'App', shortcut: 'Ctrl+Tab', run: () => cycleTab(1) },
  { id: 'prev-tab', label: 'Previous Tab', group: 'App', shortcut: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
  { id: 'settings', label: 'Settings…', group: 'App', shortcut: 'Mod+,', run: () => useApp.getState().openModal({ kind: 'settings' }) },
  { id: 'about', label: 'About Adar', group: 'App', run: () => useApp.getState().openModal({ kind: 'about' }) },
  { id: 'check-for-updates', label: 'Check for Updates…', group: 'App', run: () => checkForUpdatesNow() },
  { id: 'command-palette', label: 'Command Palette', group: 'App', shortcut: 'Mod+P', run: () => useApp.getState().setPaletteOpen(true) },
  {
    id: 'search-commits',
    label: 'Find Commit…',
    group: 'View',
    shortcut: 'Mod+F',
    when: hasRepo,
    run: withRepo((r) => {
      useApp.getState().setCenter(r, { kind: 'graph' })
      useApp.getState().setSearch(r, { open: true })
    })
  },
  { id: 'fetch', label: 'Fetch All', group: 'Remote', shortcut: 'Mod+Shift+F', when: hasRepo, run: withRepo((r) => git.fetchAll(r)) },
  { id: 'pull', label: 'Pull', group: 'Remote', shortcut: 'Mod+Shift+Down', when: hasRepo, run: withRepo((r) => git.pull(r)) },
  { id: 'pull-ff', label: 'Pull (fast-forward only)', group: 'Remote', when: hasRepo, run: withRepo((r) => git.pull(r, 'ff-only')) },
  { id: 'pull-merge', label: 'Pull (merge)', group: 'Remote', when: hasRepo, run: withRepo((r) => git.pull(r, 'merge')) },
  { id: 'pull-rebase', label: 'Pull (rebase)', group: 'Remote', when: hasRepo, run: withRepo((r) => git.pull(r, 'rebase')) },
  { id: 'push', label: 'Push', group: 'Remote', shortcut: 'Mod+Shift+Up', when: hasRepo, run: withRepo((r) => git.push(r)) },
  { id: 'force-push', label: 'Force Push (with lease)', group: 'Remote', when: hasRepo, run: withRepo((r) => git.push(r, { force: 'with-lease' })) },
  { id: 'manage-remotes', label: 'Manage Remotes…', group: 'Remote', when: hasRepo, run: withRepo((r) => useApp.getState().openModal({ kind: 'remotes', repo: r })) },
  { id: 'create-branch', label: 'Create Branch…', group: 'Branch', shortcut: 'Mod+B', when: hasRepo, run: withRepo((r) => git.createBranch(r)) },
  { id: 'stash', label: 'Stash Changes', group: 'Stash', shortcut: 'Mod+Shift+S', when: hasRepo, run: withRepo((r) => git.stash(r)) },
  { id: 'stash-message', label: 'Stash Changes with Message…', group: 'Stash', when: hasRepo, run: withRepo((r) => git.stash(r, { askMessage: true })) },
  { id: 'pop-stash', label: 'Pop Stash', group: 'Stash', shortcut: 'Mod+Alt+S', when: hasRepo, run: withRepo((r) => git.popStash(r)) },
  { id: 'stage-all', label: 'Stage All Changes', group: 'Changes', shortcut: 'Mod+Shift+A', when: hasRepo, run: withRepo((r) => git.stageAll(r)) },
  { id: 'unstage-all', label: 'Unstage All Changes', group: 'Changes', when: hasRepo, run: withRepo((r) => git.unstageAll(r)) },
  { id: 'discard-all', label: 'Discard All Changes…', group: 'Changes', when: hasRepo, run: withRepo((r) => git.discardAll(r)) },
  {
    id: 'commit',
    label: 'Go to Commit Message',
    group: 'Changes',
    when: hasRepo,
    run: withRepo((r) => {
      useApp.getState().select(r, { kind: 'wip' })
      setTimeout(() => document.querySelector<HTMLElement>('[data-commit-summary]')?.focus(), 50)
    })
  },
  { id: 'undo', label: 'Undo', group: 'Repository', shortcut: 'Mod+Z', when: hasRepo, run: withRepo((r) => git.undo(r)) },
  { id: 'redo', label: 'Redo', group: 'Repository', shortcut: 'Mod+Shift+Z', when: hasRepo, run: withRepo((r) => git.redo(r)) },
  {
    id: 'refresh',
    label: 'Refresh',
    group: 'View',
    shortcut: 'Mod+R',
    when: hasRepo,
    run: withRepo((r) => useApp.getState().refresh(r))
  },
  { id: 'show-graph', label: 'Show Graph', group: 'View', when: hasRepo, run: withRepo((r) => git.showGraph(r)) },
  { id: 'toggle-left-panel', label: 'Toggle Left Panel', group: 'View', shortcut: 'Mod+J', run: () => useApp.getState().toggleLeft() },
  { id: 'toggle-right-panel', label: 'Toggle Right Panel', group: 'View', shortcut: 'Mod+K', run: () => useApp.getState().toggleRight() },
  { id: 'zoom-in', label: 'Zoom In', group: 'View', shortcut: 'Mod+=', run: () => zoom(1) },
  { id: 'zoom-out', label: 'Zoom Out', group: 'View', shortcut: 'Mod+-', run: () => zoom(-1) },
  { id: 'zoom-reset', label: 'Actual Size', group: 'View', shortcut: 'Mod+0', run: () => zoom(0) },
  { id: 'open-in-terminal', label: 'Open in Terminal', group: 'Repository', shortcut: 'Mod+Alt+T', when: hasRepo, run: withRepo((r) => git.openInTerminal(r)) },
  { id: 'open-in-finder', label: 'Reveal in Finder', group: 'Repository', shortcut: 'Mod+Alt+R', when: hasRepo, run: withRepo((r) => git.showInFolder(r)) },
  { id: 'open-in-editor', label: 'Open in Editor', group: 'Repository', when: hasRepo, run: withRepo((r) => git.openInEditor(r)) },
  { id: 'git-console', label: 'Git Console', group: 'Repository', shortcut: 'Ctrl+`', when: hasRepo, run: () => useApp.getState().setConsoleOpen(!useApp.getState().consoleOpen) },
  { id: 'identity', label: 'Set Author Identity…', group: 'Repository', when: hasRepo, run: withRepo((r) => useApp.getState().openModal({ kind: 'identity', repo: r })) },
  { id: 'abort-operation', label: 'Abort Merge/Rebase/Cherry-pick', group: 'Repository', when: () => (getActiveTab()?.info?.state ?? 'none') !== 'none', run: withRepo((r) => git.abortOperation(r)) },
  { id: 'continue-operation', label: 'Continue Merge/Rebase/Cherry-pick', group: 'Repository', when: () => (getActiveTab()?.info?.state ?? 'none') !== 'none', run: withRepo((r) => git.continueOperation(r)) },
  { id: 'update-submodules', label: 'Update Submodules', group: 'Repository', when: () => !!getActiveTab()?.refs?.submodules.length, run: withRepo((r) => git.updateSubmodules(r)) }
]

const byId = new Map(COMMANDS.map((c) => [c.id, c]))

export function getCommand(id: string): Command | undefined {
  return byId.get(id)
}

export function runCommand(id: MenuCommand | string): void {
  const cmd = byId.get(id)
  if (!cmd) {
    console.warn('[adar] unknown command', id)
    return
  }
  if (cmd.when && !cmd.when()) return
  void cmd.run()
}
