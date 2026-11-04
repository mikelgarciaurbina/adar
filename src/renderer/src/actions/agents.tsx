// Agents at work: opening a worktree from the Agents view, a graph row, the menu bar or a notification (on its
// changes or on a commit), the Agents view itself, marking a worktree as seen and silencing its "went quiet"
// notifications. What each worktree is doing comes from components/agents/agentStore.ts.

import type { AgentOpen, AgentWorktree } from '@shared/agents'
import { goToCommit } from '@renderer/components/details/CommitPanel'
import { revealWorkingTree } from '@renderer/components/diff/nav'
import { useApp } from '@renderer/store/appStore'
import { openWorktree } from './worktrees'

const store = () => useApp.getState()

/** The Agents view, in the active tab. */
export function openAgents(): void {
  const repo = store().activePath
  if (repo) store().setCenter(repo, { kind: 'agents' })
}

/** Switch to a worktree's tab (opening it in the group of its repository's tab when it has none). */
export async function showWorktree(path: string, repo: string, view: 'changes' | 'commit' | 'graph' = 'graph', sha?: string): Promise<void> {
  if (!store().tabs.some((t) => t.path === path)) {
    const from = store().tabs.find((t) => t.path === repo || t.info?.mainWorktree === repo)?.path ?? store().activePath ?? repo
    if (!(await openWorktree(from, path))) return
  } else if (store().activePath !== path) store().setActive(path)
  if (view === 'changes') revealWorkingTree(path)
  else if (view === 'commit' && sha) goToCommit(path, sha)
  else store().setCenter(path, { kind: 'graph' })
}

/** A notification, or the menu bar panel, asked for a worktree or the Agents view. */
export function openFromAgentNotice(open: AgentOpen): void {
  if (open.view === 'agents' || !open.path) openAgents()
  else void showWorktree(open.path, open.repo, open.view, open.sha)
}

/** The commits made so far count as seen: the blue dot goes. */
export function markWorktreeSeen(list: readonly AgentWorktree[]): void {
  const seen = { ...store().settings.worktreesSeen }
  let changed = false
  for (const w of list) {
    if (!w.head || seen[w.path]?.sha === w.head) continue
    seen[w.path] = { sha: w.head, at: Date.now() }
    changed = true
  }
  if (changed) void store().updateSettings({ worktreesSeen: seen })
}

/** "Don't tell me when it goes quiet" for one worktree, and back. */
export function setQuietMuted(path: string, muted: boolean): void {
  const list = store().settings.agentsQuietMuted.filter((p) => p !== path)
  if (muted) list.push(path)
  void store().updateSettings({ agentsQuietMuted: list })
}
