// Smoke tests for the Git console drawer (server-rendered with a minimal window stub).

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useApp, type AppState } from '@renderer/store/appStore'
import { useConsole } from './consoleStore'
import { GitConsole } from './GitConsole'

function seed(patch: Partial<AppState>) {
  useApp.setState(patch)
  Object.assign(useApp.getInitialState(), patch)
}

const repo = '/Users/me/Projects/adar'
const g = globalThis as unknown as { window?: unknown }
let hadWindow = false

beforeEach(() => {
  hadWindow = 'window' in g
  if (!hadWindow) g.window = { innerHeight: 900 }
  seed({ consoleOpen: true, activePath: repo, tabs: [{ path: repo, name: 'adar' } as AppState['tabs'][number]] })
})

afterEach(() => {
  if (!hadWindow) delete g.window
})

describe('GitConsole', () => {
  it('is hidden when closed', () => {
    seed({ consoleOpen: false })
    expect(renderToStaticMarkup(<GitConsole />)).toBe('')
  })

  it('shows the hint for an empty log and the git prompt', () => {
    const html = renderToStaticMarkup(<GitConsole />)
    expect(html).toContain('Git console')
    expect(html).toContain('pal-console-git">git<')
    expect(html).toContain('Run any git command')
    expect(html).toContain('height:240px')
  })

  it('renders commands, stdout, stderr and exit codes', () => {
    const lines = [
      { id: 1, kind: 'cmd' as const, text: 'git status' },
      { id: 2, kind: 'out' as const, text: 'On branch main' },
      { id: 3, kind: 'err' as const, text: 'warning: something' },
      { id: 4, kind: 'exit' as const, text: 'exit 1', code: 1 }
    ]
    useConsole.setState({ logs: { [repo]: lines } })
    Object.assign(useConsole.getInitialState(), { logs: { [repo]: lines } })
    const html = renderToStaticMarkup(<GitConsole />)
    expect(html).toContain('pal-line-cmd')
    expect(html).toContain('On branch main')
    expect(html).toContain('pal-line pal-line-err')
    expect(html).toContain('pal-line-exit-fail')
  })

  it('is hidden (but stays open) while no repository is active', () => {
    seed({ activePath: null, tabs: [] })
    expect(renderToStaticMarkup(<GitConsole />)).toBe('')
    expect(useApp.getState().consoleOpen).toBe(true)
  })
})
