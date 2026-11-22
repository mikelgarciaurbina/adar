// Commits and pushes Adar did not make itself, in the repositories open in it: an agent's in one of Adar's
// terminals or in a worktree of its own, or the user's from another app. The main process notices them
// (src/main/system/activity.ts) and the UI turns them into notifications (components/agents). This is what is left
// of "Agents at work": what an agent is doing is now told by its terminal (src/shared/terminal.ts).

export interface AgentCommit {
  sha: string
  subject: string
  /** Committer time (ms). */
  at: number
}

/** What happened in a repository's folder or worktree; `own` when Adar itself did it (no notification then). */
export type AgentEvent =
  | { kind: 'commit'; path: string; repo: string; branch: string | null; isMain: boolean; commits: AgentCommit[]; files: number; agent: string | null; own: boolean }
  | { kind: 'push'; path: string; repo: string; branch: string | null; isMain: boolean; count: number; upstream: string; subject: string; agent: string | null; own: boolean }

/** A notification the UI asks the main process to show; a click sends an 'open-agent' event with `open`. */
export interface AgentNotice {
  title: string
  subtitle: string
  body: string
  open: AgentOpen
}

export interface AgentOpen {
  /** The folder or worktree (its tab opens). */
  path: string
  repo: string
  /** Its changes, or one commit. */
  view: 'changes' | 'commit'
  sha?: string
}

/** Branch prefixes that name the agent working on a branch ("claude/" → Claude), after Co-Authored-By trailers. */
export const AGENT_PREFIXES: ReadonlyArray<{ prefix: string; name: string }> = [
  { prefix: 'claude/', name: 'Claude' },
  { prefix: 'codex/', name: 'Codex' },
  { prefix: 'copilot/', name: 'Copilot' },
  { prefix: 'cursor/', name: 'Cursor' }
]

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

/** Which agent made some commits: their trailers, else the branch prefix, else the folder they were made in. */
export function agentOf(coAuthors: readonly string[], branch: string | null, folder: string): string | null {
  if (coAuthors.length) return coAuthors[0]
  for (const p of AGENT_PREFIXES) if (branch?.startsWith(p.prefix)) return p.name
  for (const [re, name] of AGENT_FOLDERS) if (re.test(folder)) return name
  return null
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
  if (view !== 'changes' && view !== 'commit') return null
  const path = text(open.path, 4096)
  const repo = text(open.repo, 4096)
  if (!repo || !path) return null
  const sha = typeof open.sha === 'string' && /^[0-9a-f]{7,64}$/i.test(open.sha) ? open.sha : undefined
  return { title, subtitle, body, open: { path, repo, view, ...(sha ? { sha } : {}) } }
}
