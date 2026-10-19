// Pure helpers for conflict inspection (unit-tested).

import type { ConflictKind } from '@shared/types'

/** Unmerged XY code from `git status --porcelain=v2` → ConflictKind. */
export function kindFromXY(xy: string): ConflictKind | null {
  switch (xy) {
    case 'UU':
      return 'both-modified'
    case 'AA':
      return 'both-added'
    case 'DD':
      return 'both-deleted'
    case 'AU':
      return 'added-by-us'
    case 'UA':
      return 'added-by-them'
    case 'DU':
      return 'deleted-by-us'
    case 'UD':
      return 'deleted-by-them'
    default:
      return null
  }
}

/** Index stages present for a path (1 base, 2 ours, 3 theirs) → ConflictKind. */
export function kindFromStages(stages: ReadonlySet<number>): ConflictKind {
  const b = stages.has(1)
  const o = stages.has(2)
  const t = stages.has(3)
  if (o && t) return b ? 'both-modified' : 'both-added'
  if (b && o) return 'deleted-by-them'
  if (b && t) return 'deleted-by-us'
  if (o) return 'added-by-us'
  if (t) return 'added-by-them'
  return 'both-deleted'
}

export interface StageEntry {
  mode: string
  sha: string
  stage: number
  path: string
}

/** Parse `git ls-files -u -z` output. */
export function parseUnmergedEntries(stdout: string): StageEntry[] {
  const out: StageEntry[] = []
  for (const rec of stdout.split('\0')) {
    const m = /^(\d+) ([0-9a-f]+) ([0-3])\t([\s\S]*)$/.exec(rec)
    if (m) out.push({ mode: m[1], sha: m[2], stage: Number(m[3]), path: m[4] })
  }
  return out
}

/** Find the unmerged XY code for `path` in `git status --porcelain=v2 -z` output. */
export function unmergedXY(stdout: string, path: string): string | null {
  for (const rec of stdout.split('\0')) {
    if (!rec.startsWith('u ')) continue
    // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
    let idx = 0
    for (let i = 0; i < 10 && idx !== -1; i++) idx = rec.indexOf(' ', idx + 1)
    if (idx === -1) continue
    if (rec.slice(idx + 1) === path) return rec.slice(2, 4)
  }
  return null
}

/**
 * Name of the merged branch from the first line of MERGE_MSG
 * ("Merge branch 'x'", "Merge remote-tracking branch 'origin/x'", "Merge tag 'v1'", ...).
 */
export function mergeSourceFromMessage(msg: string): string | null {
  const first = msg.split('\n')[0]?.trim() ?? ''
  const m = /^Merge (?:remote-tracking branch|branch|tag|commit) '([^']+)'/.exec(first)
  if (!m) return null
  return /^Merge commit/.test(first) ? m[1].slice(0, 7) : m[1]
}

/** Repository URL of "Merge branch 'x' of <url> [into y]" (git pull), or null. */
export function mergeSourceUrl(msg: string): string | null {
  const first = msg.split('\n')[0]?.trim() ?? ''
  const m = /^Merge (?:remote-tracking )?branch(?:es)? '[^']+' of (.+?)(?: into .+)?$/.exec(first)
  return m ? m[1].trim() : null
}

/** True when the buffer looks binary (NUL byte in the first 8000 bytes, like git). */
export function looksBinary(buf: Buffer | null): boolean {
  if (!buf) return false
  return buf.subarray(0, 8000).includes(0)
}
