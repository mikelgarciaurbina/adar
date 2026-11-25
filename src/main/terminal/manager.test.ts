// Terminals, main side: how one is started on each system, the environment it gets, the hooks an agent is given,
// and a real shell followed from start to end (output, resize, what it says about itself, closing).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AdarEvent } from '@shared/types'
import type { TerminalInfo } from '@shared/terminal'
import { claudeHooks, defaultLang, parseSignalLine, spawnPlan, terminalEnv, TerminalManager, withAgentState } from './manager'
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

  it('writes hooks that tell Adar through its signals file and stay silent elsewhere', () => {
    const hooks = (claudeHooks() as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> }).hooks
    expect(Object.keys(hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'PostToolUse',
      'PostToolUseFailure',
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'StopFailure',
      'UserPromptSubmit'
    ])
    // A hook has no terminal to print to: it appends a line, with the terminal it is about.
    expect(hooks.Stop[0].hooks[0]).toEqual({ type: 'command', command: `[ -n "$ADAR_SIGNALS" ] && printf '%s finished\\n' "$ADAR_TERMINAL" >> "$ADAR_SIGNALS"; true` })
    expect(hooks.PreToolUse[0].matcher).toBe('AskUserQuestion|ExitPlanMode')
    expect(hooks.Notification[0].matcher).toBe('permission_prompt|elicitation_dialog')
    expect(hooks.PermissionRequest[0].hooks[0].command).toContain('Permission to use ')
    for (const list of Object.values(hooks)) for (const h of list.flatMap((l) => l.hooks)) expect(h.command).toContain('"$ADAR_SIGNALS"')
  })

  it('reads a line of the signals file, and nothing that is not one', () => {
    expect(parseSignalLine('t3-abc working')).toEqual({ id: 't3-abc', signal: { kind: 'agent', what: 'working', message: '' } })
    expect(parseSignalLine('t3-abc asks Permission to use Bash')).toEqual({ id: 't3-abc', signal: { kind: 'agent', what: 'asks', message: 'Permission to use Bash' } })
    expect(parseSignalLine('t3-abc notify  two\twords\x1b[31m ')?.signal).toMatchObject({ message: 'two words [31m' })
    expect(parseSignalLine('t3-abc dance')).toBeNull()
    expect(parseSignalLine('working')).toBeNull()
    expect(parseSignalLine('')).toBeNull()
  })

  it('keeps an agent session Adar was started from out of the agents run in its terminals', () => {
    const inside = { PATH: '/usr/bin', CLAUDECODE: '1', CLAUDE_CODE_SIMPLE: '1', CLAUDE_CODE_SESSION_ID: 's', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_API_KEY: 'mine' }
    expect(Object.keys(terminalEnv(inside, {}, '1', 'en-US')).filter((k) => /CLAUDE|ANTHROPIC/.test(k))).toEqual(['ANTHROPIC_API_KEY'])
    // Variables of the user's own, with no session around them, are theirs to pass on.
    const own = terminalEnv({ PATH: '/usr/bin', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BASE_URL: 'https://proxy.example' }, {}, '1', 'en-US')
    expect(own).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BASE_URL: 'https://proxy.example' })
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
  let exited: string[] = []
  afterEach(async () => {
    const m = manager
    manager = null
    if (m) {
      // A shell on its way out still writes its history and its completion cache: wait until each one is gone
      // before taking its folders away.
      const ids = m.list().map((t) => t.id)
      for (const id of ids) m.close(id)
      await vi.waitFor(() => expect(ids.filter((id) => !exited.includes(id))).toEqual([]), { timeout: 10000 }).catch(() => undefined)
      m.dispose()
    }
    exited = []
    process.env.SHELL = shellBefore
    if (zdotdirBefore === undefined) delete process.env.ZDOTDIR
    else process.env.ZDOTDIR = zdotdirBefore
    for (const d of dirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
      } catch {
        // A temporary folder left behind is not a failed test.
      }
    }
  })

  function start(launchers = DEFAULT_SETTINGS.terminalLaunchers, shell = '/bin/sh') {
    // A plain shell: the developer's own start-up files would make the output theirs.
    process.env.SHELL = shell
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-term-')))
    dirs.push(dir)
    const events: AdarEvent[] = []
    manager = new TerminalManager({
      emit: (e) => {
        events.push(e)
        if (e.type === 'terminal-exit') exited.push(e.id)
      },
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

  it('follows what an agent’s hooks append to the signals file', async () => {
    const { manager, dir, infos } = start()
    const info = await manager.open({ owner: dir, cwd: dir, cols: 80, rows: 24 })
    manager.attach(info.id)
    const said = async (state: string | null, message = '') => {
      await vi.waitFor(
        async () => {
          await manager.readSignalsNow()
          expect(infos(info.id).at(-1) ?? { state: null, message: '' }).toMatchObject({ state, message })
        },
        { timeout: 8000 }
      )
    }
    // What a hook runs: the shell's environment says where to write and which terminal it is.
    manager.write(info.id, `printf '%s working\\n' "$ADAR_TERMINAL" >> "$ADAR_SIGNALS"\r`)
    await said('working')
    // Typed by hand into a plain shell: the terminal is called after the agent while it speaks.
    expect(infos(info.id).at(-1)?.name).toBe('Claude Code')
    manager.write(info.id, `printf '%s asks Permission to use Bash\\n' "$ADAR_TERMINAL" >> "$ADAR_SIGNALS"\r`)
    await said('needs-you', 'Permission to use Bash')
    // Lines about a terminal that is not there, or that say nothing known, are passed over.
    manager.write(info.id, `printf 't-nobody finished\\nnonsense\\n%s finished\\n' "$ADAR_TERMINAL" >> "$ADAR_SIGNALS"\r`)
    await said('finished')
    expect(fs.statSync(path.join(dir, 'terminal', 'signals')).mode & 0o077).toBe(0)
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

    // Agents typed by hand are started so that they report, unless the user has a function of that name.
    manager.write(info.id, 'whence -w claude codex\r')
    await vi.waitFor(() => expect(output(info.id)).toMatch(/claude: function[\s\S]*codex: function/), { timeout: 15000 })

    // "cd adar" + Tab finds "Adar Web", and the shell says where it went.
    // (zsh rewrites only what differs on the line, so the proof is where the shell ends up.)
    manager.write(info.id, 'cd adar\t')
    await vi.waitFor(() => expect(output(info.id).split('cd adar').pop()).toContain('Web'), { timeout: 15000 })
    manager.write(info.id, '\r')
    await vi.waitFor(() => expect(infos(info.id).at(-1)?.cwd).toBe(path.join(dir, 'Adar Web')), { timeout: 15000 })
  })

  it.skipIf(!fs.existsSync('/bin/zsh'))('hears from zsh what it runs, and calls an agent typed by hand by its name', async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-zsh-home-')))
    dirs.push(home)
    // A program called claude that gives its terminal a title, as the agent does, and stays a moment.
    const bin = path.join(home, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'claude'), "#!/bin/sh\nprintf '\\033]0;✳ Fix the login form\\007'\nsleep 2\n", { mode: 0o755 })
    fs.writeFileSync(path.join(home, '.zshrc'), `PS1='%% '\nunsetopt beep\npath=(${bin} $path)\n`)
    process.env.ZDOTDIR = home
    const { manager, dir, output, infos } = start([{ id: 'hello', name: 'Hello', command: 'echo launched-$((6*7))' }], '/bin/zsh')
    const info = await manager.open({ owner: dir, cwd: dir, cols: 100, rows: 30 })
    manager.attach(info.id)
    const last = () => infos(info.id).at(-1)

    // A command, without the variable set in front of it; then the prompt again.
    manager.write(info.id, 'TOKEN=secret sleep 2\r')
    await vi.waitFor(() => expect(last()).toMatchObject({ command: 'sleep 2', busy: true, process: 'sleep', name: '' }), { timeout: 15000 })
    await vi.waitFor(() => expect(last()).toMatchObject({ command: '', busy: false, process: 'zsh' }), { timeout: 15000 })
    expect(infos(info.id).some((i) => i.command.includes('secret'))).toBe(false)

    // A line that starts with a space is not told, as it is kept out of the history.
    manager.write(info.id, ' sleep 0.3; echo spaced-$((1+1))\r')
    await vi.waitFor(() => expect(output(info.id)).toContain('spaced-2'), { timeout: 15000 })
    expect(infos(info.id).some((i) => i.command.includes('spaced'))).toBe(false)

    // An agent typed by hand goes by its name, with the title it gives the terminal; both end with it.
    manager.write(info.id, 'claude\r')
    await vi.waitFor(() => expect(infos(info.id).some((i) => i.name === 'Claude Code' && i.command === 'claude' && i.title === '✳ Fix the login form' && i.busy)).toBe(true), {
      timeout: 15000
    })
    await vi.waitFor(() => expect(last()).toMatchObject({ name: '', command: '', title: '', busy: false }), { timeout: 15000 })

    // A launcher's name is its program's: what is typed into the shell that took over is called by what it is.
    const launched = await manager.open({ owner: dir, cwd: dir, cols: 100, rows: 30, launcher: 'hello' })
    manager.attach(launched.id)
    expect(launched.name).toBe('Hello')
    await vi.waitFor(() => expect(output(launched.id)).toContain('launched-42'), { timeout: 15000 })
    manager.write(launched.id, 'sleep 2\r')
    await vi.waitFor(() => expect(infos(launched.id).at(-1)).toMatchObject({ command: 'sleep 2', busy: true, name: '' }), { timeout: 15000 })
    await vi.waitFor(() => expect(infos(launched.id).at(-1)).toMatchObject({ command: '', busy: false, name: '' }), { timeout: 15000 })
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

describe.skipIf(process.platform === 'win32')('TerminalManager, with a stand-in for the pseudo-terminal', () => {
  const shellBefore = process.env.SHELL
  let manager: TerminalManager | null = null
  let dir = ''
  afterEach(() => {
    manager?.dispose()
    manager = null
    process.env.SHELL = shellBefore
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  /** A terminal whose program in front and output the test decides. */
  async function open(launcher?: string) {
    process.env.SHELL = '/bin/sh'
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-pty-')))
    let output: (data: string) => void = () => undefined
    const written: string[] = []
    const proc = {
      process: 'sh',
      onData: (listener: (data: string) => void) => ((output = listener), { dispose: () => undefined }),
      onExit: () => ({ dispose: () => undefined }),
      write: (data: string) => void written.push(data),
      resize: () => undefined,
      kill: () => undefined,
      pause: () => undefined,
      resume: () => undefined
    }
    const m = new TerminalManager({
      emit: () => undefined,
      settings: async () => ({
        terminalLaunchers: [{ id: 'codex', name: 'Codex', command: 'codex' }],
        terminalAgentState: true,
        terminalShellIntegration: false,
        terminalCompleteAnyCase: false
      }),
      userDataDir: dir,
      appVersion: '0.0.0-test',
      load: async () => ({ spawn: () => proc }) as unknown as typeof import('node-pty'),
      flushMs: 1,
      typingBellMs: 60_000
    })
    manager = m
    const info = await m.open({ owner: dir, cwd: dir, cols: 80, rows: 24, launcher })
    const now = () => m.list().find((t) => t.id === info.id)!
    return { m, proc, info, now, prints: (data: string) => output(data), written }
  }

  it('keeps a launcher’s name while its login shell starts it, and follows what Codex says', async () => {
    const { proc, info, now, prints } = await open('codex')
    expect(info).toMatchObject({ name: 'Codex', process: 'codex', busy: true })
    // The login shell is in front before the program: the tab is still the program's.
    proc.process = 'sh'
    expect(now()).toMatchObject({ name: 'Codex', process: 'codex', busy: true })
    proc.process = 'node'
    expect(now()).toMatchObject({ name: 'Codex', process: 'node', busy: true })
    // What it says about itself counts, and its bell does not.
    prints('\x1b]7501;state=working:app=codex\x07')
    expect(now().state).toBe('working')
    prints('\x07\x1b]7501;state=done:app=codex\x07')
    expect(now().state).toBe('finished')
    // It ended (Adar's own line after it): from now on the shell in front is the shell.
    prints('\x1b]7717;adar;idle\x07')
    proc.process = 'sh'
    expect(now()).toMatchObject({ process: 'sh', busy: false, state: null })
  })

  it('calls an agent typed by hand by the name it gives, and takes no focus report for an answer', async () => {
    const { m, info, now, prints, written } = await open()
    expect(info).toMatchObject({ name: '', busy: false })
    prints('\x1b]7501;state=working:app=codex\x07')
    expect(now()).toMatchObject({ name: 'Codex', state: 'working' })
    prints('\x1b]7501;state=blocked:app=codex:kind=permission\x07')
    expect(now()).toMatchObject({ state: 'needs-you', message: 'Waits for your approval' })
    // The pane loses the keyboard: the program hears it, and it still waits.
    m.write(info.id, '\x1b[O')
    expect(written.at(-1)).toBe('\x1b[O')
    expect(now().state).toBe('needs-you')
    m.write(info.id, 'y')
    expect(now().state).toBe('working')
  })

  it('takes a bell after a focus report for one of its own, and after a key for the shell’s', async () => {
    const { m, info, now, prints } = await open()
    m.write(info.id, '\x1b[I')
    prints('\x07')
    expect(now().state).toBe('needs-you')
    m.seen(info.id)
    m.write(info.id, 'x')
    prints('\x07')
    expect(now().state).toBeNull()
  })
})
