// Terminals in the UI: the words for one, what an owner's terminals add up to, and their notifications.

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type WorkingStatus } from '@shared/types'
import type { TerminalInfo } from '@shared/terminal'
import { changesText, labelText, noticeFor, ownerCount, ownerState, shortFolder, shouldNotify, tabLabel, tabLabels, taskOf, terminalLabel, whereOf } from './model'

const info = (over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  id: 't1',
  owner: '/p/landing',
  cwd: '/Users/ana/Projects/basoa/landing',
  launcher: 'claude',
  name: 'Claude Code',
  process: 'claude',
  title: '',
  command: '',
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
    // The command the shell says it runs tells more than the program in front.
    expect(terminalLabel(info({ launcher: 'shell', name: '', process: 'node', command: 'npm run dev' }))).toBe('npm run dev')
    expect(terminalLabel(info({ launcher: 'shell', name: '', process: 'zsh', command: 'npm run dev', busy: false }))).toBe('zsh')
    expect(shortFolder('/Users/ana/Projects/landing')).toBe('~/Projects/landing')
    expect(shortFolder('/home/ana')).toBe('~')
    expect(shortFolder('/opt/code/landing')).toBe('/opt/code/landing')
  })

  it('takes an agent’s task from the title it gives its terminal', () => {
    // Claude Code's own titles: its name at first, then the task behind a mark that turns while it works.
    expect(taskOf(info({ title: '✳ Claude Code' }))).toBe('')
    expect(taskOf(info({ title: '◐ Claude Code' }))).toBe('')
    expect(taskOf(info({ title: '◐ Pricing section heading rename' }))).toBe('Pricing section heading rename')
    expect(taskOf(info({ title: '◑ Pricing section heading rename' }))).toBe('Pricing section heading rename')
    expect(taskOf(info({ title: '✳ Pricing section heading rename' }))).toBe('Pricing section heading rename')
    expect(taskOf(info({ title: '' }))).toBe('')
    // Only a mark and a space are taken off the front: the rest is the agent's.
    expect(taskOf(info({ title: '[WIP] ~/landing: fix #12' }))).toBe('[WIP] ~/landing: fix #12')
    // A title that only says what runs is no task: the launcher, the program, or the command a shell put there.
    expect(taskOf(info({ name: 'Claude (fast)', title: 'Claude (fast)' }))).toBe('')
    expect(taskOf(info({ title: 'CLAUDE' }))).toBe('')
    expect(taskOf(info({ name: 'Codex', process: 'codex', title: 'codex' }))).toBe('')
    expect(taskOf(info({ command: 'claude --resume --model opus', title: 'claude --resume' }))).toBe('')
    expect(taskOf(info({ command: 'claude --resume --model opus', title: 'claude --resume --mo…' }))).toBe('')
  })

  it('says on a tab what goes on in it', () => {
    const at = '/Users/ana/Projects/basoa/landing'
    const shell = (over: Partial<TerminalInfo> = {}) => info({ launcher: 'shell', name: '', process: 'zsh', busy: false, ...over })
    // An agent: its name and, once it has one, its task.
    expect(tabLabel(info(), at)).toEqual({ text: 'Claude Code', detail: '' })
    expect(tabLabel(info({ title: '◐ Pricing section heading rename' }), at)).toEqual({ text: 'Claude Code', detail: 'Pricing section heading rename' })
    expect(labelText(tabLabel(info({ title: '◐ Pricing section heading rename' }), at))).toBe('Claude Code · Pricing section heading rename')
    // A command: what was typed; whatever title that program sets is its own business.
    expect(tabLabel(shell({ busy: true, process: 'node', command: 'npm run dev', title: 'vite' }), at)).toEqual({ text: 'npm run dev', detail: '' })
    expect(tabLabel(shell({ busy: true, process: 'node' }), at)).toEqual({ text: 'node', detail: '' })
    // A shell at its prompt: the folder it went to, or its own name where its terminals start.
    expect(tabLabel(shell(), at)).toEqual({ text: 'zsh', detail: '' })
    expect(tabLabel(shell({ cwd: `${at}/` }), at).text).toBe('zsh')
    expect(tabLabel(shell({ cwd: `${at}/site` }), at).text).toBe('site')
    expect(tabLabel(shell({ cwd: `${at}/site/src/pages` }), at).text).toBe('pages')
    expect(tabLabel(shell({ cwd: '/Users/ana' }), at).text).toBe('~')
    expect(tabLabel(shell({ cwd: '/' }), at).text).toBe('/')
    expect(tabLabel(shell({ cwd: 'C:\\Users\\ana\\code\\api', process: 'powershell' }), 'C:\\Users\\ana\\code').text).toBe('api')
    // The title an earlier program left behind is not the shell's.
    expect(tabLabel(shell({ title: '✳ Pricing section heading rename' }), at)).toEqual({ text: 'zsh', detail: '' })
    expect(tabLabel(undefined, at)).toEqual({ text: 'terminal', detail: '' })
  })

  it('numbers the tabs that would read the same, and leaves the user’s names alone', () => {
    const at = '/Users/ana/Projects/basoa/landing'
    const shell = (over: Partial<TerminalInfo> = {}) => info({ launcher: 'shell', name: '', process: 'zsh', busy: false, ...over })
    const labels = tabLabels(
      [
        { name: '', info: shell() },
        { name: '', info: info({ title: '◐ Fix the login form' }) },
        { name: '', info: shell() },
        { name: 'zsh', info: shell() },
        { name: '', info: shell({ cwd: `${at}/site` }) },
        { name: '', info: info({ title: '✳ Fix the login form' }) },
        { name: '', info: shell() },
        { name: 'server', info: shell({ busy: true, process: 'node', command: 'npm run dev' }) }
      ],
      at
    )
    expect(labels.map(labelText)).toEqual(['zsh', 'Claude Code · Fix the login form', 'zsh 2', 'zsh', 'site', 'Claude Code 2 · Fix the login form', 'zsh 3', 'server'])
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
