// Commits and pushes Adar did not make, UI side: tells the main process which repositories to follow (the open
// tabs), turns what it reports into notifications, and opens the folder a clicked notification was about.

import { useEffect } from 'react'
import type { AgentEvent } from '@shared/agents'
import { api, onAdarEvent } from '@renderer/api/client'
import { openFromAgentNotice } from '@renderer/actions/agents'
import { useApp } from '@renderer/store/appStore'
import { noticesFor } from './model'

/** Notify what happened (see noticesFor for what is left out). */
function notice(events: readonly AgentEvent[]): void {
  const s = useApp.getState()
  // The tab in front while Adar is: the user sees it happen. A group's view in front shows no tab.
  const front = document.hasFocus() && !s.groupView ? s.activePath : null
  const name = (repo: string) => s.tabs.find((t) => t.path === repo)?.name ?? repo.split(/[\\/]/).pop() ?? repo
  for (const n of noticesFor(events, s.settings, front, name)) void api.notifyAgent(n).catch(() => undefined)
}

/** Keep the main process following the open tabs' repositories, and notify what it sees. */
export function useAgentSync(): void {
  const ready = useApp((s) => s.ready)
  const paths = useApp((s) => s.tabs.map((t) => t.path).join('\n'))
  const on = useApp((s) => s.settings.notifyAgentCommits)

  useEffect(() => {
    if (!ready) return
    // Settles first: tabs restored at startup, and the settings change that triggered this saved.
    const timer = setTimeout(() => void api.watchAgents(on && paths ? paths.split('\n') : []).catch(() => undefined), 300)
    return () => clearTimeout(timer)
  }, [ready, paths, on])

  useEffect(
    () =>
      onAdarEvent((ev) => {
        if (ev.type === 'agents') {
          if (ev.events.length) notice(ev.events)
        } else if (ev.type === 'open-agent') {
          const { type: _type, ...open } = ev
          openFromAgentNotice(open)
        }
      }),
    []
  )
}
