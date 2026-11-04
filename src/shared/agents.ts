// Agents at work: what the worktrees of the open repositories are doing, as the main process sees them through git
// and the files (src/main/system/activity.ts), and the pure rules both sides share: working, quiet or idle, which
// agent works there (Co-Authored-By trailers, the branch prefix, the folder), the 30-minute strip and the commits
// made since the user last looked. Adar never looks at the agents' processes or terminals.

export interface AgentFile {
  /** Worktree-relative path. */
  path: string
  /** M modified, A added, D deleted, R renamed, U conflicted, ? untracked. */
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?'
  added: number
  removed: number
  /** When it last changed (ms): its modification time, or when Adar saw it go for a deleted file. */
  at: number
}

export interface AgentCommit {
  sha: string
  subject: string
  /** Committer time (ms). */
  at: number
}

export interface AgentWorktree {
  /** The worktree's folder. */
  path: string
  /** The repository's main folder. */
  repo: string
  /** Folder name. */
  name: string
  /** The repository's own folder rather than a linked worktree. */
  isMain: boolean
  branch: string | null
  head: string | null
  /** Changes not committed, the latest first (at most MAX_AGENT_FILES). */
  files: AgentFile[]
  /** Every file with changes not committed (`files` may be cut). */
  fileCount: number
  added: number
  removed: number
  /** The branch the work is for ("main") and how many commits this one has that it lacks. */
  base: string | null
  ahead: number
  /** Commits the upstream lacks; null without an upstream (never pushed). */
  unpushed: number | null
  upstream: string | null
  /** The branch's own commits (not in base), newest first, at most MAX_AGENT_COMMITS. */
  commits: AgentCommit[]
  /** Agents named in the Co-Authored-By trailers of those commits, in the order first seen. */
  coAuthors: string[]
  /** Files changed per minute over the last STRIP_MINUTES: [minute start (ms), files]. */
  activity: Array<[number, number]>
  /** The last change seen: a file or a commit (ms); null when there is none to tell. */
  lastChange: number | null
  /** Start of the current stretch of work: changes less than IDLE_MS apart (ms). */
  since: number | null
}

export type AgentState = 'working' | 'quiet' | 'idle'

/** What happened in a worktree; `own` when Adar itself did it (no notification then). */
export type AgentEvent =
  | { kind: 'commit'; path: string; repo: string; commits: AgentCommit[]; files: number; own: boolean }
  | { kind: 'push'; path: string; repo: string; count: number; upstream: string; subject: string; own: boolean }
  | { kind: 'quiet'; path: string; repo: string }

/** A notification the UI asks the main process to show; a click sends an 'open-agent' event with `open`. */
export interface AgentNotice {
  title: string
  subtitle: string
  body: string
  open: AgentOpen
}

export interface AgentOpen {
  /** The worktree (its tab opens), or null for the Agents view. */
  path: string | null
  repo: string
  /** Its changes, one commit, or the Agents view. */
  view: 'changes' | 'commit' | 'agents'
  sha?: string
}

export interface AgentPrefix {
  prefix: string
  name: string
}

export const DEFAULT_AGENT_PREFIXES: AgentPrefix[] = [
  { prefix: 'claude/', name: 'Claude' },
  { prefix: 'codex/', name: 'Codex' },
  { prefix: 'copilot/', name: 'Copilot' },
  { prefix: 'cursor/', name: 'Cursor' }
]

export const MAX_AGENT_FILES = 40
export const MAX_AGENT_COMMITS = 30
export const MAX_AGENT_PREFIXES = 30
export const STRIP_MINUTES = 30
/** Nothing for this long: idle, whatever is pending. */
export const IDLE_MS = 30 * 60_000
/** Idle for a day or more: folded in the Agents view. */
export const FOLD_MS = 24 * 3600_000
export const QUIET_MINUTES = [2, 5, 10, 15] as const
export const DEFAULT_QUIET_MINUTES = 5

/** Coding agents named in Co-Authored-By trailers (the name before the address). */
const AGENTS: Array<[RegExp, string]> = [
  [/\bclaude\b/i, 'Claude'],
  [/\bcopilot\b/i, 'Copilot'],
  [/\bcodex\b|\bchatgpt\b|\bopenai\b/i, 'Codex'],
  [/\bcursor\b/i, 'Cursor'],
  [/\bgemini\b|\bjules\b/i, 'Gemini'],
  [/\bdevin\b/i, 'Devin'],
  [/\baider\b/i, 'Aider'],
  [/\bamp\b/i, 'Amp']
]

/** The agents named in a list of trailer values or whole messages, in the order first seen. */
export function agentsNamed(values: readonly string[]): string[] {
  const out: string[] = []
  for (const who of values) for (const [re, name] of AGENTS) if (re.test(who) && !out.includes(name)) out.push(name)
  return out
}

/** Coding agents named in the Co-Authored-By trailers of commit messages, in the order first seen. */
export function coAuthorAgents(messages: readonly string[]): string[] {
  const who: string[] = []
  for (const m of messages) {
    for (const line of m.split('\n')) {
      const t = /^co-authored-by:\s*(.+)$/i.exec(line.trim())
      if (t) who.push(t[1])
    }
  }
  return agentsNamed(who)
}

/** Folders agents make their worktrees in (Claude Code's .claude/worktrees, Codex's ~/.codex/worktrees…). */
const AGENT_FOLDERS: Array<[RegExp, string]> = [
  [/[\\/]\.claude[\\/]/, 'Claude'],
  [/[\\/]\.codex[\\/]/, 'Codex'],
  [/[\\/]\.cursor[\\/]/, 'Cursor']
]

/** Which agent works in a worktree: its commits' trailers, else the branch prefix, else the folder it is in. */
export function agentOf(w: Pick<AgentWorktree, 'coAuthors' | 'branch' | 'path'>, prefixes: readonly AgentPrefix[]): string | null {
  if (w.coAuthors.length) return w.coAuthors[0]
  const branch = w.branch ?? ''
  for (const p of prefixes) if (p.prefix && branch.startsWith(p.prefix)) return p.name
  for (const [re, name] of AGENT_FOLDERS) if (re.test(w.path)) return name
  return null
}

/** Commits the upstream lacks: those not pushed, or every own commit when the branch was never pushed. */
export function unpushedOf(w: Pick<AgentWorktree, 'unpushed' | 'ahead'>): number {
  return w.unpushed ?? w.ahead
}

/** Work left: changes not committed, or commits not pushed. */
export function pendingWork(w: Pick<AgentWorktree, 'fileCount' | 'unpushed' | 'ahead'>): boolean {
  return w.fileCount > 0 || unpushedOf(w) > 0
}

/**
 * Working: something changed less than `quietMinutes` ago. Quiet: it stopped longer ago than that, within the
 * last half hour, with work left (agents stop like this when they need an answer or a permission). Idle: the rest.
 */
export function agentState(w: Pick<AgentWorktree, 'lastChange' | 'fileCount' | 'unpushed' | 'ahead'>, now: number, quietMinutes: number): AgentState {
  if (w.lastChange === null) return 'idle'
  const gap = Math.max(0, now - w.lastChange)
  if (gap >= IDLE_MS) return 'idle'
  if (gap < quietMinutes * 60_000) return 'working'
  return pendingWork(w) ? 'quiet' : 'idle'
}

export function minuteOf(t: number): number {
  return Math.floor(t / 60_000) * 60_000
}

/** The last STRIP_MINUTES as bars (files changed per minute, oldest first) and the minutes with a commit. */
export function stripOf(w: Pick<AgentWorktree, 'activity' | 'commits'>, now: number): { bars: number[]; commits: number[] } {
  const end = minuteOf(now)
  const first = end - (STRIP_MINUTES - 1) * 60_000
  const bars = new Array<number>(STRIP_MINUTES).fill(0)
  for (const [minute, count] of w.activity) {
    const i = Math.round((minute - first) / 60_000)
    if (i >= 0 && i < STRIP_MINUTES) bars[i] += count
  }
  const commits: number[] = []
  for (const c of w.commits) {
    const i = Math.round((minuteOf(c.at) - first) / 60_000)
    if (i >= 0 && i < STRIP_MINUTES && !commits.includes(i)) commits.push(i)
  }
  return { bars, commits: commits.sort((a, b) => a - b) }
}

/** What the user saw of a worktree: its HEAD then, and when. */
export interface WorktreeSeen {
  sha: string
  at: number
}

/** Commits made since the user last looked (newest first): those above the one they saw, or newer than then. */
export function newSince(w: Pick<AgentWorktree, 'commits' | 'head'>, seen: WorktreeSeen | undefined): AgentCommit[] {
  if (!seen || !w.head || seen.sha === w.head) return []
  const i = w.commits.findIndex((c) => c.sha === seen.sha)
  if (i >= 0) return w.commits.slice(0, i)
  return w.commits.filter((c) => c.at > seen.at)
}

/** Settings keys are paths: keep the map small and its values well formed. */
export const MAX_WORKTREES_SEEN = 200

export function sanitizeAgentPrefixes(v: unknown): AgentPrefix[] | null {
  if (!Array.isArray(v)) return null
  const out: AgentPrefix[] = []
  for (const p of v) {
    if (!p || typeof p !== 'object') continue
    const { prefix, name } = p as Record<string, unknown>
    if (typeof prefix !== 'string' || typeof name !== 'string') continue
    const pre = prefix.trim().slice(0, 60)
    const nm = name.trim().slice(0, 40)
    if (!pre || !nm || out.some((o) => o.prefix === pre)) continue
    out.push({ prefix: pre, name: nm })
    if (out.length >= MAX_AGENT_PREFIXES) break
  }
  return out
}

export function sanitizeWorktreesSeen(v: unknown): Record<string, WorktreeSeen> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const entries: Array<[string, WorktreeSeen]> = []
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (!key || key.length > 4096 || !val || typeof val !== 'object') continue
    const { sha, at } = val as Record<string, unknown>
    if (typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(sha) || typeof at !== 'number' || !Number.isFinite(at)) continue
    entries.push([key, { sha, at }])
  }
  entries.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, MAX_WORKTREES_SEEN))
}

/** Validate a notice the UI sends (it reaches a system notification and, when clicked, the UI again). */
export function parseAgentNotice(v: unknown): AgentNotice | null {
  if (!v || typeof v !== 'object') return null
  const n = v as Record<string, unknown>
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : null)
  const title = text(n.title, 200)
  const subtitle = text(n.subtitle, 200)
  const body = text(n.body, 500)
  const open = n.open as Record<string, unknown> | undefined
  if (title === null || subtitle === null || body === null || !open || typeof open !== 'object') return null
  const view = open.view
  if (view !== 'changes' && view !== 'commit' && view !== 'agents') return null
  const path = open.path === null ? null : text(open.path, 4096)
  const repo = text(open.repo, 4096)
  if (!repo || (open.path !== null && !path)) return null
  const sha = typeof open.sha === 'string' && /^[0-9a-f]{7,64}$/i.test(open.sha) ? open.sha : undefined
  return { title, subtitle, body, open: { path, repo, view, ...(sha ? { sha } : {}) } }
}
