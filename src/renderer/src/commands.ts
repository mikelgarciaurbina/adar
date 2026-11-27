// Command registry shared by the native menu, keyboard shortcuts and the
// command palette. The palette may add dynamic entries (branches, files...)
// on top of these.

import * as git from '@renderer/actions/git'
import { installCliCommand, uninstallCliCommand } from '@renderer/actions/cli'
import { openMarkdownDialog, openMarkdownWithAdar } from '@renderer/actions/markdown'
import { closeFiles, closeSheet, openFileDialog, toggleFiles } from '@renderer/actions/editor'
import { editorKey, useEditor } from '@renderer/components/editor/editorStore'
import { closeMarkdown, useMarkdown } from '@renderer/components/markdown/markdownStore'
import { openBranchCleanup, openKeptBranches } from '@renderer/actions/cleanup'
import { openReflog } from '@renderer/actions/reflog'
import { openWorkReview } from '@renderer/actions/workReview'
import { newWorktree } from '@renderer/actions/worktrees'
import {
  clearFocusedTerminal,
  closeFocusedTerminal,
  equalizeTerminals,
  findInTerminal,
  focusPane,
  newTerminal,
  setTerminalView,
  splitTerminal,
  stepTerminalTab,
  terminalHasKeyboard,
  terminalOwner,
  terminalsAvailable,
  toggleTerminal,
  zoomTerminal
} from '@renderer/actions/terminal'
import { openConnect, selectPull, startPullRequest, turnOffPullRequests } from '@renderer/actions/pulls'
import { openInbox, openReview } from '@renderer/actions/review'
import { anyPullsOn, hostingOn, pullIndexOf, repoHosting, usePulls } from '@renderer/components/pulls/pullStore'
import { currentBranch } from '@renderer/lib/refs'
import { isElectron, platform } from '@renderer/api/client'
import { FOCUS_FILTER_EVENT } from '@renderer/components/sidebar/LeftPanel'
import { checkForUpdatesNow } from '@renderer/components/update/UpdateNotice'
import { getActiveTab, useApp } from '@renderer/store/appStore'
import type { MenuCommand } from '@shared/types'

export interface Command {
  id: string
  label: string
  /** Group shown in the palette. */
  group: 'Repository' | 'Branch' | 'Remote' | 'Stash' | 'View' | 'App' | 'Changes' | 'Terminal'
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

const activeHosting = () => repoHosting(getActiveTab())
const githubOn = () => !!usePulls.getState().connection?.method
/** The open pull request of the checked-out branch, if any. */
const currentPull = () => {
  const tab = getActiveTab()
  const cur = currentBranch(tab?.refs ?? null)
  if (!tab || !cur) return undefined
  const pr = pullIndexOf(usePulls.getState().repos[tab.path]?.data, tab.refs).byLocal.get(cur.name)
  return pr && (pr.state === 'open' || pr.state === 'draft') ? pr : undefined
}

/** The pull request to review: the one shown in the right panel, else the checked-out branch's. */
const reviewTarget = () => {
  const tab = getActiveTab()
  if (!tab) return undefined
  const data = usePulls.getState().repos[tab.path]?.data
  if (tab.selection.kind === 'pull') {
    const n = tab.selection.number
    const pr = data?.pulls.find((p) => p.number === n)
    if (pr && (pr.state === 'open' || pr.state === 'draft')) return pr
  }
  return currentPull()
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
  { id: 'open-repo-path', label: 'Open Repository by Path…', group: 'App', run: () => useApp.getState().openModal({ kind: 'open' }) },
  { id: 'open-repo-wsl', label: 'Open Repository in WSL…', group: 'App', when: () => isElectron && platform === 'win32', run: () => git.openWslRepoDialog() },
  { id: 'clone-repo', label: 'Clone Repository…', group: 'App', shortcut: 'Mod+Shift+N', run: () => useApp.getState().openModal({ kind: 'clone' }) },
  { id: 'init-repo', label: 'Init Repository…', group: 'App', shortcut: 'Mod+Alt+N', run: () => useApp.getState().openModal({ kind: 'init' }) },
  { id: 'close-tab', label: 'Close Tab', group: 'App', shortcut: 'Mod+W', when: hasRepo, run: withRepo((r) => useApp.getState().closeTab(r)) },
  { id: 'open-file', label: 'Open File…', group: 'App', when: () => isElectron, run: () => openFileDialog() },
  { id: 'open-markdown', label: 'Open Markdown File…', group: 'App', when: () => isElectron, run: () => openMarkdownDialog() },
  { id: 'markdown-default-app', label: 'Open Markdown Files with Adar by Default…', group: 'App', when: () => isElectron && platform === 'darwin', run: () => openMarkdownWithAdar() },
  { id: 'next-tab', label: 'Next Tab', group: 'App', shortcut: 'Ctrl+Tab', run: () => cycleTab(1) },
  { id: 'prev-tab', label: 'Previous Tab', group: 'App', shortcut: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
  { id: 'settings', label: 'Settings…', group: 'App', shortcut: 'Mod+,', run: () => useApp.getState().openModal({ kind: 'settings' }) },
  { id: 'about', label: 'About Adar', group: 'App', run: () => useApp.getState().openModal({ kind: 'about' }) },
  { id: 'check-for-updates', label: 'Check for Updates…', group: 'App', run: () => checkForUpdatesNow() },
  { id: 'whats-new', label: "What's New in Adar", group: 'App', run: () => useApp.getState().openModal({ kind: 'whats-new' }) },
  { id: 'install-cli', label: "Install 'adar' Command in PATH…", group: 'App', when: () => isElectron, run: () => void installCliCommand() },
  { id: 'uninstall-cli', label: "Uninstall 'adar' Command", group: 'App', when: () => isElectron, run: () => void uninstallCliCommand() },
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
  { id: 'create-pull-request', label: 'Create Pull Request…', group: 'Remote', when: () => !!activeHosting(), run: withRepo((r) => startPullRequest(r)) },
  {
    id: 'show-pull-request',
    label: 'Show Pull Request of the Current Branch',
    group: 'Remote',
    when: () => !!currentPull(),
    run: withRepo((r) => {
      const pr = currentPull()
      if (pr) selectPull(r, pr.number)
    })
  },
  { id: 'pull-requests', label: 'Pull Requests', group: 'Remote', shortcut: 'Mod+Shift+R', when: () => hasRepo() && anyPullsOn(), run: () => openInbox() },
  { id: 'review-work', label: 'Review the Work in This Worktree', group: 'Repository', when: () => hasRepo(), run: withRepo((r) => void openWorkReview(r)) },
  {
    id: 'review-pull-request',
    label: 'Review Pull Request',
    group: 'Remote',
    when: () => !!reviewTarget(),
    run: withRepo((r) => {
      const pr = reviewTarget()
      if (pr) openReview(r, pr.number)
    })
  },
  {
    id: 'pulls-on',
    label: 'Turn On Pull Requests…',
    group: 'App',
    when: () => !!activeHosting() && !hostingOn(activeHosting()),
    run: () => openConnect(activeHosting())
  },
  { id: 'github-pulls-off', label: 'Turn Off GitHub Pull Requests', group: 'App', when: githubOn, run: () => turnOffPullRequests() },
  { id: 'manage-remotes', label: 'Manage Remotes…', group: 'Remote', when: hasRepo, run: withRepo((r) => useApp.getState().openModal({ kind: 'remotes', repo: r })) },
  { id: 'create-branch', label: 'Create Branch…', group: 'Branch', shortcut: 'Mod+B', when: hasRepo, run: withRepo((r) => git.createBranch(r)) },
  { id: 'clean-up-branches', label: 'Clean Up Branches…', group: 'Branch', when: hasRepo, run: withRepo((r) => openBranchCleanup(r)) },
  { id: 'kept-branches', label: 'Branches Never Cleaned Up…', group: 'Branch', when: hasRepo, run: withRepo((r) => openKeptBranches(r)) },
  { id: 'new-worktree', label: 'New Worktree…', group: 'Branch', when: hasRepo, run: withRepo((r) => newWorktree(r)) },
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
  { id: 'recover-lost-commits', label: 'Recover Lost Commits…', group: 'Repository', when: hasRepo, run: withRepo((r) => openReflog(r, 'lost')) },
  { id: 'show-reflog', label: 'Show Reflog', group: 'Repository', when: hasRepo, run: withRepo((r) => openReflog(r, 'moves')) },
  {
    id: 'refresh',
    label: 'Refresh',
    group: 'View',
    shortcut: 'Mod+R',
    when: hasRepo,
    run: withRepo((r) => useApp.getState().refresh(r))
  },
  {
    id: 'focus-branch-filter',
    label: 'Filter Branches',
    group: 'View',
    shortcut: 'Mod+Alt+F',
    when: hasRepo,
    run: () => {
      if (useApp.getState().leftCollapsed) useApp.getState().toggleLeft()
      setTimeout(() => window.dispatchEvent(new Event(FOCUS_FILTER_EVENT)), 0)
    }
  },
  { id: 'show-files', label: 'Edit Files', group: 'View', shortcut: 'Mod+Shift+E', when: hasRepo, run: withRepo((r) => toggleFiles(r)) },
  { id: 'show-graph', label: 'Show Graph', group: 'View', when: hasRepo, run: withRepo((r) => git.showGraph(r)) },
  { id: 'toggle-left-panel', label: 'Toggle Left Panel', group: 'View', shortcut: 'Mod+J', run: () => useApp.getState().toggleLeft() },
  { id: 'toggle-right-panel', label: 'Toggle Right Panel', group: 'View', shortcut: 'Mod+K', run: () => useApp.getState().toggleRight() },
  { id: 'zoom-in', label: 'Zoom In', group: 'View', shortcut: 'Mod+=', run: () => zoom(1) },
  { id: 'zoom-out', label: 'Zoom Out', group: 'View', shortcut: 'Mod+-', run: () => zoom(-1) },
  { id: 'zoom-reset', label: 'Actual Size', group: 'View', shortcut: 'Mod+0', run: () => zoom(0) },
  { id: 'open-in-terminal', label: 'Open in External Terminal', group: 'Repository', shortcut: 'Mod+Alt+T', when: hasRepo, run: withRepo((r) => git.openInTerminal(r)) },
  { id: 'open-in-finder', label: 'Reveal in Finder', group: 'Repository', shortcut: 'Mod+Alt+R', when: hasRepo, run: withRepo((r) => git.showInFolder(r)) },
  { id: 'open-in-editor', label: 'Open in Editor', group: 'Repository', when: hasRepo, run: withRepo((r) => git.openInEditor(r)) },
  { id: 'git-console', label: 'Git Console', group: 'Repository', shortcut: 'Ctrl+`', when: hasRepo, run: () => useApp.getState().setConsoleOpen(!useApp.getState().consoleOpen) },
  { id: 'identity', label: 'Set Author Identity…', group: 'Repository', when: hasRepo, run: withRepo((r) => useApp.getState().openModal({ kind: 'identity', repo: r })) },
  { id: 'abort-operation', label: 'Abort Merge/Rebase/Cherry-pick', group: 'Repository', when: () => (getActiveTab()?.info?.state ?? 'none') !== 'none', run: withRepo((r) => git.abortOperation(r)) },
  { id: 'continue-operation', label: 'Continue Merge/Rebase/Cherry-pick', group: 'Repository', when: () => (getActiveTab()?.info?.state ?? 'none') !== 'none', run: withRepo((r) => git.continueOperation(r)) },
  { id: 'update-submodules', label: 'Update Submodules', group: 'Repository', when: () => !!getActiveTab()?.refs?.submodules.length, run: withRepo((r) => git.updateSubmodules(r)) }
]

// Terminals (desktop app): the shortcuts are Cmd ones on macOS, Ctrl+Shift elsewhere, where Ctrl belongs to the shell.
const isMacApp = platform === 'darwin'
const hasTerminals = () => terminalsAvailable && hasRepo()
const terminalShowing = () => !!terminalOwner()
const launcher = (id: string) => useApp.getState().settings.terminalLaunchers.find((l) => l.id === id)
COMMANDS.push(
  { id: 'toggle-terminal', label: 'Switch Between Graph and Terminal', group: 'View', shortcut: 'Mod+E', when: hasTerminals, run: () => toggleTerminal() },
  { id: 'view-graph', label: 'Show the Graph Only', group: 'View', when: hasTerminals, run: withRepo((r) => setTerminalView(r, 'graph')) },
  { id: 'view-both', label: 'Show the Graph and the Terminal', group: 'View', when: hasTerminals, run: withRepo((r) => setTerminalView(r, 'both')) },
  { id: 'view-terminal', label: 'Show the Terminal Only', group: 'View', when: hasTerminals, run: withRepo((r) => setTerminalView(r, 'terminal')) },
  { id: 'terminal-new', label: 'New Terminal', group: 'Terminal', shortcut: isMacApp ? 'Mod+T' : 'Ctrl+Shift+T', when: hasTerminals, run: () => newTerminal() },
  { id: 'terminal-claude', label: 'New Terminal: Claude Code', group: 'Terminal', when: () => hasTerminals() && !!launcher('claude'), run: () => newTerminal('claude') },
  { id: 'terminal-codex', label: 'New Terminal: Codex', group: 'Terminal', when: () => hasTerminals() && !!launcher('codex'), run: () => newTerminal('codex') },
  { id: 'terminal-split-right', label: 'Split Terminal Right', group: 'Terminal', shortcut: isMacApp ? 'Mod+D' : 'Ctrl+Shift+D', when: hasTerminals, run: () => splitTerminal('row') },
  { id: 'terminal-split-down', label: 'Split Terminal Down', group: 'Terminal', shortcut: isMacApp ? 'Mod+Shift+D' : undefined, when: hasTerminals, run: () => splitTerminal('column') },
  { id: 'terminal-zoom', label: 'Zoom Terminal Pane', group: 'Terminal', shortcut: isMacApp ? 'Mod+Shift+Enter' : 'Ctrl+Shift+Enter', when: terminalShowing, run: () => zoomTerminal() },
  { id: 'terminal-equalize', label: 'Equalize Terminal Splits', group: 'Terminal', shortcut: isMacApp ? 'Ctrl+Mod+=' : undefined, when: terminalShowing, run: () => equalizeTerminals() },
  { id: 'terminal-next-pane', label: 'Next Terminal Pane', group: 'Terminal', shortcut: isMacApp ? 'Mod+]' : undefined, when: terminalShowing, run: () => focusPane(1) },
  { id: 'terminal-prev-pane', label: 'Previous Terminal Pane', group: 'Terminal', shortcut: isMacApp ? 'Mod+[' : undefined, when: terminalShowing, run: () => focusPane(-1) },
  { id: 'terminal-next-tab', label: 'Next Terminal Tab', group: 'Terminal', shortcut: isMacApp ? 'Mod+Shift+]' : undefined, when: terminalShowing, run: () => stepTerminalTab(1) },
  { id: 'terminal-prev-tab', label: 'Previous Terminal Tab', group: 'Terminal', shortcut: isMacApp ? 'Mod+Shift+[' : undefined, when: terminalShowing, run: () => stepTerminalTab(-1) },
  { id: 'terminal-find', label: 'Find in Terminal…', group: 'Terminal', when: terminalShowing, run: () => findInTerminal() },
  { id: 'terminal-clear', label: 'Clear Terminal', group: 'Terminal', when: terminalShowing, run: () => clearFocusedTerminal() },
  { id: 'terminal-close', label: 'Close Terminal Pane', group: 'Terminal', when: terminalShowing, run: () => closeFocusedTerminal() }
)

/**
 * While a terminal has the keyboard, these shortcuts of the git side mean the terminal's own (as in any terminal
 * app): ⌘W closes the pane, ⌘F finds in it, ⌘K clears it. macOS's menu takes those keys before the page sees them.
 */
const IN_TERMINAL: Record<string, string> = { 'close-tab': 'terminal-close', 'search-commits': 'terminal-find', 'toggle-right-panel': 'terminal-clear' }

const byId = new Map(COMMANDS.map((c) => [c.id, c]))

export function getCommand(id: string): Command | undefined {
  return byId.get(id)
}

/**
 * While an editor has the keyboard, these shortcuts of the git and terminal sides mean the editor's own (as in any
 * editor): ⌘F finds in the file, ⌘D selects the next occurrence, ⌘] and ⌘[ indent. The editor takes those keys
 * itself when the page sees them first; this is for when the menu does.
 */
const IN_EDITOR: Record<string, Parameters<typeof editorKey>[0]> = {
  'search-commits': 'find',
  'terminal-split-right': 'next-occurrence',
  'terminal-next-pane': 'indent',
  'terminal-prev-pane': 'outdent'
}

export function runCommand(id: MenuCommand | string): void {
  if (id === 'close-tab') {
    // What is over the window is what ⌘W closes: a file being edited there, a Markdown document.
    if (useEditor.getState().sheet) return void closeSheet()
    if (useMarkdown.getState().doc) return closeMarkdown()
    // Then the Files view of the tab in front (its text stays), unless a terminal has the keyboard.
    const tab = getActiveTab()
    if (tab?.center.kind === 'files' && !useApp.getState().groupView && !terminalHasKeyboard()) return closeFiles(tab.path)
  }
  const inEditor = IN_EDITOR[id]
  if (inEditor && editorKey(inEditor)) return
  const cmd = byId.get(terminalHasKeyboard() ? (IN_TERMINAL[id] ?? id) : id)
  if (!cmd) {
    console.warn('[adar] unknown command', id)
    return
  }
  if (cmd.when && !cmd.when()) return
  void cmd.run()
}
