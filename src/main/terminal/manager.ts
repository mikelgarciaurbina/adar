// The terminals Adar runs: each one a pseudo-terminal with the user's login shell (node-pty), started in a
// repository's or a tab group's folder, optionally with a launcher's program ("claude"). The manager keeps their
// recent output for the UI to paint when it starts drawing one, reads the output for signals (@shared/terminal:
// title, bell, what an agent says about itself) and tells the UI what each one is doing with 'terminal-info'
// events. Terminals outlive Adar's window: they end when closed, when their shell exits or when Adar quits.

import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type { IPty } from 'node-pty'
import { AdarError } from '@shared/errors'
import {
  ADAR_OSC,
  afterInput,
  afterSeen,
  afterSignal,
  agentOfCommand,
  cleanText,
  IDLE_RUN,
  MAX_TERMINALS,
  newScan,
  scanOutput,
  SHELL_LAUNCHER,
  type RunState,
  type ScanState,
  type TerminalAttach,
  type TerminalInfo,
  type TerminalLauncher,
  type TerminalOpen,
  type TerminalSignal
} from '@shared/terminal'
import type { AdarEvent, AppSettings } from '@shared/types'
import { wslExecutable, wslTarget } from '../git/wsl'
import { writeJsonAtomic } from '../system/settings'
import { integrates, shellIntegration } from './shell'

type Pty = typeof import('node-pty')

export interface TerminalDeps {
  emit(event: AdarEvent): void
  settings(): Promise<Pick<AppSettings, 'terminalLaunchers' | 'terminalAgentState' | 'terminalShellIntegration' | 'terminalCompleteAnyCase'>>
  /** Where the agents' settings file is kept. */
  userDataDir: string
  appVersion: string
  /** Tests: another way to load node-pty, and no waiting between output and its event. */
  load?: () => Promise<Pty>
  flushMs?: number
  /** Tests: how long after a key a bell is still the shell's answer to it (default TYPING_BELL_MS). */
  typingBellMs?: number
}

/** Output kept per terminal for a UI that starts drawing it later (characters). */
const REPLAY_MAX = 400_000
const REPLAY_KEEP = 300_000
/** A bell this soon after a key is the shell answering it (nothing to complete), not a call for attention. */
const TYPING_BELL_MS = 1500
/** The signals file is also looked at this often (file events are not reliable everywhere), and emptied past this size. */
const SIGNALS_POLL_MS = 1500
const SIGNALS_MAX_BYTES = 256_000
/** Output is sent on in batches: at most this often, or sooner when this much is waiting. */
const FLUSH_MS = 6
const FLUSH_AT = 64_000
/** Output sent and not yet drawn: above HIGH the program is paused, below LOW it goes on. */
const HIGH = 1_500_000
const LOW = 300_000
const PROCESS_POLL_MS = 1500
const MAX_WRITE = 2_000_000

const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })

interface Session {
  info: TerminalInfo
  pty: IPty
  scan: ScanState
  run: RunState
  /** The shell's own name ("zsh"): anything else in front is a program running. */
  shell: string
  /** The name its launcher gave it ('' for a plain shell), for when an agent typed by hand is gone again. */
  launcherName: string
  replay: string
  pending: string
  timer: NodeJS.Timeout | null
  /** When the user last typed into it. */
  lastInput: number
  /** A UI is drawing it: output goes out as events and is counted until acknowledged. */
  attached: boolean
  unacked: number
  paused: boolean
  ended: boolean
}

/** Variables of Adar's own process that mean nothing, or the wrong thing, to a shell started from it. */
const DROPPED_ENV = /^(ELECTRON_|ADAR_|CHROME_|VITE_|npm_|ORIGINAL_XDG_|GOOGLE_API_KEY$|INIT_CWD$|NODE_ENV$|NODE_CHANNEL_FD$)/

/** What a terminal whose agent was typed by hand is called while Claude Code's hooks speak for it. */
const CLAUDE_NAME = 'Claude Code'
const NESTED_ENV = /^(CLAUDECODE$|CLAUDE_|ANTHROPIC_BASE_URL$|MCP_)/

/** "es-ES" → "es_ES.UTF-8": what a terminal app sets when the system gave the process no locale. */
export function defaultLang(locale: string): string {
  const m = /^([a-z]{2,3})[-_]([A-Za-z]{2})\b/.exec(locale)
  return m ? `${m[1].toLowerCase()}_${m[2].toUpperCase()}.UTF-8` : 'en_US.UTF-8'
}

/** The environment a terminal's shell starts with. */
export function terminalEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>, version: string, locale: string): Record<string, string> {
  const env: Record<string, string> = {}
  // Started from inside an agent's session (a development run): its markers and its sign-in are not for the
  // agents run here, which must start as from a terminal of the user's own.
  const nested = base.CLAUDECODE !== undefined
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'string' || DROPPED_ENV.test(k) || (nested && NESTED_ENV.test(k))) continue
    env[k] = v
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Adar'
  env.TERM_PROGRAM_VERSION = version
  if (process.platform !== 'win32' && !env.LANG && !env.LC_ALL) env.LANG = defaultLang(locale)
  return Object.assign(env, extra)
}

/**
 * A shell line that tells Adar something from a hook: a line appended to the file it watches ($ADAR_SIGNALS), with
 * the terminal it is about. Hooks have no terminal of their own to print to; outside Adar's terminals the variable
 * is not there and the line does nothing.
 */
function sayLine(what: string): string {
  return `[ -n "$ADAR_SIGNALS" ] && printf '%s ${what}\\n' "$ADAR_TERMINAL" >> "$ADAR_SIGNALS"; true`
}

/** The same with a few words taken from the JSON the hook reads (the value of `key`; quotes inside it end the capture). */
function sayWith(what: string, key: string, prefix = ''): string {
  return (
    `[ -n "$ADAR_SIGNALS" ] || exit 0; m=$(sed -n 's/.*"${key}"[[:space:]]*:[[:space:]]*"\\([^"\\\\]*\\).*/\\1/p' | head -c 200 | tr -d '\\000-\\037'); ` +
    `printf '%s ${what} ${prefix}%s\\n' "$ADAR_TERMINAL" "$m" >> "$ADAR_SIGNALS"; true`
  )
}

/**
 * Claude Code settings that make it say what it is doing: hooks for when a prompt is sent, when it asks for a
 * permission or a question, when a tool is done and when its turn ends. Loaded with `claude --settings <file>`,
 * on top of the user's own settings; they do nothing outside Adar's terminals.
 */
export function claudeHooks(): unknown {
  const hook = (command: string, matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }]
  return {
    hooks: {
      SessionStart: hook(sayLine('idle')),
      UserPromptSubmit: hook(sayLine('working')),
      // It needs the user: a permission to give, a question, a plan to approve.
      PermissionRequest: hook(sayWith('asks', 'tool_name', 'Permission to use ')),
      PreToolUse: hook(sayLine('asks'), 'AskUserQuestion|ExitPlanMode'),
      Notification: hook(sayWith('notify', 'message'), 'permission_prompt|elicitation_dialog'),
      // A tool ran: whatever it was waiting for was answered.
      PostToolUse: hook(sayLine('working')),
      PostToolUseFailure: hook(sayLine('working')),
      Stop: hook(sayLine('finished')),
      StopFailure: hook(sayLine('finished')),
      SessionEnd: hook(sayLine('idle'))
    }
  }
}

/** One line of the signals file: "<terminal> <what> [text]". */
export function parseSignalLine(line: string): { id: string; signal: TerminalSignal } | null {
  const m = /^(\S{1,64}) (working|asks|notify|finished|idle)(?: (.*))?$/.exec(line)
  if (!m) return null
  return { id: m[1], signal: { kind: 'agent', what: m[2] as 'working' | 'asks' | 'notify' | 'finished' | 'idle', message: cleanText(m[3] ?? '') } }
}

/** A launcher's command with what makes its agent report its state (nothing for programs Adar does not know). */
export function withAgentState(command: string, on: boolean): string {
  if (!on || process.platform === 'win32') return command
  const agent = agentOfCommand(command)
  if (agent === 'claude' && !/(^|\s)--settings(=|\s|$)/.test(command)) return `${command} --settings "$ADAR_CLAUDE_SETTINGS"`
  // Codex tells its terminal when a turn ends or it needs approval (a desktop notification: OSC 9).
  if (agent === 'codex' && !/tui\.notifications/.test(command)) return `${command} -c tui.notifications=true`
  return command
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

interface SpawnPlan {
  file: string
  args: string[]
  cwd: string
  /** Typed into the shell once it runs (where the program cannot be given on the command line). */
  type?: string
  shell: string
}

/** How a terminal is started on this system: the login shell there, alone or running the launcher's command first. */
export function spawnPlan(
  cwd: string,
  command: string | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  /** The shell that takes over from a launcher reads Adar's start-up files too (they gave $ZDOTDIR back). */
  integrated = false
): SpawnPlan {
  if (platform === 'win32') {
    const wsl = wslTarget(cwd, platform)
    // A folder inside WSL: a shell of its distribution there.
    if (wsl) return { file: wslExecutable(env), args: ['-d', wsl.distro, '--cd', wsl.linux], cwd: os.homedir(), type: command ?? undefined, shell: 'bash' }
    const file = env.COMSPEC && /powershell|pwsh/i.test(env.COMSPEC) ? env.COMSPEC : 'powershell.exe'
    return { file, args: ['-NoLogo'], cwd, type: command ?? undefined, shell: path.basename(file).replace(/\.exe$/i, '') }
  }
  const file = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const shell = path.basename(file)
  if (!command) return { file, args: ['-l', '-i'], cwd, shell }
  // The program first, in a login shell that has read the user's files (PATH, aliases); the shell again when it ends.
  const line = `${command}; printf '\\033]${ADAR_OSC};adar;idle\\007'; ${integrated ? 'ZDOTDIR="$ADAR_ZDOTDIR" ' : ''}exec ${shellQuote(file)} -l -i`
  return { file, args: ['-l', '-i', '-c', line], cwd, shell }
}

/** node-pty, loaded when the first terminal is asked for (a native module: nothing else waits for it). */
async function loadPty(): Promise<Pty> {
  const unwrap = (mod: Pty | { default: Pty }): Pty => ('spawn' in mod ? mod : mod.default)
  try {
    return unwrap(await import('node-pty'))
  } catch (err) {
    // A development build made outside the project (scripts/e2e.sh) finds its dependencies where it was started.
    if (!(process as { defaultApp?: boolean }).defaultApp) throw err
    return unwrap(createRequire(path.join(process.cwd(), 'package.json'))('node-pty') as Pty)
  }
}

export class TerminalManager {
  private readonly sessions = new Map<string, Session>()
  private seq = 0
  private pty: Promise<Pty> | null = null
  private poll: NodeJS.Timeout | null = null
  private hooksFile: Promise<string> | null = null
  /** The file hooks append to, how far it was read, and what watches it. */
  private signals: Promise<string> | null = null
  private signalsRead = 0
  private signalsWatch: FSWatcher | null = null
  private signalsPoll: NodeJS.Timeout | null = null
  private readingSignals = false

  constructor(private readonly deps: TerminalDeps) {}

  private load(): Promise<Pty> {
    if (!this.pty) {
      this.pty = (this.deps.load ? this.deps.load() : loadPty()).catch((err) => {
        this.pty = null
        throw new AdarError({ message: `Terminals cannot start on this system: ${err instanceof Error ? err.message : String(err)}`, code: 'UNKNOWN' })
      })
    }
    return this.pty
  }

  /** The agents' settings file, written once per run. */
  private claudeSettings(): Promise<string> {
    if (!this.hooksFile) {
      const file = path.join(this.deps.userDataDir, 'terminal', 'claude-hooks.json')
      this.hooksFile = writeJsonAtomic(file, claudeHooks()).then(
        () => file,
        () => {
          this.hooksFile = null
          return ''
        }
      )
    }
    return this.hooksFile
  }

  /** The file agents' hooks write to, emptied once per run and watched from then on; '' when it cannot be made. */
  private signalsFile(): Promise<string> {
    if (!this.signals) {
      const file = path.join(this.deps.userDataDir, 'terminal', 'signals')
      this.signals = fs
        .mkdir(path.dirname(file), { recursive: true })
        .then(() => fs.writeFile(file, '', { mode: 0o600 }))
        .then(
          () => {
            this.signalsRead = 0
            try {
              this.signalsWatch = watch(file, () => void this.readSignals(file))
              this.signalsWatch.on('error', () => undefined)
            } catch {
              this.signalsWatch = null
            }
            // File events are not to be trusted everywhere: a slow look as well.
            this.signalsPoll = setInterval(() => void this.readSignals(file), SIGNALS_POLL_MS)
            this.signalsPoll.unref?.()
            return file
          },
          () => {
            this.signals = null
            return ''
          }
        )
    }
    return this.signals
  }

  /** Read what was appended since the last look, a whole line at a time. */
  private async readSignals(file: string): Promise<void> {
    if (this.readingSignals) return
    this.readingSignals = true
    try {
      const handle = await fs.open(file, 'r')
      try {
        const { size } = await handle.stat()
        if (size < this.signalsRead) this.signalsRead = 0
        if (size === this.signalsRead) return
        const buf = Buffer.alloc(Math.min(size - this.signalsRead, 1_000_000))
        const { bytesRead } = await handle.read(buf, 0, buf.length, this.signalsRead)
        const text = buf.subarray(0, bytesRead).toString('utf8')
        const end = text.lastIndexOf('\n')
        if (end < 0) return
        this.signalsRead += Buffer.byteLength(text.slice(0, end + 1))
        for (const line of text.slice(0, end).split('\n')) {
          const parsed = parseSignalLine(line)
          const s = parsed && this.sessions.get(parsed.id)
          if (!parsed || !s) continue
          // Only Claude Code's hooks write here: a shell it was typed into by hand is its terminal for now.
          if (!s.info.name && parsed.signal.kind === 'agent' && parsed.signal.what !== 'idle') s.info.name = CLAUDE_NAME
          this.onSignal(s, parsed.signal)
        }
      } finally {
        await handle.close()
      }
      // Read to its end and grown large: start it again.
      if (this.signalsRead > SIGNALS_MAX_BYTES) {
        await fs.truncate(file, 0).catch(() => undefined)
        this.signalsRead = 0
      }
    } catch {
      /* the next change reads again */
    } finally {
      this.readingSignals = false
    }
  }

  /** Read the signals file now (tests). */
  async readSignalsNow(): Promise<void> {
    const file = await this.signalsFile()
    if (file) await this.readSignals(file)
  }

  async open(raw: unknown): Promise<TerminalInfo> {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<TerminalOpen>
    if (typeof o.owner !== 'string' || !o.owner || o.owner.length > 4096) throw invalid('A terminal needs an owner')
    if (typeof o.cwd !== 'string' || !path.isAbsolute(o.cwd)) throw invalid('A terminal needs a folder')
    const cols = clamp(o.cols, 2, 500, 80)
    const rows = clamp(o.rows, 1, 300, 24)
    if (this.sessions.size >= MAX_TERMINALS) throw invalid(`Adar keeps at most ${MAX_TERMINALS} terminals open`)
    const stat = await fs.stat(o.cwd).catch(() => null)
    if (!stat?.isDirectory()) throw new AdarError({ message: `The folder ${o.cwd} does not exist`, code: 'NOT_FOUND' })

    const settings = await this.deps.settings()
    let launcher: TerminalLauncher | null = null
    if (o.launcher !== undefined && o.launcher !== SHELL_LAUNCHER) {
      launcher = settings.terminalLaunchers.find((l) => l.id === o.launcher) ?? null
      if (!launcher) throw invalid('Unknown launcher')
    }
    const id = `t${++this.seq}-${Date.now().toString(36)}`
    const extra: Record<string, string> = { ADAR_TERMINAL: id }
    const posix = process.platform !== 'win32'
    // What agents need to say what they are doing: the file their hooks write to, and Claude Code's hooks.
    if (settings.terminalAgentState && posix) {
      const [signals, hooks] = await Promise.all([this.signalsFile(), this.claudeSettings()])
      if (signals) extra.ADAR_SIGNALS = signals
      if (signals && hooks) extra.ADAR_CLAUDE_SETTINGS = hooks
    }
    const shell = process.env.SHELL || ''
    let integrated = false
    if (settings.terminalShellIntegration && integrates(shell)) {
      const env = await shellIntegration(this.deps.userDataDir, { anyCase: settings.terminalCompleteAnyCase, userZdotdir: process.env.ZDOTDIR })
      if (env) {
        Object.assign(extra, env)
        integrated = true
      }
    }
    let command: string | null = null
    // With Adar's start-up files the shell itself starts the agents it knows that way, typed by hand or by a launcher.
    if (launcher) command = integrated ? launcher.command : withAgentState(launcher.command, !!extra.ADAR_CLAUDE_SETTINGS)
    const plan = spawnPlan(o.cwd, command, process.env, process.platform, integrated)
    const pty = await this.load()
    // Terminals may be opened while this one loads: the limit is checked again by the time it exists.
    let proc: IPty
    try {
      proc = pty.spawn(plan.file, plan.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: plan.cwd,
        env: terminalEnv(process.env, extra, this.deps.appVersion, Intl.DateTimeFormat().resolvedOptions().locale)
      })
    } catch (err) {
      throw new AdarError({ message: `Could not start ${plan.shell}: ${err instanceof Error ? err.message : String(err)}`, code: 'UNKNOWN' })
    }
    const s: Session = {
      info: {
        id,
        owner: o.owner,
        cwd: o.cwd,
        launcher: launcher?.id ?? SHELL_LAUNCHER,
        name: launcher?.name ?? '',
        process: launcher ? (agentOfCommand(launcher.command) ?? '') : plan.shell,
        title: '',
        busy: !!launcher,
        state: null,
        message: '',
        startedAt: Date.now()
      },
      pty: proc,
      scan: newScan(),
      run: IDLE_RUN,
      shell: plan.shell,
      launcherName: launcher?.name ?? '',
      replay: '',
      pending: '',
      timer: null,
      lastInput: 0,
      attached: false,
      unacked: 0,
      paused: false,
      ended: false
    }
    this.sessions.set(id, s)
    proc.onData((data) => this.onData(s, data))
    proc.onExit(({ exitCode, signal }) => this.onExit(s, exitCode, signal ?? 0))
    if (plan.type) setTimeout(() => !s.ended && proc.write(`${plan.type}\r`), 400)
    this.startPolling()
    return { ...s.info }
  }

  private get(id: unknown): Session {
    const s = typeof id === 'string' ? this.sessions.get(id) : undefined
    if (!s) throw new AdarError({ message: 'This terminal is no longer running', code: 'NOT_FOUND' })
    return s
  }

  /** Start drawing a terminal: its output so far, and from now on 'terminal-data' events. */
  attach(id: unknown): TerminalAttach {
    const s = this.get(id)
    this.flush(s)
    s.attached = true
    s.unacked = 0
    return { info: { ...s.info }, replay: s.replay }
  }

  /** The window went away or reloads: nothing draws the terminals now, so nothing may hold them back. */
  detachAll(): void {
    for (const s of this.sessions.values()) {
      s.attached = false
      s.unacked = 0
      this.resume(s)
    }
  }

  write(id: unknown, data: unknown): void {
    const s = this.get(id)
    if (typeof data !== 'string' || data.length > MAX_WRITE) throw invalid('Invalid input')
    if (s.ended) return
    s.pty.write(data)
    s.lastInput = Date.now()
    this.setRun(s, afterInput(s.run, data))
  }

  resize(id: unknown, cols: unknown, rows: unknown): void {
    const s = this.get(id)
    if (s.ended) return
    try {
      s.pty.resize(clamp(cols, 2, 500, 80), clamp(rows, 1, 300, 24))
    } catch {
      // The process ended between the check and the call.
    }
  }

  /** The UI drew this much output. */
  ack(id: unknown, chars: unknown): void {
    const s = typeof id === 'string' ? this.sessions.get(id) : undefined
    if (!s || typeof chars !== 'number' || !(chars > 0)) return
    s.unacked = Math.max(0, s.unacked - chars)
    if (s.unacked < LOW) this.resume(s)
  }

  /** The user looked at it. */
  seen(id: unknown): void {
    const s = typeof id === 'string' ? this.sessions.get(id) : undefined
    if (s) this.setRun(s, afterSeen(s.run))
  }

  close(id: unknown): void {
    const s = typeof id === 'string' ? this.sessions.get(id) : undefined
    if (!s) return
    this.kill(s)
  }

  list(): TerminalInfo[] {
    for (const s of this.sessions.values()) this.readProcess(s)
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  /** Terminals with a program running (quitting asks first). */
  busyCount(): number {
    return this.list().filter((t) => t.busy).length
  }

  dispose(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    if (this.signalsPoll) clearInterval(this.signalsPoll)
    this.signalsPoll = null
    this.signalsWatch?.close()
    this.signalsWatch = null
    for (const s of [...this.sessions.values()]) this.kill(s)
    this.sessions.clear()
  }

  private kill(s: Session): void {
    if (s.ended) return
    try {
      s.pty.kill()
    } catch {
      // Already gone.
    }
  }

  private resume(s: Session): void {
    if (!s.paused || s.ended) return
    s.paused = false
    try {
      s.pty.resume()
    } catch {
      // Already gone.
    }
  }

  private onData(s: Session, data: string): void {
    for (const sig of scanOutput(s.scan, data)) this.onSignal(s, sig)
    s.replay += data
    if (s.replay.length > REPLAY_MAX) s.replay = s.replay.slice(-REPLAY_KEEP)
    if (!s.attached) return
    s.pending += data
    if (s.pending.length >= FLUSH_AT) this.flush(s)
    else if (!s.timer) s.timer = setTimeout(() => this.flush(s), this.deps.flushMs ?? FLUSH_MS)
  }

  private flush(s: Session): void {
    if (s.timer) clearTimeout(s.timer)
    s.timer = null
    if (!s.pending) return
    const data = s.pending
    s.pending = ''
    s.unacked += data.length
    this.deps.emit({ type: 'terminal-data', id: s.info.id, data })
    if (s.unacked > HIGH && !s.paused && !s.ended) {
      s.paused = true
      try {
        s.pty.pause()
      } catch {
        s.paused = false
      }
    }
  }

  private onSignal(s: Session, sig: TerminalSignal): void {
    if (sig.kind === 'title') {
      if (sig.title !== s.info.title) this.change(s, { title: sig.title })
    } else if (sig.kind === 'cwd') {
      if (path.isAbsolute(sig.cwd) && sig.cwd !== s.info.cwd) this.change(s, { cwd: sig.cwd })
    } else {
      // The shell beeps at what was just typed (nothing to complete, the start of the line): that asks for nothing.
      if (sig.kind === 'attention' && !sig.message && Date.now() - s.lastInput < (this.deps.typingBellMs ?? TYPING_BELL_MS)) return
      this.setRun(s, afterSignal(s.run, sig))
    }
  }

  private setRun(s: Session, run: RunState): void {
    if (run === s.run) return
    s.run = run
    this.change(s, { state: run.state, message: run.message })
  }

  private change(s: Session, patch: Partial<TerminalInfo>): void {
    Object.assign(s.info, patch)
    this.deps.emit({ type: 'terminal-info', info: { ...s.info } })
  }

  private onExit(s: Session, code: number, signal: number): void {
    s.ended = true
    this.flush(s)
    this.sessions.delete(s.info.id)
    this.deps.emit({ type: 'terminal-exit', id: s.info.id, code, signal })
    if (!this.sessions.size && this.poll) {
      clearInterval(this.poll)
      this.poll = null
    }
  }

  /** The program in front (the system knows; the terminal does not say). */
  private readProcess(s: Session): void {
    if (s.ended) return
    let name = ''
    try {
      name = path.basename(s.pty.process || '').replace(/^-/, '')
    } catch {
      return
    }
    if (!name) return
    const busy = name !== s.shell
    if (name !== s.info.process || busy !== s.info.busy) {
      // Back at the shell: whatever ran there said its last word.
      if (!busy && s.run !== IDLE_RUN && s.run.by === 'agent') s.run = IDLE_RUN
      this.change(s, { process: name, busy, state: s.run.state, message: s.run.message, ...(busy ? {} : { name: s.launcherName }) })
    }
  }

  private startPolling(): void {
    if (this.poll || process.platform === 'win32') return
    this.poll = setInterval(() => {
      for (const s of this.sessions.values()) this.readProcess(s)
    }, PROCESS_POLL_MS)
    this.poll.unref?.()
  }
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : fallback
}
