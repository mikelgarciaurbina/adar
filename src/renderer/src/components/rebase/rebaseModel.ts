// Pure model for the interactive rebase editor (no React). Entries are kept in
// TODO ORDER (oldest first, like `git rebase -i`); the view renders them
// reversed (newest at the top, like GitKraken) and converts indices with
// toDisplayIndex(). Covered by rebaseModel.test.ts.
//
// Message semantics (RebaseTodoItem.message):
//  - reword: the new full message of that commit.
//  - squash: the combined message of the squash group, sent on the FIRST squash
//    item of the group. While editing, the custom message is stored on one of the
//    group's squash entries; if several carry one, the last one wins.

import type { Commit, RebaseAction, RebaseTodoItem } from '@shared/types'

export interface RebaseEntry {
  commit: Commit
  action: RebaseAction
  /** reword: edited full message. squash: custom combined message of its group. */
  message?: string
}

export interface ActionInfo {
  action: RebaseAction
  label: string
  /** Keyboard shortcut (single letter, like git's abbreviations). */
  key: string
  description: string
}

export const REBASE_ACTIONS: readonly ActionInfo[] = [
  { action: 'pick', label: 'Pick', key: 'p', description: 'Keep the commit as is' },
  { action: 'reword', label: 'Reword', key: 'r', description: 'Keep the commit, edit its message' },
  { action: 'edit', label: 'Edit', key: 'e', description: 'Stop at this commit to amend it' },
  { action: 'squash', label: 'Squash', key: 's', description: 'Meld into the previous commit, combining messages' },
  { action: 'fixup', label: 'Fixup', key: 'f', description: 'Meld into the previous commit, discarding this message' },
  { action: 'drop', label: 'Drop', key: 'd', description: 'Remove the commit' }
]

export const ACTION_INFO: Record<RebaseAction, ActionInfo> = Object.fromEntries(REBASE_ACTIONS.map((a) => [a.action, a])) as Record<
  RebaseAction,
  ActionInfo
>

/** Lower-case key → action ("p" → pick...). */
export function actionForKey(key: string): RebaseAction | null {
  const k = key.toLowerCase()
  return REBASE_ACTIONS.find((a) => a.key === k)?.action ?? null
}

export function isMeld(action: RebaseAction): boolean {
  return action === 'squash' || action === 'fixup'
}

/** Subject + blank line + body (body trimmed). */
export function fullMessage(commit: Pick<Commit, 'subject' | 'body'>): string {
  const body = (commit.body ?? '').replace(/^\s*\n/, '').trimEnd()
  return body ? `${commit.subject}\n\n${body}` : commit.subject
}

export function initialEntries(commits: readonly Commit[]): RebaseEntry[] {
  return commits.map((commit) => ({ commit, action: 'pick' }))
}

/** True when anything differs from the original todo (order, actions or messages). */
export function isModified(entries: readonly RebaseEntry[], original: readonly Commit[]): boolean {
  if (entries.length !== original.length) return true
  return entries.some((e, i) => e.commit.sha !== original[i].sha || e.action !== 'pick')
}

// ── Squash groups ──────────────────────────────────────────────────────────

export interface SquashGroup {
  /** Todo index of the commit the members are melded into (pick / reword / edit). */
  head: number
  /** Todo indices of the squash/fixup members, oldest first. */
  members: number[]
  /** Only the 'squash' members (their messages are combined). */
  squashMembers: number[]
}

export interface GroupInfo {
  groups: SquashGroup[]
  /** For each todo index: the head index a squash/fixup melds into, null when there is none (invalid) or not a meld. */
  targetOf: Array<number | null>
  /** For each todo index: the group it belongs to (as head or member), or -1. */
  groupOf: number[]
}

/**
 * Work out which commits squash/fixup meld into. Dropped commits are ignored
 * (git removes them from the todo before applying), so `pick A, drop B, squash C`
 * melds C into A.
 */
export function computeGroups(entries: readonly RebaseEntry[]): GroupInfo {
  const groups: SquashGroup[] = []
  const targetOf: Array<number | null> = entries.map(() => null)
  const groupOf: number[] = entries.map(() => -1)
  let head = -1
  let currentGroup = -1
  entries.forEach((e, i) => {
    if (e.action === 'drop') return
    if (isMeld(e.action)) {
      if (head < 0) return
      targetOf[i] = head
      if (currentGroup < 0) {
        currentGroup = groups.length
        groups.push({ head, members: [], squashMembers: [] })
        groupOf[head] = currentGroup
      }
      const g = groups[currentGroup]
      g.members.push(i)
      if (e.action === 'squash') g.squashMembers.push(i)
      groupOf[i] = currentGroup
      return
    }
    head = i
    currentGroup = -1
  })
  return { groups, targetOf, groupOf }
}

/** Combined message git would propose: head message + every squash member's message (fixups excluded). */
export function defaultGroupMessage(entries: readonly RebaseEntry[], group: SquashGroup): string {
  const head = entries[group.head]
  const headMsg = head.action === 'reword' && head.message?.trim() ? head.message.trim() : fullMessage(head.commit)
  return [headMsg, ...group.squashMembers.map((i) => fullMessage(entries[i].commit))].join('\n\n')
}

/** Custom message stored on the group's squash members (last one wins), or undefined. */
export function customGroupMessage(entries: readonly RebaseEntry[], group: SquashGroup): string | undefined {
  let msg: string | undefined
  for (const i of group.squashMembers) if (entries[i].message !== undefined) msg = entries[i].message
  return msg
}

export function groupMessage(entries: readonly RebaseEntry[], group: SquashGroup): string {
  return customGroupMessage(entries, group) ?? defaultGroupMessage(entries, group)
}

/** Store a custom combined message on the group's first squash member (others cleared). null resets to the default. */
export function setGroupMessage(entries: readonly RebaseEntry[], group: SquashGroup, message: string | null): RebaseEntry[] {
  if (!group.squashMembers.length) return entries as RebaseEntry[]
  const next = entries.slice()
  group.squashMembers.forEach((i, k) => {
    next[i] = { ...next[i], message: k === 0 && message !== null ? message : undefined }
  })
  return next
}

// ── Edits ──────────────────────────────────────────────────────────────────

/** Change the action of one entry (todo index). Reword pre-fills the original message. */
export function setAction(entries: readonly RebaseEntry[], index: number, action: RebaseAction): RebaseEntry[] {
  const e = entries[index]
  if (!e || e.action === action) return entries as RebaseEntry[]
  const next = entries.slice()
  next[index] = { ...e, action, message: action === 'reword' ? fullMessage(e.commit) : undefined }

  // Leaving a squash group while carrying its custom message: hand it to another squash member.
  if (e.action === 'squash' && e.message !== undefined) {
    const old = computeGroups(entries)
    const g = old.groupOf[index] >= 0 ? old.groups[old.groupOf[index]] : null
    const heirs = (g?.squashMembers ?? []).filter((i) => i !== index && next[i].action === 'squash')
    if (heirs.length && heirs.every((i) => next[i].message === undefined)) {
      next[heirs[0]] = { ...next[heirs[0]], message: e.message }
    }
  }
  return next
}

/** Set the reword message of an entry. */
export function setMessage(entries: readonly RebaseEntry[], index: number, message: string): RebaseEntry[] {
  const next = entries.slice()
  next[index] = { ...next[index], message }
  return next
}

/** Move an entry so it ends up at index `to` (todo order). */
export function moveEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const n = list.length
  if (from < 0 || from >= n) return list as T[]
  const target = Math.max(0, Math.min(n - 1, to))
  if (target === from) return list as T[]
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

/** Display index (newest first) ↔ todo index (oldest first). The mapping is its own inverse. */
export function toDisplayIndex(count: number, index: number): number {
  return count - 1 - index
}

/**
 * Final todo index for a drag & drop in the DISPLAY list: the row at todo index
 * `fromTodo` is dropped before display row `insertBefore` (0..count; count = after the last row).
 */
export function dropTargetTodoIndex(count: number, fromTodo: number, insertBefore: number): number {
  const fromDisplay = toDisplayIndex(count, fromTodo)
  let finalDisplay = insertBefore > fromDisplay ? insertBefore - 1 : insertBefore
  finalDisplay = Math.max(0, Math.min(count - 1, finalDisplay))
  return toDisplayIndex(count, finalDisplay)
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface RebaseIssue {
  /** Todo index of the offending entry, or null for list-wide problems. */
  index: number | null
  message: string
}

export function validateRebase(entries: readonly RebaseEntry[]): RebaseIssue[] {
  const issues: RebaseIssue[] = []
  if (!entries.length) {
    issues.push({ index: null, message: 'There are no commits to rebase.' })
    return issues
  }
  if (entries.every((e) => e.action === 'drop')) {
    issues.push({ index: null, message: 'At least one commit must be kept.' })
  }
  const { groups, targetOf } = computeGroups(entries)
  entries.forEach((e, i) => {
    if (isMeld(e.action) && targetOf[i] === null) {
      issues.push({
        index: i,
        message: `Cannot ${e.action} the oldest commit: there is no earlier commit to combine it with.`
      })
    }
    if (e.action === 'reword' && e.message !== undefined && !e.message.trim()) {
      issues.push({ index: i, message: 'The commit message cannot be empty.' })
    }
  })
  for (const g of groups) {
    const custom = customGroupMessage(entries, g)
    if (custom !== undefined && !custom.trim()) {
      issues.push({ index: g.squashMembers[0], message: 'The combined commit message cannot be empty.' })
    }
  }
  return issues
}

// ── Todo ───────────────────────────────────────────────────────────────────

/**
 * The todo list for api.interactiveRebase, OLDEST FIRST. Reword items always
 * carry a message; each squash group carries its combined message (custom or
 * the default combination shown in the editor) on its first squash item.
 */
export function buildTodo(entries: readonly RebaseEntry[]): RebaseTodoItem[] {
  const { groups } = computeGroups(entries)
  const groupMessageAt = new Map<number, string>()
  for (const g of groups) {
    if (g.squashMembers.length) groupMessageAt.set(g.squashMembers[0], groupMessage(entries, g).trim())
  }
  return entries.map((e, i) => {
    const item: RebaseTodoItem = { action: e.action, sha: e.commit.sha, subject: e.commit.subject }
    if (e.action === 'reword') item.message = (e.message ?? fullMessage(e.commit)).trim()
    else if (e.action === 'squash' && groupMessageAt.has(i)) item.message = groupMessageAt.get(i)
    return item
  })
}

// ── Summary ────────────────────────────────────────────────────────────────

/** "5 commits: 3 pick, 1 squash, 1 drop". */
export function summarize(entries: readonly RebaseEntry[]): string {
  const counts = new Map<RebaseAction, number>()
  for (const e of entries) counts.set(e.action, (counts.get(e.action) ?? 0) + 1)
  const parts = REBASE_ACTIONS.filter((a) => counts.get(a.action)).map((a) => `${counts.get(a.action)} ${a.action}`)
  const head = `${entries.length} commit${entries.length === 1 ? '' : 's'}`
  return parts.length ? `${head}: ${parts.join(', ')}` : head
}

/** Number of commits the rebased branch will have in the rewritten range. */
export function resultCount(entries: readonly RebaseEntry[]): number {
  return entries.filter((e) => e.action !== 'drop' && !isMeld(e.action)).length
}
