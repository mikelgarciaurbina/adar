// Terminals, main side: how one is started on each system, the environment it gets, the hooks an agent is given,
// and a real shell followed from start to end (output, resize, what it says about itself, closing).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AdarEvent } from '@shared/types'
import type { TerminalInfo } from '@shared/terminal'
import { claudeHooks, defaultLang, spawnPlan, terminalEnv, TerminalManager, withAgentState } from './manager'
import { integrates, zshFiles } from './shell'

describe('starting a terminal', () => {
  it('runs the login shell, alone or after a launcher’s program', () => {
    expect(spawnPlan('/p/landing', null, { SHELL: '/bin/zsh' }, 'darwin')).toEqual({ file: '/bin/zsh', args: ['-l', '-i'], cwd: '/p/landing', shell: 'zsh' })
    const plan = spawnPlan('/p/landing', 'claude --resume', { SHELL: '/opt/it\'s/fish' }, 'linux')
    expect(plan.args.slice(0, 3)).toEqual(['-l', '-i', '-c'])
    // The program, then word that it ended, then the shell again.
    expect(plan.args[3]).toBe(`claude --resume; printf '\\033]7717;adar;idle\\007'; exec '/opt/it'\\''s/fish' -l -i`)
    expect(spawnPlan('/p', null, {}, 'linux').file).toBe('/bin/bash')
    // With Adar's start-up files in use, the shell that takes over reads them too.
    expect(spawnPlan('/p', 'claude', { SHELL: '/bin/zsh' }, 'darwin', true).args[3]).toBe(`claude; printf '\\033]7717;adar;idle\\007'; ZDOTDIR="$ADAR_ZDOTDIR" exec '/bin/zsh' -l -i`)
  })

  it('opens PowerShell on Windows, and the distribution’s shell for a folder inside WSL', () => {
    expect(spawnPlan('C:\\code\\landing', 'claude', {}, 'win32')).toMatchObject({ file: 'powershell.exe', cwd: 'C:\\code\\landing', type: 'claude' })
    const wsl = spawnPlan('\\\\wsl.localhost\\Ubuntu\\home\\ana\\landing', null, { SystemRoot: 'C:\\Windows' }, 'win32')
    expect(wsl.args).toEqual(['-d', 'Ubuntu', '--cd', '/home/ana/landing'])
    expect(wsl.file.toLowerCase()).toContain('wsl.exe')
  })

  it('gives the shell a terminal’s environment, without Adar’s own variables', () => {
    const env = terminalEnv(
      { PATH: '/usr/bin', HOME: '/Users/ana', ELECTRON_RUN_AS_NODE: '1', ADAR_USER_DATA: '/tmp/x', npm_config_cache: '/c', NODE_ENV: 'production', MISSING: undefined },
      { ADAR_TERMINAL: 't1' },
      '0.25.0',
      'es-ES'
    )
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/Users/ana', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Adar', TERM_PROGRAM_VERSION: '0.25.0', ADAR_TERMINAL: 't1' })
    expect(Object.keys(env).filter((k) => /^(ELECTRON_|npm_|NODE_ENV|MISSING|ADAR_USER)/.test(k))).toEqual([])
    if (process.platform !== 'win32') expect(env.LANG).toBe('es_ES.UTF-8')
    expect(terminalEnv({ LANG: 'eu_ES.UTF-8' }, {}, '1', 'en-US').LANG).toBe('eu_ES.UTF-8')
    expect(defaultLang('en')).toBe('en_US.UTF-8')
  })

  it.skipIf(process.platform === 'win32')('starts the agents it knows so that they report their state', () => {
    expect(withAgentState('claude', true)).toBe('claude --settings "$ADAR_CLAUDE_SETTINGS"')
    expect(withAgentState('claude --settings mine.json', true)).toBe('claude --settings mine.json')
    expect(withAgentState('codex --full-auto', true)).toBe('codex --full-auto -c tui.notifications=true')
    expect(withAgentState('aider', true)).toBe('aider')
    expect(withAgentState('claude', false)).toBe('claude')
  })

  it('writes hooks that speak through the terminal and stay silent elsewhere', () => {
    const hooks = (claudeHooks() as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> }).hooks
    expect(Object.keys(hooks).sort()).toEqual(['Notification', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'])
    expect(hooks.Stop[0].hooks[0]).toEqual({ type: 'command', command: `[ -n "$ADAR_TERMINAL" ] && printf '\\033]7717;adar;finished\\007' > /dev/tty 2>/dev/null; true` })
    expect(hooks.PreToolUse[0].matcher).toBe('AskUserQuestion|ExitPlanMode')
    for (const list of Object.values(hooks)) for (const h of list.flatMap((l) => l.hooks)) expect(h.command).toContain('$ADAR_TERMINAL')
  })
})

describe('what Adar adds to zsh', () => {
  it('only for zsh, and not on Windows', () => {
    expect(integrates('/bin/zsh', 'darwin')).toBe(true)
    expect(integrates('/opt/homebrew/bin/zsh', 'linux')).toBe(true)
    expect(integrates('/bin/bash', 'darwin')).toBe(false)
    expect(integrates('zsh', 'win32')).toBe(false)
  })

  it('reads each of the user’s start-up files first and gives $ZDOTDIR back', () => {
    const files = zshFiles()
    expect(Object.keys(files).sort()).toEqual(['.zlogin', '.zprofile', '.zshenv', '.zshrc'])
    for (const [name, text] of Object.entries(files)) expect(text).toContain(`builtin source "\${ZDOTDIR:-$HOME}/${name}"`)
    // The history file the system put beside Adar's files goes back with the user's.
    expect(files['.zshrc']).toContain('[[ $HISTFILE == "$ADAR_ZDOTDIR/.zsh_history" ]] && HISTFILE=${ADAR_USER_ZDOTDIR:-$HOME}/.zsh_history')
    // Names of files and folders in any case, only when asked; commands are left exact.
    expect(files['.zshrc']).toContain("zstyle ':completion:*:*:*:*:(local-|path-|)directories' matcher 'm:{a-z}={A-Z}'")
    expect(files['.zshrc'].indexOf('ADAR_COMPLETE_ANY_CASE')).toBeLessThan(files['.zshrc'].indexOf('compinit'))
    // .zlogin is the last one: nothing sets Adar's folder again after it.
    expect(files['.zlogin']).not.toContain('ZDOTDIR=$ADAR_ZDOTDIR')
  })
})

describe.skipIf(process.platform === 'win32')('TerminalManager', () => {
  let manager: TerminalManager | null = null
  const dirs: string[] = []
  const shellBefore = process.env.SHELL
  const zdotdirBefore = process.env.ZDOTDIR
  afterEach(() => {
    manager?.dispose()
    manager = null
    process.env.SHELL = shellBefore
    if (zdotdirBefore === undefined) delete process.env.ZDOTDIR
    else process.env.ZDOTDIR = zdotdirBefore
    // A shell on its way out may still be writing its history there.
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  function start(launchers = DEFAULT_SETTINGS.terminalLaunchers, shell = '/bin/sh') {
    // A plain shell: the developer's own start-up files would make the output theirs.
    process.env.SHELL = shell
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-term-')))
    dirs.push(dir)
    const events: AdarEvent[] = []
    manager = new TerminalManager({
      emit: (e) => events.push(e),
      settings: async () => ({ terminalLaunchers: launchers, terminalAgentState: true, terminalShellIntegration: true, terminalCompleteAnyCase: true }),
      userDataDir: dir,
      appVersion: '0.0.0-test',
      flushMs: 1,
      typingBellMs: 150
    })
    const output = (id: string) => events.map((e) => (e.type === 'terminal-data' && e.id === id ? e.data : '')).join('')
    const infos = (id: string) => events.flatMap((e): TerminalInfo[] => (e.type === 'terminal-info' && e.info.id === id ? [e.info] : []))
    return { manager, dir, events, output, infos }
  }

  it('runs a shell in the folder, sends its output on and follows what it says about itself', async () => {
    const { manager, dir, events, output, infos } = start()
    const info = await manager.open({ owner: dir, cwd: dir, cols: 90, rows: 30 })
    expect(info).toMatchObject({ owner: dir, cwd: dir, launcher: 'shell', name: '', state: null, busy: false })

    // Nothing is sent until a UI draws it; what was printed meanwhile comes with attach.
    manager.write(info.id, 'echo before-$((40+2))\r')
    await vi.waitFor(() => expect(manager.attach(info.id).replay).toContain('before-42'), { timeout: 8000 })
    manager.write(info.id, 'pwd; echo size-$(stty size | tr " " x)\r')
    await vi.waitFor(() => expect(output(info.id)).toContain('size-30x90'), { timeout: 8000 })
    expect(output(info.id)).toContain(dir)

    manager.resize(info.id, 120, 40)
    manager.write(info.id, 'echo now-$(stty size | tr " " x)\r')
    await vi.waitFor(() => expect(output(info.id)).toContain('now-40x120'), { timeout: 8000 })

    // The environment says it is one of Adar's terminals, and which.
    manager.write(info.id, 'echo "$TERM_PROGRAM/$ADAR_TERMINAL"\r')
    await vi.waitFor(() => expect(output(info.id)).toContain(`Adar/${info.id}`), { timeout: 8000 })

    // What an agent's hooks print: working, then a question, an answer, and the end of the turn.
    manager.write(info.id, `printf '\\033]7717;adar;working\\007'\r`)
    await vi.waitFor(() => expect(infos(info.id).at(-1)?.state).toBe('working'), { timeout: 8000 })
    manager.write(info.id, `printf '\\033]7717;adar;notify;May I run the tests?\\007'\r`)
    await vi.waitFor(() => expect(infos(info.id).at(-1)).toMatchObject({ state: 'needs-you', message: 'May I run the tests?' }), { timeout: 8000 })
    // That line's own Enter came before the question; the next one answers it.
    manager.write(info.id, '\r')
    expect(infos(info.id).at(-1)?.state).toBe('working')
    manager.write(info.id, `printf '\\033]7717;adar;finished\\007'\r`)
    await vi.waitFor(() => expect(infos(info.id).at(-1)?.state).toBe('finished'), { timeout: 8000 })
    manager.seen(info.id)
    expect(infos(info.id).at(-1)?.state).toBeNull()

    expect(manager.list().map((t) => t.id)).toEqual([info.id])
    manager.close(info.id)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'terminal-exit' && e.id === info.id)).toBe(true), { timeout: 8000 })
    expect(manager.list()).toEqual([])
    expect(() => manager.attach(info.id)).toThrow(/no longer running/)
  })

  it('runs a launcher’s program first and leaves the shell when it ends', async () => {
    const { manager, dir } = start([{ id: 'hello', name: 'Hello', command: 'echo launched-$((6*7))' }])
    const info = await manager.open({ owner: 'group:g1', cwd: dir, cols: 80, rows: 24, launcher: 'hello' })
    expect(info).toMatchObject({ launcher: 'hello', name: 'Hello', owner: 'group:g1' })
    await vi.waitFor(() => expect(manager.attach(info.id).replay).toContain('launched-42'), { timeout: 8000 })
    // The shell took over: it still answers.
    manager.write(info.id, 'echo still-$((1+1))\r')
    await vi.waitFor(() => expect(manager.attach(info.id).replay).toContain('still-2'), { timeout: 8000 })
  })

  it('takes a bell for a call for attention, unless it answers what was just typed', async () => {
    const { manager, dir, infos } = start()
    const info = await manager.open({ owner: dir, cwd: dir, cols: 80, rows: 24 })
    manager.attach(info.id)
    // The shell beeping at a key (nothing to complete) asks for nothing.
    manager.write(info.id, `printf '\\a'; echo rang\r`)
    await vi.waitFor(() => expect(manager.attach(info.id).replay).toContain('rang'), { timeout: 8000 })
    expect(infos(info.id).some((i) => i.state === 'needs-you')).toBe(false)
    // A program that rings later on its own does.
    manager.write(info.id, `(sleep 0.5; printf '\\a') &\r`)
    await vi.waitFor(() => expect(infos(info.id).at(-1)).toMatchObject({ state: 'needs-you' }), { timeout: 8000 })
    manager.seen(info.id)
    expect(infos(info.id).at(-1)?.state).toBeNull()
  })

  it.skipIf(!fs.existsSync('/bin/zsh'))('adds to zsh without taking anything from the user’s own files', async () => {
    // The "user": start-up files of their own in a folder of their choice, as $ZDOTDIR.
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-zsh-home-')))
    dirs.push(home)
    fs.writeFileSync(path.join(home, '.zshenv'), 'export FROM_ENV=theirs\n')
    fs.writeFileSync(path.join(home, '.zshrc'), "MARK=mine\nPS1='%% '\nunsetopt beep\n")
    process.env.ZDOTDIR = home
    const { manager, dir, output, infos } = start(DEFAULT_SETTINGS.terminalLaunchers, '/bin/zsh')
    fs.mkdirSync(path.join(dir, 'Adar Web'))
    const info = await manager.open({ owner: dir, cwd: dir, cols: 100, rows: 30 })
    manager.attach(info.id)

    // Their files ran, and $ZDOTDIR and the history are theirs again once the shell is up.
    manager.write(info.id, 'echo "m=$MARK e=$FROM_ENV z=$ZDOTDIR h=${HISTFILE:-none}"\r')
    await vi.waitFor(() => expect(output(info.id)).toContain(`m=mine e=theirs z=${home} h=`), { timeout: 15000 })
    expect(output(info.id)).not.toContain(path.join(dir, 'terminal', 'zsh', '.zsh_history'))

    // "cd adar" + Tab finds "Adar Web", and the shell says where it went.
    // (zsh rewrites only what differs on the line, so the proof is where the shell ends up.)
    manager.write(info.id, 'cd adar\t')
    await vi.waitFor(() => expect(output(info.id).split('cd adar').pop()).toContain('Web'), { timeout: 15000 })
    manager.write(info.id, '\r')
    await vi.waitFor(() => expect(infos(info.id).at(-1)?.cwd).toBe(path.join(dir, 'Adar Web')), { timeout: 15000 })
  })

  it('refuses what it cannot start', async () => {
    const { manager, dir } = start()
    await expect(manager.open({ owner: dir, cwd: 'relative/path', cols: 80, rows: 24 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(manager.open({ owner: dir, cwd: path.join(dir, 'missing'), cols: 80, rows: 24 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(manager.open({ owner: dir, cwd: dir, cols: 80, rows: 24, launcher: 'nope' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(manager.open({ owner: '', cwd: dir, cols: 80, rows: 24 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(() => manager.write('t-none', 'x')).toThrow(/no longer running/)
  })
})
