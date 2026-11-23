// Small pieces of the terminals' UI used outside their own view too (the tab bar, the toolbar, the status bar).

import type { AgentRunState } from '@shared/terminal'
import { showTerminal } from '@renderer/actions/terminal'
import { useApp } from '@renderer/store/appStore'
import { STATE_TITLE, whereOf } from './model'
import { useTerminals } from './terminalStore'
import './terminal.css'

/** The dot for what an agent is doing: violet and pulsing while it works, amber when it needs you, green when done. */
export function StateDot({ state, title }: { state: AgentRunState; title?: string }) {
  const label = title ?? STATE_TITLE[state]
  return <span className={`tm-dot tm-dot-${state}`} role="img" aria-label={label} title={label} />
}

/**
 * The status bar's word about terminals: the one that needs the user, else one that finished, wherever it is.
 * A click goes there.
 */
export function TerminalAttention() {
  const infos = useTerminals((s) => s.infos)
  const tabs = useApp((s) => s.tabs)
  const groups = useApp((s) => s.settings.tabGroups)
  const all = Object.values(infos)
  const pick = all.find((t) => t.state === 'needs-you') ?? all.find((t) => t.state === 'finished')
  if (!pick?.state) return null
  const who = pick.name || pick.process || 'A terminal'
  const text = `${who} ${pick.state === 'needs-you' ? 'needs you' : 'finished'} in ${whereOf(pick.owner, tabs, groups)}`
  return (
    <button className={`tb-status-item tb-status-btn tm-status tm-state-${pick.state}`} title={pick.message || 'Show that terminal'} onClick={() => showTerminal(pick.owner, pick.id)}>
      <StateDot state={pick.state} />
      {text}
    </button>
  )
}
