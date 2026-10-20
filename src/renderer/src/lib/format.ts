import type { FileStatusCode, UnixSeconds } from '@shared/types'

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null

/** "3 minutes ago", "yesterday", "2 months ago". */
export function relativeTime(ts: UnixSeconds, now = Date.now()): string {
  const diff = ts - Math.floor(now / 1000)
  const abs = Math.abs(diff)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  if (abs < 45) return 'just now'
  for (const [unit, secs] of units) {
    if (abs >= secs || unit === 'minute') {
      const v = Math.round(diff / secs)
      return rtf ? rtf.format(v, unit) : `${Math.abs(v)} ${unit}${Math.abs(v) === 1 ? '' : 's'} ago`
    }
  }
  return ''
}

/** "Oct 19, 2026, 11:24" */
export function absoluteTime(ts: UnixSeconds): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatDate(ts: UnixSeconds, mode: 'relative' | 'absolute'): string {
  return mode === 'relative' ? relativeTime(ts) : absoluteTime(ts)
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i) : ''
}

export function pluralize(n: number, word: string, plural = word + 's'): string {
  return `${n} ${n === 1 ? word : plural}`
}

/** "a, b and c" / "a, b, c and 4 more" — a readable list that stays short. */
export function summarizeList(items: readonly string[], max = 3): string {
  if (items.length <= 1) return items.join('')
  if (items.length <= max) return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `${items.slice(0, max).join(', ')} and ${items.length - max} more`
}

export const STATUS_LETTER: Record<FileStatusCode, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  typechange: 'T',
  conflicted: '!'
}

/** CSS colour variable for a file status. */
export function statusColor(status: FileStatusCode): string {
  switch (status) {
    case 'added':
    case 'untracked':
    case 'copied':
      return 'var(--c-added)'
    case 'deleted':
      return 'var(--c-deleted)'
    case 'renamed':
    case 'typechange':
      return 'var(--c-renamed)'
    case 'conflicted':
      return 'var(--c-conflict)'
    default:
      return 'var(--c-modified)'
  }
}

/** First line of a multi-line message. */
export function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i >= 0 ? s.slice(0, i) : s
}
