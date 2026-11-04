// Agents at work in a repository's graph: the other worktrees with work in progress (a dashed row each, while they
// work or are quiet), what those rows say, and the commits made in a worktree since the user last looked (tinted,
// like those of a followed pull request).

import { useMemo } from 'react'
import type { Commit } from '@shared/types'
import type { ReviewMark } from '@renderer/components/pulls/PullNews'
import type { AgentInput } from '@renderer/components/graph/model'
import type { AgentRowInfo } from '@renderer/components/graph/types'
import { pluralize } from '@renderer/lib/format'
import { useApp } from '@renderer/store/appStore'
import { useAgents } from './agentStore'
import { agentName, newCommits, shortAgo, stateOf, stateTitle } from './model'

const NONE: readonly AgentInput[] = []

/** The other worktrees of `repo` (its main folder) working or quiet with changes not committed, and their rows' words. */
export function useAgentRows(repo: string, self: string): { inputs: readonly AgentInput[]; infos: ReadonlyMap<string, AgentRowInfo> } {
  const worktrees = useAgents((s) => s.worktrees)
  const now = useAgents((s) => s.now)
  const settings = useApp((s) => s.settings)
  const live = Object.values(worktrees).filter((w) => w.repo === repo && w.path !== self && w.head && w.fileCount > 0 && stateOf(w, now, settings) !== 'idle')
  // Rebuild the graph's rows only when the rows themselves change, not with every tick of the clock.
  const key = live.map((w) => `${w.path}\u0000${w.head}`).sort().join('\u0001')
  const inputs = useMemo(
    () => (key ? key.split('\u0001').map((k) => ({ path: k.split('\u0000')[0], tip: k.split('\u0000')[1] })) : NONE),
    [key]
  )
  const infos = new Map<string, AgentRowInfo>()
  for (const w of live) {
    const state = stateOf(w, now, settings)
    const agent = agentName(w, settings)
    infos.set(w.path, {
      name: w.name,
      state,
      files: w.fileCount,
      added: w.added,
      removed: w.removed,
      agent,
      ago: shortAgo(now - (w.lastChange ?? now)),
      title: `${stateTitle(w, state, now, agent)}\nClick to open it`
    })
  }
  return { inputs, infos }
}

const NO_MARKS: ReadonlyMap<string, ReviewMark> = new Map()

/** Commits made in the repository's worktrees since the user last looked at each. */
export function useWorktreeMarks(repo: string, commits: readonly Commit[]): ReadonlyMap<string, ReviewMark> {
  const worktrees = useAgents((s) => s.worktrees)
  const seen = useApp((s) => s.settings.worktreesSeen)
  return useMemo(() => {
    if (!commits.length) return NO_MARKS
    const loaded = new Set(commits.map((c) => c.sha))
    const out = new Map<string, ReviewMark>()
    for (const w of Object.values(worktrees)) {
      if (w.repo !== repo) continue
      const fresh = newCommits(w, seen)
      for (const c of fresh) if (loaded.has(c.sha)) out.set(c.sha, { kind: 'new', title: `New in ${w.name} since you last looked (${pluralize(fresh.length, 'commit')})` })
    }
    return out.size ? out : NO_MARKS
  }, [worktrees, seen, repo, commits])
}
