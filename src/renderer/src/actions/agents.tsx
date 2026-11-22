// Opening a repository's folder or worktree on its changes or on a commit: from a commit or push notification
// (components/agents), and from the worktrees section.

import type { AgentOpen } from '@shared/agents'
import { goToCommit } from '@renderer/components/details/CommitPanel'
import { revealWorkingTree } from '@renderer/components/diff/nav'
import { useApp } from '@renderer/store/appStore'
import { setTerminalView, viewOf } from './terminal'
import { openWorktree } from './worktrees'

const store = () => useApp.getState()

/** Switch to a worktree's tab, opening it in the group of its repository's tab when it has none; false when it could not be opened. */
export async function focusWorktree(path: string, repo?: string): Promise<boolean> {
  if (!store().tabs.some((t) => t.path === path)) {
    const from = store().tabs.find((t) => t.path === repo || t.info?.mainWorktree === repo)?.path ?? store().activePath ?? repo ?? path
    if (!(await openWorktree(from, path))) return false
  } else store().setActive(path)
  return true
}

/** Switch to a worktree's tab (see focusWorktree) on its graph, its changes or a commit. */
export async function showWorktree(path: string, repo: string, view: 'changes' | 'commit' | 'graph' = 'graph', sha?: string): Promise<void> {
  if (!(await focusWorktree(path, repo))) return
  // The graph side has to be on screen for any of these: beside the terminal when only that was showing.
  if (viewOf(path) === 'terminal') setTerminalView(path, 'both')
  if (view === 'changes') revealWorkingTree(path)
  else if (view === 'commit' && sha) goToCommit(path, sha)
  else store().setCenter(path, { kind: 'graph' })
}

/** A commit or push notification was clicked. */
export function openFromAgentNotice(open: AgentOpen): void {
  void showWorktree(open.path, open.repo, open.view, open.sha)
}
