// `git blame --porcelain` parser.

import type { BlameLine } from '@shared/types'
import { toInt } from './util'

interface CommitInfo {
  authorName: string
  authorEmail: string
  authorDate: number
  summary: string
}

const HEADER_RE = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: (\d+))?$/

/**
 * Porcelain format: for every line a header "<sha> <orig> <final> [<count>]", then —
 * the first time a commit appears — "key value" metadata lines, optional
 * "previous"/"boundary"/"filename" lines, and finally the content prefixed by TAB.
 */
export function parseBlamePorcelain(out: string): BlameLine[] {
  const lines = out.split('\n')
  const commits = new Map<string, CommitInfo>()
  const result: BlameLine[] = []
  let current: { sha: string; orig: number; final: number } | null = null
  let pending: Partial<CommitInfo> = {}

  for (const raw of lines) {
    if (current === null) {
      const m = HEADER_RE.exec(raw)
      if (!m) continue
      current = { sha: m[1], orig: toInt(m[2]), final: toInt(m[3]) }
      pending = {}
      continue
    }
    if (raw.startsWith('\t')) {
      const known = commits.get(current.sha)
      const info: CommitInfo = {
        authorName: pending.authorName ?? known?.authorName ?? '',
        authorEmail: pending.authorEmail ?? known?.authorEmail ?? '',
        authorDate: pending.authorDate ?? known?.authorDate ?? 0,
        summary: pending.summary ?? known?.summary ?? ''
      }
      if (!known || Object.keys(pending).length > 0) commits.set(current.sha, info)
      let content = raw.slice(1)
      if (content.endsWith('\r')) content = content.slice(0, -1)
      result.push({
        lineNo: current.final,
        content,
        sha: current.sha,
        authorName: info.authorName,
        authorEmail: info.authorEmail,
        authorDate: info.authorDate,
        summary: info.summary,
        origLineNo: current.orig
      })
      current = null
      continue
    }
    const sp = raw.indexOf(' ')
    const key = sp < 0 ? raw : raw.slice(0, sp)
    const value = sp < 0 ? '' : raw.slice(sp + 1)
    switch (key) {
      case 'author':
        pending.authorName = value
        break
      case 'author-mail':
        pending.authorEmail = value.replace(/^<|>$/g, '')
        break
      case 'author-time':
        pending.authorDate = toInt(value)
        break
      case 'summary':
        pending.summary = value
        break
      default:
        break // committer*, previous, boundary, filename, author-tz...
    }
  }
  return result
}
