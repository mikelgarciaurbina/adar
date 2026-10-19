// Changed-file listings from `--numstat -z` and `--name-status -z`.

import type { FileChange, FileStatusCode } from '@shared/types'

export interface NumstatEntry {
  path: string
  oldPath?: string
  additions: number
  deletions: number
  binary: boolean
}

export interface NameStatusEntry {
  path: string
  oldPath?: string
  status: FileStatusCode
}

/**
 * Parse `--numstat -z`:
 *   "<add>\t<del>\t<path>\0"                 regular
 *   "<add>\t<del>\t\0<old>\0<new>\0"         rename / copy
 *   "-\t-\t..."                              binary
 */
export function parseNumstatZ(out: string): NumstatEntry[] {
  const tokens = out.split('\0')
  const entries: NumstatEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(t)
    if (!m) continue
    const binary = m[1] === '-' && m[2] === '-'
    const additions = binary ? 0 : Number(m[1]) || 0
    const deletions = binary ? 0 : Number(m[2]) || 0
    if (m[3]) {
      entries.push({ path: m[3], additions, deletions, binary })
    } else {
      const oldPath = tokens[i + 1] ?? ''
      const path = tokens[i + 2] ?? ''
      i += 2
      if (!path) continue
      entries.push({ path, oldPath, additions, deletions, binary })
    }
  }
  return entries
}

export function statusFromLetter(letter: string): FileStatusCode {
  switch (letter[0]) {
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
    case '?':
      return 'untracked'
    default:
      return 'modified'
  }
}

/** Parse `--name-status -z`: "M\0path\0", "R100\0old\0new\0", "C75\0old\0new\0". */
export function parseNameStatusZ(out: string): NameStatusEntry[] {
  const tokens = out.split('\0')
  const entries: NameStatusEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]
    if (!code) continue
    if (!/^[ACDMRTUXB]\d*$/.test(code)) continue
    const status = statusFromLetter(code)
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = tokens[i + 1] ?? ''
      const path = tokens[i + 2] ?? ''
      i += 2
      if (path) entries.push({ path, oldPath, status })
    } else {
      const path = tokens[i + 1] ?? ''
      i += 1
      if (path) entries.push({ path, status })
    }
  }
  return entries
}

/**
 * Parse the combined output of `--raw --numstat -z` (one git process instead of a
 * --name-status and a --numstat run):
 *   ":<mode> <mode> <sha> <sha> M\0path\0"            raw, regular
 *   ":<mode> <mode> <sha> <sha> R100\0old\0new\0"      raw, rename / copy
 *   "<add>\t<del>\tpath\0" / "<add>\t<del>\t\0old\0new\0"   numstat (after all raw records)
 * Leading commit headers / newlines git prints before the records are skipped.
 */
export function parseRawNumstatZ(out: string): FileChange[] {
  const tokens = out.split('\0')
  const nameStatus: NameStatusEntry[] = []
  const numstat: NumstatEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/^\n+/, '')
    if (!t) continue
    if (t.startsWith(':')) {
      const code = t.slice(t.lastIndexOf(' ') + 1)
      if (!/^[ACDMRTUXB]\d*$/.test(code)) continue
      const status = statusFromLetter(code)
      if (code[0] === 'R' || code[0] === 'C') {
        const oldPath = tokens[i + 1] ?? ''
        const path = tokens[i + 2] ?? ''
        i += 2
        if (path) nameStatus.push({ path, oldPath, status })
      } else {
        const path = tokens[i + 1] ?? ''
        i += 1
        if (path) nameStatus.push({ path, status })
      }
      continue
    }
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(t)
    if (!m) continue
    const binary = m[1] === '-' && m[2] === '-'
    const additions = binary ? 0 : Number(m[1]) || 0
    const deletions = binary ? 0 : Number(m[2]) || 0
    if (m[3]) {
      numstat.push({ path: m[3], additions, deletions, binary })
    } else {
      const oldPath = tokens[i + 1] ?? ''
      const path = tokens[i + 2] ?? ''
      i += 2
      if (path) numstat.push({ path, oldPath, additions, deletions, binary })
    }
  }
  return mergeFileChanges(nameStatus, numstat)
}

/** Combine name-status (authoritative order/status) with numstat counts. */
export function mergeFileChanges(nameStatus: NameStatusEntry[], numstat: NumstatEntry[]): FileChange[] {
  const stats = new Map<string, NumstatEntry>()
  for (const n of numstat) stats.set(n.path, n)
  const files: FileChange[] = nameStatus.map((e) => {
    const s = stats.get(e.path)
    const fc: FileChange = { path: e.path, status: e.status }
    if (e.oldPath) fc.oldPath = e.oldPath
    if (s) {
      fc.additions = s.additions
      fc.deletions = s.deletions
      if (s.binary) fc.binary = true
    }
    return fc
  })
  // Entries only present in numstat (should not happen, but never drop a file).
  const seen = new Set(nameStatus.map((e) => e.path))
  for (const n of numstat) {
    if (seen.has(n.path)) continue
    const fc: FileChange = {
      path: n.path,
      status: n.oldPath ? 'renamed' : 'modified',
      additions: n.additions,
      deletions: n.deletions
    }
    if (n.oldPath) fc.oldPath = n.oldPath
    if (n.binary) fc.binary = true
    files.push(fc)
  }
  return files
}

export function totals(files: FileChange[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions ?? 0
    deletions += f.deletions ?? 0
  }
  return { additions, deletions }
}
