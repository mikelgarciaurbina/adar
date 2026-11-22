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
  sanitizeTerminalLaunchers,
  scanOutput,
  topState,
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

  it('cleans what it shows', () => {
    expect(cleanText('  two\twords\x1b[31m\x00 here  ')).toBe('two words [31m here')
    expect(cleanText('x'.repeat(500)).length).toBe(200)
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
    // An agent that says what it does needs no bell to repeat it.
    const working = run(agent('working'))
    expect(afterSignal(working, bell())).toBe(working)
  })

  it('moves on when the user answers, interrupts or looks', () => {
    const asked = run(agent('working'), agent('asks'))
    expect(afterInput(asked, '2')).toBe(asked)
    expect(afterInput(asked, '\r')).toMatchObject({ state: 'working', by: 'agent' })
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
