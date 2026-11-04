// Small pieces of Agents at work shared by the left panel, the graph, the tabs and the Agents view: the agent's
// mark, the state dot and label, and the 30-minute strip.

import { Sparkle } from 'lucide-react'
import { stripOf, type AgentState, type AgentWorktree } from '@shared/agents'
import { useApp } from '@renderer/store/appStore'
import { useAgents } from './agentStore'
import { agentName, newCommits, stateLabel, stateOf, stateTitle } from './model'
import './agents.css'

/** "✦ Claude": which agent works in a worktree (compact: the sparkle alone, the name in its tooltip). */
export function AgentMark({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <span className={`ag-mark${compact ? ' ag-mark-compact' : ''}`} title={`${name} works here (from its commits' Co-Authored-By, the branch or the folder)`} aria-label={name}>
      <Sparkle size={compact ? 9 : 10} aria-hidden="true" />
      {!compact && name}
    </span>
  )
}

export function StateDot({ state }: { state: AgentState }) {
  return <i className={`ag-dot ag-dot-${state}`} aria-hidden="true" />
}

/** A worktree's live state, its agent and what is new, as the left panel and the graph label show it. */
export function useWorktreeState(path: string | null | undefined) {
  const w = useAgents((s) => (path ? s.worktrees[path] : undefined))
  const now = useAgents((s) => s.now)
  const settings = useApp((s) => s.settings)
  if (!w) return null
  const state = stateOf(w, now, settings)
  const agent = agentName(w, settings)
  return { w, state, agent, label: stateLabel(w, state, now), title: stateTitle(w, state, now, agent), fresh: newCommits(w, settings.worktreesSeen) }
}

/** The state beside a worktree: "● 7 files · now", "● quiet 6 min", "○ 10:40". */
export function StateLabel({ state, label, title }: { state: AgentState; label: string; title?: string }) {
  if (!label) return null
  return (
    <span className={`ag-state ag-state-${state}`} title={title}>
      <StateDot state={state} />
      {label}
    </span>
  )
}

/** "● 2 new": commits since the user last looked at the worktree. */
export function NewChip({ count, title }: { count: number; title?: string }) {
  if (!count) return null
  return (
    <span className="ag-new" title={title ?? `${count} new since you last looked`}>
      <i aria-hidden="true" />
      {count} new
    </span>
  )
}

/** The last 30 minutes: a bar per minute of files changing, a dot per commit. */
export function Strip({ w, now, state }: { w: AgentWorktree; now: number; state: AgentState }) {
  const { bars, commits } = stripOf(w, now)
  const max = Math.max(3, ...bars)
  return (
    <div className={`ag-strip ag-strip-${state}`} role="img" aria-label={`Files changed per minute over the last 30 minutes${commits.length ? `, ${commits.length} with a commit` : ''}`}>
      {bars.map((n, i) => {
        const h = n ? `${Math.max(14, Math.round((n / max) * 100))}%` : '2px'
        return (
          <span key={i} className="ag-tick" style={{ ['--h' as string]: h }}>
            <i className={n ? undefined : 'ag-tick-empty'} />
            {commits.includes(i) && <b className="ag-commit-dot" />}
          </span>
        )
      })}
    </div>
  )
}
