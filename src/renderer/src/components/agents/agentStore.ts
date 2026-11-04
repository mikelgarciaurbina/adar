// Agents at work, UI side: what each watched worktree is doing (getAgentWorktrees, then the main process's 'agents'
// events), a clock for the states and "4 s ago", the open tabs as the repositories to watch, the commits counted as
// seen (the worktree's tab in front, or marked) and the notifications for what agents did.

import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { AgentEvent, AgentsScope, AgentWorktree } from '@shared/agents'
import { api, onAdarEvent } from '@renderer/api/client'
import { openFromAgentNotice } from '@renderer/actions/agents'
import { useApp } from '@renderer/store/appStore'
import { noticesFor, scopeOf, type AgentScope } from './model'

interface AgentsState {
  /** Watched worktrees by path. */
  worktrees: Record<string, AgentWorktree>
  /** The clock the states and labels are drawn with (ticks while worktrees are watched). */
  now: number
  apply(list: readonly AgentWorktree[], removed?: readonly string[], replace?: boolean): void
}

export const useAgents = create<AgentsState>()((set) => ({
  worktrees: {},
  now: Date.now(),
  apply(list, removed = [], replace = false) {
    set((s) => {
      const next: Record<string, AgentWorktree> = replace ? {} : { ...s.worktrees }
      for (const p of removed) delete next[p]
      for (const w of list) next[w.path] = w
      return { worktrees: next, now: Date.now() }
    })
  }
}))

/** A watched worktree, by path (undefined while Agents at work is off or it is not watched). */
/** A tab's Agents scope (settings.agentsScope), the worktrees in it, and how many are watched in all. */
export function useAgentScope(path: string, scope?: AgentsScope): AgentScope & { total: number } {
  const worktrees = useAgents((s) => s.worktrees)
  const tabs = useApp((s) => s.tabs)
  const groups = useApp((s) => s.settings.tabGroups)
  const saved = useApp((s) => s.settings.agentsScope)
  const want = scope ?? saved
  return useMemo(() => {
    const all = Object.values(worktrees)
    const mainOf = (p: string) => tabs.find((t) => t.path === p)?.info?.mainWorktree ?? p
    const mainWorktree = tabs.find((t) => t.path === path)?.info?.mainWorktree ?? null
    return { ...scopeOf(all, { path, mainWorktree }, want, groups, mainOf), total: all.length }
  }, [worktrees, tabs, groups, want, path])
}

export function useAgentWorktree(path: string | null | undefined): AgentWorktree | undefined {
  return useAgents((s) => (path ? s.worktrees[path] : undefined))
}

const CLOCK_MS = 5000

/** Notify what agents did (see noticesFor for what is left out). */
function notice(events: readonly AgentEvent[]): void {
  const s = useApp.getState()
  const front = document.hasFocus() ? s.activePath : null
  const name = (repo: string) => s.tabs.find((t) => t.path === repo)?.name ?? repo.split(/[\\/]/).pop() ?? repo
  for (const n of noticesFor(events, useAgents.getState().worktrees, s.settings, front, name)) void api.notifyAgent(n).catch(() => undefined)
}

/** Keep the main process watching the open tabs' worktrees, and this window in step with what it sees. */
export function useAgentSync(): void {
  const ready = useApp((s) => s.ready)
  const paths = useApp((s) => s.tabs.map((t) => t.path).join('\n'))
  const on = useApp((s) => s.settings.agentsOn)
  const watchMain = useApp((s) => s.settings.agentsWatchMain)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    // Settles first: tabs restored at startup, and the settings change that triggered this saved.
    const timer = setTimeout(() => {
      const repos = on && paths ? paths.split('\n') : []
      void api
        .watchAgents(repos)
        .then(() => api.getAgentWorktrees())
        .then((list) => {
          if (!cancelled) useAgents.getState().apply(list, [], true)
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ready, paths, on, watchMain])

  useEffect(
    () =>
      onAdarEvent((ev) => {
        if (ev.type === 'agents') {
          useAgents.getState().apply(ev.worktrees, ev.removed)
          if (ev.events.length) notice(ev.events)
        } else if (ev.type === 'open-agent') {
          const { type: _type, ...open } = ev
          openFromAgentNotice(open)
        }
      }),
    []
  )

  const watching = useAgents((s) => Object.keys(s.worktrees).length > 0)
  useEffect(() => {
    if (!watching) return
    const id = setInterval(() => useAgents.setState({ now: Date.now() }), CLOCK_MS)
    return () => clearInterval(id)
  }, [watching])

  // A worktree first seen starts with nothing new; the one whose tab is in front sees its commits as they come.
  const active = useApp((s) => s.activePath)
  const worktrees = useAgents((s) => s.worktrees)
  useEffect(() => {
    const s = useApp.getState()
    const seen = s.settings.worktreesSeen
    const patch: typeof seen = {}
    for (const w of Object.values(worktrees)) {
      if (!w.head) continue
      const mark = seen[w.path]
      if (!mark || (w.path === active && mark.sha !== w.head)) patch[w.path] = { sha: w.head, at: Date.now() }
    }
    if (Object.keys(patch).length) void s.updateSettings({ worktreesSeen: { ...seen, ...patch } })
  }, [worktrees, active])
}
