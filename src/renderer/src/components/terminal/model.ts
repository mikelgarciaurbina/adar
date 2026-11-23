// Terminals, pure UI helpers: the words for a terminal and its tab, the state an owner's terminals add up to
// (the dot on a project's tab or a group's label) and the notifications for what an agent in one says.

import type { AppSettings, TabGroup, WorkingStatus } from '@shared/types'
import { isGroupOwner, topState, type AgentRunState, type TerminalInfo, type TerminalNotice } from '@shared/terminal'
import { pluralize } from '@renderer/lib/format'
import { groupOf } from '@renderer/lib/tabGroups'

/**
 * What runs in a terminal, in a few words: the launcher or agent while its program runs, else the command the shell
 * says it runs ("npm run dev"), else the program in front.
 */
export function terminalLabel(info: TerminalInfo | undefined): string {
  if (!info) return 'terminal'
  if (info.busy) return info.name || info.command || info.process || 'shell'
  return info.process || 'shell'
}

/** What agents call their terminal before they have a task to name. */
const AGENT_TITLES = new Set(['claude code', 'claude', 'codex', 'openai codex'])

/**
 * An agent's own words for its task, from the title it gives its terminal ("✳ Fix the login form" → "Fix the login
 * form": the mark in front says it is working, which the dot already does); '' while the title only names the program.
 */
export function taskOf(info: TerminalInfo): string {
  const task = info.title.replace(/^(?:[\p{S}\p{P}]\s+)+/u, '').trim()
  const low = task.toLowerCase()
  if (!task || AGENT_TITLES.has(low)) return ''
  if ([info.name, info.process, info.command].some((own) => own && own.toLowerCase() === low)) return ''
  // A shell's own title for what it runs is the command again, perhaps cut short.
  if (info.command && info.command.toLowerCase().startsWith(low.replace(/(\.{3}|…)$/, ''))) return ''
  return task
}

/** A terminal tab's words: what it is and, after it and dimmer, an agent's task. */
export interface TabLabel {
  text: string
  detail: string
}

export const labelText = (l: TabLabel): string => (l.detail ? `${l.text} · ${l.detail}` : l.text)

/** The folder an idle shell is in, by its own name ("site"); '' in the folder its terminals start in. */
function placeOf(cwd: string, folder: string): string {
  const trim = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p)
  if (!cwd || trim(cwd) === trim(folder)) return ''
  if (shortFolder(trim(cwd)) === '~') return '~'
  return trim(cwd).split(/[\\/]/).pop() || cwd
}

/**
 * What a terminal's tab says, for telling it from its neighbours: an agent with its task ("Claude Code · Fix the
 * login form"), the command that runs ("npm run dev"), or for a shell at its prompt the folder it is in when that is
 * not the one its terminals start in (`folder`), else the shell's name.
 */
export function tabLabel(info: TerminalInfo | undefined, folder: string): TabLabel {
  if (!info) return { text: 'terminal', detail: '' }
  if (info.busy) return { text: terminalLabel(info), detail: info.name ? taskOf(info) : '' }
  return { text: placeOf(info.cwd, folder) || info.process || 'shell', detail: '' }
}

/** Each tab's label, in order: the user's own name for it, else `tabLabel`; those that would read the same are numbered. */
export function tabLabels(tabs: ReadonlyArray<{ name: string; info: TerminalInfo | undefined }>, folder: string): TabLabel[] {
  const seen = new Map<string, number>()
  return tabs.map((t) => {
    if (t.name) return { text: t.name, detail: '' }
    const label = tabLabel(t.info, folder)
    const key = labelText(label)
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return n > 1 ? { ...label, text: `${label.text} ${n}` } : label
  })
}

/** "~/Projects/landing" for a folder under the user's home (told by the path itself: /Users/x or /home/x). */
export function shortFolder(cwd: string): string {
  const m = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/.exec(cwd)
  return m ? `~${cwd.slice(m[1].length)}` : cwd
}

/** The state of an owner's terminals taken together. */
export function ownerState(infos: Record<string, TerminalInfo>, owner: string): AgentRunState | null {
  const states: Array<AgentRunState | null> = []
  for (const t of Object.values(infos)) if (t.owner === owner) states.push(t.state)
  return topState(states)
}

/** How many terminals an owner has running. */
export function ownerCount(infos: Record<string, TerminalInfo>, owner: string): number {
  let n = 0
  for (const t of Object.values(infos)) if (t.owner === owner) n++
  return n
}

export const STATE_TITLE: Record<AgentRunState, string> = {
  working: 'An agent is working in a terminal here',
  'needs-you': 'An agent in a terminal here needs you',
  finished: 'An agent in a terminal here finished its task'
}

export function shouldNotify(info: TerminalInfo, s: Pick<AppSettings, 'notifyTerminalNeedsYou' | 'notifyTerminalFinished'>): boolean {
  if (info.state === 'needs-you') return s.notifyTerminalNeedsYou
  if (info.state === 'finished') return s.notifyTerminalFinished
  return false
}

/** "3 files changed, not committed yet", from a repository's status. */
export function changesText(status: WorkingStatus | null | undefined): string {
  if (!status) return ''
  const files = new Set([...status.staged, ...status.unstaged, ...status.conflicted].map((f) => f.path)).size
  return files ? `${pluralize(files, 'file')} changed, not committed yet` : 'No changes left to commit'
}

interface TabLike {
  path: string
  name: string
  status: WorkingStatus | null
}

/** Where a terminal is, for a notification: "Basoa › landing", or "Basoa · group" for a group's own. */
export function whereOf(owner: string, tabs: readonly TabLike[], groups: readonly TabGroup[]): string {
  if (isGroupOwner(owner)) {
    const group = groups.find((g) => `group:${g.id}` === owner)
    return group ? `${group.name} · group` : 'A tab group'
  }
  const repo = tabs.find((t) => t.path === owner)?.name ?? owner.split(/[\\/]/).pop() ?? owner
  const group = groupOf(groups, owner)
  return group ? `${group.name} › ${repo}` : repo
}

/** The notification for a terminal that needs the user or finished; null for any other state. */
export function noticeFor(info: TerminalInfo, tabs: readonly TabLike[], groups: readonly TabGroup[]): TerminalNotice | null {
  const who = info.name || info.process || 'A terminal'
  const subtitle = whereOf(info.owner, tabs, groups)
  const open = { owner: info.owner, id: info.id }
  if (info.state === 'needs-you') return { title: `${who} needs you`, subtitle, body: info.message || 'It asked something and waits for your answer.', open }
  if (info.state === 'finished') return { title: `${who} finished`, subtitle, body: changesText(tabs.find((t) => t.path === info.owner)?.status), open }
  return null
}
