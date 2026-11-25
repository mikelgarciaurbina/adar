// Terminals inside Adar: a shell of the user's own in each project and tab group, run by the main process
// (src/main/terminal/manager.ts, node-pty) and drawn by the renderer (components/terminal, xterm.js). This file is
// what both sides share: what a terminal is, the launchers ("Claude Code" → `claude`), the signals read from a
// terminal's output (its title, a bell, what an agent says about itself) and the rules that turn them into the
// state a tab's dot shows: working, needs you or finished.

/** What the agent in a terminal is doing; null when nothing says so (a plain shell, or already seen). */
export type AgentRunState = 'working' | 'needs-you' | 'finished'

/** A program a new terminal can start with, besides the shell. */
export interface TerminalLauncher {
  id: string
  name: string
  /** Run in the user's login shell, as typed ("claude", "codex --full-auto"). */
  command: string
}

/** The launcher id of a plain shell. */
export const SHELL_LAUNCHER = 'shell'
export const DEFAULT_TERMINAL_LAUNCHERS: TerminalLauncher[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude' },
  { id: 'codex', name: 'Codex', command: 'codex' }
]
export const MAX_TERMINAL_LAUNCHERS = 12
export const MAX_TERMINALS = 64
export const TERMINAL_CURSORS = ['block', 'bar', 'underline'] as const
export type TerminalCursor = (typeof TERMINAL_CURSORS)[number]
/** What a project's tab shows: the graph, the terminal, or the graph with the terminal docked below. */
export const TERMINAL_VIEWS = ['graph', 'both', 'terminal'] as const
export type TerminalViewMode = (typeof TERMINAL_VIEWS)[number]

export interface TerminalInfo {
  id: string
  /** Whose it is: a repository's folder (its tab), or `group:<id>` for a tab group's. */
  owner: string
  /** The folder it started in. */
  cwd: string
  /** The launcher it started with (SHELL_LAUNCHER for a plain shell). */
  launcher: string
  /** The launcher's name ("Claude Code"); '' for a plain shell. */
  name: string
  /** The program in front now ("zsh", "claude", "node"); '' where the system does not say. */
  process: string
  /** The title the program gave its terminal, if any. */
  title: string
  /** The command line the shell is running, as typed; '' at its prompt, and where the shell does not say. */
  command: string
  /** A program other than the shell runs in it (closing asks first). */
  busy: boolean
  state: AgentRunState | null
  /** What it asked, while it needs you. */
  message: string
  startedAt: number
}

export interface TerminalOpen {
  owner: string
  cwd: string
  cols: number
  rows: number
  /** A launcher's id; a plain shell when absent. */
  launcher?: string
}

/** A terminal the UI starts drawing: what it is, and its recent output to paint first. */
export interface TerminalAttach {
  info: TerminalInfo
  replay: string
}

/** A notification the UI asks the main process to show; a click sends an 'open-terminal' event with `open`. */
export interface TerminalNotice {
  title: string
  subtitle: string
  body: string
  open: { owner: string; id: string }
}

const text = (x: unknown, max: number): string | null => (typeof x === 'string' ? x.slice(0, max) : null)

/** Validate a notice the UI sends (it reaches a system notification and, when clicked, the UI again). */
export function parseTerminalNotice(v: unknown): TerminalNotice | null {
  if (!v || typeof v !== 'object') return null
  const n = v as Record<string, unknown>
  const title = text(n.title, 200)
  const subtitle = text(n.subtitle, 200)
  const body = text(n.body, 500)
  const open = n.open as Record<string, unknown> | undefined
  if (title === null || subtitle === null || body === null || !open || typeof open !== 'object') return null
  const owner = text(open.owner, 4096)
  const id = text(open.id, 64)
  if (!owner || !id) return null
  return { title, subtitle, body, open: { owner, id } }
}

export function sanitizeTerminalLaunchers(v: unknown): TerminalLauncher[] | null {
  if (!Array.isArray(v)) return null
  const out: TerminalLauncher[] = []
  const seen = new Set<string>([SHELL_LAUNCHER])
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const l = raw as Record<string, unknown>
    const id = typeof l.id === 'string' ? l.id.trim().slice(0, 40) : ''
    const name = typeof l.name === 'string' ? l.name.trim().slice(0, 40) : ''
    const command = typeof l.command === 'string' ? l.command.trim().slice(0, 500) : ''
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || seen.has(id) || !name || !command || /[\r\n\0]/.test(command)) continue
    seen.add(id)
    out.push({ id, name, command })
    if (out.length >= MAX_TERMINAL_LAUNCHERS) break
  }
  return out
}

/** What an agent is called when nothing else names it (typed by hand into a shell). */
export const AGENT_NAMES: Record<'claude' | 'codex', string> = { claude: 'Claude Code', codex: 'Codex' }

/** The agent a command starts, by its first word ("claude --resume" → claude). */
export function agentOfCommand(command: string): 'claude' | 'codex' | null {
  const first = command.trim().split(/\s+/)[0] ?? ''
  const base = first.split(/[\\/]/).pop() ?? ''
  if (base === 'claude') return 'claude'
  if (base === 'codex') return 'codex'
  return null
}

// ── Files dropped on a terminal ────────────────────────────────────────────

/** How the shell of a terminal takes a path: a POSIX shell, PowerShell, or a POSIX shell inside a WSL distribution. */
export type PathStyle = { shell: 'posix' } | { shell: 'powershell' } | { shell: 'wsl'; distro: string }

const WSL_SHARE = /^(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]+([^\\/]+)(?:[\\/]+(.*))?$/i

/** The distribution a \\wsl.localhost\… (or \\wsl$\…) folder is in; null for any other folder. */
export function wslDistroOf(folder: string): string | null {
  return WSL_SHARE.exec(folder.trim())?.[1] ?? null
}

/**
 * A Windows path as a shell inside `distro` reaches it (the rule git follows there too, src/main/git/wsl.ts): a drive
 * is /mnt/<drive>, a path of its own share is that path; null when it cannot (another distribution, a network share).
 */
export function pathInWsl(distro: string, p: string): string | null {
  const share = WSL_SHARE.exec(p.trim())
  const drive = /^([a-z]):(?:[\\/](.*))?$/i.exec(p)
  if (share && share[1].toLowerCase() !== distro.toLowerCase()) return null
  if (!share && !drive) return null
  const parts = ((share ? share[2] : drive![2]) ?? '').split(/[\\/]+/).filter((s) => s && s !== '.')
  if (parts.includes('..')) return null
  return '/' + [...(share ? [] : ['mnt', drive![1].toLowerCase()]), ...parts].join('/')
}

/** Characters a POSIX shell takes as they are in a word; every other one of ASCII is written behind a backslash. */
const POSIX_PLAIN = /[A-Za-z0-9_\-./:@%+,=~]/
const hasControl = (s: string): boolean => /[\u0000-\u001f\u007f-\u009f]/.test(s)

/**
 * What dropping files on a terminal types: their paths as the shell there reads them back whole (a space is "\ "
 * in a POSIX shell, as other terminals type it, and quotes in PowerShell), one after another, with a space after the
 * last so that typing goes on. Never a line end: a path with control characters in it is left out, as is one the
 * shell cannot reach, and `left` counts them.
 */
export function typedPaths(paths: readonly string[], style: PathStyle): { text: string; left: number } {
  const words: string[] = []
  for (const raw of paths) {
    const p = style.shell === 'wsl' ? pathInWsl(style.distro, raw) : raw
    if (!p || hasControl(p)) continue
    if (style.shell === 'powershell') words.push(/^[A-Za-z0-9_\-./\\:]+$/.test(p) ? p : `'${p.replace(/'/g, "''")}'`)
    else words.push(Array.from(p, (ch) => (ch.charCodeAt(0) > 0x7f || POSIX_PLAIN.test(ch) ? ch : `\\${ch}`)).join(''))
  }
  return { text: words.length ? `${words.join(' ')} ` : '', left: paths.length - words.length }
}

// ── Signals in a terminal's output ─────────────────────────────────────────

/** The OSC number Adar's own messages use: ESC ] 7717 ; adar ; <what> [; <text>] BEL. */
export const ADAR_OSC = '7717'

export type TerminalSignal =
  /** The agent's own hooks: working, asks (a question: it needs you), notify (it says it waits), finished, idle. */
  | { kind: 'agent'; what: 'working' | 'asks' | 'notify' | 'finished' | 'idle'; message: string }
  /** A bell or a desktop notification (OSC 9, OSC 777) from whatever runs there. */
  | { kind: 'attention'; message: string }
  | { kind: 'title'; title: string }
  | { kind: 'cwd'; cwd: string }
  /** The shell started what was typed (what Adar adds to zsh says so); '' when it is back at its prompt. */
  | { kind: 'command'; command: string }

const NORMAL = 0
const ESCAPE = 1
const OSC = 2
const OSC_ESCAPE = 3
/** DCS, APC, PM, SOS: a string up to ST that is none of ours (it may hold a BEL). */
const STRING = 4
const STRING_ESCAPE = 5
const MAX_OSC = 2048

/** Where the reader of a terminal's output is, between chunks. */
export interface ScanState {
  mode: number
  buf: string
  /** The sequence is longer than anything of ours: read to its end, keep nothing. */
  over: boolean
}

export function newScan(): ScanState {
  return { mode: NORMAL, buf: '', over: false }
}

/** Text from a terminal, safe to show: no control characters, one line, cut. */
export function cleanText(s: string, max = 200): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    out += c < 0x20 || (c >= 0x7f && c < 0xa0) ? ' ' : ch
    if (out.length >= max * 2) break
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * A command line as a terminal's tab shows it: one line, cut, and without the variables set in front of it
 * (`TOKEN=… npm test` → "npm test": they say little, and are the part most likely to be a secret).
 */
export function shownCommand(line: string): string {
  let s = cleanText(line, 400)
  for (;;) {
    const m = /^[A-Za-z_][A-Za-z0-9_]*=/.exec(s)
    if (!m) break
    // The value ends at the first space outside quotes.
    let i = m[0].length
    let quote = ''
    for (; i < s.length; i++) {
      const ch = s[i]
      if (quote) {
        if (ch === quote) quote = ''
        else if (ch === '\\' && quote === '"') i++
      } else if (ch === '\\') i++
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === ' ') break
    }
    s = s.slice(i).trimStart()
  }
  return s.slice(0, 80)
}

function oscSignal(body: string): TerminalSignal | null {
  const semi = body.indexOf(';')
  const code = semi < 0 ? body : body.slice(0, semi)
  const rest = semi < 0 ? '' : body.slice(semi + 1)
  if (code === '0' || code === '2') return { kind: 'title', title: cleanText(rest, 120) }
  if (code === '7') {
    try {
      const url = new URL(rest)
      if (url.protocol !== 'file:') return null
      return { kind: 'cwd', cwd: decodeURIComponent(url.pathname) }
    } catch {
      return null
    }
  }
  if (code === '9') {
    // 9;4;… is a progress bar (ConEmu, Windows Terminal), not a message.
    if (/^4;/.test(rest) || !rest) return null
    return { kind: 'attention', message: cleanText(rest) }
  }
  if (code === '777') {
    const [verb, title = '', ...more] = rest.split(';')
    if (verb !== 'notify') return null
    const detail = more.join(';')
    return { kind: 'attention', message: cleanText(detail ? `${title}: ${detail}` : title) }
  }
  if (code === ADAR_OSC) {
    const [who, what, ...more] = rest.split(';')
    if (who !== 'adar') return null
    if (what === 'working' || what === 'asks' || what === 'notify' || what === 'finished' || what === 'idle') {
      return { kind: 'agent', what, message: cleanText(more.join(';')) }
    }
    if (what === 'command') return { kind: 'command', command: shownCommand(more.join(';')) }
  }
  return null
}

/**
 * Read a chunk of a terminal's output for what Adar listens to: bells, titles, the folder, notifications and an
 * agent's own messages. Nothing is removed from the output (xterm.js ignores the sequences it does not know).
 */
export function scanOutput(st: ScanState, chunk: string): TerminalSignal[] {
  const out: TerminalSignal[] = []
  // Most output has nothing for us.
  if (st.mode === NORMAL && !chunk.includes('\x07') && !chunk.includes('\x1b')) return out
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk.charCodeAt(i)
    switch (st.mode) {
      case NORMAL:
        if (c === 0x07) out.push({ kind: 'attention', message: '' })
        else if (c === 0x1b) st.mode = ESCAPE
        break
      case ESCAPE:
        if (c === 0x5d) {
          st.mode = OSC
          st.buf = ''
          st.over = false
        } else if (c === 0x50 || c === 0x5f || c === 0x5e || c === 0x58) st.mode = STRING
        else if (c !== 0x1b) st.mode = NORMAL
        break
      case OSC:
        if (c === 0x07) {
          const sig = st.over ? null : oscSignal(st.buf)
          if (sig) out.push(sig)
          st.mode = NORMAL
          st.buf = ''
        } else if (c === 0x1b) st.mode = OSC_ESCAPE
        else if (st.over) break
        else if (st.buf.length >= MAX_OSC) {
          st.over = true
          st.buf = ''
        } else st.buf += chunk[i]
        break
      case OSC_ESCAPE: {
        // ESC \ ends it; anything else after ESC and the sequence was cut short.
        const sig = c === 0x5c && !st.over ? oscSignal(st.buf) : null
        if (sig) out.push(sig)
        st.buf = ''
        st.mode = c === 0x5c ? NORMAL : c === 0x1b ? ESCAPE : NORMAL
        break
      }
      case STRING:
        if (c === 0x1b) st.mode = STRING_ESCAPE
        break
      case STRING_ESCAPE:
        st.mode = c === 0x5c ? NORMAL : c === 0x1b ? STRING_ESCAPE : STRING
        break
    }
  }
  return out
}

// ── From signals to the state a dot shows ──────────────────────────────────

export interface RunState {
  state: AgentRunState | null
  message: string
  /** Who said it: the agent's own hooks, or only a bell or a notification from whatever runs there. */
  by: 'agent' | 'bell' | null
}

export const IDLE_RUN: RunState = { state: null, message: '', by: null }

/** A notification that only says a turn is over. */
const TURN_ENDED = /^agent turn complete/i

const same = (a: RunState, b: RunState) => a.state === b.state && a.message === b.message && a.by === b.by

/** The state after a signal from the terminal's output (the same object when nothing changes). */
export function afterSignal(cur: RunState, sig: TerminalSignal): RunState {
  let next = cur
  if (sig.kind === 'agent') {
    if (sig.what === 'working') next = { state: 'working', message: '', by: 'agent' }
    else if (sig.what === 'asks') next = { state: 'needs-you', message: sig.message, by: 'agent' }
    else if (sig.what === 'finished') next = { state: 'finished', message: '', by: 'agent' }
    else if (sig.what === 'idle') next = IDLE_RUN
    // "It waits for you" only counts in the middle of a turn: agents repeat it while idle after finishing.
    else if (cur.state === 'working' || cur.state === 'needs-you') next = { state: 'needs-you', message: sig.message || cur.message, by: 'agent' }
  } else if (sig.kind === 'attention') {
    // An agent that reports its own state needs no bell to say it again.
    if (cur.by !== 'agent' || cur.state === null) {
      // Codex says the end of a turn in these words (its terminal notifications); anything else asks for the user.
      next = TURN_ENDED.test(sig.message) ? { state: 'finished', message: '', by: 'bell' } : { state: 'needs-you', message: sig.message || cur.message, by: 'bell' }
    }
  }
  return same(cur, next) ? cur : next
}

/** The state after the user typed into the terminal. */
export function afterInput(cur: RunState, data: string): RunState {
  if (cur.state === 'finished') return IDLE_RUN
  // An answer to what an agent asked (one key is enough for its menus): it goes on. A bell had nothing more to say.
  if (cur.state === 'needs-you' && cur.by === 'agent') return { state: 'working', message: '', by: 'agent' }
  if (cur.state === 'needs-you' && data.includes('\r')) return IDLE_RUN
  // Esc or Ctrl-C alone: the turn was interrupted, and nothing reports that.
  if (cur.state === 'working' && (data === '\x1b' || data === '\x03')) return IDLE_RUN
  return cur
}

/** The state once the user looked at the terminal: "finished" and a bell are news only until seen. */
export function afterSeen(cur: RunState): RunState {
  if (cur.state === 'finished' || (cur.state === 'needs-you' && cur.by === 'bell')) return IDLE_RUN
  return cur
}

const URGENCY: Record<AgentRunState, number> = { 'needs-you': 3, finished: 2, working: 1 }

/** The state several terminals show together (a tab's dot): the most urgent one. */
export function topState(states: ReadonlyArray<AgentRunState | null | undefined>): AgentRunState | null {
  let top: AgentRunState | null = null
  for (const s of states) if (s && (!top || URGENCY[s] > URGENCY[top])) top = s
  return top
}

export const STATE_LABEL: Record<AgentRunState, string> = { working: 'working', 'needs-you': 'needs you', finished: 'finished' }

/** The key of a tab group's terminals. */
export const groupOwner = (groupId: string): string => `group:${groupId}`
export const isGroupOwner = (owner: string): boolean => owner.startsWith('group:')

/** Calls about the window a terminal is drawn in (not the backend's): see src/main/index.ts. */
export const TERMINAL_WINDOW_METHODS = ['terminalFocusChanged'] as const
export type TerminalWindowMethod = (typeof TERMINAL_WINDOW_METHODS)[number]
export interface TerminalWindowApi {
  /** A terminal took or lost the keyboard: elsewhere than macOS the menu's Ctrl shortcuts then go to the shell. */
  terminalFocusChanged(focused: boolean): Promise<void>
}
