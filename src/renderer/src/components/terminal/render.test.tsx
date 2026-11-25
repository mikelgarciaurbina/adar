// The terminals of a project or a tab group, server-rendered: with nothing running there yet, the view offers what to
// start (the shell or a launcher) instead of starting a shell on its own.

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '@renderer/store/appStore'
import { DEFAULT_SETTINGS } from '@shared/types'
import { TerminalWorkspace } from './TerminalView'
import { useTerminals } from './terminalStore'

/** Server rendering reads a store's initial state (useSyncExternalStore's server snapshot): set both. */
function app(patch: Partial<ReturnType<typeof useApp.getState>>): void {
  useApp.setState(patch)
  Object.assign(useApp.getInitialState(), patch)
}
function terminals(patch: Partial<ReturnType<typeof useTerminals.getState>>): void {
  useTerminals.setState(patch)
  Object.assign(useTerminals.getInitialState(), patch)
}

describe('the terminals of a project', () => {
  beforeEach(() => {
    app({ settings: { ...DEFAULT_SETTINGS } })
    terminals({ infos: {}, workspaces: {}, focus: null, ready: true })
  })

  it('offers what to start when nothing runs there yet', () => {
    const html = renderToStaticMarkup(<TerminalWorkspace owner="/p/landing" cwd="/Users/ana/Projects/basoa/landing" />)
    expect(html).toContain('Start a terminal')
    expect(html).toContain('~/Projects/basoa/landing')
    expect(html).toContain('aria-label="Start a shell"')
    expect(html).toContain('aria-label="Start Claude Code"')
    expect(html).toContain('aria-label="Start Codex"')
    // What each launcher runs is shown as it is typed.
    expect(html).toContain('<code class="tm-empty-what">claude</code>')
    expect(html).toContain('<code class="tm-empty-what">codex</code>')
    // The view's own, for the keyboard to find it when the view opens.
    expect(html).toContain('data-owner="/p/landing"')
    expect(html).toContain('Edit launchers')
  })

  it('offers the launchers of the settings, and nothing before the terminals are known', () => {
    app({ settings: { ...DEFAULT_SETTINGS, terminalLaunchers: [{ id: 'aider', name: 'Aider', command: 'aider --model sonnet' }] } })
    const group = renderToStaticMarkup(<TerminalWorkspace owner="group:g1" cwd="/Users/ana/Projects/basoa" />)
    expect(group).toContain('aria-label="Start a shell"')
    expect(group).toContain('aria-label="Start Aider"')
    expect(group).toContain('aider --model sonnet')
    expect(group).not.toContain('Claude Code')
    // After a reload, until the main process has said which terminals run: no choice that would flash and go.
    terminals({ ready: false })
    expect(renderToStaticMarkup(<TerminalWorkspace owner="/p/landing" cwd="/p/landing" />)).not.toContain('Start a terminal')
  })
})
