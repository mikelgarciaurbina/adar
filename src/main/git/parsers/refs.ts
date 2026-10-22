// Parsers for refs, stashes, remotes and submodules.

import type { Ref, RemoteInfo, Stash, Submodule } from '@shared/types'
import { toInt, trimTrailingNewlines } from './util'

const REF_FIELDS = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(*objectname)',
  '%(objecttype)',
  '%(upstream)',
  '%(upstream:track)',
  '%(HEAD)',
  '%(symref)',
  '%(contents:subject)',
  '%(contents:body)'
] as const

/** for-each-ref format: NUL-separated fields, each ref terminated by RS (bodies may span lines). */
export const FOR_EACH_REF_FORMAT = REF_FIELDS.join('%00') + '%1e'

/**
 * Same layout without %(upstream:track), whose per-branch ahead/behind walks dominate getRefs in
 * repositories with many tracking branches; tracking counts are then filled by applyTracking().
 */
export const FOR_EACH_REF_FORMAT_NO_TRACK = REF_FIELDS.map((f) => (f === '%(upstream:track)' ? '' : f)).join('%00') + '%1e'

/** Parse "<refname>\0<value>" lines (one per ref). */
export function parseRefValues(out: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of out.split('\n')) {
    const nul = line.indexOf('\0')
    if (nul > 0) map.set(line.slice(0, nul), line.slice(nul + 1).trim())
  }
  return map
}

/** "%(ahead-behind:X)" value "3 1" → { ahead: 3, behind: 1 }. */
export function parseAheadBehind(value: string): TrackInfo | null {
  const m = /^(\d+) (\d+)$/.exec(value.trim())
  return m ? { ahead: toInt(m[1]), behind: toInt(m[2]), gone: false } : null
}

/** Set ahead/behind/upstreamGone on local branches from per-ref tracking info. */
export function applyTracking(branches: Ref[], tracking: ReadonlyMap<string, TrackInfo>): void {
  for (const b of branches) {
    const t = tracking.get(b.fullName)
    if (!t || !b.upstream) continue
    b.ahead = t.ahead
    b.behind = t.behind
    if (t.gone) b.upstreamGone = true
    else delete b.upstreamGone
  }
}

export interface TrackInfo {
  ahead: number
  behind: number
  gone: boolean
}

/** Parse %(upstream:track): "[ahead 2, behind 1]", "[ahead 2]", "[behind 1]", "[gone]" or "". */
export function parseTrack(track: string): TrackInfo {
  const t = track.trim()
  const info: TrackInfo = { ahead: 0, behind: 0, gone: false }
  if (!t) return info
  if (/\bgone\b/.test(t)) {
    info.gone = true
    return info
  }
  const a = /ahead (\d+)/.exec(t)
  const b = /behind (\d+)/.exec(t)
  if (a) info.ahead = toInt(a[1])
  if (b) info.behind = toInt(b[1])
  return info
}

/** Strip the well-known namespace from a full ref name. */
export function shortRefName(fullName: string): string {
  for (const prefix of ['refs/heads/', 'refs/remotes/', 'refs/tags/']) {
    if (fullName.startsWith(prefix)) return fullName.slice(prefix.length)
  }
  return fullName.replace(/^refs\//, '')
}

/** "origin/feature/x" → remote "origin" (longest configured remote name wins, so "team/a" remotes work). */
export function remoteOf(shortName: string, remoteNames: readonly string[]): string {
  let best = ''
  for (const r of remoteNames) {
    if (r.length > best.length && shortName.startsWith(r + '/')) best = r
  }
  if (best) return best
  const slash = shortName.indexOf('/')
  return slash < 0 ? shortName : shortName.slice(0, slash)
}

export interface ParsedRefs {
  branches: Ref[]
  remotes: Ref[]
  tags: Ref[]
  /** Local branch full name → full name of its configured upstream. */
  upstreamOf: Map<string, string>
}

export function parseForEachRef(out: string, remoteNames: readonly string[] = []): ParsedRefs {
  const result: ParsedRefs = { branches: [], remotes: [], tags: [], upstreamOf: new Map() }
  for (let record of out.split('\x1e')) {
    if (record.startsWith('\n')) record = record.slice(1)
    if (!record) continue
    const f = record.split('\0')
    if (f.length < REF_FIELDS.length) continue
    const [fullName, , objectName, peeled, objectType, upstreamFull, track, head, symref, subject] = f
    const body = f.slice(10).join('\0')
    if (!fullName || !objectName) continue
    const name = shortRefName(fullName)

    if (fullName.startsWith('refs/heads/')) {
      const ref: Ref = { name, fullName, type: 'branch', sha: objectName, isHead: head === '*' }
      if (upstreamFull) {
        result.upstreamOf.set(fullName, upstreamFull)
        ref.upstream = shortRefName(upstreamFull)
        const t = parseTrack(track)
        ref.ahead = t.ahead
        ref.behind = t.behind
        if (t.gone) ref.upstreamGone = true
      }
      result.branches.push(ref)
    } else if (fullName.startsWith('refs/remotes/')) {
      const ref: Ref = { name, fullName, type: 'remote', sha: objectName, remote: remoteOf(name, remoteNames) }
      if (symref) {
        ref.isSymbolic = true
        ref.target = shortRefName(symref)
      }
      result.remotes.push(ref)
    } else if (fullName.startsWith('refs/tags/')) {
      const annotated = objectType === 'tag'
      const ref: Ref = { name, fullName, type: 'tag', sha: annotated && peeled ? peeled : objectName, annotated }
      if (annotated) {
        const msg = trimTrailingNewlines([subject, trimTrailingNewlines(body)].filter(Boolean).join('\n\n'))
        if (msg) ref.tagMessage = msg
      }
      result.tags.push(ref)
    }
  }
  return result
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Checked-out branch first, then by name (natural order). */
export function sortBranches(branches: Ref[]): Ref[] {
  return [...branches].sort((a, b) => {
    if (a.isHead !== b.isHead) return a.isHead ? -1 : 1
    return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  })
}

export function sortByName(refs: Ref[]): Ref[] {
  return [...refs].sort((a, b) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** Format for `git stash list`: sha, selector, parents, committer date, reflog subject. */
export const STASH_FORMAT = '%H%x00%gd%x00%P%x00%ct%x00%gs'

export function parseStashList(out: string): Stash[] {
  const stashes: Stash[] = []
  const lines = out.split('\n').filter((l) => l.length > 0)
  lines.forEach((line, lineIndex) => {
    const f = line.split('\0')
    if (f.length < 5) return
    const [sha, selector, parents, date, ...rest] = f
    const subject = rest.join('\0')
    const m = /\{(\d+)\}/.exec(selector)
    const index = m ? toInt(m[1], lineIndex) : lineIndex
    const stash: Stash = {
      index,
      ref: `stash@{${index}}`,
      sha,
      baseSha: parents.split(' ').filter(Boolean)[0] ?? '',
      message: subject,
      date: toInt(date)
    }
    const branch = parseStashBranch(subject)
    if (branch) stash.branch = branch
    stashes.push(stash)
  })
  return stashes
}

/** "WIP on main: abc123 msg" / "On feature/x: msg" → branch; "(no branch)" → undefined. */
export function parseStashBranch(subject: string): string | undefined {
  const m = /^(?:WIP on|On) (.+?): /.exec(subject) ?? /^(?:WIP on|On) (.+?):?$/.exec(subject)
  if (!m) return undefined
  const b = m[1].trim()
  if (!b || b === '(no branch)') return undefined
  return b
}

/** Parse `git remote -v` into fetch/push urls, preserving order. */
export function parseRemotesVerbose(out: string): RemoteInfo[] {
  const map = new Map<string, RemoteInfo>()
  for (const line of out.split('\n')) {
    const m = /^(\S+)\t(.*?)\s+\((fetch|push)\)\s*$/.exec(line)
    if (!m) continue
    const [, name, url, kind] = m
    let r = map.get(name)
    if (!r) {
      r = { name, fetchUrl: '', pushUrl: '' }
      map.set(name, r)
    }
    if (kind === 'fetch' && !r.fetchUrl) r.fetchUrl = url
    if (kind === 'push' && !r.pushUrl) r.pushUrl = url
  }
  for (const r of map.values()) {
    if (!r.pushUrl) r.pushUrl = r.fetchUrl
    if (!r.fetchUrl) r.fetchUrl = r.pushUrl
  }
  return [...map.values()]
}

export interface SubmoduleStatusEntry {
  path: string
  sha: string | null
  status: Submodule['status']
}

/**
 * Parse `git submodule status` lines:
 *   " <sha> path (describe)"  initialized   "-<sha> path"  uninitialized
 *   "+<sha> path (describe)"  modified      "U<sha> path"  conflict
 */
export function parseSubmoduleStatus(out: string): SubmoduleStatusEntry[] {
  const entries: SubmoduleStatusEntry[] = []
  for (const line of out.split('\n')) {
    if (line.length < 3) continue
    const prefix = line[0]
    const m = /^([0-9a-f]{7,64}) (.+?)(?: \([^()]*\))?$/.exec(line.slice(1))
    if (!m) continue
    const sha = /^0+$/.test(m[1]) ? null : m[1]
    const status: Submodule['status'] =
      prefix === '-' ? 'uninitialized' : prefix === '+' ? 'modified' : prefix === 'U' ? 'conflict' : 'initialized'
    entries.push({ path: m[2], sha, status })
  }
  return entries
}

/**
 * Parse `git config -z -f .gitmodules --get-regexp ^submodule\..*\.(path|url)$`
 * ("key\nvalue\0" records) into path → url.
 */
export function parseGitmodulesConfig(out: string): Map<string, string> {
  const byName = new Map<string, { path?: string; url?: string }>()
  for (const rec of out.split('\0')) {
    if (!rec) continue
    const nl = rec.indexOf('\n')
    const key = nl < 0 ? rec : rec.slice(0, nl)
    const value = nl < 0 ? '' : rec.slice(nl + 1)
    const m = /^submodule\.(.+)\.(path|url)$/i.exec(key)
    if (!m) continue
    const entry = byName.get(m[1]) ?? {}
    if (m[2].toLowerCase() === 'path') entry.path = value
    else entry.url = value
    byName.set(m[1], entry)
  }
  const urls = new Map<string, string>()
  for (const [name, e] of byName) urls.set(e.path ?? name, e.url ?? '')
  return urls
}

/**
 * Combine `submodule status` (authoritative: gitlinks in the index) with .gitmodules urls.
 * `includeUnlisted` adds .gitmodules entries missing from the status output (used when
 * `submodule status` itself failed).
 */
export function buildSubmodules(
  statusEntries: SubmoduleStatusEntry[],
  urls: Map<string, string>,
  includeUnlisted = false
): Submodule[] {
  const seen = new Set<string>()
  const result: Submodule[] = statusEntries.map((e) => {
    seen.add(e.path)
    return { path: e.path, url: urls.get(e.path) ?? '', sha: e.sha, status: e.status }
  })
  if (includeUnlisted) {
    for (const [p, url] of urls) {
      if (!seen.has(p)) result.push({ path: p, url, sha: null, status: 'uninitialized' })
    }
  }
  return result
}
