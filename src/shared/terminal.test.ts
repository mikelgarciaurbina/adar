// Terminals, the shared rules: what is read from a terminal's output, and the state it adds up to.

import { describe, expect, it } from 'vitest'
import {
  afterInput,
  afterSeen,
  afterSignal,
  agentOfCommand,
  cleanText,
  IDLE_RUN,
  newScan,
  parseTerminalNotice,
  pathInWsl,
  sanitizeTerminalLaunchers,
  scanOutput,
  shownCommand,
  topState,
  typedPaths,
  wslDistroOf,
  type RunState,
  type TerminalSignal
} from './terminal'

const scan = (...chunks: string[]): TerminalSignal[] => {
  const st = newScan()
  return chunks.flatMap((c) => scanOutput(st, c))
}

describe('scanOutput', () => {
  it('hears a bell, but not the one that ends a sequence', () => {
    expect(scan('done\x07')).toEqual([{ kind: 'attention', message: '' }])
    expect(scan('\x1b]0;my title\x07')).toEqual([{ kind: 'title', title: 'my title' }])
    expect(scan('plain text, colours \x1b[32mok\x1b[0m')).toEqual([])
  })

  it('reads titles, the folder and notifications, whichever way the sequence ends', () => {
    expect(scan('\x1b]2;vim README.md\x1b\\')).toEqual([{ kind: 'title', title: 'vim README.md' }])
    expect(scan('\x1b]7;file://mac.local/Users/ana/My%20Projects/landing\x07')).toEqual([{ kind: 'cwd', cwd: '/Users/ana/My Projects/landing' }])
    expect(scan('\x1b]9;Approval requested: npm test\x07')).toEqual([{ kind: 'attention', message: 'Approval requested: npm test' }])
    expect(scan('\x1b]777;notify;Build;finished in 3 s\x07')).toEqual([{ kind: 'attention', message: 'Build: finished in 3 s' }])
    // A progress bar is not a message.
    expect(scan('\x1b]9;4;1;40\x07')).toEqual([])
  })

  it('reads an agent’s own messages, also when they arrive in pieces', () => {
    expect(scan('\x1b]7717;adar;working\x07')).toEqual([{ kind: 'agent', what: 'working', message: '' }])
    expect(scan('out\x1b]77', '17;adar;notify;Claude needs your perm', 'ission to use Bash\x07more')).toEqual([
      { kind: 'agent', what: 'notify', message: 'Claude needs your permission to use Bash' }
    ])
    expect(scan('\x1b', ']7717;adar;finished\x1b', '\\')).toEqual([{ kind: 'agent', what: 'finished', message: '' }])
    expect(scan('\x1b]7717;someone-else;working\x07', '\x1b]7717;adar;dance\x07')).toEqual([])
  })

  it('reads past long sequences and strings that are not its own without ringing', () => {
    expect(scan(`\x1b]52;c;${'A'.repeat(5000)}\x07`)).toEqual([])
    expect(scan('\x1bPq#0;2;0;0;0\x07#1~~\x1b\\', 'after\x07')).toEqual([{ kind: 'attention', message: '' }])
    expect(scan('\x1b_Gf=100;AAAA\x1b\\')).toEqual([])
  })

  it('reads what the shell says it runs, and that it is back at its prompt', () => {
    expect(scan('\x1b]7717;adar;command;npm run dev\x07')).toEqual([{ kind: 'command', command: 'npm run dev' }])
    expect(scan('\x1b]7717;adar;command;echo a; echo b\x07')).toEqual([{ kind: 'command', command: 'echo a; echo b' }])
    expect(scan('\x1b]7717;adar;command;\x07', '\x1b]7717;adar;command\x1b\\')).toEqual([
      { kind: 'command', command: '' },
      { kind: 'command', command: '' }
    ])
    expect(scan('\x1b]7717;other;command;npm run dev\x07')).toEqual([])
  })

  it('shows a command without the variables set in front of it', () => {
    expect(shownCommand('npm run dev')).toBe('npm run dev')
    expect(shownCommand('  git   log\t--oneline ')).toBe('git log --oneline')
    expect(shownCommand('TOKEN=abc123 npm test')).toBe('npm test')
    expect(shownCommand('NODE_ENV=production API_KEY="a b c" node server.js --port=3000')).toBe('node server.js --port=3000')
    expect(shownCommand("GREETING='it''s me' A=b\\ c ./run.sh x=1")).toBe('./run.sh x=1')
    // Nothing but a variable, or a quote never closed: nothing to show.
    expect(shownCommand('TOKEN=abc123')).toBe('')
    expect(shownCommand('TOKEN="abc 123 npm test')).toBe('')
    expect(shownCommand(`echo ${'x'.repeat(300)}`).length).toBe(80)
  })

  it('cleans what it shows', () => {
    expect(cleanText('  two\twords\x1b[31m\x00 here  ')).toBe('two words [31m here')
    expect(cleanText('x'.repeat(500)).length).toBe(200)
  })
})

describe('files dropped on a terminal', () => {
  it('types their paths as a POSIX shell reads them back whole', () => {
    const posix = { shell: 'posix' } as const
    expect(typedPaths(['/Users/ana/Desktop/shot.png'], posix)).toEqual({ text: '/Users/ana/Desktop/shot.png ', left: 0 })
    expect(typedPaths(['/Users/ana/Desktop/Screenshot 2026-11-25 at 10.12.33.png'], posix).text).toBe('/Users/ana/Desktop/Screenshot\\ 2026-11-25\\ at\\ 10.12.33.png ')
    // Letters of any alphabet stay as they are; what a shell would act on goes behind a backslash.
    expect(typedPaths(["/tmp/Captura de pantalla (1) año's $HOME & `x`!.png"], posix).text).toBe("/tmp/Captura\\ de\\ pantalla\\ \\(1\\)\\ año\\'s\\ \\$HOME\\ \\&\\ \\`x\\`\\!.png ")
    expect(typedPaths(['/tmp/a;b|c>d<e*f?g[h]{i}#j"k\\l'], posix).text).toBe('/tmp/a\\;b\\|c\\>d\\<e\\*f\\?g\\[h\\]\\{i\\}\\#j\\"k\\\\l ')
    // Several: one after another, and typing goes on after the last.
    expect(typedPaths(['/a/b.png', '/c d/e.txt'], posix)).toEqual({ text: '/a/b.png /c\\ d/e.txt ', left: 0 })
  })

  it('never types a line end: a path with control characters, or none, is left out', () => {
    const posix = { shell: 'posix' } as const
    expect(typedPaths(['', '/tmp/evil\nrm -rf x', '/tmp/esc\x1b[201~', '/tmp/c1\u009b', '/ok'], posix)).toEqual({ text: '/ok ', left: 4 })
    expect(typedPaths([''], posix)).toEqual({ text: '', left: 1 })
    expect(typedPaths([], posix)).toEqual({ text: '', left: 0 })
    for (const style of [{ shell: 'posix' }, { shell: 'powershell' }, { shell: 'wsl', distro: 'Ubuntu' }] as const) {
      expect(typedPaths(['C:\\a\r\nb', '/a\tb'], style).text).toBe('')
    }
  })

  it('quotes for PowerShell, and turns Windows paths into the ones a WSL shell reaches', () => {
    const ps = { shell: 'powershell' } as const
    expect(typedPaths(['C:\\Users\\ana\\shot.png'], ps).text).toBe('C:\\Users\\ana\\shot.png ')
    expect(typedPaths(["C:\\Users\\ana\\My Pictures\\it's.png"], ps).text).toBe("'C:\\Users\\ana\\My Pictures\\it''s.png' ")

    const wsl = { shell: 'wsl', distro: 'Ubuntu' } as const
    expect(typedPaths(['C:\\Users\\ana\\My Pictures\\shot.png', '\\\\wsl.localhost\\Ubuntu\\home\\ana\\a b.png'], wsl).text).toBe('/mnt/c/Users/ana/My\\ Pictures/shot.png /home/ana/a\\ b.png ')
    // Another distribution's files and network shares are not there.
    expect(typedPaths(['\\\\wsl.localhost\\Debian\\home\\ana\\a.png', '\\\\server\\share\\a.png', '/home/ana/a.png'], wsl)).toEqual({ text: '', left: 3 })

    expect(wslDistroOf('\\\\wsl.localhost\\Ubuntu\\home\\ana\\repo')).toBe('Ubuntu')
    expect(wslDistroOf('\\\\wsl$\\Ubuntu-22.04')).toBe('Ubuntu-22.04')
    expect(wslDistroOf('C:\\code\\repo')).toBeNull()
    expect(wslDistroOf('/home/ana/repo')).toBeNull()
    expect(pathInWsl('Ubuntu', 'D:\\')).toBe('/mnt/d')
    expect(pathInWsl('ubuntu', '//wsl.localhost/Ubuntu/home/ana')).toBe('/home/ana')
    expect(pathInWsl('Ubuntu', 'C:\\a\\..\\b')).toBeNull()
  })
})

describe('the state of a terminal', () => {
  const agent = (what: 'working' | 'asks' | 'notify' | 'finished' | 'idle', message = ''): TerminalSignal => ({ kind: 'agent', what, message })
  const bell = (message = ''): TerminalSignal => ({ kind: 'attention', message })
  const run = (...sigs: TerminalSignal[]): RunState => sigs.reduce(afterSignal, IDLE_RUN)

  it('follows an agent through a turn', () => {
    expect(run(agent('working'))).toEqual({ state: 'working', message: '', by: 'agent' })
    expect(run(agent('working'), agent('notify', 'Claude needs your permission to use Bash'))).toEqual({
      state: 'needs-you',
      message: 'Claude needs your permission to use Bash',
      by: 'agent'
    })
    expect(run(agent('working'), agent('asks'))).toMatchObject({ state: 'needs-you', by: 'agent' })
    expect(run(agent('working'), agent('finished'))).toMatchObject({ state: 'finished' })
    expect(run(agent('working'), agent('finished'), agent('idle'))).toBe(IDLE_RUN)
  })

  it('takes "it waits for you" only in the middle of a turn', () => {
    // After finishing, agents remind that they wait for a prompt: still finished.
    expect(run(agent('working'), agent('finished'), agent('notify', 'Claude is waiting for your input'))).toMatchObject({ state: 'finished' })
    expect(run(agent('notify'))).toBe(IDLE_RUN)
  })

  it('lets a bell ask for attention where no agent reports its state', () => {
    expect(run(bell('Build finished'))).toEqual({ state: 'needs-you', message: 'Build finished', by: 'bell' })
    // Codex's notification for the end of a turn means finished; its others ask for the user.
    expect(run(bell('Agent turn complete'))).toEqual({ state: 'finished', message: '', by: 'bell' })
    expect(run(bell('Approval requested: npm test'))).toMatchObject({ state: 'needs-you', message: 'Approval requested: npm test' })
    expect(afterSeen(run(bell('Agent turn complete')))).toBe(IDLE_RUN)
    // An agent that says what it does needs no bell to repeat it.
    const working = run(agent('working'))
    expect(afterSignal(working, bell())).toBe(working)
  })

  it('moves on when the user answers, interrupts or looks', () => {
    const asked = run(agent('working'), agent('asks'))
    // One key answers an agent's menu; a bell waits for a whole line.
    expect(afterInput(asked, '2')).toMatchObject({ state: 'working', by: 'agent' })
    expect(afterInput(asked, '\r')).toMatchObject({ state: 'working', by: 'agent' })
    expect(afterInput(run(bell()), 'l')).toMatchObject({ state: 'needs-you' })
    expect(afterInput(run(bell()), 'ls\r')).toBe(IDLE_RUN)
    expect(afterInput(run(agent('working')), '\x1b')).toBe(IDLE_RUN)
    // An arrow key starts with Esc and interrupts nothing.
    expect(afterInput(run(agent('working')), '\x1b[A')).toMatchObject({ state: 'working' })
    expect(afterInput(run(agent('working'), agent('finished')), 'n')).toBe(IDLE_RUN)

    expect(afterSeen(run(agent('working'), agent('finished')))).toBe(IDLE_RUN)
    expect(afterSeen(run(bell()))).toBe(IDLE_RUN)
    // What an agent asked stays until answered.
    expect(afterSeen(asked)).toBe(asked)
    expect(afterSeen(run(agent('working')))).toMatchObject({ state: 'working' })
  })

  it('shows the most urgent state of several terminals', () => {
    expect(topState(['working', null, 'finished'])).toBe('finished')
    expect(topState(['finished', 'needs-you', 'working'])).toBe('needs-you')
    expect(topState([null, undefined])).toBeNull()
  })
})

describe('launchers and notices', () => {
  it('keeps well-formed launchers only', () => {
    expect(
      sanitizeTerminalLaunchers([
        { id: 'claude', name: ' Claude Code ', command: 'claude' },
        { id: 'claude', name: 'Twice', command: 'claude' },
        { id: 'shell', name: 'Reserved', command: 'zsh' },
        { id: 'bad id', name: 'x', command: 'x' },
        { id: 'two', name: 'Two lines', command: 'a\nb' },
        { id: 'aider', name: 'Aider', command: 'aider --model sonnet' },
        'nonsense'
      ])
    ).toEqual([
      { id: 'claude', name: 'Claude Code', command: 'claude' },
      { id: 'aider', name: 'Aider', command: 'aider --model sonnet' }
    ])
    expect(sanitizeTerminalLaunchers('claude')).toBeNull()
  })

  it('knows the agent a command starts', () => {
    expect(agentOfCommand('claude --resume')).toBe('claude')
    expect(agentOfCommand('/opt/homebrew/bin/codex')).toBe('codex')
    expect(agentOfCommand('npx claude')).toBeNull()
  })

  it('validates a notice from the UI', () => {
    const notice = { title: 'Claude Code needs you', subtitle: 'Basoa › landing', body: '', open: { owner: '/p/landing', id: 't1-abc' } }
    expect(parseTerminalNotice(notice)).toEqual(notice)
    expect(parseTerminalNotice({ ...notice, open: { owner: '', id: 't1' } })).toBeNull()
    expect(parseTerminalNotice({ ...notice, title: 3 })).toBeNull()
  })
})
