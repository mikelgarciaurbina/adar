// Navigation helpers shared by the diff, history and blame views.

import * as git from '@renderer/actions/git'
import { useApp } from '@renderer/store/appStore'

/** Select a commit in the graph (paging it in if needed) and show the graph. */
export async function revealCommit(repo: string, sha: string): Promise<void> {
  await useApp.getState().ensureCommitLoaded(repo, sha)
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  const full = tab?.commits.find((c) => c.sha === sha || c.sha.startsWith(sha))?.sha ?? sha
  useApp.getState().select(repo, { kind: 'commit', sha: full })
  git.showGraph(repo)
}

/** Select the working-tree ("// WIP") node and show the graph. */
export function revealWorkingTree(repo: string): void {
  useApp.getState().select(repo, { kind: 'wip' })
  git.showGraph(repo)
}
