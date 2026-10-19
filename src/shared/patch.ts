// Partial patches for line / hunk level staging, unstaging and discarding
// (the same model as `git gui` / GitHub Desktop). Pure module: no DOM / node APIs.
//
//   const patch = buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [3, 4] }], 'stage')
//   if (patch) await api.applyPatch(repo, patch, patchApplyOptions('stage'))
//
// Modes and the diff they are built from:
//   'stage'   — unstaged diff (index → worktree), applied with `git apply --cached`.
//   'unstage' — staged diff (HEAD → index), applied with `git apply --cached --reverse`.
//   'discard' — unstaged diff (index → worktree), applied with `git apply --reverse`.
//
// Selected +/- lines are the ones applied; a hunk entry without `lineIndexes`
// selects every change of that hunk. Forward ('stage'): unselected '+' lines are
// dropped and unselected '-' lines become context, so the old side (the index)
// is preserved exactly. Reverse ('unstage' / 'discard'): unselected '+' lines
// become context and unselected '-' lines are dropped, so the new side (what the
// reverse apply matches against) is preserved exactly.

import type { DiffHunk, DiffLine, DiffLineType, FileDiff } from './types'

export type PatchMode = 'stage' | 'unstage' | 'discard'

export interface HunkSelection {
  hunkIndex: number
  /** Indexes into `hunk.lines`. Context lines are ignored. Omitted = whole hunk. */
  lineIndexes?: number[]
}

/** Options for `api.applyPatch` matching a mode. */
export function patchApplyOptions(mode: PatchMode): { cached?: boolean; reverse?: boolean } {
  switch (mode) {
    case 'stage':
      return { cached: true }
    case 'unstage':
      return { cached: true, reverse: true }
    case 'discard':
      return { reverse: true }
  }
}

/**
 * True when line/hunk level patches can be built for this diff in `mode`.
 * New, untracked, deleted, binary, type-changed and conflicted files only support
 * whole-file operations.
 */
export function supportsPartialPatch(diff: FileDiff, mode: PatchMode): boolean {
  if (diff.binary || diff.tooLarge || !diff.hunks.length) return false
  switch (diff.status) {
    case 'modified':
    case 'renamed':
      return true
    case 'copied':
      // A forward copy patch would be applied as a rename (removing the source).
      return mode !== 'stage'
    default:
      return false
  }
}

/** True when the line is a change ('add' or 'del'). */
export function isChange(line: DiffLine): boolean {
  return line.type === 'add' || line.type === 'del'
}

/**
 * Old/new line numbers of every line in a hunk, derived from the hunk header
 * (authoritative even when a parser leaves DiffLine.oldLine/newLine unset).
 */
export function hunkLineNumbers(hunk: DiffHunk): Array<{ old: number | null; new: number | null }> {
  let o = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart
  let n = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart
  return hunk.lines.map((l) => {
    if (l.type === 'add') return { old: null, new: n++ }
    if (l.type === 'del') return { old: o++, new: null }
    return { old: o++, new: n++ }
  })
}

/**
 * Stable identity of a changed line across diffs of the same file computed with
 * different context sizes / whitespace options: side + file line number + content.
 */
export function changeKey(type: DiffLineType, lineNo: number | null, content: string): string {
  return `${type === 'add' ? 'a' : 'd'}:${lineNo ?? 0}:${content}`
}

/** Keys of every selected change in `diff`. */
export function selectedChangeKeys(diff: FileDiff, selection: HunkSelection[]): Set<string> {
  const keys = new Set<string>()
  for (const [hunkIndex, chosen] of normaliseSelection(diff, selection)) {
    const hunk = diff.hunks[hunkIndex]
    const nums = hunkLineNumbers(hunk)
    hunk.lines.forEach((l, i) => {
      if (!isChange(l) || (chosen && !chosen.has(i))) return
      keys.add(changeKey(l.type, l.type === 'add' ? nums[i].new : nums[i].old, l.content))
    })
  }
  return keys
}

/**
 * Re-express a selection made on `from` (e.g. the diff on screen, possibly with
 * a different context size or ignoring whitespace) as a selection on `to` (a
 * fresh diff of the same file). `complete` is false when some selected change no
 * longer exists in `to` (the file changed meanwhile).
 */
export function remapSelection(
  from: FileDiff,
  selection: HunkSelection[],
  to: FileDiff
): { selection: HunkSelection[]; complete: boolean } {
  const wanted = selectedChangeKeys(from, selection)
  const found = new Set<string>()
  const out: HunkSelection[] = []
  to.hunks.forEach((hunk, hunkIndex) => {
    const nums = hunkLineNumbers(hunk)
    const lineIndexes: number[] = []
    hunk.lines.forEach((l, i) => {
      if (!isChange(l)) return
      const key = changeKey(l.type, l.type === 'add' ? nums[i].new : nums[i].old, l.content)
      if (wanted.has(key)) {
        lineIndexes.push(i)
        found.add(key)
      }
    })
    if (lineIndexes.length) out.push({ hunkIndex, lineIndexes })
  })
  return { selection: out, complete: found.size === wanted.size }
}

/** Selection entries merged per hunk; value null = whole hunk. Out-of-range hunks are ignored. */
function normaliseSelection(diff: FileDiff, selection: HunkSelection[]): Map<number, Set<number> | null> {
  const map = new Map<number, Set<number> | null>()
  for (const s of selection) {
    if (!Number.isInteger(s.hunkIndex) || s.hunkIndex < 0 || s.hunkIndex >= diff.hunks.length) continue
    if (!s.lineIndexes) {
      map.set(s.hunkIndex, null)
      continue
    }
    const prev = map.get(s.hunkIndex)
    if (prev === null) continue
    const set = prev ?? new Set<number>()
    for (const i of s.lineIndexes) set.add(i)
    map.set(s.hunkIndex, set)
  }
  return map
}

interface OutLine {
  type: DiffLineType
  content: string
  noNewline: boolean
}

const NO_NEWLINE = '\\ No newline at end of file'

/**
 * Build a unified diff that applies only the selected changes. Returns null when
 * nothing is selected or the diff does not support partial patches.
 */
export function buildPartialPatch(diff: FileDiff, selection: HunkSelection[], mode: PatchMode): string | null {
  if (!supportsPartialPatch(diff, mode)) return null
  const chosen = normaliseSelection(diff, selection)
  if (!chosen.size) return null
  const reverse = mode !== 'stage'

  const body: string[] = []
  // Cumulative (target side − anchor side) line delta of the hunks emitted so far.
  // The anchor side is the one preserved exactly: old for 'stage', new otherwise.
  let delta = 0

  diff.hunks.forEach((hunk, hunkIndex) => {
    if (!chosen.has(hunkIndex)) return
    const sel = chosen.get(hunkIndex) ?? null
    const out: OutLine[] = []
    let changes = 0
    hunk.lines.forEach((line, i) => {
      const noNewline = !!line.noNewline
      // The backend strips a trailing "\r" from CRLF lines and flags them; restore it byte-for-byte.
      const content = line.crlf ? line.content + '\r' : line.content
      if (line.type === 'context') {
        out.push({ type: 'context', content, noNewline })
        return
      }
      const selected = sel === null || sel.has(i)
      if (selected) {
        out.push({ type: line.type, content, noNewline })
        changes++
        return
      }
      // Unselected change: keep it on the anchor side only (as context) or drop it.
      const keepAsContext = reverse ? line.type === 'add' : line.type === 'del'
      if (keepAsContext) out.push({ type: 'context', content, noNewline })
    })
    if (!changes) return

    const lines = fixMissingNewlines(out)
    let oldCount = 0
    let newCount = 0
    for (const l of lines) {
      if (l.type !== 'add') oldCount++
      if (l.type !== 'del') newCount++
    }

    // Lines of the anchor side that precede this hunk (an empty side's start is
    // the line *before* the position, per unified diff convention).
    const anchorStart = reverse ? hunk.newStart : hunk.oldStart
    const anchorOrigCount = reverse ? hunk.newLines : hunk.oldLines
    const anchorCount = reverse ? newCount : oldCount
    const targetCount = reverse ? oldCount : newCount
    const anchorBefore = anchorOrigCount > 0 ? anchorStart - 1 : anchorStart
    const targetBefore = Math.max(0, anchorBefore + delta)
    const aStart = anchorCount > 0 ? anchorBefore + 1 : anchorBefore
    const tStart = targetCount > 0 ? targetBefore + 1 : targetBefore
    delta += targetCount - anchorCount

    const oldStart = reverse ? tStart : aStart
    const newStart = reverse ? aStart : tStart
    body.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${hunkSection(hunk.header)}`)
    for (const l of lines) {
      body.push((l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.content)
      if (l.noNewline) body.push(NO_NEWLINE)
    }
  })

  if (!body.length) return null

  // Reverse-applying "a/old → b/new" would also revert the rename / copy itself;
  // for reverse modes the patch therefore targets the new path only.
  const newPath = diff.path
  const oldPath = reverse ? diff.path : (diff.oldPath ?? diff.path)
  const header = [
    `diff --git ${quotePath('a/' + oldPath)} ${quotePath('b/' + newPath)}`,
    `--- ${quotePath('a/' + oldPath)}${tabIfSpace(oldPath)}`,
    `+++ ${quotePath('b/' + newPath)}${tabIfSpace(newPath)}`
  ]
  return header.concat(body).join('\n') + '\n'
}

/**
 * A line without a trailing newline can only be the last line of its side. When a
 * partial selection leaves such a line followed by other lines (e.g. the old last
 * line kept while a new line is appended after it) the line must gain a newline:
 * a context line is split into '-' (as before) / '+' (with newline), a change
 * line simply loses its marker.
 */
function fixMissingNewlines(lines: OutLine[]): OutLine[] {
  let lastOld = -1
  let lastNew = -1
  lines.forEach((l, i) => {
    if (l.type !== 'add') lastOld = i
    if (l.type !== 'del') lastNew = i
  })
  const misplaced = (l: OutLine, i: number) => l.noNewline && ((l.type !== 'add' && i !== lastOld) || (l.type !== 'del' && i !== lastNew))
  if (!lines.some(misplaced)) return lines
  const out: OutLine[] = []
  lines.forEach((l, i) => {
    if (!l.noNewline) {
      out.push(l)
      return
    }
    if (l.type === 'del') out.push({ ...l, noNewline: i === lastOld })
    else if (l.type === 'add') out.push({ ...l, noNewline: i === lastNew })
    else if (i === lastOld && i === lastNew) out.push(l)
    else {
      out.push({ type: 'del', content: l.content, noNewline: i === lastOld })
      out.push({ type: 'add', content: l.content, noNewline: i === lastNew })
    }
  })
  return out
}

/** Text after the closing "@@" of a hunk header (kept verbatim, usually " funcName"). */
function hunkSection(header: string): string {
  const m = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(.*)$/.exec(header)
  return m ? m[1] : ''
}

/** git appends a TAB after names containing spaces in ---/+++ lines (GNU patch compatibility). */
function tabIfSpace(path: string): string {
  return path.includes(' ') ? '\t' : ''
}

const C_ESCAPES: Record<string, string> = {
  '\x07': '\\a',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\v': '\\v',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\'
}

/** C-style quote a path the way git does when it contains control chars, '"' or '\'. */
export function quotePath(path: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[\x00-\x1f\x7f"\\]/.test(path)) return path
  let out = '"'
  for (const ch of path) {
    const esc = C_ESCAPES[ch]
    if (esc) out += esc
    else {
      const code = ch.charCodeAt(0)
      out += code < 0x20 || code === 0x7f ? '\\' + code.toString(8).padStart(3, '0') : ch
    }
  }
  return out + '"'
}
