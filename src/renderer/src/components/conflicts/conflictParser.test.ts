import { describe, expect, it } from 'vitest'
import {
  buildOutput,
  buildOutputWithRegions,
  buildPaneRows,
  chunkRowStarts,
  countConflicts,
  countUnresolved,
  detectEol,
  describeSide,
  hasConflictMarkers,
  maxLineColumns,
  nextConflictPath,
  needsChooser,
  parseConflicts,
  restoreLineEndings,
  sideChecked,
  sideExists,
  sideText,
  splitLines,
  stripEol,
  toggleChoice,
  type ConflictSegment,
  type Segment
} from './conflictParser'

const SIMPLE = ['a', '<<<<<<< HEAD', 'ours 1', 'ours 2', '=======', 'theirs 1', '>>>>>>> feature/x', 'z', ''].join('\n')

function conflicts(segs: Segment[]): ConflictSegment[] {
  return segs.filter((s): s is ConflictSegment => s.type === 'conflict')
}

describe('splitLines / stripEol', () => {
  it('keeps terminators and handles a missing final newline', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a')).toEqual(['a'])
    expect(splitLines('a\n')).toEqual(['a\n'])
    expect(splitLines('a\r\nb\nc')).toEqual(['a\r\n', 'b\n', 'c'])
    expect(splitLines('\n\n')).toEqual(['\n', '\n'])
  })
  it('strips LF and CRLF', () => {
    expect(stripEol('x\r\n')).toBe('x')
    expect(stripEol('x\n')).toBe('x')
    expect(stripEol('x')).toBe('x')
    expect(stripEol('x\r')).toBe('x\r')
  })
})

describe('parseConflicts', () => {
  it('parses a simple conflict with labels', () => {
    const segs = parseConflicts(SIMPLE)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ type: 'common', lines: ['a\n'] })
    const c = segs[1] as ConflictSegment
    expect(c.type).toBe('conflict')
    expect(c.index).toBe(0)
    expect(c.ours).toEqual(['ours 1\n', 'ours 2\n'])
    expect(c.theirs).toEqual(['theirs 1\n'])
    expect(c.base).toBeUndefined()
    expect(c.oursLabel).toBe('HEAD')
    expect(c.theirsLabel).toBe('feature/x')
    expect(segs[2]).toEqual({ type: 'common', lines: ['z\n'] })
  })

  it('returns a single common segment when there are no markers', () => {
    expect(parseConflicts('x\ny\n')).toEqual([{ type: 'common', lines: ['x\n', 'y\n'] }])
    expect(parseConflicts('')).toEqual([])
  })

  it('parses diff3 / zdiff3 base sections', () => {
    const text = ['<<<<<<< ours', 'o', '||||||| merged common ancestors', 'b1', 'b2', '=======', 't', '>>>>>>> theirs', ''].join('\n')
    const [c] = conflicts(parseConflicts(text))
    expect(c.ours).toEqual(['o\n'])
    expect(c.base).toEqual(['b1\n', 'b2\n'])
    expect(c.baseLabel).toBe('merged common ancestors')
    expect(c.theirs).toEqual(['t\n'])
  })

  it('preserves CRLF line endings in every section', () => {
    const text = 'a\r\n<<<<<<< HEAD\r\no\r\n=======\r\nt\r\n>>>>>>> b\r\nz\r\n'
    const segs = parseConflicts(text)
    const [c] = conflicts(segs)
    expect(c.ours).toEqual(['o\r\n'])
    expect(c.theirs).toEqual(['t\r\n'])
    expect(c.oursLabel).toBe('HEAD')
    expect(c.theirsLabel).toBe('b')
    expect(buildOutput(segs, ['ours'])).toBe('a\r\no\r\nz\r\n')
    expect(buildOutput(segs, [undefined])).toBe(text)
  })

  it('only recognises markers at the start of a line and with exactly 7 chars', () => {
    const text = [' <<<<<<< not a marker', '<<<<<<<< eight', 'x <<<<<<< y', '========', ''].join('\n')
    const segs = parseConflicts(text)
    expect(countConflicts(segs)).toBe(0)
    expect(segs).toHaveLength(1)
  })

  it('accepts markers without labels', () => {
    const [c] = conflicts(parseConflicts('<<<<<<<\no\n=======\nt\n>>>>>>>\n'))
    expect(c.oursLabel).toBe('')
    expect(c.theirsLabel).toBe('')
    expect(c.ours).toEqual(['o\n'])
  })

  it('treats unterminated markers as text', () => {
    const text = 'a\n<<<<<<< HEAD\no\n=======\nt\n'
    const segs = parseConflicts(text)
    expect(countConflicts(segs)).toBe(0)
    expect(segs).toEqual([{ type: 'common', lines: splitLines(text) }])
    expect(buildOutput(segs, [])).toBe(text)
  })

  it('treats an end marker without separator as text', () => {
    const text = '<<<<<<< HEAD\no\n>>>>>>> x\nafter\n'
    const segs = parseConflicts(text)
    expect(countConflicts(segs)).toBe(0)
    expect(buildOutput(segs, [])).toBe(text)
  })

  it('recovers when a new block starts before the previous one is closed', () => {
    const text = '<<<<<<< A\nbroken\n<<<<<<< HEAD\no\n=======\nt\n>>>>>>> b\n'
    const segs = parseConflicts(text)
    expect(countConflicts(segs)).toBe(1)
    expect(segs[0]).toEqual({ type: 'common', lines: ['<<<<<<< A\n', 'broken\n'] })
    expect(buildOutput(segs, ['theirs'])).toBe('<<<<<<< A\nbroken\nt\n')
  })

  it('parses multiple and adjacent chunks', () => {
    const text = [
      'top',
      '<<<<<<< HEAD',
      'o1',
      '=======',
      't1',
      '>>>>>>> b',
      '<<<<<<< HEAD',
      'o2',
      '=======',
      't2',
      '>>>>>>> b',
      'mid',
      '<<<<<<< HEAD',
      '=======',
      't3',
      '>>>>>>> b',
      ''
    ].join('\n')
    const segs = parseConflicts(text)
    const cs = conflicts(segs)
    expect(cs.map((c) => c.index)).toEqual([0, 1, 2])
    expect(segs.map((s) => s.type)).toEqual(['common', 'conflict', 'conflict', 'common', 'conflict'])
    expect(cs[2].ours).toEqual([])
    expect(cs[2].theirs).toEqual(['t3\n'])
    expect(buildOutput(segs, ['ours', 'theirs', 'both-ours-first'])).toBe('top\no1\nt2\nmid\nt3\n')
  })

  it('keeps a missing trailing newline after the last common line', () => {
    const text = '<<<<<<< HEAD\no\n=======\nt\n>>>>>>> b\nend'
    const segs = parseConflicts(text)
    expect(buildOutput(segs, ['ours'])).toBe('o\nend')
  })

  it('handles a separator line with trailing whitespace', () => {
    const [c] = conflicts(parseConflicts('<<<<<<< HEAD\no\n=======  \nt\n>>>>>>> b\n'))
    expect(c.theirs).toEqual(['t\n'])
  })
})

describe('buildOutput', () => {
  const segs = parseConflicts(SIMPLE)

  it('builds every choice', () => {
    expect(buildOutput(segs, ['ours'])).toBe('a\nours 1\nours 2\nz\n')
    expect(buildOutput(segs, ['theirs'])).toBe('a\ntheirs 1\nz\n')
    expect(buildOutput(segs, ['both-ours-first'])).toBe('a\nours 1\nours 2\ntheirs 1\nz\n')
    expect(buildOutput(segs, ['both-theirs-first'])).toBe('a\ntheirs 1\nours 1\nours 2\nz\n')
    expect(buildOutput(segs, ['none'])).toBe('a\nz\n')
  })

  it('reproduces unresolved chunks verbatim (markers included)', () => {
    expect(buildOutput(segs, [])).toBe(SIMPLE)
    expect(buildOutput(segs, [null])).toBe(SIMPLE)
  })

  it('reports the output regions of every chunk', () => {
    const res = buildOutputWithRegions(segs, ['both-theirs-first'])
    expect(res.regions).toEqual([
      { chunk: 0, source: 'theirs', startLine: 1, lineCount: 1 },
      { chunk: 0, source: 'ours', startLine: 2, lineCount: 2 }
    ])
    const un = buildOutputWithRegions(segs, [])
    expect(un.regions).toEqual([{ chunk: 0, source: 'unresolved', startLine: 1, lineCount: 6 }])
    const none = buildOutputWithRegions(segs, ['none'])
    expect(none.regions).toEqual([{ chunk: 0, source: 'none', startLine: 1, lineCount: 0 }])
  })

  it('does not glue a non-terminated line to the next piece', () => {
    const custom: Segment[] = [
      { type: 'common', lines: ['a'] },
      { type: 'conflict', index: 0, ours: ['o\n'], theirs: [], oursLabel: '', theirsLabel: '', raw: [] }
    ]
    expect(buildOutput(custom, ['ours'])).toBe('a\no\n')
    expect(buildOutput(custom, ['ours'], '\r\n')).toBe('a\r\no\n')
  })

  it('counts unresolved chunks', () => {
    const many = parseConflicts(SIMPLE + SIMPLE)
    expect(countConflicts(many)).toBe(2)
    expect(countUnresolved(many, [])).toBe(2)
    expect(countUnresolved(many, ['ours'])).toBe(1)
    expect(countUnresolved(many, ['none', 'theirs'])).toBe(0)
  })
})

describe('hasConflictMarkers', () => {
  it('detects blocks and stray markers', () => {
    expect(hasConflictMarkers(SIMPLE)).toBe(true)
    expect(hasConflictMarkers('a\n<<<<<<< HEAD\nb\n')).toBe(true)
    expect(hasConflictMarkers('a\n>>>>>>> x\r\n')).toBe(true)
    expect(hasConflictMarkers('Title\n=======\n')).toBe(false)
    expect(hasConflictMarkers('a <<<<<<< b\n')).toBe(false)
    expect(hasConflictMarkers('<<<<<<<<\n')).toBe(false)
    expect(hasConflictMarkers('')).toBe(false)
  })
})

describe('checkbox choices', () => {
  it('reports checked sides', () => {
    expect(sideChecked(undefined, 'ours')).toBe(false)
    expect(sideChecked('none', 'theirs')).toBe(false)
    expect(sideChecked('ours', 'ours')).toBe(true)
    expect(sideChecked('ours', 'theirs')).toBe(false)
    expect(sideChecked('both-theirs-first', 'ours')).toBe(true)
    expect(sideChecked('both-ours-first', 'theirs')).toBe(true)
  })

  it('toggles in click order', () => {
    expect(toggleChoice(undefined, 'ours')).toBe('ours')
    expect(toggleChoice(undefined, 'theirs')).toBe('theirs')
    expect(toggleChoice('none', 'theirs')).toBe('theirs')
    expect(toggleChoice('ours', 'theirs')).toBe('both-ours-first')
    expect(toggleChoice('theirs', 'ours')).toBe('both-theirs-first')
    expect(toggleChoice('ours', 'ours')).toBe('none')
    expect(toggleChoice('both-ours-first', 'ours')).toBe('theirs')
    expect(toggleChoice('both-ours-first', 'theirs')).toBe('ours')
    expect(toggleChoice('both-theirs-first', 'theirs')).toBe('ours')
  })
})

describe('pane rows', () => {
  const text = ['c1', '<<<<<<< HEAD', 'o1', 'o2', 'o3', '=======', 't1', '>>>>>>> b', 'c2', '<<<<<<< HEAD', '=======', 't2', '>>>>>>> b', ''].join('\n')
  const segs = parseConflicts(text)

  it('pads chunks so both sides have the same number of rows', () => {
    const a = buildPaneRows(segs, 'ours')
    const b = buildPaneRows(segs, 'theirs')
    expect(a).toHaveLength(b.length)
    expect(a).toHaveLength(1 + 3 + 1 + 1)
    expect(a.map((r) => r.kind)).toEqual(['common', 'chunk', 'chunk', 'chunk', 'common', 'filler'])
    expect(b.map((r) => r.kind)).toEqual(['common', 'chunk', 'filler', 'filler', 'common', 'chunk'])
  })

  it('numbers lines per side and marks first/last/empty rows', () => {
    const a = buildPaneRows(segs, 'ours')
    expect(a.map((r) => (r.kind === 'filler' ? null : r.lineNo))).toEqual([1, 2, 3, 4, 5, null])
    const b = buildPaneRows(segs, 'theirs')
    expect(b.map((r) => (r.kind === 'filler' ? null : r.lineNo))).toEqual([1, 2, null, null, 3, 4])
    expect(a[5]).toEqual({ kind: 'filler', chunk: 1, first: true, last: true, empty: true })
    expect(b[2]).toEqual({ kind: 'filler', chunk: 0, first: false, last: false, empty: false })
    expect(a[1]).toMatchObject({ kind: 'chunk', chunk: 0, text: 'o1', first: true, last: false })
  })

  it('computes chunk start rows', () => {
    expect(chunkRowStarts(segs)).toEqual([1, 5])
  })

  it('reconstructs side texts', () => {
    expect(sideText(segs, 'ours')).toBe('c1\no1\no2\no3\nc2\n')
    expect(sideText(segs, 'theirs')).toBe('c1\nt1\nc2\nt2\n')
  })

  it('measures the longest line with tabs as 4 columns', () => {
    expect(maxLineColumns(parseConflicts('ab\n\tx\n'))).toBe(5)
    expect(maxLineColumns(parseConflicts('<<<<<<< a\nlonger line\n=======\nb\n>>>>>>> b\n'))).toBe(11)
  })
})

describe('conflict kinds', () => {
  it('knows which kinds need the chooser', () => {
    expect(needsChooser('both-modified', false)).toBe(false)
    expect(needsChooser('both-added', false)).toBe(false)
    expect(needsChooser('both-modified', true)).toBe(true)
    expect(needsChooser('deleted-by-us', false)).toBe(true)
    expect(needsChooser('both-deleted', false)).toBe(true)
  })

  it('knows which sides still have the file', () => {
    expect(sideExists('deleted-by-us', 'ours')).toBe(false)
    expect(sideExists('deleted-by-us', 'theirs')).toBe(true)
    expect(sideExists('deleted-by-them', 'theirs')).toBe(false)
    expect(sideExists('added-by-us', 'theirs')).toBe(false)
    expect(sideExists('added-by-them', 'theirs')).toBe(true)
    expect(sideExists('both-deleted', 'ours')).toBe(false)
    expect(sideExists('both-modified', 'ours')).toBe(true)
  })

  it('describes what each side did', () => {
    expect(describeSide('deleted-by-them', 'ours')).toBe('modified this file')
    expect(describeSide('deleted-by-them', 'theirs')).toBe('deleted this file')
    expect(describeSide('added-by-us', 'theirs')).toBe('does not have this file')
  })
})

describe('detectEol', () => {
  it('picks the dominant line ending', () => {
    expect(detectEol('a\r\nb\r\nc\n')).toBe('\r\n')
    expect(detectEol('a\nb\n')).toBe('\n')
    expect(detectEol('')).toBe('\n')
  })
})

describe('restoreLineEndings', () => {
  it('puts CRLF back on a CRLF file edited in the textarea (whose value is LF-only)', () => {
    const file = 'one\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> b\r\nlast\r\n'
    // What a textarea hands back after the user typed one character.
    const edited = 'one\nmine!\nlast\n'
    expect(restoreLineEndings(edited, file, '\r\n')).toBe('one\r\nmine!\r\nlast\r\n')
    expect(restoreLineEndings('a\nb', file, '\r\n')).toBe('a\r\nb')
  })

  it('keeps the original terminator of untouched lines in a mixed file; new lines get the dominant one', () => {
    const file = 'a\r\nb\nc\r\nd\r\n'
    expect(restoreLineEndings('a\nb\nnew\nc\nd\n', file, '\r\n')).toBe('a\r\nb\nnew\r\nc\r\nd\r\n')
    // An LF-majority file with one CRLF line keeps it.
    expect(restoreLineEndings('x\ny\nz\n', 'x\ny\r\nz\n', '\n')).toBe('x\ny\r\nz\n')
  })

  it('leaves LF files and lines that still carry CRLF alone', () => {
    expect(restoreLineEndings('a\nb\n', 'a\nb\n', '\n')).toBe('a\nb\n')
    expect(restoreLineEndings('a\r\nb\r\n', 'a\r\nb\r\n', '\r\n')).toBe('a\r\nb\r\n')
    expect(restoreLineEndings('', 'a\r\n', '\r\n')).toBe('')
  })
})

describe('nextConflictPath', () => {
  it('picks the next remaining file after the current one, wrapping around', () => {
    expect(nextConflictPath(['a', 'b', 'c'], 'b', ['a', 'c'])).toBe('c')
    expect(nextConflictPath(['a', 'b', 'c'], 'c', ['a', 'b'])).toBe('a')
    expect(nextConflictPath(['a', 'b', 'c'], 'a', ['c'])).toBe('c')
  })
  it('handles unknown current files and new entries', () => {
    expect(nextConflictPath(['a'], 'x', ['d', 'a'])).toBe('d')
    expect(nextConflictPath(['a', 'b'], 'b', ['b'])).toBeNull()
    expect(nextConflictPath([], 'b', [])).toBeNull()
  })
})
