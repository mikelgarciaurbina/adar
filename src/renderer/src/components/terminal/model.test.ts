// Terminals in the UI: the words for one, what an owner's terminals add up to, and their notifications.

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type WorkingStatus } from '@shared/types'
import type { TerminalInfo } from '@shared/terminal'
import { changesText, noticeFor, ownerCount, ownerState, shortFolder, shouldNotify, terminalLabel, whereOf } from './model'

const info = (over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id: 't1',
  owner: '/p/landing',
  cwd: '/Users/ana/Projects/basoa/landing',
  launcher: 'claude',
  name: 'Claude Code',
  process: 'claude',
  title: '',
  busy: true,
  state: null,
  message: '',
  startedAt: 0,
  ...over
})
const status = (unstaged: string[], staged: string[] = []): WorkingStatus =>
  ({ staged: staged.map((path) => ({ path })), unstaged: unstaged.map((path) => ({ path })), conflicted: [], branch: 'main', upstream: null, ahead: 0, behind: 0 }) as unknown as WorkingStatus
const groups = [{ id: 'g1', name: 'Basoa', color: 'fern' as const, repos: ['/p/landing'], collapsed: false }]
const tabs = [{ path: '/p/landing', name: 'landing', status: status(['a.css', 'b.css'], ['a.css']) }]

describe('terminals in the UI', () => {
  it('names a terminal by its launcher while that runs, else by the program in front', () => {
    expect(terminalLabel(info())).toBe('Claude Code')
    expect(terminalLabel(info({ busy: false, process: 'zsh' }))).toBe('zsh')
    expect(terminalLabel(info({ launcher: 'shell', name: '', process: 'node' }))).toBe('node')
    expect(terminalLabel(undefined)).toBe('terminal')
    expect(shortFolder('/Users/ana/Projects/landing')).toBe('~/Projects/landing')
    expect(shortFolder('/home/ana')).toBe('~')
    expect(shortFolder('/opt/code/landing')).toBe('/opt/code/landing')
  })

  it('adds an owner’s terminals up to its most urgent state', () => {
    const infos = { a: info({ id: 'a', state: 'working' }), b: info({ id: 'b', state: 'finished' }), c: info({ id: 'c', owner: 'group:g1', state: 'needs-you' }) }
    expect(ownerState(infos, '/p/landing')).toBe('finished')
    expect(ownerState(infos, 'group:g1')).toBe('needs-you')
    expect(ownerState(infos, '/p/api')).toBeNull()
    expect(ownerCount(infos, '/p/landing')).toBe(2)
  })

  it('says where a terminal is and what changed there', () => {
    expect(whereOf('/p/landing', tabs, groups)).toBe('Basoa › landing')
    expect(whereOf('/p/api', tabs, groups)).toBe('api')
    expect(whereOf('group:g1', tabs, groups)).toBe('Basoa · group')
    expect(changesText(tabs[0].status)).toBe('2 files changed, not committed yet')
    expect(changesText(status([]))).toBe('No changes left to commit')
    expect(changesText(null)).toBe('')
  })

  it('notifies when an agent needs the user or finished, as the settings say', () => {
    expect(noticeFor(info({ state: 'needs-you', message: 'Claude needs your permission to use Bash' }), tabs, groups)).toEqual({
      title: 'Claude Code needs you',
      subtitle: 'Basoa › landing',
      body: 'Claude needs your permission to use Bash',
      open: { owner: '/p/landing', id: 't1' }
    })
    expect(noticeFor(info({ state: 'finished' }), tabs, groups)).toMatchObject({ title: 'Claude Code finished', body: '2 files changed, not committed yet' })
    expect(noticeFor(info({ state: 'needs-you', launcher: 'shell', name: '', process: 'zsh' }), tabs, groups)).toMatchObject({
      title: 'zsh needs you',
      body: 'It asked something and waits for your answer.'
    })
    expect(noticeFor(info({ state: 'working' }), tabs, groups)).toBeNull()

    expect(shouldNotify(info({ state: 'needs-you' }), DEFAULT_SETTINGS)).toBe(true)
    expect(shouldNotify(info({ state: 'needs-you' }), { ...DEFAULT_SETTINGS, notifyTerminalNeedsYou: false })).toBe(false)
    expect(shouldNotify(info({ state: 'finished' }), { ...DEFAULT_SETTINGS, notifyTerminalFinished: false })).toBe(false)
    expect(shouldNotify(info({ state: 'working' }), DEFAULT_SETTINGS)).toBe(false)
  })
})
