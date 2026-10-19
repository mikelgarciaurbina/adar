// `git log` / `git show` output in a NUL-separated, record-terminated format.

import type { Commit } from '@shared/types'
import { toInt, trimTrailingNewlines } from './util'

const FIELDS = ['%H', '%h', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s', '%b'] as const

/** Record separator (ASCII RS) terminating each commit. */
export const RECORD_SEPARATOR = '\x1e'

/** Pass as `--format=${LOG_FORMAT}`: fields separated by NUL, records terminated by RS. */
export const LOG_FORMAT = FIELDS.join('%x00') + '%x1e'

/** Parse output produced with LOG_FORMAT. Malformed records are skipped. */
export function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  if (!out) return commits
  for (let chunk of out.split(RECORD_SEPARATOR)) {
    // tformat adds a newline after each record terminator.
    if (chunk.startsWith('\n')) chunk = chunk.slice(1)
    if (!chunk) continue
    const commit = parseLogRecord(chunk)
    if (commit) commits.push(commit)
  }
  return commits
}

export function parseLogRecord(record: string): Commit | null {
  const f = record.split('\0')
  if (f.length < FIELDS.length) return null
  const sha = f[0].trim()
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return null
  // The body is the last field; it cannot contain NUL, but join defensively.
  const body = f.slice(10).join('\0')
  return {
    sha,
    shortSha: f[1],
    parents: f[2] ? f[2].split(' ').filter(Boolean) : [],
    authorName: f[3],
    authorEmail: f[4],
    authorDate: toInt(f[5]),
    committerName: f[6],
    committerEmail: f[7],
    committerDate: toInt(f[8]),
    subject: f[9],
    body: trimTrailingNewlines(body)
  }
}
