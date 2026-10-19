// Pure logic for interactive rebase: todo validation and todo construction.
//
// The todo the UI sends is OLDEST FIRST, the same order as git's todo file.
// Messages are applied with `exec git commit --amend` steps so the rebase never
// needs an editor:
//   reword            → pick <sha>, then amend with the new message
//   squash/fixup runs → fixup <sha> for each, then (if needed) one amend with
//                        the final message after the run

import type { Commit, RebaseAction } from '@shared/types'
import { invalid } from './util'

export const REBASE_ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop']

export interface ResolvedTodoItem {
  action: RebaseAction
  /** Full sha. */
  sha: string
  /** Trusted single-line subject (from git, not from the caller). */
  subject: string
  message?: string
}

export type TodoStep = { kind: 'line'; text: string } | { kind: 'amend'; message: string }

const hasText = (s: string | undefined): s is string => typeof s === 'string' && s.trim().length > 0

function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Validate the caller's todo against the commits being rebased and return it
 * with full shas and trusted subjects. Every commit must appear exactly once
 * (dropping is explicit with 'drop') so a stale list never loses commits.
 */
export function resolveTodo(todo: unknown, commits: Commit[]): ResolvedTodoItem[] {
  if (!Array.isArray(todo) || todo.length === 0) throw invalid('The rebase todo list is empty')
  const bySha = new Map(commits.map((c) => [c.sha.toLowerCase(), c]))
  const used = new Set<string>()
  const out: ResolvedTodoItem[] = []

  for (const raw of todo as unknown[]) {
    if (!raw || typeof raw !== 'object') throw invalid('Invalid rebase todo item')
    const item = raw as { action?: unknown; sha?: unknown; message?: unknown }
    const action = item.action as RebaseAction
    if (!REBASE_ACTIONS.includes(action)) throw invalid(`Invalid rebase action: ${String(item.action)}`)
    if (typeof item.sha !== 'string' || !/^[0-9a-f]{4,64}$/i.test(item.sha)) {
      throw invalid(`Invalid commit in rebase todo: ${String(item.sha)}`)
    }
    if (item.message !== undefined && item.message !== null && typeof item.message !== 'string') {
      throw invalid('Invalid commit message in rebase todo')
    }
    const wanted = item.sha.toLowerCase()
    let commit = bySha.get(wanted)
    if (!commit) {
      const matches = commits.filter((c) => c.sha.toLowerCase().startsWith(wanted))
      if (matches.length > 1) throw invalid(`Ambiguous commit in rebase todo: ${item.sha}`)
      commit = matches[0]
    }
    if (!commit) throw invalid(`Commit ${item.sha.slice(0, 10)} is not one of the commits being rebased`)
    if (used.has(commit.sha)) throw invalid(`Commit ${commit.shortSha} appears more than once in the rebase todo`)
    used.add(commit.sha)
    out.push({
      action,
      sha: commit.sha,
      subject: oneLine(commit.subject),
      message: typeof item.message === 'string' ? item.message : undefined
    })
  }

  const missing = commits.find((c) => !used.has(c.sha))
  if (missing) {
    throw invalid(`The rebase todo is out of date: commit ${missing.shortSha} is missing (use "drop" to remove a commit)`)
  }
  const first = out.find((i) => i.action !== 'drop')
  if (first && (first.action === 'squash' || first.action === 'fixup')) {
    throw invalid(`Cannot ${first.action} ${first.sha.slice(0, 7)}: there is no earlier commit to combine it with`)
  }
  return out
}

interface Group {
  base: ResolvedTodoItem
  /** Items after the base up to the next base: squash, fixup and drop, in order. */
  tail: ResolvedTodoItem[]
}

/** Leading drops and base + tail groups, in todo order. */
function group(items: ResolvedTodoItem[]): Array<ResolvedTodoItem | Group> {
  const out: Array<ResolvedTodoItem | Group> = []
  let current: Group | null = null
  for (const it of items) {
    if (it.action === 'pick' || it.action === 'reword' || it.action === 'edit') {
      current = { base: it, tail: [] }
      out.push(current)
    } else if (current) {
      current.tail.push(it)
    } else if (it.action === 'drop') {
      out.push(it)
    } else {
      throw invalid(`Cannot ${it.action} ${it.sha.slice(0, 7)}: there is no earlier commit to combine it with`)
    }
  }
  return out
}

/** Message the combined commit of a group should end with, or null to keep what git produces. */
function groupMessage(g: Group, fullMessages: ReadonlyMap<string, string>): string | null {
  const squashes = g.tail.filter((i) => i.action === 'squash')
  const provided = [...squashes].reverse().find((i) => hasText(i.message))
  if (provided) return provided.message as string
  const reword = g.base.action === 'reword' && hasText(g.base.message) ? g.base.message : null
  if (squashes.length) {
    const parts = [reword ?? fullMessages.get(g.base.sha) ?? g.base.subject, ...squashes.map((s) => fullMessages.get(s.sha) ?? s.subject)]
    return `${parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join('\n\n')}\n`
  }
  return reword
}

/** Shas whose full commit messages buildTodo() needs (combined squash messages). */
export function messagesNeeded(items: ResolvedTodoItem[]): string[] {
  const out: string[] = []
  for (const g of group(items)) {
    if (!('base' in g)) continue
    const squashes = g.tail.filter((i) => i.action === 'squash')
    if (!squashes.length || squashes.some((s) => hasText(s.message))) continue
    if (!(g.base.action === 'reword' && hasText(g.base.message))) out.push(g.base.sha)
    for (const s of squashes) out.push(s.sha)
  }
  return out
}

/** Build the todo as lines plus "amend with this message" steps (rendered as exec lines by the caller). */
export function buildTodo(items: ResolvedTodoItem[], fullMessages: ReadonlyMap<string, string>): TodoStep[] {
  const line = (cmd: string, it: ResolvedTodoItem): TodoStep => ({ kind: 'line', text: `${cmd} ${it.sha} ${it.subject}`.trimEnd() })
  const steps: TodoStep[] = []
  for (const g of group(items)) {
    if (!('base' in g)) {
      steps.push(line('drop', g))
      continue
    }
    steps.push(line(g.base.action === 'edit' ? 'edit' : 'pick', g.base))
    for (const t of g.tail) steps.push(line(t.action === 'drop' ? 'drop' : 'fixup', t))
    const message = groupMessage(g, fullMessages)
    if (message !== null) steps.push({ kind: 'amend', message })
  }
  return steps
}
