import { describe, expect, it } from 'vitest'
import type { Commit, RebaseTodoItem } from '@shared/types'
import {
  kindFromStages,
  kindFromXY,
  looksBinary,
  mergeSourceFromMessage,
  mergeSourceUrl,
  parseUnmergedEntries,
  unmergedXY
} from '../conflictParse'
import { appendIgnorePattern, normalizeIgnorePattern } from '../gitignore'
import { LOG_FORMAT, parseLog } from '../log'
import { buildTodo, messagesNeeded, resolveTodo } from '../rebaseTodo'
import { arg, isInside, nameArg, repoPaths, shellQuote, splitRemoteRef } from '../util'
import { parseApplyNumstatZ } from '../worktree'

const sha = (c: string) => c.repeat(40)

function commit(c: string, subject: string): Commit {
  return {
    sha: sha(c),
    shortSha: sha(c).slice(0, 7),
    parents: [],
    authorName: 'A',
    authorEmail: 'a@x',
    authorDate: 0,
    committerName: 'A',
    committerEmail: 'a@x',
    committerDate: 0,
    subject,
    body: ''
  }
}

const COMMITS = [commit('a', 'First'), commit('b', 'Second'), commit('c', 'Third'), commit('d', 'Fourth')]
const item = (action: RebaseTodoItem['action'], c: string, message?: string): RebaseTodoItem => ({
  action,
  sha: sha(c),
  subject: 'ignored',
  message
})

describe('parseApplyNumstatZ', () => {
  it('lists every path, binary entries and rename triples included, without duplicates', () => {
    expect(parseApplyNumstatZ('1\t1\tnew name.txt\x001\t0\tplain.txt\x00-\t-\timg.png\x00')).toEqual(['new name.txt', 'plain.txt', 'img.png'])
    expect(parseApplyNumstatZ('3\t1\t\x00a/old\x00b/new\x002\t2\tb/new\x00')).toEqual(['a/old', 'b/new'])
    expect(parseApplyNumstatZ('1\t0\twith\ttab\nand newline\x00')).toEqual(['with\ttab\nand newline'])
    expect(parseApplyNumstatZ('')).toEqual([])
  })
})

describe('appendIgnorePattern', () => {
  it('creates content for a missing file', () => {
    expect(appendIgnorePattern(null, '*.log')).toBe('*.log\n')
  })
  it('appends on a new line when the file lacks a trailing newline', () => {
    expect(appendIgnorePattern('node_modules', '*.log')).toBe('node_modules\n*.log\n')
    expect(appendIgnorePattern('node_modules\n', '*.log')).toBe('node_modules\n*.log\n')
  })
  it('skips exact duplicates', () => {
    expect(appendIgnorePattern('a\n*.log\nb\n', '*.log')).toBeNull()
    expect(appendIgnorePattern('a\r\n*.log\r\n', '*.log')).toBeNull()
  })
  it('does not treat a substring as a duplicate', () => {
    expect(appendIgnorePattern('*.logs\n', '*.log')).toBe('*.logs\n*.log\n')
  })
  it('keeps CRLF line endings', () => {
    expect(appendIgnorePattern('a\r\nb', 'c')).toBe('a\r\nb\r\nc\r\n')
  })
  it('normalises patterns', () => {
    expect(normalizeIgnorePattern('  dist/  ')).toBe('dist/')
    expect(normalizeIgnorePattern('')).toBeNull()
    expect(normalizeIgnorePattern('a\nb')).toBeNull()
    expect(normalizeIgnorePattern(42)).toBeNull()
  })
})

describe('argument validation', () => {
  it('rejects option-looking and empty values', () => {
    expect(() => arg('--upload-pack=x', 'ref')).toThrow(/must not start/)
    expect(() => arg('', 'ref')).toThrow(/Missing/)
    expect(() => arg('a\nb', 'ref')).toThrow(/control/)
    expect(arg('feature/x', 'ref')).toBe('feature/x')
  })
  it('rejects whitespace in names', () => {
    expect(() => nameArg('a b', 'branch name')).toThrow(/spaces/)
  })
  it('rejects paths outside the repo', () => {
    expect(() => repoPaths('/repo', ['../x'])).toThrow(/outside/)
    expect(() => repoPaths('/repo', ['/etc/passwd'])).toThrow(/outside/)
    expect(repoPaths('/repo', ['a', 'a', 'b/../c'])).toEqual(['a', 'b/../c'])
    expect(isInside('/repo', '/repo/a/b')).toBe(true)
    expect(isInside('/repo', '/repository')).toBe(false)
    expect(isInside('/repo', '/repo/..hidden')).toBe(true)
    expect(isInside('/repo', '/')).toBe(false)
    expect(repoPaths('/repo', ['..hidden'])).toEqual(['..hidden'])
  })
  it('splits remote refs using the longest remote name', () => {
    expect(splitRemoteRef('origin/feature/x', ['origin', 'up'])).toEqual({ remote: 'origin', branch: 'feature/x' })
    expect(splitRemoteRef('team/a/main', ['team', 'team/a'])).toEqual({ remote: 'team/a', branch: 'main' })
    expect(splitRemoteRef('nope/main', ['origin'])).toBeNull()
  })
  it('shell-quotes paths', () => {
    expect(shellQuote('/tmp/a b')).toBe(`'/tmp/a b'`)
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
  })
})

describe('parseLog', () => {
  it('parses NUL separated records', () => {
    const rec = (h: string, p: string, s: string, b: string) =>
      [h, h.slice(0, 7), p, 'Ann', 'ann@x', '100', 'Cid', 'cid@x', '200', s, b].join('\0')
    const out = `${rec(sha('a'), '', 'Root', '')}\0${rec(sha('b'), sha('a'), 'Child', 'Body line\n\nMore\n')}\0`
    const commits = parseLog(out)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({ sha: sha('a'), parents: [], subject: 'Root', body: '', authorDate: 100, committerDate: 200 })
    expect(commits[1]).toMatchObject({ parents: [sha('a')], subject: 'Child', body: 'Body line\n\nMore' })
    expect(LOG_FORMAT.split('%x00')).toHaveLength(11)
  })
})

describe('conflict parsing', () => {
  it('maps XY codes and stages', () => {
    expect(kindFromXY('UU')).toBe('both-modified')
    expect(kindFromXY('DU')).toBe('deleted-by-us')
    expect(kindFromXY('UD')).toBe('deleted-by-them')
    expect(kindFromXY('M.')).toBeNull()
    expect(kindFromStages(new Set([1, 2, 3]))).toBe('both-modified')
    expect(kindFromStages(new Set([2, 3]))).toBe('both-added')
    expect(kindFromStages(new Set([1, 2]))).toBe('deleted-by-them')
    expect(kindFromStages(new Set([1, 3]))).toBe('deleted-by-us')
    expect(kindFromStages(new Set([1]))).toBe('both-deleted')
    expect(kindFromStages(new Set([3]))).toBe('added-by-them')
  })
  it('parses ls-files -u and status v2 records with spaces in paths', () => {
    const ls = `100644 ${sha('a')} 1\tdir/my file.txt\x00100644 ${sha('b')} 2\tdir/my file.txt\0`
    expect(parseUnmergedEntries(ls)).toEqual([
      { mode: '100644', sha: sha('a'), stage: 1, path: 'dir/my file.txt' },
      { mode: '100644', sha: sha('b'), stage: 2, path: 'dir/my file.txt' }
    ])
    const st = `1 .M N... 100644 100644 100644 ${sha('a')} ${sha('a')} other\x00u AA N... 000000 100644 100644 100644 ${sha('0')} ${sha('b')} ${sha('c')} dir/my file.txt\0`
    expect(unmergedXY(st, 'dir/my file.txt')).toBe('AA')
    expect(unmergedXY(st, 'other')).toBeNull()
  })
  it('extracts the merged branch from MERGE_MSG', () => {
    expect(mergeSourceFromMessage("Merge branch 'feature/x'\n\n# Conflicts:\n")).toBe('feature/x')
    expect(mergeSourceFromMessage("Merge branch 'x' of github.com:a/b into main")).toBe('x')
    expect(mergeSourceFromMessage("Merge remote-tracking branch 'origin/main'")).toBe('origin/main')
    expect(mergeSourceFromMessage("Merge tag 'v1.0'")).toBe('v1.0')
    expect(mergeSourceFromMessage(`Merge commit '${sha('e')}'`)).toBe('eeeeeee')
    expect(mergeSourceFromMessage('Custom message')).toBeNull()
    expect(mergeSourceUrl("Merge branch 'main' of /tmp/origin.git")).toBe('/tmp/origin.git')
    expect(mergeSourceUrl("Merge branch 'main' of github.com:a/b into feature")).toBe('github.com:a/b')
    expect(mergeSourceUrl("Merge branch 'main'")).toBeNull()
  })
  it('detects binary buffers', () => {
    expect(looksBinary(Buffer.from('text'))).toBe(false)
    expect(looksBinary(Buffer.from([1, 0, 2]))).toBe(true)
    expect(looksBinary(null)).toBe(false)
  })
})

describe('resolveTodo', () => {
  const all = (actions: Array<RebaseTodoItem['action']>) => COMMITS.map((c, i) => item(actions[i], c.sha[0]))

  it('resolves short shas and uses trusted subjects', () => {
    const todo = COMMITS.map((c) => ({ action: 'pick' as const, sha: c.sha.slice(0, 8), subject: 'evil\nexec rm -rf /' }))
    const out = resolveTodo(todo, COMMITS)
    expect(out.map((i) => i.sha)).toEqual(COMMITS.map((c) => c.sha))
    expect(out[0].subject).toBe('First')
  })
  it('rejects unknown, duplicated and missing commits', () => {
    expect(() => resolveTodo([...all(['pick', 'pick', 'pick', 'pick']), item('pick', 'e')], COMMITS)).toThrow(/not one of/)
    expect(() => resolveTodo([item('pick', 'a'), item('pick', 'a'), item('pick', 'b'), item('pick', 'c')], COMMITS)).toThrow(/more than once/)
    expect(() => resolveTodo([item('pick', 'a'), item('pick', 'b')], COMMITS)).toThrow(/out of date/)
    expect(() => resolveTodo([], COMMITS)).toThrow(/empty/)
  })
  it('rejects invalid actions', () => {
    const todo = all(['pick', 'pick', 'pick', 'pick'])
    ;(todo[1] as { action: string }).action = 'exec'
    expect(() => resolveTodo(todo, COMMITS)).toThrow(/Invalid rebase action/)
  })
  it('rejects a squash/fixup with nothing before it', () => {
    expect(() => resolveTodo(all(['squash', 'pick', 'pick', 'pick']), COMMITS)).toThrow(/no earlier commit/)
    expect(() => resolveTodo(all(['drop', 'fixup', 'pick', 'pick']), COMMITS)).toThrow(/no earlier commit/)
    expect(() => resolveTodo(all(['drop', 'pick', 'fixup', 'squash']), COMMITS)).not.toThrow()
  })
  it('allows dropping everything', () => {
    expect(resolveTodo(all(['drop', 'drop', 'drop', 'drop']), COMMITS)).toHaveLength(4)
  })
})

describe('buildTodo', () => {
  const lines = (steps: ReturnType<typeof buildTodo>) => steps.map((s) => (s.kind === 'line' ? s.text : `AMEND ${JSON.stringify(s.message)}`))
  const full = new Map([
    [sha('a'), 'First\n\nBody A\n'],
    [sha('b'), 'Second\n'],
    [sha('c'), 'Third\n\nBody C\n'],
    [sha('d'), 'Fourth\n']
  ])

  it('emits pick/edit/drop lines with subjects', () => {
    const items = resolveTodo([item('pick', 'b'), item('edit', 'a'), item('drop', 'c'), item('pick', 'd')], COMMITS)
    expect(lines(buildTodo(items, full))).toEqual([
      `pick ${sha('b')} Second`,
      `edit ${sha('a')} First`,
      `drop ${sha('c')} Third`,
      `pick ${sha('d')} Fourth`
    ])
  })

  it('turns reword into pick + amend', () => {
    const items = resolveTodo([item('reword', 'a', 'New A\n\nBody'), item('pick', 'b'), item('pick', 'c'), item('pick', 'd')], COMMITS)
    expect(lines(buildTodo(items, full)).slice(0, 2)).toEqual([`pick ${sha('a')} First`, 'AMEND "New A\\n\\nBody"'])
  })

  it('ignores reword without a message', () => {
    const items = resolveTodo([item('reword', 'a', '  '), item('pick', 'b'), item('pick', 'c'), item('pick', 'd')], COMMITS)
    expect(buildTodo(items, full).filter((s) => s.kind === 'amend')).toHaveLength(0)
  })

  it('combines squash messages when none is provided', () => {
    const items = resolveTodo([item('pick', 'a'), item('squash', 'b'), item('fixup', 'c'), item('pick', 'd')], COMMITS)
    expect(messagesNeeded(items)).toEqual([sha('a'), sha('b')])
    expect(lines(buildTodo(items, full))).toEqual([
      `pick ${sha('a')} First`,
      `fixup ${sha('b')} Second`,
      `fixup ${sha('c')} Third`,
      'AMEND "First\\n\\nBody A\\n\\nSecond\\n"',
      `pick ${sha('d')} Fourth`
    ])
  })

  it('uses the reword message as the base of a combined message', () => {
    const items = resolveTodo([item('reword', 'a', 'Renamed'), item('squash', 'b'), item('pick', 'c'), item('pick', 'd')], COMMITS)
    expect(messagesNeeded(items)).toEqual([sha('b')])
    const amend = buildTodo(items, full).find((s) => s.kind === 'amend')
    expect(amend).toEqual({ kind: 'amend', message: 'Renamed\n\nSecond\n' })
  })

  it('uses the last provided squash message', () => {
    const items = resolveTodo(
      [item('pick', 'a'), item('squash', 'b', 'Msg B'), item('squash', 'c', 'Msg C'), item('pick', 'd')],
      COMMITS
    )
    expect(messagesNeeded(items)).toEqual([])
    const amends = buildTodo(items, full).filter((s) => s.kind === 'amend')
    expect(amends).toEqual([{ kind: 'amend', message: 'Msg C' }])
  })

  it('keeps the base message for fixup-only runs', () => {
    const items = resolveTodo([item('pick', 'a'), item('fixup', 'b'), item('drop', 'c'), item('fixup', 'd')], COMMITS)
    expect(lines(buildTodo(items, full))).toEqual([
      `pick ${sha('a')} First`,
      `fixup ${sha('b')} Second`,
      `drop ${sha('c')} Third`,
      `fixup ${sha('d')} Fourth`
    ])
  })

  it('applies a reword message after a fixup run', () => {
    const items = resolveTodo([item('reword', 'a', 'R'), item('fixup', 'b'), item('pick', 'c'), item('pick', 'd')], COMMITS)
    expect(lines(buildTodo(items, full)).slice(0, 3)).toEqual([`pick ${sha('a')} First`, `fixup ${sha('b')} Second`, 'AMEND "R"'])
  })
})
