// Pure helpers for file history and blame.

import type { BlameLine, FileStatusCode } from '@shared/types'

export interface HistoryPathEntry {
  status: FileStatusCode
  /** Path of the file in that commit. */
  path: string
  /** Previous path when the commit renamed / copied the file. */
  oldPath?: string
}

const STATUS_BY_LETTER: Record<string, FileStatusCode> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
  U: 'conflicted'
}

/** git log arguments producing the per-commit path of a file (parsed by parseFollowLog). */
export function followLogArgs(path: string, maxCount: number): string[] {
  return ['log', '--follow', '-M', '--name-status', '--format=%x01%H', `--max-count=${maxCount}`, '--', path]
}

/**
 * Parse `git log --follow --name-status --format=%x01%H` output into
 * sha → path / status of the followed file in that commit.
 */
export function parseFollowLog(stdout: string): Map<string, HistoryPathEntry> {
  const out = new Map<string, HistoryPathEntry>()
  for (const record of stdout.split('\x01')) {
    const lines = record.split('\n').filter((l) => l.length)
    if (!lines.length) continue
    const sha = lines[0].trim()
    if (!/^[0-9a-f]{7,64}$/i.test(sha)) continue
    const entry = lines.slice(1).find((l) => /^[A-Z]\d*\t/.test(l))
    if (!entry) continue
    const parts = entry.split('\t')
    const status = STATUS_BY_LETTER[parts[0][0]] ?? 'modified'
    if ((status === 'renamed' || status === 'copied') && parts.length >= 3) out.set(sha, { status, oldPath: parts[1], path: parts[2] })
    else out.set(sha, { status, path: parts[1] })
  }
  return out
}

export interface BlameGroup {
  /** Index of the first line (into the BlameLine array). */
  start: number
  /** Exclusive end index. */
  end: number
  line: BlameLine
}

/** Consecutive lines introduced by the same commit. */
export function groupBlame(lines: BlameLine[]): { groups: BlameGroup[]; groupOf: Int32Array } {
  const groups: BlameGroup[] = []
  const groupOf = new Int32Array(lines.length)
  lines.forEach((l, i) => {
    const last = groups[groups.length - 1]
    if (last && last.line.sha === l.sha) last.end = i + 1
    else groups.push({ start: i, end: i + 1, line: l })
    groupOf[i] = groups.length - 1
  })
  return { groups, groupOf }
}

export const isUncommittedSha = (sha: string): boolean => /^0+$/.test(sha)

/**
 * Age heat in [0, 1]: 1 = newest commit of the file, 0 = oldest. Rank based (by
 * distinct commit dates) so colours spread evenly whatever the history looks like.
 */
export function heatScale(lines: BlameLine[]): (date: number) => number {
  const dates = [...new Set(lines.filter((l) => !isUncommittedSha(l.sha)).map((l) => l.authorDate))].sort((a, b) => a - b)
  if (dates.length < 2) return () => 1
  const rank = new Map(dates.map((d, i) => [d, i / (dates.length - 1)]))
  return (date) => {
    const r = rank.get(date)
    if (r !== undefined) return r
    // Unknown date: position by binary search.
    let lo = 0
    let hi = dates.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (dates[mid] < date) lo = mid + 1
      else hi = mid
    }
    return lo / (dates.length - 1)
  }
}
