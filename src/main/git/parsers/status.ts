// `git status --porcelain=v2 --branch -z` parser.

import type { ConflictFile, ConflictKind, FileChange, FileStatusCode, WorkingStatus } from '@shared/types'
import { toInt } from './util'

const CONFLICT_KINDS: Record<string, ConflictKind> = {
  DD: 'both-deleted',
  AU: 'added-by-us',
  UD: 'deleted-by-them',
  UA: 'added-by-them',
  DU: 'deleted-by-us',
  AA: 'both-added',
  UU: 'both-modified'
}

export function conflictKindFromXY(xy: string): ConflictKind {
  return CONFLICT_KINDS[xy] ?? 'both-modified'
}

function codeFor(letter: string): FileStatusCode {
  switch (letter) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

/** Split off the first `n` space-separated fields; the rest (path) may contain spaces. */
function splitFields(entry: string, n: number): { fields: string[]; rest: string } | null {
  const fields: string[] = []
  let pos = 0
  for (let i = 0; i < n; i++) {
    const sp = entry.indexOf(' ', pos)
    if (sp < 0) return null
    fields.push(entry.slice(pos, sp))
    pos = sp + 1
  }
  return { fields, rest: entry.slice(pos) }
}

export function parseStatusV2(out: string): WorkingStatus {
  const status: WorkingStatus = {
    staged: [],
    unstaged: [],
    conflicted: [],
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0
  }
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i]
    if (!entry) continue
    const kind = entry[0]
    if (kind === '#') {
      parseHeader(entry, status)
      continue
    }
    if (kind === '?') {
      const path = entry.slice(2)
      if (path) status.unstaged.push({ path, status: 'untracked' })
      continue
    }
    if (kind === '!') continue // ignored files (not requested)
    if (kind === '1') {
      // 1 XY sub mH mI mW hH hI path
      const parsed = splitFields(entry, 8)
      if (!parsed) continue
      pushOrdinary(status, parsed.fields[1], parsed.rest)
      continue
    }
    if (kind === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path\0origPath
      const parsed = splitFields(entry, 9)
      if (!parsed) continue
      const origPath = tokens[i + 1] ?? ''
      i++
      pushOrdinary(status, parsed.fields[1], parsed.rest, origPath)
      continue
    }
    if (kind === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parsed = splitFields(entry, 10)
      if (!parsed) continue
      const conflict: ConflictFile = { path: parsed.rest, kind: conflictKindFromXY(parsed.fields[1]) }
      status.conflicted.push(conflict)
      continue
    }
  }
  return status
}

function pushOrdinary(status: WorkingStatus, xy: string, path: string, origPath?: string): void {
  if (!path || xy.length < 2) return
  const x = xy[0]
  const y = xy[1]
  if (x !== '.') {
    const fc: FileChange = { path, status: codeFor(x) }
    if (origPath && (x === 'R' || x === 'C')) fc.oldPath = origPath
    status.staged.push(fc)
  }
  if (y !== '.') {
    const fc: FileChange = { path, status: codeFor(y) }
    if (origPath && (y === 'R' || y === 'C')) fc.oldPath = origPath
    status.unstaged.push(fc)
  }
}

function parseHeader(entry: string, status: WorkingStatus): void {
  // "# branch.head main"
  const body = entry.slice(2)
  const sp = body.indexOf(' ')
  if (sp < 0) return
  const key = body.slice(0, sp)
  const value = body.slice(sp + 1)
  switch (key) {
    case 'branch.head':
      status.branch = value === '(detached)' ? null : value
      break
    case 'branch.upstream':
      status.upstream = value || null
      break
    case 'branch.ab': {
      const m = /^\+(\d+) -(\d+)$/.exec(value.trim())
      if (m) {
        status.ahead = toInt(m[1])
        status.behind = toInt(m[2])
      }
      break
    }
  }
}
