// Commit message helpers for the commit composer: split a full message into the
// "Summary" and "Description" fields and join them back the way git expects
// (subject, blank line, body).

/** Soft limit for the summary line; the counter turns to the warning colour past it. */
export const SUMMARY_SOFT_LIMIT = 72

export interface SplitMessage {
  summary: string
  description: string
}

/** Split a full commit message into summary (first line) and description (rest, leading blank lines removed). */
export function splitMessage(message: string): SplitMessage {
  const normalized = message.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  // Skip leading blank lines so the summary is the first meaningful line.
  const trimmedStart = normalized.replace(/^(?:[ \t]*\n)+/, '')
  const nl = trimmedStart.indexOf('\n')
  if (nl < 0) return { summary: trimmedStart.trim(), description: '' }
  const summary = trimmedStart.slice(0, nl).trim()
  const description = trimmedStart
    .slice(nl + 1)
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '')
  return { summary, description }
}

/** Join summary and description into a commit message ("summary\n\ndescription"). */
export function joinMessage(summary: string, description: string): string {
  const s = summary.replace(/[\r\n]+/g, ' ').trim()
  const d = description
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '')
  if (!d) return s
  if (!s) return d
  return `${s}\n\n${d}`
}

/** True when the summary is longer than the soft limit. */
export function isSummaryTooLong(summary: string): boolean {
  return [...summary].length > SUMMARY_SOFT_LIMIT
}

/** Visible length of the summary (counts code points, not UTF-16 units). */
export function summaryLength(summary: string): number {
  return [...summary].length
}

/**
 * Human title of a stash. git stores "On <branch>: <message>" for stashes with
 * a message and "WIP on <branch>: <sha> <subject>" otherwise; the branch and base
 * commit are shown separately, so those prefixes are dropped.
 */
export function stashTitle(message: string): string {
  const raw = message.trim()
  const wip = /^WIP on [^:]+:\s*(?:[0-9a-f]{4,40}\s+)?(.*)$/is.exec(raw)
  if (wip) return wip[1].trim() ? `WIP: ${wip[1].trim()}` : 'WIP'
  const named = /^On [^:]+:\s*(.*)$/is.exec(raw)
  if (named && named[1].trim()) return named[1].trim()
  return raw || 'Stash'
}
