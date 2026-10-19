// Robust unified-diff parser for `git diff` / `git diff-tree -p` / `git diff --no-index` output.
//
// Handles: "diff --git" headers (quoted paths, paths with spaces), rename/copy headers,
// new/deleted file modes, old/new mode changes, "Binary files ... differ", hunk headers
// with omitted counts, "\ No newline at end of file", combined diffs ("diff --cc", shown
// for unmerged paths), diff.suppressBlankEmpty (empty context lines) and mode-only changes.
//
// CRLF choice: a trailing "\r" is removed from DiffLine.content (so the UI never renders a
// stray carriage return) but recorded as `crlf: true` on that line (see DiffLineWithEol),
// so patch builders can restore the exact bytes when staging hunks/lines of CRLF files.

import type { DiffHunk, DiffLine, FileDiff, FileStatusCode } from '@shared/types'
import { isImagePath, readPathToken, unquoteGitPath } from './util'

/** DiffLine as emitted by this parser: `crlf` marks lines whose original text ended in "\r". */
export type DiffLineWithEol = DiffLine

export interface ParseDiffOptions {
  /** Count additions/deletions but do not keep hunks (used for oversized diffs). */
  countOnly?: boolean
}

interface Builder {
  headerOld?: string
  headerNew?: string
  minusPath?: string | null
  plusPath?: string | null
  renameFrom?: string
  renameTo?: string
  copyFrom?: string
  copyTo?: string
  newFile: boolean
  deletedFile: boolean
  oldMode?: string
  newMode?: string
  binary: boolean
  combined: boolean
  /** A hunk header was seen: later non-hunk lines are not extended headers. */
  inHunks: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function parseUnifiedDiff(text: string, opts: ParseDiffOptions = {}): FileDiff[] {
  const lines = text.split('\n')
  const files: FileDiff[] = []
  let b: Builder | null = null

  const finish = () => {
    if (b) files.push(build(b))
    b = null
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('diff --git ')) {
      finish()
      b = newBuilder()
      const paths = parseGitHeaderPaths(line.slice('diff --git '.length))
      b.headerOld = paths.old
      b.headerNew = paths.new
      i++
      continue
    }
    if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      finish()
      b = newBuilder()
      b.combined = true
      const p = unquoteGitPath(line.slice(line.indexOf(' ', 5) + 1))
      b.headerOld = p
      b.headerNew = p
      i++
      continue
    }
    if (!b) {
      i++
      continue
    }
    const cur: Builder = b
    if (line.startsWith('@@')) {
      i = cur.combined ? parseCombinedHunk(lines, i, cur, opts) : parseHunk(lines, i, cur, opts)
      continue
    }
    if (!cur.inHunks) parseExtendedHeader(line, cur)
    i++
  }
  finish()
  return coalesceTypeChanges(files)
}

function newBuilder(): Builder {
  return {
    newFile: false,
    deletedFile: false,
    binary: false,
    combined: false,
    inHunks: false,
    hunks: [],
    additions: 0,
    deletions: 0
  }
}

function parseExtendedHeader(line: string, b: Builder): void {
  if (line.startsWith('--- ')) {
    b.minusPath = parsePatchPath(line.slice(4), 'a/')
  } else if (line.startsWith('+++ ')) {
    b.plusPath = parsePatchPath(line.slice(4), 'b/')
  } else if (line.startsWith('new file mode ')) {
    b.newFile = true
    b.newMode = line.slice('new file mode '.length).trim()
  } else if (line.startsWith('deleted file mode ')) {
    b.deletedFile = true
    b.oldMode = line.slice('deleted file mode '.length).trim()
  } else if (line.startsWith('old mode ')) {
    b.oldMode = line.slice('old mode '.length).trim()
  } else if (line.startsWith('new mode ')) {
    b.newMode = line.slice('new mode '.length).trim()
  } else if (line.startsWith('rename from ')) {
    b.renameFrom = unquoteGitPath(line.slice('rename from '.length))
  } else if (line.startsWith('rename to ')) {
    b.renameTo = unquoteGitPath(line.slice('rename to '.length))
  } else if (line.startsWith('copy from ')) {
    b.copyFrom = unquoteGitPath(line.slice('copy from '.length))
  } else if (line.startsWith('copy to ')) {
    b.copyTo = unquoteGitPath(line.slice('copy to '.length))
  } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
    b.binary = true
  }
  // "index", "similarity index", "dissimilarity index" and anything else: ignored.
}

/** "--- a/path" / "+++ b/path" value → repo path, null for /dev/null. */
function parsePatchPath(raw: string, prefix: string): string | null {
  // Git appends a TAB after names containing spaces.
  let v = raw.endsWith('\t') ? raw.slice(0, -1) : raw
  if (v === '/dev/null') return null
  v = unquoteGitPath(v)
  return v.startsWith(prefix) ? v.slice(prefix.length) : v
}

/** Paths from "diff --git a/X b/Y" (best effort; ---/+++ and rename lines take precedence). */
export function parseGitHeaderPaths(rest: string): { old?: string; new?: string } {
  const strip = (p: string, prefix: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p)
  if (rest.startsWith('"') || rest.includes(' "')) {
    const first = readPathToken(rest, 0)
    if (first) {
      const second = readPathToken(rest, first.end + 1)
      if (second) return { old: strip(first.value, 'a/'), new: strip(second.value, 'b/') }
    }
  }
  // Same path on both sides: "a/P b/P".
  const len = rest.length
  if ((len - 5) % 2 === 0 && len > 5) {
    const n = (len - 5) / 2
    const a = rest.slice(2, 2 + n)
    if (rest.startsWith('a/') && rest.slice(2 + n, 5 + n) === ' b/' && rest.slice(5 + n) === a) {
      return { old: a, new: a }
    }
  }
  const idx = rest.indexOf(' b/')
  if (idx > 0) return { old: strip(rest.slice(0, idx), 'a/'), new: rest.slice(idx + 3) }
  return {}
}

function pushLine(hunk: DiffHunk, line: DiffLineWithEol): void {
  hunk.lines.push(line)
}

function makeLine(type: DiffLine['type'], text: string, oldLine: number | null, newLine: number | null): DiffLineWithEol {
  if (text.endsWith('\r')) return { type, content: text.slice(0, -1), oldLine, newLine, crlf: true }
  return { type, content: text, oldLine, newLine }
}

function parseHunk(lines: string[], start: number, b: Builder, opts: ParseDiffOptions): number {
  const header = lines[start]
  const m = HUNK_RE.exec(header)
  if (!m) {
    b.inHunks = true
    return start + 1
  }
  const oldStart = Number(m[1])
  const oldLines = m[2] === undefined ? 1 : Number(m[2])
  const newStart = Number(m[3])
  const newLines = m[4] === undefined ? 1 : Number(m[4])
  const hunk: DiffHunk = { header, oldStart, oldLines, newStart, newLines, lines: [] }
  let oldRem = oldLines
  let newRem = newLines
  let oldNo = oldStart
  let newNo = newStart
  let last: DiffLine | null = null
  let i = start + 1
  const lastIndex = lines.length - 1

  while (i < lines.length && (oldRem > 0 || newRem > 0)) {
    const l = lines[i]
    if (l === '' && i === lastIndex) break // trailing newline of the output (truncated diff)
    const c = l[0]
    if (c === ' ' || l === '') {
      // An empty line is a context line printed with diff.suppressBlankEmpty.
      last = makeLine('context', l.slice(1), oldNo++, newNo++)
      oldRem--
      newRem--
    } else if (c === '-') {
      last = makeLine('del', l.slice(1), oldNo++, null)
      oldRem--
      b.deletions++
    } else if (c === '+') {
      last = makeLine('add', l.slice(1), null, newNo++)
      newRem--
      b.additions++
    } else if (c === '\\') {
      if (last) last.noNewline = true
      i++
      continue
    } else {
      break // malformed: stop this hunk
    }
    if (!opts.countOnly) pushLine(hunk, last)
    i++
  }
  // "\ No newline at end of file" after the final line of the hunk.
  while (i < lines.length && lines[i].startsWith('\\')) {
    if (last) last.noNewline = true
    i++
  }
  b.inHunks = true
  if (!opts.countOnly) b.hunks.push(hunk)
  return i
}

/** Combined diff hunk ("@@@ -a,b -c,d +e,f @@@"): one marker column per parent. */
function parseCombinedHunk(lines: string[], start: number, b: Builder, opts: ParseDiffOptions): number {
  const header = lines[start]
  const at = /^(@{3,})/.exec(header)
  if (!at) return parseHunk(lines, start, b, opts)
  const markers = at[1].length
  const parents = markers - 1
  const close = header.indexOf(at[1], markers)
  const ranges = header.slice(markers, close < 0 ? undefined : close).trim().split(/\s+/)
  const parseRange = (r: string | undefined) => {
    const mm = /^[-+](\d+)(?:,(\d+))?$/.exec(r ?? '')
    return mm ? { start: Number(mm[1]), count: mm[2] === undefined ? 1 : Number(mm[2]) } : { start: 0, count: 0 }
  }
  const first = parseRange(ranges[0])
  const result = parseRange(ranges.find((r) => r.startsWith('+')))
  const hunk: DiffHunk = {
    header,
    oldStart: first.start,
    oldLines: first.count,
    newStart: result.start,
    newLines: result.count,
    lines: []
  }
  let oldNo = first.start
  let newNo = result.start
  let last: DiffLine | null = null
  let i = start + 1
  const lastIndex = lines.length - 1
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('diff ') || l.startsWith('@@')) break
    if (l === '' && i === lastIndex) break
    if (l.startsWith('\\')) {
      if (last) last.noNewline = true
      i++
      continue
    }
    const cols = l.slice(0, parents)
    if (cols.length < parents && l !== '') break
    if (!/^[ +-]*$/.test(cols)) break
    const text = l.slice(parents)
    if (cols.includes('-')) {
      last = makeLine('del', text, cols[0] === '-' ? oldNo++ : null, null)
      b.deletions++
    } else if (cols.includes('+')) {
      last = makeLine('add', text, null, newNo++)
      if (cols[0] !== '+') oldNo++
      b.additions++
    } else {
      last = makeLine('context', text, oldNo++, newNo++)
    }
    if (!opts.countOnly) pushLine(hunk, last)
    i++
  }
  b.inHunks = true
  if (!opts.countOnly) b.hunks.push(hunk)
  return i
}

function build(b: Builder): FileDiff {
  const deleted = b.deletedFile || (b.plusPath === null && b.minusPath !== undefined)
  const added = b.newFile || (b.minusPath === null && b.plusPath !== undefined)
  const newPath = b.renameTo ?? b.copyTo ?? (b.plusPath || undefined) ?? b.headerNew
  const oldPath = b.renameFrom ?? b.copyFrom ?? (b.minusPath || undefined) ?? b.headerOld
  let status: FileStatusCode
  if (b.combined) status = 'conflicted'
  else if (b.renameFrom !== undefined || b.renameTo !== undefined) status = 'renamed'
  else if (b.copyFrom !== undefined || b.copyTo !== undefined) status = 'copied'
  else if (added) status = 'added'
  else if (deleted) status = 'deleted'
  else status = 'modified'
  const path = (deleted ? oldPath : newPath) ?? oldPath ?? ''
  const diff: FileDiff = {
    path,
    status,
    binary: b.binary,
    isImage: isImagePath(path),
    hunks: b.hunks,
    additions: b.additions,
    deletions: b.deletions
  }
  if ((status === 'renamed' || status === 'copied') && oldPath && oldPath !== path) diff.oldPath = oldPath
  if (b.oldMode) diff.oldMode = b.oldMode
  if (b.newMode) diff.newMode = b.newMode
  return diff
}

/**
 * Git prints a type change (file ↔ symlink) as a deletion followed by an addition
 * of the same path; merge such pairs into one 'typechange' entry.
 */
export function coalesceTypeChanges(files: FileDiff[]): FileDiff[] {
  const out: FileDiff[] = []
  for (const f of files) {
    const prev = out[out.length - 1]
    if (prev && prev.path === f.path && prev.status === 'deleted' && f.status === 'added') {
      const merged: FileDiff = {
        path: f.path,
        status: 'typechange',
        binary: prev.binary || f.binary,
        isImage: f.isImage,
        hunks: [...prev.hunks, ...f.hunks],
        additions: prev.additions + f.additions,
        deletions: prev.deletions + f.deletions
      }
      if (prev.oldMode) merged.oldMode = prev.oldMode
      if (f.newMode) merged.newMode = f.newMode
      out[out.length - 1] = merged
      continue
    }
    out.push(f)
  }
  return out
}

/** Empty diff for a path with no textual changes. */
export function emptyFileDiff(path: string, status: FileStatusCode = 'modified', oldPath?: string): FileDiff {
  const d: FileDiff = { path, status, binary: false, isImage: isImagePath(path), hunks: [], additions: 0, deletions: 0 }
  if (oldPath && oldPath !== path) d.oldPath = oldPath
  return d
}
