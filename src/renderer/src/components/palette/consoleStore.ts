// Per-repository Git console log (kept while the app runs, so switching tabs or
// closing the drawer does not lose output) and the command runner.

import { create } from 'zustand'
import { api } from '@renderer/api/client'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import { formatCommand, interactiveReason, parseGitCommandLine } from './argv'

export type ConsoleLineKind = 'cmd' | 'out' | 'err' | 'exit' | 'info'

export interface ConsoleLine {
  id: number
  kind: ConsoleLineKind
  text: string
  code?: number
}

/** Keep at most this many entries per repository. */
const MAX_ENTRIES = 600
/** Truncate a single stdout/stderr block beyond this many characters. */
const MAX_BLOCK_CHARS = 400_000

interface ConsoleState {
  logs: Record<string, ConsoleLine[]>
  running: Record<string, boolean>
  append(repo: string, lines: Array<Omit<ConsoleLine, 'id'>>): void
  clear(repo: string): void
  setRunning(repo: string, running: boolean): void
}

let nextId = 1

export const useConsole = create<ConsoleState>((set) => ({
  logs: {},
  running: {},
  append(repo, lines) {
    if (!lines.length) return
    set((s) => {
      const prev = s.logs[repo] ?? []
      const added = lines.map((l) => ({ ...l, id: nextId++ }))
      const merged = prev.concat(added)
      return { logs: { ...s.logs, [repo]: merged.length > MAX_ENTRIES ? merged.slice(merged.length - MAX_ENTRIES) : merged } }
    })
  },
  clear(repo) {
    set((s) => ({ logs: { ...s.logs, [repo]: [] } }))
  },
  setRunning(repo, running) {
    set((s) => ({ running: { ...s.running, [repo]: running } }))
  }
}))

export function truncateBlock(text: string, max = MAX_BLOCK_CHARS): string {
  if (text.length <= max) return text
  const omitted = text.length - max
  return `${text.slice(0, max)}\n… output truncated (${omitted.toLocaleString()} more characters)`
}

/** Strip a single trailing newline (git output always ends with one). */
function trimEnd(text: string): string {
  return text.replace(/\r?\n$/, '')
}

/**
 * Run one console line in `repo`. Returns false when nothing was executed
 * (parse error, blocked interactive command, built-in like "clear").
 */
export async function runConsoleLine(repo: string, line: string): Promise<boolean> {
  const store = useConsole.getState()
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed === 'clear' || trimmed === 'cls') {
    store.clear(repo)
    return false
  }
  if (trimmed === 'exit') {
    useApp.getState().setConsoleOpen(false)
    return false
  }
  const { args, error } = parseGitCommandLine(trimmed)
  if (error) {
    store.append(repo, [{ kind: 'err', text: `Parse error: ${error}` }])
    return false
  }
  if (!args.length) {
    store.append(repo, [{ kind: 'info', text: 'Type a git command, e.g. status, log --oneline -20, branch -vv' }])
    return false
  }
  const blocked = interactiveReason(args)
  if (blocked) {
    store.append(repo, [
      { kind: 'cmd', text: formatCommand(args) },
      { kind: 'info', text: blocked }
    ])
    return false
  }

  store.append(repo, [{ kind: 'cmd', text: formatCommand(args) }])
  store.setRunning(repo, true)
  try {
    const res = await api.runGit(repo, args)
    const out: Array<Omit<ConsoleLine, 'id'>> = []
    if (res.stdout) out.push({ kind: 'out', text: truncateBlock(trimEnd(res.stdout)) })
    if (res.stderr) out.push({ kind: 'err', text: truncateBlock(trimEnd(res.stderr)) })
    out.push({ kind: 'exit', text: `exit ${res.code}`, code: res.code })
    useConsole.getState().append(repo, out)
  } catch (err) {
    useConsole.getState().append(repo, [{ kind: 'err', text: describeError(err) }])
  } finally {
    useConsole.getState().setRunning(repo, false)
    if (useApp.getState().tabs.some((t) => t.path === repo)) void useApp.getState().refresh(repo)
  }
  return true
}
