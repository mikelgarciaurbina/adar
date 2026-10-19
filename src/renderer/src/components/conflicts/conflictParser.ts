// Pure logic for the merge-conflict tool: parse working-tree text containing
// git conflict markers into segments, build the merged output from per-chunk
// choices, and helpers for the side-by-side panes. No React / DOM here so it
// can be unit tested (conflictParser.test.ts).
//
// Lines are kept WITH their original terminator ("\n" or "\r\n"; the last line
// may have none) so that rebuilding the file preserves line endings and the
// presence/absence of a trailing newline exactly.

import type { ConflictKind } from '@shared/types'

// ── Types ──────────────────────────────────────────────────────────────────

export interface CommonSegment {
  type: 'common'
  /** Lines including their terminators. */
  lines: string[]
}

export interface ConflictSegment {
  type: 'conflict'
  /** 0-based index among the conflict segments of the file. */
  index: number
  ours: string[]
  /** Common-ancestor lines (diff3 / zdiff3 conflict style only). */
  base?: string[]
  theirs: string[]
  /** Text after the markers ("HEAD", "feature/x", "parent of abc123"...). */
  oursLabel: string
  baseLabel?: string
  theirsLabel: string
  /** Original lines, markers included — used to reproduce unresolved chunks verbatim. */
  raw: string[]
}

export type Segment = CommonSegment | ConflictSegment

export type ChunkChoice = 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first' | 'none'

/** Choice per conflict chunk (by ConflictSegment.index); undefined/null = unresolved. */
export type ChunkChoices = ReadonlyArray<ChunkChoice | null | undefined>

export type Side = 'ours' | 'theirs'

// ── Line helpers ───────────────────────────────────────────────────────────

/** Split text into lines that keep their terminator. "" → []. */
export function splitLines(text: string): string[] {
  const out: string[] = []
  let start = 0
  const n = text.length
  while (start < n) {
    const nl = text.indexOf('\n', start)
    if (nl < 0) {
      out.push(text.slice(start))
      break
    }
    out.push(text.slice(start, nl + 1))
    start = nl + 1
  }
  return out
}

/** Remove the line terminator ("\n" or "\r\n"). */
export function stripEol(line: string): string {
  if (line.endsWith('\r\n')) return line.slice(0, -2)
  if (line.endsWith('\n')) return line.slice(0, -1)
  return line
}

/** Text after a 7-char marker, or null when the line is not that marker. */
function markerLabel(line: string, ch: '<' | '>' | '|'): string | null {
  const body = stripEol(line)
  const marker = ch.repeat(7)
  if (!body.startsWith(marker)) return null
  const rest = body.slice(7)
  if (rest === '') return ''
  // Exactly 7 marker chars followed by a space (git writes "<<<<<<< label").
  if (rest[0] !== ' ' && rest[0] !== '\t') return null
  return rest.slice(1).trim()
}

function isSeparator(line: string): boolean {
  const body = stripEol(line)
  return body.startsWith('=======') && body.slice(7).trim() === ''
}

// ── Parsing ────────────────────────────────────────────────────────────────

interface Pending {
  section: 'ours' | 'base' | 'theirs'
  ours: string[]
  base?: string[]
  theirs: string[]
  oursLabel: string
  baseLabel?: string
  raw: string[]
}

/**
 * Parse text containing git conflict markers.
 *  - Markers must start at the beginning of a line and be exactly 7 chars long.
 *  - `||||||| base` sections (diff3 / zdiff3) are captured as `base`.
 *  - Unterminated or malformed blocks are kept as plain (common) text.
 *  - Adjacent common lines are merged into a single segment.
 */
export function parseConflicts(text: string): Segment[] {
  const lines = splitLines(text)
  const segments: Segment[] = []
  let conflictIndex = 0
  let pending: Pending | null = null

  const pushCommon = (ls: string[]) => {
    if (!ls.length) return
    const last = segments[segments.length - 1]
    if (last && last.type === 'common') last.lines.push(...ls)
    else segments.push({ type: 'common', lines: [...ls] })
  }

  for (const line of lines) {
    if (!pending) {
      const label = markerLabel(line, '<')
      if (label !== null) {
        pending = { section: 'ours', ours: [], theirs: [], oursLabel: label, raw: [line] }
      } else {
        pushCommon([line])
      }
      continue
    }

    // Inside a conflict block.
    const startLabel = markerLabel(line, '<')
    if (startLabel !== null) {
      // A new block starts before the previous one was closed: the previous one
      // is malformed → keep it as text and start over.
      pushCommon(pending.raw)
      pending = { section: 'ours', ours: [], theirs: [], oursLabel: startLabel, raw: [line] }
      continue
    }

    if (pending.section === 'ours') {
      const baseLabel = markerLabel(line, '|')
      if (baseLabel !== null) {
        pending.section = 'base'
        pending.base = []
        pending.baseLabel = baseLabel
        pending.raw.push(line)
        continue
      }
      if (isSeparator(line)) {
        pending.section = 'theirs'
        pending.raw.push(line)
        continue
      }
      if (markerLabel(line, '>') !== null) {
        // End marker without separator → malformed.
        pending.raw.push(line)
        pushCommon(pending.raw)
        pending = null
        continue
      }
      pending.ours.push(line)
      pending.raw.push(line)
      continue
    }

    if (pending.section === 'base') {
      if (isSeparator(line)) {
        pending.section = 'theirs'
        pending.raw.push(line)
        continue
      }
      if (markerLabel(line, '>') !== null) {
        pending.raw.push(line)
        pushCommon(pending.raw)
        pending = null
        continue
      }
      pending.base!.push(line)
      pending.raw.push(line)
      continue
    }

    // section === 'theirs'
    const endLabel = markerLabel(line, '>')
    if (endLabel !== null) {
      pending.raw.push(line)
      const seg: ConflictSegment = {
        type: 'conflict',
        index: conflictIndex++,
        ours: pending.ours,
        theirs: pending.theirs,
        oursLabel: pending.oursLabel,
        theirsLabel: endLabel,
        raw: pending.raw
      }
      if (pending.base) {
        seg.base = pending.base
        seg.baseLabel = pending.baseLabel
      }
      segments.push(seg)
      pending = null
      continue
    }
    pending.theirs.push(line)
    pending.raw.push(line)
  }

  // Unterminated block → plain text.
  if (pending) pushCommon(pending.raw)
  return segments
}

export function conflictSegments(segments: readonly Segment[]): ConflictSegment[] {
  return segments.filter((s): s is ConflictSegment => s.type === 'conflict')
}

export function countConflicts(segments: readonly Segment[]): number {
  let n = 0
  for (const s of segments) if (s.type === 'conflict') n++
  return n
}

/** Number of conflict chunks without a choice. */
export function countUnresolved(segments: readonly Segment[], choices: ChunkChoices): number {
  let n = 0
  for (const s of segments) if (s.type === 'conflict' && !choices[s.index]) n++
  return n
}

/** True when the text still contains a well-formed conflict block or a stray start/end marker. */
export function hasConflictMarkers(text: string): boolean {
  if (/^(<{7}|>{7})([ \t].*)?\r?$/m.test(text)) return true
  return countConflicts(parseConflicts(text)) > 0
}

// ── Building the output ────────────────────────────────────────────────────

export type RegionSource = 'ours' | 'theirs' | 'unresolved' | 'none'

/** Where the lines of a chunk ended up in the generated output (0-based line numbers). */
export interface OutputRegion {
  chunk: number
  source: RegionSource
  startLine: number
  lineCount: number
}

export interface BuiltOutput {
  text: string
  regions: OutputRegion[]
}

/** Lines contributed by a chunk for a given choice (unresolved → the original markers). */
export function chunkLines(seg: ConflictSegment, choice: ChunkChoice | null | undefined): Array<{ source: RegionSource; lines: string[] }> {
  switch (choice) {
    case 'ours':
      return [{ source: 'ours', lines: seg.ours }]
    case 'theirs':
      return [{ source: 'theirs', lines: seg.theirs }]
    case 'both-ours-first':
      return [
        { source: 'ours', lines: seg.ours },
        { source: 'theirs', lines: seg.theirs }
      ]
    case 'both-theirs-first':
      return [
        { source: 'theirs', lines: seg.theirs },
        { source: 'ours', lines: seg.ours }
      ]
    case 'none':
      return [{ source: 'none', lines: [] }]
    default:
      return [{ source: 'unresolved', lines: seg.raw }]
  }
}

/**
 * Join the pieces of an output, making sure a piece that does not end with a
 * line terminator (the last line of a side, e.g. "no newline at end of file")
 * is not glued to the next piece. Uses the file's dominant line ending.
 */
function joinPieces(pieces: string[][], eol: string): string {
  const parts: string[] = []
  // Track the terminator state instead of inspecting the growing string (keeps this O(n)).
  let open = false
  for (const lines of pieces) {
    for (const line of lines) {
      if (open) parts.push(eol)
      parts.push(line)
      open = !line.endsWith('\n')
    }
  }
  return parts.join('')
}

/** "\r\n" when most terminated lines use CRLF, else "\n". */
export function detectEol(text: string): '\n' | '\r\n' {
  let crlf = 0
  let lf = 0
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text[i - 1] === '\r') crlf++
    else lf++
  }
  return crlf > lf ? '\r\n' : '\n'
}

/** Build the merged text from per-chunk choices, with the line regions of every chunk. */
export function buildOutputWithRegions(segments: readonly Segment[], choices: ChunkChoices, eol: '\n' | '\r\n' = '\n'): BuiltOutput {
  const pieces: string[][] = []
  const regions: OutputRegion[] = []
  let line = 0
  for (const seg of segments) {
    if (seg.type === 'common') {
      pieces.push(seg.lines)
      line += seg.lines.length
      continue
    }
    for (const part of chunkLines(seg, choices[seg.index])) {
      regions.push({ chunk: seg.index, source: part.source, startLine: line, lineCount: part.lines.length })
      pieces.push(part.lines)
      line += part.lines.length
    }
  }
  return { text: joinPieces(pieces, eol), regions }
}

/** Build the merged text from per-chunk choices. Unresolved chunks keep their conflict markers. */
export function buildOutput(segments: readonly Segment[], choices: ChunkChoices, eol: '\n' | '\r\n' = '\n'): string {
  return buildOutputWithRegions(segments, choices, eol).text
}

/** Reconstruct one side's version of the file (common lines + that side of every chunk). */
export function sideText(segments: readonly Segment[], side: Side, eol: '\n' | '\r\n' = '\n'): string {
  const pieces: string[][] = []
  for (const seg of segments) pieces.push(seg.type === 'common' ? seg.lines : seg[side])
  return joinPieces(pieces, eol)
}

// ── Choices (checkbox semantics) ───────────────────────────────────────────

/** Is this side's checkbox checked for the choice? */
export function sideChecked(choice: ChunkChoice | null | undefined, side: Side): boolean {
  if (!choice || choice === 'none') return false
  if (choice === 'ours' || choice === 'theirs') return choice === side
  return true
}

/**
 * Toggle a side's checkbox. Checking the second side appends it after the
 * first one (click order decides the order of "both"). Unchecking the last
 * checked side yields 'none' (explicitly take neither).
 */
export function toggleChoice(choice: ChunkChoice | null | undefined, side: Side): ChunkChoice {
  const other: Side = side === 'ours' ? 'theirs' : 'ours'
  const checked = sideChecked(choice, side)
  const otherChecked = sideChecked(choice, other)
  if (checked) return otherChecked ? other : 'none'
  if (otherChecked) return other === 'ours' ? 'both-ours-first' : 'both-theirs-first'
  return side
}

export function choiceLabel(choice: ChunkChoice | null | undefined, oursName = 'A', theirsName = 'B'): string {
  switch (choice) {
    case 'ours':
      return oursName
    case 'theirs':
      return theirsName
    case 'both-ours-first':
      return `${oursName} + ${theirsName}`
    case 'both-theirs-first':
      return `${theirsName} + ${oursName}`
    case 'none':
      return 'Neither'
    default:
      return 'Unresolved'
  }
}

// ── Aligned pane rows ──────────────────────────────────────────────────────

export type PaneRow =
  | { kind: 'common'; text: string; lineNo: number }
  /** A line of a conflict chunk; `first` marks the row that carries the checkbox. */
  | { kind: 'chunk'; chunk: number; text: string; lineNo: number; first: boolean; last: boolean }
  /** Padding so both panes keep chunks aligned; `first` when the side has no lines at all. */
  | { kind: 'filler'; chunk: number; first: boolean; last: boolean; empty: boolean }

/**
 * Rows for one side of the side-by-side view. Both sides produce the same
 * number of rows (chunks are padded to the taller side, min 1 row) so the
 * panes can scroll in lock-step.
 */
export function buildPaneRows(segments: readonly Segment[], side: Side): PaneRow[] {
  const rows: PaneRow[] = []
  let lineNo = 1
  for (const seg of segments) {
    if (seg.type === 'common') {
      for (const l of seg.lines) rows.push({ kind: 'common', text: stripEol(l), lineNo: lineNo++ })
      continue
    }
    const mine = seg[side]
    const height = Math.max(seg.ours.length, seg.theirs.length, 1)
    for (let i = 0; i < height; i++) {
      const first = i === 0
      const last = i === height - 1
      if (i < mine.length) rows.push({ kind: 'chunk', chunk: seg.index, text: stripEol(mine[i]), lineNo: lineNo++, first, last })
      else rows.push({ kind: 'filler', chunk: seg.index, first, last, empty: mine.length === 0 })
    }
  }
  return rows
}

/** Row index (in buildPaneRows output) where each chunk starts. */
export function chunkRowStarts(segments: readonly Segment[]): number[] {
  const starts: number[] = []
  let row = 0
  for (const seg of segments) {
    if (seg.type === 'common') {
      row += seg.lines.length
      continue
    }
    starts[seg.index] = row
    row += Math.max(seg.ours.length, seg.theirs.length, 1)
  }
  return starts
}

/** Longest line (tabs counted as 4 columns) across both sides — used to size horizontally-scrolling panes. */
export function maxLineColumns(segments: readonly Segment[]): number {
  let max = 0
  const measure = (l: string) => {
    const s = stripEol(l)
    let cols = 0
    for (let i = 0; i < s.length; i++) cols += s.charCodeAt(i) === 9 ? 4 : 1
    if (cols > max) max = cols
  }
  for (const seg of segments) {
    if (seg.type === 'common') seg.lines.forEach(measure)
    else {
      seg.ours.forEach(measure)
      seg.theirs.forEach(measure)
    }
  }
  return max
}

// ── Conflict kinds ─────────────────────────────────────────────────────────

/** Kinds where a line-by-line text merge is not possible. */
export function needsChooser(kind: ConflictKind, binary: boolean): boolean {
  return binary || (kind !== 'both-modified' && kind !== 'both-added')
}

/** Whether a side still has the file for this conflict kind. */
export function sideExists(kind: ConflictKind, side: Side): boolean {
  switch (kind) {
    case 'both-deleted':
      return false
    case 'deleted-by-us':
      return side === 'theirs'
    case 'deleted-by-them':
      return side === 'ours'
    case 'added-by-us':
      return side === 'ours'
    case 'added-by-them':
      return side === 'theirs'
    default:
      return true
  }
}

/** What a side did to the file, e.g. "modified this file". */
export function describeSide(kind: ConflictKind, side: Side): string {
  switch (kind) {
    case 'both-modified':
      return 'modified this file'
    case 'both-added':
      return 'added this file'
    case 'both-deleted':
      return 'deleted this file'
    case 'deleted-by-us':
      return side === 'ours' ? 'deleted this file' : 'modified this file'
    case 'deleted-by-them':
      return side === 'theirs' ? 'deleted this file' : 'modified this file'
    case 'added-by-us':
      return side === 'ours' ? 'added this file' : 'does not have this file'
    case 'added-by-them':
      return side === 'theirs' ? 'added this file' : 'does not have this file'
  }
}

export const CONFLICT_KIND_LABEL: Record<ConflictKind, string> = {
  'both-modified': 'Both modified',
  'both-added': 'Both added',
  'both-deleted': 'Both deleted',
  'added-by-us': 'Added by A',
  'added-by-them': 'Added by B',
  'deleted-by-us': 'Deleted by A',
  'deleted-by-them': 'Deleted by B'
}

// ── Conflicted file navigation ─────────────────────────────────────────────

/**
 * File to open after `current` was resolved: the first remaining file that came
 * after it in the previous ordering, wrapping around; null when none remain.
 */
export function nextConflictPath(order: readonly string[], current: string, remaining: readonly string[]): string | null {
  const left = new Set(remaining.filter((p) => p !== current))
  if (!left.size) return null
  const idx = order.indexOf(current)
  if (idx >= 0) {
    for (let k = 1; k <= order.length; k++) {
      const p = order[(idx + k) % order.length]
      if (left.has(p)) return p
    }
  }
  return remaining.find((p) => left.has(p)) ?? null
}
