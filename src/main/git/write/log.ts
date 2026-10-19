// Minimal `git log` parser for the write side (the read side has its own).

import type { Commit } from '@shared/types'

const FIELDS = ['%H', '%h', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s', '%b'] as const

/** Use with `git log -z --format=<LOG_FORMAT>`: fields and records are NUL separated. */
export const LOG_FORMAT = FIELDS.join('%x00')

/** Parse the output of `git log -z --format=LOG_FORMAT`. */
export function parseLog(stdout: string): Commit[] {
  const parts = stdout.split('\0')
  const n = FIELDS.length
  const commits: Commit[] = []
  for (let i = 0; i + n <= parts.length; i += n) {
    // Records are separated by NUL too; git may emit a newline after the separator.
    const sha = parts[i].replace(/^\n+/, '')
    if (!/^[0-9a-f]{7,64}$/.test(sha)) continue
    const [, shortSha, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, subject, body] =
      parts.slice(i, i + n)
    commits.push({
      sha,
      shortSha,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName,
      authorEmail,
      authorDate: Number(authorDate) || 0,
      committerName,
      committerEmail,
      committerDate: Number(committerDate) || 0,
      subject,
      body: body.replace(/\s+$/, '')
    })
  }
  return commits
}
