import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildPartialPatch,
  hunkLineNumbers,
  patchApplyOptions,
  quotePath,
  remapSelection,
  supportsPartialPatch,
  type HunkSelection,
  type PatchMode
} from './patch'
import type { DiffHunk, DiffLine, FileDiff, FileStatusCode } from './types'

// ── Fixture helpers (hand-written diffs, independent of the backend parser) ──

/**
 * Hunk from a header and rows prefixed with ' ', '+', '-'; a "\\" row marks the previous line as lacking a newline.
 * Like the backend parser, a trailing "\r" is removed from the content and recorded as `crlf`.
 */
function h(header: string, rows: string[]): DiffHunk {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
  if (!m) throw new Error('bad header ' + header)
  const oldStart = Number(m[1])
  const oldLines = m[2] === undefined ? 1 : Number(m[2])
  const newStart = Number(m[3])
  const newLines = m[4] === undefined ? 1 : Number(m[4])
  let o = oldLines === 0 ? oldStart + 1 : oldStart
  let n = newLines === 0 ? newStart + 1 : newStart
  const lines: DiffLine[] = []
  for (const row of rows) {
    if (row === '\\') {
      lines[lines.length - 1].noNewline = true
      continue
    }
    const raw = row.slice(1)
    const crlf = raw.endsWith('\r')
    const content = crlf ? raw.slice(0, -1) : raw
    const eol = crlf ? { crlf: true } : {}
    if (row[0] === '+') lines.push({ type: 'add', content, oldLine: null, newLine: n++, ...eol })
    else if (row[0] === '-') lines.push({ type: 'del', content, oldLine: o++, newLine: null, ...eol })
    else lines.push({ type: 'context', content, oldLine: o++, newLine: n++, ...eol })
  }
  return { header, oldStart, oldLines, newStart, newLines, lines }
}

function fd(path: string, hunks: DiffHunk[], extra: Partial<FileDiff> = {}): FileDiff {
  let additions = 0
  let deletions = 0
  for (const hk of hunks)
    for (const l of hk.lines) {
      if (l.type === 'add') additions++
      if (l.type === 'del') deletions++
    }
  return { path, status: 'modified' as FileStatusCode, binary: false, isImage: false, hunks, additions, deletions, ...extra }
}

const patchBody = (p: string | null) => {
  expect(p).not.toBeNull()
  const lines = p!.split('\n')
  return lines.slice(lines.findIndex((l) => l.startsWith('@@'))).join('\n')
}

// ── String-level tests ──────────────────────────────────────────────────────

describe('buildPartialPatch (string level)', () => {
  const simple = fd('a.txt', [h('@@ -1,3 +1,3 @@', [' a', '-b', '+B', ' c'])])

  it('stages a single added line: the unselected deletion becomes context', () => {
    expect(buildPartialPatch(simple, [{ hunkIndex: 0, lineIndexes: [2] }], 'stage')).toBe(
      ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,3 +1,4 @@', ' a', ' b', '+B', ' c', ''].join('\n')
    )
  })

  it('stages a single deleted line: the unselected addition is dropped', () => {
    expect(patchBody(buildPartialPatch(simple, [{ hunkIndex: 0, lineIndexes: [1] }], 'stage'))).toBe(
      ['@@ -1,3 +1,2 @@', ' a', '-b', ' c', ''].join('\n')
    )
  })

  it('unstages / discards with reverse semantics: unselected additions become context', () => {
    for (const mode of ['unstage', 'discard'] as PatchMode[]) {
      expect(patchBody(buildPartialPatch(simple, [{ hunkIndex: 0, lineIndexes: [1] }], mode))).toBe(
        ['@@ -1,4 +1,3 @@', ' a', '-b', ' B', ' c', ''].join('\n')
      )
      expect(patchBody(buildPartialPatch(simple, [{ hunkIndex: 0, lineIndexes: [2] }], mode))).toBe(
        ['@@ -1,2 +1,3 @@', ' a', '+B', ' c', ''].join('\n')
      )
    }
  })

  it('a whole-hunk selection reproduces the hunk', () => {
    expect(patchBody(buildPartialPatch(simple, [{ hunkIndex: 0 }], 'stage'))).toBe(
      ['@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c', ''].join('\n')
    )
  })

  it('returns null when nothing (or only context) is selected, or the selection is out of range', () => {
    expect(buildPartialPatch(simple, [], 'stage')).toBeNull()
    expect(buildPartialPatch(simple, [{ hunkIndex: 0, lineIndexes: [] }], 'stage')).toBeNull()
    expect(buildPartialPatch(simple, [{ hunkIndex: 0, lineIndexes: [0, 3] }], 'unstage')).toBeNull()
    expect(buildPartialPatch(simple, [{ hunkIndex: 5 }], 'stage')).toBeNull()
  })

  const multi = fd('m.txt', [
    h('@@ -1,3 +1,5 @@ first', [' a', '+x', '+y', ' b', ' c']),
    h('@@ -10,4 +12,3 @@ second', [' j', '-k', ' l', ' m']),
    h('@@ -20,3 +21,3 @@ third', [' t', '-u', '+U', ' v']),
    h('@@ -30,3 +31,4 @@ fourth', [' D', '+E', ' F', ' G'])
  ])

  it('recomputes new starts for later hunks when staging (old side preserved)', () => {
    const sel: HunkSelection[] = [
      { hunkIndex: 0, lineIndexes: [1] }, // +x only (y dropped) → delta +1
      { hunkIndex: 1 }, // -k → delta 0
      // hunk 2 has nothing selected → dropped
      { hunkIndex: 3, lineIndexes: [1] }
    ]
    expect(patchBody(buildPartialPatch(multi, sel, 'stage'))).toBe(
      [
        '@@ -1,3 +1,4 @@ first',
        ' a',
        '+x',
        ' b',
        ' c',
        '@@ -10,4 +11,3 @@ second',
        ' j',
        '-k',
        ' l',
        ' m',
        '@@ -30,3 +30,4 @@ fourth',
        ' D',
        '+E',
        ' F',
        ' G',
        ''
      ].join('\n')
    )
  })

  it('recomputes old starts for later hunks with reverse modes (new side preserved)', () => {
    const sel: HunkSelection[] = [
      { hunkIndex: 0, lineIndexes: [2] }, // +y only: x stays as context → old count 4
      { hunkIndex: 2, lineIndexes: [1] }, // -u only: U context
      { hunkIndex: 3 }
    ]
    expect(patchBody(buildPartialPatch(multi, sel, 'unstage'))).toBe(
      [
        '@@ -1,4 +1,5 @@ first',
        ' a',
        ' x',
        '+y',
        ' b',
        ' c',
        // hunk 1 dropped: old side equals new side there.
        '@@ -20,4 +21,3 @@ third',
        ' t',
        '-u',
        ' U',
        ' v',
        '@@ -31,3 +31,4 @@ fourth',
        ' D',
        '+E',
        ' F',
        ' G',
        ''
      ].join('\n')
    )
  })

  it('merges duplicate selection entries for the same hunk', () => {
    const a = buildPartialPatch(
      multi,
      [
        { hunkIndex: 0, lineIndexes: [1] },
        { hunkIndex: 0, lineIndexes: [2] }
      ],
      'stage'
    )
    expect(a).toBe(buildPartialPatch(multi, [{ hunkIndex: 0 }], 'stage'))
    const b = buildPartialPatch(multi, [{ hunkIndex: 0, lineIndexes: [1] }, { hunkIndex: 0 }], 'stage')
    expect(b).toBe(a)
  })

  it('handles insertion hunks with an empty old side', () => {
    const d = fd('e.txt', [h('@@ -0,0 +1,2 @@', ['+one', '+two']), h('@@ -5,2 +7,3 @@', [' x', '+y', ' z'])])
    expect(patchBody(buildPartialPatch(d, [{ hunkIndex: 0, lineIndexes: [0] }, { hunkIndex: 1 }], 'stage'))).toBe(
      ['@@ -0,0 +1,1 @@', '+one', '@@ -5,2 +6,3 @@', ' x', '+y', ' z', ''].join('\n')
    )
    // Reverse: dropping a whole-deletion hunk side.
    const del = fd('e.txt', [h('@@ -1,2 +0,0 @@', ['-one', '-two']), h('@@ -9,2 +7,3 @@', [' x', '+y', ' z'])])
    expect(patchBody(buildPartialPatch(del, [{ hunkIndex: 0, lineIndexes: [1] }, { hunkIndex: 1 }], 'discard'))).toBe(
      ['@@ -1,1 +0,0 @@', '-two', '@@ -8,2 +7,3 @@', ' x', '+y', ' z', ''].join('\n')
    )
  })

  describe('no newline at end of file', () => {
    // old "a\nb\nc" (no newline) → new "a\nB\nc\n"
    const oldLacks = fd('n.txt', [h('@@ -1,3 +1,3 @@', [' a', '-b', '-c', '\\', '+B', '+c'])])

    it('keeps the marker on the old side when the last line stays last', () => {
      expect(patchBody(buildPartialPatch(oldLacks, [{ hunkIndex: 0, lineIndexes: [2, 4] }], 'stage'))).toBe(
        ['@@ -1,3 +1,3 @@', ' a', ' b', '-c', '\\ No newline at end of file', '+c', ''].join('\n')
      )
    })

    it('splits a context line that lacks a newline when lines are appended after it', () => {
      expect(patchBody(buildPartialPatch(oldLacks, [{ hunkIndex: 0, lineIndexes: [3] }], 'stage'))).toBe(
        ['@@ -1,3 +1,4 @@', ' a', ' b', '-c', '\\ No newline at end of file', '+c', '+B', ''].join('\n')
      )
    })

    it('drops the marker of a removed line that is no longer last (reverse)', () => {
      // Discarding "-c/+c" while keeping +B: c must keep a newline because B follows it.
      expect(patchBody(buildPartialPatch(oldLacks, [{ hunkIndex: 0, lineIndexes: [2, 4] }], 'discard'))).toBe(
        ['@@ -1,3 +1,3 @@', ' a', '-c', ' B', '+c', ''].join('\n')
      )
    })

    // old "a\nb\n" → new "a\nb\nc" (no newline)
    const newLacks = fd('n.txt', [h('@@ -1,2 +1,3 @@', [' a', ' b', '+c', '\\'])])
    it('keeps the marker on an added last line', () => {
      for (const mode of ['stage', 'discard'] as PatchMode[]) {
        expect(patchBody(buildPartialPatch(newLacks, [{ hunkIndex: 0 }], mode))).toBe(
          ['@@ -1,2 +1,3 @@', ' a', ' b', '+c', '\\ No newline at end of file', ''].join('\n')
        )
      }
    })

    // both sides lack a newline and the last line changes: "p\nq" → "p\nr"
    const both = fd('n.txt', [h('@@ -1,2 +1,2 @@', [' p', '-q', '\\', '+r', '\\'])])
    it('handles both sides lacking a newline', () => {
      expect(patchBody(buildPartialPatch(both, [{ hunkIndex: 0, lineIndexes: [2] }], 'stage'))).toBe(
        ['@@ -1,2 +1,3 @@', ' p', '-q', '\\ No newline at end of file', '+q', '+r', '\\ No newline at end of file', ''].join('\n')
      )
      expect(patchBody(buildPartialPatch(both, [{ hunkIndex: 0, lineIndexes: [1] }], 'stage'))).toBe(
        ['@@ -1,2 +1,1 @@', ' p', '-q', '\\ No newline at end of file', ''].join('\n')
      )
      expect(patchBody(buildPartialPatch(both, [{ hunkIndex: 0, lineIndexes: [1] }], 'unstage'))).toBe(
        ['@@ -1,3 +1,2 @@', ' p', '-q', ' r', '\\ No newline at end of file', ''].join('\n')
      )
    })

    it('keeps the marker after an unchanged last context line', () => {
      const ctx = fd('n.txt', [h('@@ -1,3 +1,3 @@', [' 1', '-2', '+TWO', ' 3', '\\'])])
      expect(patchBody(buildPartialPatch(ctx, [{ hunkIndex: 0, lineIndexes: [2] }], 'stage'))).toBe(
        ['@@ -1,3 +1,4 @@', ' 1', ' 2', '+TWO', ' 3', '\\ No newline at end of file', ''].join('\n')
      )
    })
  })

  describe('CRLF line endings', () => {
    // The parser strips "\r" from content and flags the line; patches must put it back byte for byte.
    const crlf = fd('w.txt', [h('@@ -1,3 +1,3 @@', [' a\r', '-b\r', '+B\r', ' c\r'])])

    it('fixture lines carry the flag, not the carriage return', () => {
      expect(crlf.hunks[0].lines[1]).toEqual({ type: 'del', content: 'b', oldLine: 2, newLine: null, crlf: true })
    })

    it('re-adds "\\r" to context, selected and unselected lines', () => {
      expect(patchBody(buildPartialPatch(crlf, [{ hunkIndex: 0, lineIndexes: [2] }], 'stage'))).toBe(
        ['@@ -1,3 +1,4 @@', ' a\r', ' b\r', '+B\r', ' c\r', ''].join('\n')
      )
      expect(patchBody(buildPartialPatch(crlf, [{ hunkIndex: 0, lineIndexes: [1] }], 'discard'))).toBe(
        ['@@ -1,4 +1,3 @@', ' a\r', '-b\r', ' B\r', ' c\r', ''].join('\n')
      )
    })

    it('keeps mixed endings per line (a line-ending-only change)', () => {
      // "b\r\n" → "b\n": same content, only the flag differs.
      const mixed = fd('m.txt', [h('@@ -1,3 +1,3 @@', [' a', '-b\r', '+b', ' c\r'])])
      expect(patchBody(buildPartialPatch(mixed, [{ hunkIndex: 0 }], 'stage'))).toBe(['@@ -1,3 +1,3 @@', ' a', '-b\r', '+b', ' c\r', ''].join('\n'))
      expect(patchBody(buildPartialPatch(mixed, [{ hunkIndex: 0, lineIndexes: [2] }], 'stage'))).toBe(
        ['@@ -1,3 +1,4 @@', ' a', ' b\r', '+b', ' c\r', ''].join('\n')
      )
    })

    it('handles a CRLF last line without a final newline', () => {
      const last = fd('n.txt', [h('@@ -1,2 +1,2 @@', [' x\r', '-y\r', '\\', '+Y\r', '\\'])])
      expect(patchBody(buildPartialPatch(last, [{ hunkIndex: 0, lineIndexes: [2] }], 'stage'))).toBe(
        ['@@ -1,2 +1,3 @@', ' x\r', '-y\r', '\\ No newline at end of file', '+y\r', '+Y\r', '\\ No newline at end of file', ''].join('\n')
      )
    })
  })

  it('keeps old/new paths for a staged rename, but targets the new path when reversing', () => {
    const d = fd('dir/new.txt', [h('@@ -1,3 +1,3 @@', [' a', '-b', '+B', ' c'])], { status: 'renamed', oldPath: 'dir/old.txt' })
    const stage = buildPartialPatch(d, [{ hunkIndex: 0 }], 'stage')!
    expect(stage.split('\n').slice(0, 3)).toEqual(['diff --git a/dir/old.txt b/dir/new.txt', '--- a/dir/old.txt', '+++ b/dir/new.txt'])
    const unstage = buildPartialPatch(d, [{ hunkIndex: 0 }], 'unstage')!
    expect(unstage.split('\n').slice(0, 3)).toEqual(['diff --git a/dir/new.txt b/dir/new.txt', '--- a/dir/new.txt', '+++ b/dir/new.txt'])
  })

  it('C-quotes special paths and appends a tab after names with spaces', () => {
    expect(quotePath('plain/file.txt')).toBe('plain/file.txt')
    expect(quotePath('a/tab\there')).toBe('"a/tab\\there"')
    expect(quotePath('a/q"uote\\back')).toBe('"a/q\\"uote\\\\back"')
    expect(quotePath('a/nl\nx\x01')).toBe('"a/nl\\nx\\001"')
    expect(quotePath('a/ünï cødé')).toBe('a/ünï cødé')
    const d = fd('my file.txt', [h('@@ -1,1 +1,1 @@', ['-a', '+b'])])
    expect(
      buildPartialPatch(d, [{ hunkIndex: 0 }], 'stage')!
        .split('\n')
        .slice(0, 3)
    ).toEqual(['diff --git a/my file.txt b/my file.txt', '--- a/my file.txt\t', '+++ b/my file.txt\t'])
    const q = fd('we"ird', [h('@@ -1,1 +1,1 @@', ['-a', '+b'])])
    expect(buildPartialPatch(q, [{ hunkIndex: 0 }], 'stage')!.split('\n')[0]).toBe('diff --git "a/we\\"ird" "b/we\\"ird"')
  })

  it('refuses unsupported diffs', () => {
    const base = [h('@@ -0,0 +1,1 @@', ['+x'])]
    for (const status of ['added', 'untracked', 'deleted', 'conflicted', 'typechange'] as FileStatusCode[]) {
      expect(buildPartialPatch(fd('x', base, { status }), [{ hunkIndex: 0 }], 'stage')).toBeNull()
    }
    expect(buildPartialPatch(fd('x', base, { binary: true }), [{ hunkIndex: 0 }], 'stage')).toBeNull()
    expect(buildPartialPatch(fd('x', [], { tooLarge: true }), [{ hunkIndex: 0 }], 'stage')).toBeNull()
    expect(supportsPartialPatch(fd('x', base, { status: 'copied' }), 'stage')).toBe(false)
    expect(supportsPartialPatch(fd('x', base, { status: 'copied' }), 'unstage')).toBe(true)
  })

  it('refuses diffs whose text was not valid UTF-8 (a patch would write U+FFFD over the original bytes)', () => {
    const lossy = fd('latin1.properties', [h('@@ -1,1 +1,2 @@', [' a', '+caf�'])], { encodingLossy: true })
    for (const mode of ['stage', 'unstage', 'discard'] as PatchMode[]) {
      expect(supportsPartialPatch(lossy, mode)).toBe(false)
      expect(buildPartialPatch(lossy, [{ hunkIndex: 0 }], mode)).toBeNull()
    }
    // The same diff without the flag (a genuine U+FFFD in UTF-8 text) still works.
    expect(buildPartialPatch({ ...lossy, encodingLossy: false }, [{ hunkIndex: 0 }], 'stage')).toContain('+caf�')
  })

  it('maps apply options per mode', () => {
    expect(patchApplyOptions('stage')).toEqual({ cached: true })
    expect(patchApplyOptions('unstage')).toEqual({ cached: true, reverse: true })
    expect(patchApplyOptions('discard')).toEqual({ reverse: true })
  })
})

describe('hunkLineNumbers / remapSelection', () => {
  it('derives line numbers from the header', () => {
    expect(hunkLineNumbers(h('@@ -4,3 +4,3 @@', [' a', '-b', '+B', ' c']))).toEqual([
      { old: 4, new: 4 },
      { old: 5, new: null },
      { old: null, new: 5 },
      { old: 6, new: 6 }
    ])
    expect(hunkLineNumbers(h('@@ -0,0 +1,1 @@', ['+x']))).toEqual([{ old: null, new: 1 }])
  })

  it('maps a selection between diffs with different context', () => {
    const narrow = fd('f', [h('@@ -5,1 +5,1 @@', ['-e', '+E']), h('@@ -9,0 +10,1 @@', ['+new'])])
    const wide = fd('f', [h('@@ -2,11 +2,12 @@', [' b', ' c', ' d', '-e', '+E', ' f', ' g', ' h', ' i', '+new', ' j', ' k', ' l'])])
    const r = remapSelection(narrow, [{ hunkIndex: 0, lineIndexes: [1] }, { hunkIndex: 1 }], wide)
    expect(r).toEqual({ selection: [{ hunkIndex: 0, lineIndexes: [4, 9] }], complete: true })
  })

  it('reports an incomplete mapping when a selected line changed', () => {
    const a = fd('f', [h('@@ -1,1 +1,1 @@', ['-x', '+y'])])
    const b = fd('f', [h('@@ -1,1 +1,1 @@', ['-x', '+z'])])
    expect(remapSelection(a, [{ hunkIndex: 0 }], b)).toEqual({ selection: [{ hunkIndex: 0, lineIndexes: [0] }], complete: false })
  })
})

// ── Integration: patches must apply with real git ─────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
// Node modules are imported dynamically so this file also typechecks under the
// DOM-only renderer tsconfig (which includes src/shared but not @types/node).
const load = (name: string): Promise<any> => import(/* @vite-ignore */ name)

interface Node {
  cp: any
  fs: any
  path: any
  os: any
  env: Record<string, string | undefined>
}
let node: Node
let tmpRoot = ''
let emptyConfig = ''

beforeAll(async () => {
  const [cp, fs, path, os, proc] = await Promise.all([
    load('node:child_process'),
    load('node:fs'),
    load('node:path'),
    load('node:os'),
    load('node:process')
  ])
  node = { cp, fs, path, os, env: (proc.default ?? proc).env }
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adar-patch-'))
  emptyConfig = path.join(tmpRoot, 'gitconfig')
  fs.writeFileSync(emptyConfig, '')
})

afterAll(() => {
  if (tmpRoot) node.fs.rmSync(tmpRoot, { recursive: true, force: true })
})

let repoCounter = 0

class Repo {
  readonly dir: string
  constructor() {
    this.dir = node.path.join(tmpRoot, `repo${++repoCounter}`)
    node.fs.mkdirSync(this.dir)
    this.git(['init', '-q', '-b', 'main'])
    this.git(['config', 'user.name', 'Adar Test'])
    this.git(['config', 'user.email', 'adar@example.com'])
    this.git(['config', 'core.autocrlf', 'false'])
  }
  run(args: string[], input?: string): { code: number; stdout: string; stderr: string } {
    const r = node.cp.spawnSync('git', args, {
      cwd: this.dir,
      input,
      encoding: 'utf8',
      env: { ...node.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    })
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  git(args: string[], input?: string): string {
    const r = this.run(args, input)
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
    return r.stdout
  }
  write(file: string, content: string): void {
    node.fs.writeFileSync(node.path.join(this.dir, file), content)
  }
  read(file: string): string {
    return node.fs.readFileSync(node.path.join(this.dir, file), 'utf8')
  }
  index(file: string): string {
    return this.git(['show', `:${file}`])
  }
  commitAll(msg = 'c'): void {
    this.git(['add', '-A'])
    this.git(['commit', '-q', '-m', msg])
  }
  /** git apply --check then apply, with the options of the mode. */
  apply(patch: string, mode: PatchMode): void {
    const o = patchApplyOptions(mode)
    const flags = [...(o.cached ? ['--cached'] : []), ...(o.reverse ? ['--reverse'] : [])]
    const check = this.run(['apply', '--check', ...flags, '-'], patch)
    if (check.code !== 0) throw new Error(`patch does not apply: ${check.stderr}\n${patch}`)
    this.git(['apply', ...flags, '-'], patch)
  }
  /** Hunk text git produces, normalised (explicit counts, no section) to compare with fixtures. */
  diffHunks(args: string[]): string {
    const out = this.git(['diff', '--no-color', '--no-ext-diff', '-U3', ...args])
    const lines = out.split('\n')
    return normaliseHunks(lines.slice(lines.findIndex((l) => l.startsWith('@@'))).join('\n'))
  }
}

function normaliseHunks(text: string): string {
  return text
    .split('\n')
    .map((l) => {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l)
      return m ? `@@ -${m[1]},${m[2] ?? 1} +${m[3]},${m[4] ?? 1} @@` : l
    })
    .join('\n')
}

/** Fixture sanity check: the whole-diff patch must equal git's own diff. */
function expectFixtureMatches(repo: Repo, diff: FileDiff, args: string[]): void {
  const all = diff.hunks.map((_, hunkIndex) => ({ hunkIndex }))
  expect(normaliseHunks(patchBody(buildPartialPatch(diff, all, 'stage')))).toBe(repo.diffHunks(args))
}

const lines = (n: number, f: (i: number) => string = (i) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1))
const text = (ls: string[], eol = true) => ls.join('\n') + (eol ? '\n' : '')

describe('buildPartialPatch applies with git', () => {
  const base = lines(30)
  const changed = (() => {
    const l = [...base]
    l[1] = 'LINE 2'
    l[29] = 'line 30!'
    l.splice(21, 1) // delete line 22
    l.splice(12, 0, 'new A', 'new B') // insert after line 12
    return l
  })()
  // Hand-written equivalent of `git diff -U3` between base and changed.
  const multi = (path: string, extra: Partial<FileDiff> = {}) =>
    fd(
      path,
      [
        h('@@ -1,5 +1,5 @@', [' line 1', '-line 2', '+LINE 2', ' line 3', ' line 4', ' line 5']),
        h('@@ -10,6 +10,8 @@', [' line 10', ' line 11', ' line 12', '+new A', '+new B', ' line 13', ' line 14', ' line 15']),
        h('@@ -19,7 +21,6 @@', [' line 19', ' line 20', ' line 21', '-line 22', ' line 23', ' line 24', ' line 25']),
        h('@@ -27,4 +28,4 @@', [' line 27', ' line 28', ' line 29', '-line 30', '+line 30!'])
      ],
      extra
    )

  it('stages selected lines across several hunks', () => {
    const repo = new Repo()
    repo.write('f.txt', text(base))
    repo.commitAll()
    repo.write('f.txt', text(changed))
    const diff = multi('f.txt')
    expectFixtureMatches(repo, diff, ['--', 'f.txt'])

    const patch = buildPartialPatch(
      diff,
      [
        { hunkIndex: 1, lineIndexes: [4] }, // + new B
        { hunkIndex: 2 }, // - line 22
        { hunkIndex: 3, lineIndexes: [3] } // - line 30 (without + line 30!)
      ],
      'stage'
    )!
    repo.apply(patch, 'stage')
    const expected = [...base.slice(0, 12), 'new B', ...base.slice(12, 21), ...base.slice(22, 29)]
    expect(repo.index('f.txt')).toBe(text(expected))
    expect(repo.read('f.txt')).toBe(text(changed)) // worktree untouched
  })

  it('unstages selected lines (reverse, cached)', () => {
    const repo = new Repo()
    repo.write('f.txt', text(base))
    repo.commitAll()
    repo.write('f.txt', text(changed))
    repo.git(['add', 'f.txt'])
    const diff = multi('f.txt')
    expectFixtureMatches(repo, diff, ['--cached', '--', 'f.txt'])

    const patch = buildPartialPatch(
      diff,
      [
        { hunkIndex: 0, lineIndexes: [1] }, // restore "line 2" (LINE 2 stays)
        { hunkIndex: 3, lineIndexes: [4] } // unstage "+line 30!" (deletion of line 30 stays)
      ],
      'unstage'
    )!
    repo.apply(patch, 'unstage')
    const expected = ['line 1', 'line 2', 'LINE 2', ...base.slice(2, 12), 'new A', 'new B', ...base.slice(12, 21), ...base.slice(22, 29)]
    expect(repo.index('f.txt')).toBe(text(expected))
    expect(repo.read('f.txt')).toBe(text(changed))
  })

  it('discards selected lines from the working tree (reverse)', () => {
    const repo = new Repo()
    repo.write('f.txt', text(base))
    repo.commitAll()
    repo.write('f.txt', text(changed))
    const diff = multi('f.txt')
    const patch = buildPartialPatch(
      diff,
      [
        { hunkIndex: 1, lineIndexes: [3] }, // drop "new A"
        { hunkIndex: 2, lineIndexes: [3] } // restore "line 22"
      ],
      'discard'
    )!
    repo.apply(patch, 'discard')
    const expected = ['line 1', 'LINE 2', ...base.slice(2, 12), 'new B', ...base.slice(12, 29), 'line 30!']
    expect(repo.read('f.txt')).toBe(text(expected))
    expect(repo.index('f.txt')).toBe(text(base))
  })

  it('stages every single change individually, one after another', () => {
    const repo = new Repo()
    repo.write('f.txt', text(base))
    repo.commitAll()
    repo.write('f.txt', text(changed))
    // Apply each change separately: the result must match staging everything.
    let diff = multi('f.txt')
    let steps = 0
    while (diff.hunks.length) {
      // Always pick the first change of the current unstaged diff.
      const lineIndex = diff.hunks[0].lines.findIndex((l) => l.type !== 'context')
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [lineIndex] }], 'stage')!, 'stage')
      diff = fixtureFromGit(repo, ['--', 'f.txt'], 'f.txt')
      expect(++steps).toBeLessThanOrEqual(7)
    }
    expect(steps).toBe(7)
    expect(repo.index('f.txt')).toBe(text(changed))
  })

  describe('no newline at end of file', () => {
    it('old side lacks a newline (stage / discard)', () => {
      const repo = new Repo()
      repo.write('n.txt', 'a\nb\nc')
      repo.commitAll()
      repo.write('n.txt', 'a\nB\nc\n')
      const diff = fd('n.txt', [h('@@ -1,3 +1,3 @@', [' a', '-b', '-c', '\\', '+B', '+c'])])
      expectFixtureMatches(repo, diff, ['--', 'n.txt'])

      // Only the newline fix of "c".
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [2, 4] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('a\nb\nc\n')
      repo.git(['reset', '-q'])

      // Only "+B": the old last line must gain a newline.
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [3] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('a\nb\nc\nB\n')
      repo.git(['reset', '-q'])

      // "-b" and "+B" only.
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [1, 3] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('a\nc\nB\n')
      repo.git(['reset', '-q'])

      // Discard "-c/+c" while keeping "-b/+B".
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [2, 4] }], 'discard')!, 'discard')
      expect(repo.read('n.txt')).toBe('a\nc\nB\n')
    })

    it('new side lacks a newline (stage / discard / unstage)', () => {
      const repo = new Repo()
      repo.write('n.txt', 'x\ny\n')
      repo.commitAll()
      repo.write('n.txt', 'x\nY\nz')
      const diff = fd('n.txt', [h('@@ -1,2 +1,3 @@', [' x', '-y', '+Y', '+z', '\\'])])
      expectFixtureMatches(repo, diff, ['--', 'n.txt'])

      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [3] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('x\ny\nz')
      repo.git(['reset', '-q'])

      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [1, 2] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('x\nY\n')

      // Now unstage that again from the staged diff (HEAD → index).
      const staged = fd('n.txt', [h('@@ -1,2 +1,2 @@', [' x', '-y', '+Y'])])
      expectFixtureMatches(repo, staged, ['--cached', '--', 'n.txt'])
      repo.apply(buildPartialPatch(staged, [{ hunkIndex: 0, lineIndexes: [2] }], 'unstage')!, 'unstage')
      expect(repo.index('n.txt')).toBe('x\n')

      // Discard the trailing "z" (without newline) from the worktree only.
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [3] }], 'discard')!, 'discard')
      expect(repo.read('n.txt')).toBe('x\nY\n')
    })

    it('both sides lack a newline and the last line changes', () => {
      const repo = new Repo()
      repo.write('n.txt', 'p\nq')
      repo.commitAll()
      repo.write('n.txt', 'p\nr')
      const diff = fd('n.txt', [h('@@ -1,2 +1,2 @@', [' p', '-q', '\\', '+r', '\\'])])
      expectFixtureMatches(repo, diff, ['--', 'n.txt'])

      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [2] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('p\nq\nr')
      repo.git(['reset', '-q'])
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [1] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('p\n')
      repo.git(['reset', '-q'])
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [2] }], 'discard')!, 'discard')
      expect(repo.read('n.txt')).toBe('p\n')
    })

    it('unchanged last line without newline', () => {
      const repo = new Repo()
      repo.write('n.txt', '1\n2\n3\n4\n5')
      repo.commitAll()
      repo.write('n.txt', '1\nTWO\n3\n4\nFIVE')
      // git merges both changes into a single hunk.
      const diff = fd('n.txt', [h('@@ -1,5 +1,5 @@', [' 1', '-2', '+TWO', ' 3', ' 4', '-5', '\\', '+FIVE', '\\'])])
      expectFixtureMatches(repo, diff, ['--', 'n.txt'])
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [1, 2] }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('1\nTWO\n3\n4\n5')
    })
  })

  it('unstages lines of a staged rename while keeping the rename', () => {
    const repo = new Repo()
    repo.write('old.txt', 'a\nb\nc\nd\ne\nf\n')
    repo.commitAll()
    repo.git(['mv', 'old.txt', 'new.txt'])
    repo.write('new.txt', 'a\nB\nc\nd\nE\nf\n')
    repo.git(['add', 'new.txt'])
    const diff = fd('new.txt', [h('@@ -1,6 +1,6 @@', [' a', '-b', '+B', ' c', ' d', '-e', '+E', ' f'])], {
      status: 'renamed',
      oldPath: 'old.txt'
    })
    expectFixtureMatches(repo, diff, ['--cached', '-M', '--', 'old.txt', 'new.txt'])
    repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [1, 2] }], 'unstage')!, 'unstage')
    expect(repo.index('new.txt')).toBe('a\nb\nc\nd\nE\nf\n')
    expect(repo.git(['diff', '--cached', '-M', '--name-status']).trim()).toMatch(/^R\d*\told\.txt\tnew\.txt$/)
  })

  it('stages lines of files whose paths need quoting', () => {
    const repo = new Repo()
    const names = ['with space.txt', 'quo"te.txt', 'tab\tname.txt', 'back\\slash.txt']
    for (const n of names) repo.write(n, 'one\ntwo\nthree\n')
    repo.commitAll()
    for (const n of names) {
      repo.write(n, 'one\nTWO\nthree\nfour\n')
      const diff = fd(n, [h('@@ -1,3 +1,4 @@', [' one', '-two', '+TWO', ' three', '+four'])])
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [4] }], 'stage')!, 'stage')
      expect(repo.index(n)).toBe('one\ntwo\nthree\nfour\n')
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [1, 2] }], 'discard')!, 'discard')
      expect(repo.read(n)).toBe('one\ntwo\nthree\nfour\n')
    }
  })

  describe('CRLF files', () => {
    const crlfText = (ls: string[]) => ls.map((l) => l + '\r\n').join('')

    it('stages, unstages and discards selected lines of a CRLF file', () => {
      const repo = new Repo()
      const base = lines(12)
      repo.write('w.txt', crlfText(base))
      repo.commitAll()
      const next = [...base]
      next[1] = 'LINE 2'
      next[9] = 'LINE 10'
      repo.write('w.txt', crlfText(next))
      const diff = fixtureFromGit(repo, ['--', 'w.txt'], 'w.txt')
      expect(diff.hunks.flatMap((hk) => hk.lines).every((l) => l.crlf && !l.content.endsWith('\r'))).toBe(true)
      expectFixtureMatches(repo, diff, ['--', 'w.txt'])

      // Stage only the second change ("line 10" → "LINE 10").
      const sel: HunkSelection[] = []
      diff.hunks.forEach((hk, hunkIndex) =>
        hk.lines.forEach((l, i) => {
          if (l.content.endsWith('10')) sel.push({ hunkIndex, lineIndexes: [i] })
        })
      )
      repo.apply(buildPartialPatch(diff, sel, 'stage')!, 'stage')
      const staged = [...base]
      staged[9] = 'LINE 10'
      expect(repo.index('w.txt')).toBe(crlfText(staged))

      // Unstage it again from the staged diff (its "-line 10" / "+LINE 10" pair).
      const cached = fixtureFromGit(repo, ['--cached', '--', 'w.txt'], 'w.txt')
      const pair = cached.hunks[0].lines.map((l, i) => (l.type !== 'context' ? i : -1)).filter((i) => i >= 0)
      expect(pair).toHaveLength(2)
      repo.apply(buildPartialPatch(cached, [{ hunkIndex: 0, lineIndexes: pair }], 'unstage')!, 'unstage')
      expect(repo.index('w.txt')).toBe(crlfText(base))

      // Discard the first change from the working tree, keep the second.
      const wt = fixtureFromGit(repo, ['--', 'w.txt'], 'w.txt')
      const first = wt.hunks[0].lines.map((l, i) => (l.content.endsWith(' 2') || l.content === 'LINE 2' ? i : -1)).filter((i) => i >= 0)
      repo.apply(buildPartialPatch(wt, [{ hunkIndex: 0, lineIndexes: first }], 'discard')!, 'discard')
      expect(repo.read('w.txt')).toBe(crlfText(staged))
    })

    it('stages a line-ending-only change and mixed endings without touching other lines', () => {
      const repo = new Repo()
      repo.write('m.txt', 'a\r\nb\r\nc\nd\r\n')
      repo.commitAll()
      repo.write('m.txt', 'a\r\nb\nc\nD\r\n')
      const diff = fixtureFromGit(repo, ['--', 'm.txt'], 'm.txt')
      expectFixtureMatches(repo, diff, ['--', 'm.txt'])
      const idx = (type: string, content: string) => diff.hunks[0].lines.findIndex((l) => l.type === type && l.content === content)
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: [idx('del', 'b'), idx('add', 'b')] }], 'stage')!, 'stage')
      expect(repo.index('m.txt')).toBe('a\r\nb\nc\nd\r\n')
      const rest = fixtureFromGit(repo, ['--', 'm.txt'], 'm.txt')
      repo.apply(buildPartialPatch(rest, [{ hunkIndex: 0 }], 'discard')!, 'discard')
      expect(repo.read('m.txt')).toBe('a\r\nb\nc\nd\r\n')
    })

    it('handles a CRLF file without a final newline', () => {
      const repo = new Repo()
      repo.write('n.txt', 'x\r\ny\r\nz\r')
      repo.commitAll()
      repo.write('n.txt', 'x\r\nY\r\nz\r\nw\r')
      const diff = fixtureFromGit(repo, ['--', 'n.txt'], 'n.txt')
      expectFixtureMatches(repo, diff, ['--', 'n.txt'])
      // git shows "-y -z +Y +z +w" (z gains a newline). Stage everything but the appended "w".
      const all = diff.hunks[0].lines
      const pick = all.map((l, i) => (l.type !== 'context' && !(l.type === 'add' && l.content === 'w') ? i : -1)).filter((i) => i >= 0)
      expect(all.find((l) => l.type === 'del' && l.content === 'z')).toMatchObject({ crlf: true, noNewline: true })
      repo.apply(buildPartialPatch(diff, [{ hunkIndex: 0, lineIndexes: pick }], 'stage')!, 'stage')
      expect(repo.index('n.txt')).toBe('x\r\nY\r\nz\r\n')
      // And discard only the appended "w" from the working tree.
      const rest = fixtureFromGit(repo, ['--', 'n.txt'], 'n.txt')
      repo.apply(buildPartialPatch(rest, [{ hunkIndex: 0 }], 'discard')!, 'discard')
      expect(repo.read('n.txt')).toBe('x\r\nY\r\nz\r\n')
    })
  })

  it('stages one change block picked on a full-file diff (remapped onto a -U3 diff)', () => {
    const repo = new Repo()
    repo.write('f.txt', text(base))
    repo.commitAll()
    repo.write('f.txt', text(changed))
    const display = fixtureFromGit(repo, ['-U1000000', '--', 'f.txt'], 'f.txt')
    expect(display.hunks).toHaveLength(1)
    // The block "+new A / +new B": consecutive changed lines of the single hunk.
    const lines0 = display.hunks[0].lines
    const start = lines0.findIndex((l) => l.content === 'new A')
    let end = start
    while (end + 1 < lines0.length && lines0[end + 1].type !== 'context') end++
    const block: HunkSelection = { hunkIndex: 0, lineIndexes: Array.from({ length: end - start + 1 }, (_, k) => start + k) }
    const mapped = remapSelection(display, [block], multi('f.txt'))
    expect(mapped.complete).toBe(true)
    repo.apply(buildPartialPatch(multi('f.txt'), mapped.selection, 'stage')!, 'stage')
    expect(repo.index('f.txt')).toBe(text([...base.slice(0, 12), 'new A', 'new B', ...base.slice(12)]))
    // Discarding the block "-line 22" from the full-file view leaves everything else in place.
    const full2 = fixtureFromGit(repo, ['-U1000000', '--', 'f.txt'], 'f.txt')
    const i22 = full2.hunks[0].lines.findIndex((l) => l.type === 'del' && l.content === 'line 22')
    const fresh = fixtureFromGit(repo, ['--', 'f.txt'], 'f.txt')
    const m2 = remapSelection(full2, [{ hunkIndex: 0, lineIndexes: [i22] }], fresh)
    expect(m2.complete).toBe(true)
    repo.apply(buildPartialPatch(fresh, m2.selection, 'discard')!, 'discard')
    const expected = [...changed]
    expected.splice(23, 0, 'line 22')
    expect(repo.read('f.txt')).toBe(text(expected))
  })

  it('applies a patch remapped from a zero-context diff onto a full-context diff', () => {
    const repo = new Repo()
    repo.write('f.txt', text(base))
    repo.commitAll()
    repo.write('f.txt', text(changed))
    const display = fixtureFromGit(repo, ['-U0', '--', 'f.txt'], 'f.txt')
    const applyDiff = multi('f.txt')
    // Select "+new B" and "-line 30" on the zero-context display.
    const sel: HunkSelection[] = []
    display.hunks.forEach((hk, hunkIndex) =>
      hk.lines.forEach((l, i) => {
        if ((l.type === 'add' && l.content === 'new B') || (l.type === 'del' && l.content === 'line 30'))
          sel.push({ hunkIndex, lineIndexes: [i] })
      })
    )
    const mapped = remapSelection(display, sel, applyDiff)
    expect(mapped.complete).toBe(true)
    repo.apply(buildPartialPatch(applyDiff, mapped.selection, 'stage')!, 'stage')
    expect(repo.index('f.txt')).toBe(text([...base.slice(0, 12), 'new B', ...base.slice(12, 29)]))
  })
})

/**
 * Test-only: turn `git diff` output of a single file into a FileDiff through the
 * same compact fixture notation (used where the expected diff depends on earlier
 * steps). Only handles plain text modifications.
 */
function fixtureFromGit(repo: Repo, args: string[], path: string): FileDiff {
  const out = repo.git(['diff', '--no-color', '--no-ext-diff', '-U3', ...args])
  const hunks: DiffHunk[] = []
  let header: string | null = null
  let rows: string[] = []
  const flush = () => {
    if (header) hunks.push(h(header, rows))
  }
  for (const line of out.split('\n')) {
    if (line.startsWith('@@')) {
      flush()
      header = line
      rows = []
    } else if (header !== null) {
      if (line.startsWith('\\')) rows.push('\\')
      else if (line[0] === ' ' || line[0] === '+' || line[0] === '-') rows.push(line)
    }
  }
  flush()
  return fd(path, hunks)
}
