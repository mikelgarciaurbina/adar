// Notifications for the commits and pushes Adar did not make itself (an agent's in a terminal or a worktree of
// its own): what each says and which are left out. Pure; the events come from the main process (@shared/agents).

import type { AgentEvent, AgentNotice } from '@shared/agents'
import type { AppSettings } from '@shared/types'
import { pluralize } from '@renderer/lib/format'
import { groupOf } from '@renderer/lib/tabGroups'

/**
 * The notifications a batch of events calls for: nothing for Adar's own commits and pushes, or for a folder whose
 * tab is in front while Adar is; more than three become one.
 *
 * Each says what happened and on which branch ("Pushed 1 commit to origin/main"), then where: the tab group and
 * the repository ("Basoa › landing"), a linked worktree's folder when it says more than the branch, and the agent.
 */
export function noticesFor(
  events: readonly AgentEvent[],
  s: Pick<AppSettings, 'notifyAgentCommits' | 'tabGroups'>,
  front: string | null,
  repoName: (repo: string) => string
): AgentNotice[] {
  if (!s.notifyAgentCommits) return []
  const out: AgentNotice[] = []
  const kinds: string[] = []
  const repos = new Set<string>()
  for (const e of events) {
    if (e.own || e.path === front) continue
    const repo = repoName(e.repo)
    const folder = e.path.split(/[\\/]/).pop() || e.path
    const group = groupOf(s.tabGroups, e.path) ?? groupOf(s.tabGroups, e.repo)
    // Without a branch the title names the folder.
    const subtitle = [
      group ? `${group.name} › ${repo}` : repo,
      e.branch && !e.isMain && folder !== repo && folder !== e.branch ? folder : null,
      e.agent ? `with ${e.agent}` : null
    ]
      .filter(Boolean)
      .join(' · ')
    if (e.kind === 'commit') {
      if (!e.commits.length) continue
      const [first] = e.commits
      const more = e.commits.length > 1 ? ` and ${e.commits.length - 1} more` : ''
      out.push({
        title: e.branch ? `Committed to ${e.branch}` : `Committed in ${folder}`,
        subtitle,
        body: `${first.subject}${more} · ${pluralize(e.files, 'file')}`,
        open: { path: e.path, repo: e.repo, view: 'commit', sha: first.sha }
      })
      kinds.push('committed')
    } else {
      const more = e.subject && e.count > 1 ? ` and ${e.count - 1} more` : ''
      out.push({
        title: `Pushed ${e.count ? `${pluralize(e.count, 'commit')} ` : ''}to ${e.upstream}`,
        subtitle,
        body: `${e.subject}${more}`,
        open: { path: e.path, repo: e.repo, view: 'changes' }
      })
      kinds.push('pushed')
    }
    repos.add(repo)
  }
  if (out.length <= 3) return out
  const counts = new Map<string, number>()
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1)
  const names = [...repos]
  return [
    {
      title: `${out.length} commits and pushes while you were away`,
      subtitle: names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and '),
      body: [...counts].map(([k, n]) => `${n} ${k}`).join(', '),
      open: { path: out[0].open.path, repo: out[0].open.repo, view: 'changes' }
    }
  ]
}
