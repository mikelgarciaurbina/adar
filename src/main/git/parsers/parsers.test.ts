import { describe, expect, it } from 'vitest'
import { parseBlamePorcelain } from './blame'
import { coalesceTypeChanges, parseGitHeaderPaths, parseUnifiedDiff, type DiffLineWithEol } from './diff'
import { mergeFileChanges, parseNameStatusZ, parseNumstatZ, totals } from './files'
import { LOG_FORMAT, parseLog } from './log'
import {
  FOR_EACH_REF_FORMAT,
  buildSubmodules,
  parseForEachRef,
  parseGitmodulesConfig,
  parseRemotesVerbose,
  parseStashBranch,
  parseStashList,
  parseSubmoduleStatus,
  parseTrack,
  remoteOf,
  sortBranches
} from './refs'
import { parseStatusV2 } from './status'
import { isImagePath, looksBinary, readPathToken, unquoteGitPath } from './util'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)

// ── util ────────────────────────────────────────────────────────────────────

describe('util', () => {
  it('unquotes C-quoted git paths (escapes + octal UTF-8 bytes)', () => {
    expect(unquoteGitPath('plain.txt')).toBe('plain.txt')
    expect(unquoteGitPath('"tab\\there.txt"')).toBe('tab\there.txt')
    expect(unquoteGitPath('"quote\\"d\\\\x"')).toBe('quote"d\\x')
    expect(unquoteGitPath('"t\\303\\251st.txt"')).toBe('tést.txt')
  })

  it('reads quoted and unquoted path tokens', () => {
    expect(readPathToken('"a/x y" "b/z"', 0)).toEqual({ value: 'a/x y', end: 7 })
    expect(readPathToken('a/x b/y', 0)).toEqual({ value: 'a/x', end: 3 })
  })

  it('detects images and binary buffers', () => {
    expect(isImagePath('assets/logo.PNG')).toBe(true)
    expect(isImagePath('icon.svg')).toBe(true)
    expect(isImagePath('a.avif')).toBe(true)
    expect(isImagePath('readme.md')).toBe(false)
    expect(isImagePath('.png')).toBe(false)
    expect(isImagePath('png')).toBe(false)
    expect(looksBinary(Buffer.from('hello'))).toBe(false)
    expect(looksBinary(Buffer.from([1, 2, 0, 3]))).toBe(true)
    const late = Buffer.alloc(9000, 65)
    late[8500] = 0
    expect(looksBinary(late)).toBe(false)
  })
})

// ── log ─────────────────────────────────────────────────────────────────────

function logRecord(f: string[]): string {
  return f.join('\0') + '\x1e\n'
}

describe('parseLog', () => {
  it('uses NUL separators and RS terminators', () => {
    expect(LOG_FORMAT).toBe('%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%b%x1e')
  })

  it('parses commits with multiline bodies, merges and root commits', () => {
    const out =
      logRecord([SHA_A, 'aaaaaaa', `${SHA_B} ${SHA_C}`, 'Ann', 'ann@x.io', '1700000000', 'Cid', 'cid@x.io', '1700000100', 'Merge branch x', 'Line one\n\nLine three\n']) +
      logRecord([SHA_B, 'bbbbbbb', SHA_C, 'Bob', 'bob@x.io', '1690000000', 'Bob', 'bob@x.io', '1690000000', 'Fix: thing', '']) +
      logRecord([SHA_C, 'ccccccc', '', 'Cid', 'cid@x.io', '1680000000', 'Cid', 'cid@x.io', '1680000000', 'Initial', 'Body with\ttab\n\n'])
    const commits = parseLog(out)
    expect(commits).toHaveLength(3)
    expect(commits[0]).toEqual({
      sha: SHA_A,
      shortSha: 'aaaaaaa',
      parents: [SHA_B, SHA_C],
      authorName: 'Ann',
      authorEmail: 'ann@x.io',
      authorDate: 1700000000,
      committerName: 'Cid',
      committerEmail: 'cid@x.io',
      committerDate: 1700000100,
      subject: 'Merge branch x',
      body: 'Line one\n\nLine three'
    })
    expect(commits[1].body).toBe('')
    expect(commits[1].parents).toEqual([SHA_C])
    expect(commits[2].parents).toEqual([])
    expect(commits[2].body).toBe('Body with\ttab')
  })

  it('ignores empty and malformed output', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog('garbage\x1e\n')).toEqual([])
  })
})

// ── numstat / name-status ──────────────────────────────────────────────────

describe('file listings', () => {
  it('parses -z numstat with renames and binaries', () => {
    const out = '3\t1\tsrc/a.ts\0-\t-\timg.png\0' + '2\t0\t\0old name.txt\0new name.txt\0'
    expect(parseNumstatZ(out)).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1, binary: false },
      { path: 'img.png', additions: 0, deletions: 0, binary: true },
      { path: 'new name.txt', oldPath: 'old name.txt', additions: 2, deletions: 0, binary: false }
    ])
  })

  it('parses -z name-status and merges with numstat', () => {
    const ns = 'M\0src/a.ts\0A\0img.png\0R087\0old name.txt\0new name.txt\0D\0gone.txt\0T\0link\0C100\0x\0y\0'
    const parsed = parseNameStatusZ(ns)
    expect(parsed.map((e) => e.status)).toEqual(['modified', 'added', 'renamed', 'deleted', 'typechange', 'copied'])
    const files = mergeFileChanges(parsed, parseNumstatZ('3\t1\tsrc/a.ts\0-\t-\timg.png\0' + '2\t0\t\0old name.txt\0new name.txt\0' + '0\t4\tgone.txt\0'))
    expect(files[0]).toEqual({ path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 })
    expect(files[1]).toEqual({ path: 'img.png', status: 'added', additions: 0, deletions: 0, binary: true })
    expect(files[2]).toEqual({ path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed', additions: 2, deletions: 0 })
    expect(files[3]).toMatchObject({ path: 'gone.txt', status: 'deleted', deletions: 4 })
    expect(totals(files)).toEqual({ additions: 5, deletions: 5 })
  })
})

// ── status v2 ──────────────────────────────────────────────────────────────

describe('parseStatusV2', () => {
  const entries = [
    '# branch.oid ' + SHA_A,
    '# branch.head feature/x',
    '# branch.upstream origin/feature/x',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 h1 h2 staged.txt',
    '1 .M N... 100644 100644 100644 h1 h1 unstaged file.txt',
    '1 MM N... 100644 100644 100644 h1 h2 both.txt',
    '1 A. N... 000000 100644 100644 0000000 h2 added.txt',
    '1 .D N... 100644 100644 000000 h1 h1 removed.txt',
    '1 .A N... 000000 000000 100644 0000000 0000000 intent.txt',
    '1 .T N... 100644 100644 120000 h1 h1 link',
    '2 R. N... 100644 100644 100644 h1 h1 R100 new name.txt',
    'old name.txt',
    '2 RM N... 100644 100644 100644 h1 h1 R90 moved.txt',
    'orig.txt',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt',
    'u AA N... 000000 100644 100644 100644 0 h2 h3 both added.txt',
    'u DU N... 100644 000000 100644 100644 h1 0 h3 du.txt',
    'u UD N... 100644 100644 000000 100644 h1 h2 0 ud.txt',
    'u DD N... 100644 000000 000000 000000 h1 0 0 dd.txt',
    'u AU N... 000000 100644 000000 100644 0 h2 0 au.txt',
    'u UA N... 000000 000000 100644 100644 0 0 h3 ua.txt',
    '? untracked dir/new file.txt'
  ]
  const status = parseStatusV2(entries.join('\0') + '\0')

  it('parses branch headers', () => {
    expect(status.branch).toBe('feature/x')
    expect(status.upstream).toBe('origin/feature/x')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(1)
  })

  it('splits staged and unstaged entries (a file may be in both)', () => {
    expect(status.staged).toEqual([
      { path: 'staged.txt', status: 'modified' },
      { path: 'both.txt', status: 'modified' },
      { path: 'added.txt', status: 'added' },
      { path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed' },
      { path: 'moved.txt', oldPath: 'orig.txt', status: 'renamed' }
    ])
    expect(status.unstaged).toEqual([
      { path: 'unstaged file.txt', status: 'modified' },
      { path: 'both.txt', status: 'modified' },
      { path: 'removed.txt', status: 'deleted' },
      { path: 'intent.txt', status: 'added' },
      { path: 'link', status: 'typechange' },
      { path: 'moved.txt', status: 'modified' },
      { path: 'untracked dir/new file.txt', status: 'untracked' }
    ])
  })

  it('puts unmerged paths only in conflicted[] with the right kind', () => {
    expect(status.conflicted).toEqual([
      { path: 'conflict.txt', kind: 'both-modified' },
      { path: 'both added.txt', kind: 'both-added' },
      { path: 'du.txt', kind: 'deleted-by-us' },
      { path: 'ud.txt', kind: 'deleted-by-them' },
      { path: 'dd.txt', kind: 'both-deleted' },
      { path: 'au.txt', kind: 'added-by-us' },
      { path: 'ua.txt', kind: 'added-by-them' }
    ])
    const all = [...status.staged, ...status.unstaged].map((f) => f.path)
    expect(all).not.toContain('conflict.txt')
  })

  it('handles detached HEAD and unborn branches', () => {
    expect(parseStatusV2('# branch.oid ' + SHA_A + '\0# branch.head (detached)\0').branch).toBeNull()
    const unborn = parseStatusV2('# branch.oid (initial)\0# branch.head main\0? a.txt\0')
    expect(unborn.branch).toBe('main')
    expect(unborn.unstaged).toEqual([{ path: 'a.txt', status: 'untracked' }])
    expect(unborn.upstream).toBeNull()
  })
})

// ── refs ───────────────────────────────────────────────────────────────────

function refRecord(f: string[]): string {
  return f.join('\0') + '\x1e\n'
}

describe('refs parsers', () => {
  it('builds the for-each-ref format with NUL fields and RS terminator', () => {
    expect(FOR_EACH_REF_FORMAT.split('%00')).toHaveLength(11)
    expect(FOR_EACH_REF_FORMAT.endsWith('%1e')).toBe(true)
  })

  it('parses upstream tracking info', () => {
    expect(parseTrack('[ahead 2, behind 1]')).toEqual({ ahead: 2, behind: 1, gone: false })
    expect(parseTrack('[ahead 3]')).toEqual({ ahead: 3, behind: 0, gone: false })
    expect(parseTrack('[behind 7]')).toEqual({ ahead: 0, behind: 7, gone: false })
    expect(parseTrack('[gone]')).toEqual({ ahead: 0, behind: 0, gone: true })
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
  })

  it('resolves remote names containing slashes', () => {
    expect(remoteOf('origin/main', ['origin'])).toBe('origin')
    expect(remoteOf('team/a/feature/x', ['team', 'team/a'])).toBe('team/a')
    expect(remoteOf('unknown/x', [])).toBe('unknown')
  })

  it('parses branches, remotes (incl. symbolic HEAD) and tags (annotated peeled)', () => {
    const out =
      refRecord(['refs/heads/main', 'main', SHA_A, '', 'commit', 'refs/remotes/origin/main', '[ahead 2, behind 1]', '*', '', 'subj', '']) +
      refRecord(['refs/heads/feature/old', 'feature/old', SHA_B, '', 'commit', 'refs/remotes/origin/feature/old', '[gone]', ' ', '', 's', '']) +
      refRecord(['refs/heads/local-only', 'local-only', SHA_C, '', 'commit', '', '', ' ', '', 's', '']) +
      refRecord(['refs/heads/tracks-local', 'tracks-local', SHA_C, '', 'commit', 'refs/heads/main', '[behind 3]', ' ', '', 's', '']) +
      refRecord(['refs/remotes/origin/HEAD', 'origin', SHA_A, '', 'commit', '', '', ' ', 'refs/remotes/origin/main', 's', '']) +
      refRecord(['refs/remotes/origin/main', 'origin/main', SHA_A, '', 'commit', '', '', ' ', '', 's', '']) +
      refRecord(['refs/remotes/team/a/dev', 'team/a/dev', SHA_B, '', 'commit', '', '', ' ', '', 's', '']) +
      refRecord(['refs/tags/v1.0.0', 'v1.0.0', 'd'.repeat(40), SHA_B, 'tag', '', '', ' ', '', 'Release 1.0', 'Notes line 1\nNotes line 2\n']) +
      refRecord(['refs/tags/light', 'light', SHA_C, '', 'commit', '', '', ' ', '', 'commit subject', 'commit body'])
    const refs = parseForEachRef(out, ['origin', 'team/a'])
    expect(refs.branches).toEqual([
      { name: 'main', fullName: 'refs/heads/main', type: 'branch', sha: SHA_A, isHead: true, upstream: 'origin/main', ahead: 2, behind: 1 },
      {
        name: 'feature/old',
        fullName: 'refs/heads/feature/old',
        type: 'branch',
        sha: SHA_B,
        isHead: false,
        upstream: 'origin/feature/old',
        ahead: 0,
        behind: 0,
        upstreamGone: true
      },
      { name: 'local-only', fullName: 'refs/heads/local-only', type: 'branch', sha: SHA_C, isHead: false },
      { name: 'tracks-local', fullName: 'refs/heads/tracks-local', type: 'branch', sha: SHA_C, isHead: false, upstream: 'main', ahead: 0, behind: 3 }
    ])
    expect(refs.remotes).toEqual([
      { name: 'origin/HEAD', fullName: 'refs/remotes/origin/HEAD', type: 'remote', sha: SHA_A, remote: 'origin', isSymbolic: true },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', type: 'remote', sha: SHA_A, remote: 'origin' },
      { name: 'team/a/dev', fullName: 'refs/remotes/team/a/dev', type: 'remote', sha: SHA_B, remote: 'team/a' }
    ])
    expect(refs.tags).toEqual([
      { name: 'v1.0.0', fullName: 'refs/tags/v1.0.0', type: 'tag', sha: SHA_B, annotated: true, tagMessage: 'Release 1.0\n\nNotes line 1\nNotes line 2' },
      { name: 'light', fullName: 'refs/tags/light', type: 'tag', sha: SHA_C, annotated: false }
    ])
  })

  it('sorts branches HEAD first then naturally by name', () => {
    const mk = (name: string, isHead = false) => ({ name, fullName: `refs/heads/${name}`, type: 'branch' as const, sha: SHA_A, isHead })
    expect(sortBranches([mk('b'), mk('feature-10'), mk('zeta', true), mk('feature-9'), mk('A')]).map((b) => b.name)).toEqual([
      'zeta',
      'A',
      'b',
      'feature-9',
      'feature-10'
    ])
  })

  it('parses stash list', () => {
    const out =
      [SHA_A, 'stash@{0}', `${SHA_B} ${SHA_C} ${'d'.repeat(40)}`, '1700000000', 'WIP on main: 1234567 Something'].join('\0') +
      '\n' +
      [SHA_B, 'stash@{1}', `${SHA_C} ${SHA_A}`, '1690000000', 'On feature/x: my message'].join('\0') +
      '\n' +
      [SHA_C, 'stash@{2}', `${SHA_A} ${SHA_B}`, '1680000000', 'WIP on (no branch): abc detached'].join('\0') +
      '\n'
    const stashes = parseStashList(out)
    expect(stashes).toEqual([
      { index: 0, ref: 'stash@{0}', sha: SHA_A, baseSha: SHA_B, message: 'WIP on main: 1234567 Something', branch: 'main', date: 1700000000 },
      { index: 1, ref: 'stash@{1}', sha: SHA_B, baseSha: SHA_C, message: 'On feature/x: my message', branch: 'feature/x', date: 1690000000 },
      { index: 2, ref: 'stash@{2}', sha: SHA_C, baseSha: SHA_A, message: 'WIP on (no branch): abc detached', date: 1680000000 }
    ])
    expect(parseStashBranch('custom message')).toBeUndefined()
  })

  it('parses remotes, submodule status and .gitmodules', () => {
    const remotes = parseRemotesVerbose(
      'origin\tgit@github.com:me/repo.git (fetch)\norigin\tgit@github.com:me/repo.git (push)\nup\thttps://x/y.git (fetch)\nup\tno_push (push)\n'
    )
    expect(remotes).toEqual([
      { name: 'origin', fetchUrl: 'git@github.com:me/repo.git', pushUrl: 'git@github.com:me/repo.git' },
      { name: 'up', fetchUrl: 'https://x/y.git', pushUrl: 'no_push' }
    ])
    const st = parseSubmoduleStatus(
      ` ${SHA_A} libs/one (v1.0)\n-${SHA_B} libs/two\n+${SHA_C} libs/with space (heads/main)\nU${'0'.repeat(40)} libs/conf\n`
    )
    expect(st).toEqual([
      { path: 'libs/one', sha: SHA_A, status: 'initialized' },
      { path: 'libs/two', sha: SHA_B, status: 'uninitialized' },
      { path: 'libs/with space', sha: SHA_C, status: 'modified' },
      { path: 'libs/conf', sha: null, status: 'conflict' }
    ])
    const urls = parseGitmodulesConfig(
      'submodule.one.path\nlibs/one\0submodule.one.url\nhttps://h/one.git\0submodule.weird.name.path\nlibs/two\0submodule.weird.name.url\n../two\0'
    )
    expect([...urls.entries()]).toEqual([
      ['libs/one', 'https://h/one.git'],
      ['libs/two', '../two']
    ])
    const subs = buildSubmodules(st.slice(0, 2), urls)
    expect(subs).toEqual([
      { path: 'libs/one', url: 'https://h/one.git', sha: SHA_A, status: 'initialized' },
      { path: 'libs/two', url: '../two', sha: SHA_B, status: 'uninitialized' }
    ])
    expect(buildSubmodules([], urls, true)).toHaveLength(2)
  })
})

// ── blame ──────────────────────────────────────────────────────────────────

describe('parseBlamePorcelain', () => {
  it('parses headers, repeated commits and content', () => {
    const out = [
      `${SHA_A} 1 1 2`,
      'author Ann Author',
      'author-mail <ann@x.io>',
      'author-time 1700000000',
      'author-tz +0100',
      'committer Ann Author',
      'committer-mail <ann@x.io>',
      'committer-time 1700000000',
      'committer-tz +0100',
      'summary First commit',
      'boundary',
      'filename file.txt',
      '\tline one',
      `${SHA_A} 2 2`,
      '\tline two\r',
      `${SHA_B} 5 3 1`,
      'author Bob',
      'author-mail <bob@x.io>',
      'author-time 1710000000',
      'author-tz +0000',
      'committer Bob',
      'committer-mail <bob@x.io>',
      'committer-time 1710000000',
      'committer-tz +0000',
      'summary Second',
      `previous ${SHA_A} file.txt`,
      'filename file.txt',
      '\t\tindented with tab',
      `${SHA_A} 3 4 1`,
      'filename file.txt',
      '\t',
      ''
    ].join('\n')
    const lines = parseBlamePorcelain(out)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toEqual({
      lineNo: 1,
      content: 'line one',
      sha: SHA_A,
      authorName: 'Ann Author',
      authorEmail: 'ann@x.io',
      authorDate: 1700000000,
      summary: 'First commit',
      origLineNo: 1
    })
    expect(lines[1]).toMatchObject({ lineNo: 2, content: 'line two', sha: SHA_A, authorName: 'Ann Author', origLineNo: 2 })
    expect(lines[2]).toMatchObject({ lineNo: 3, content: '\tindented with tab', sha: SHA_B, authorEmail: 'bob@x.io', summary: 'Second', origLineNo: 5 })
    expect(lines[3]).toMatchObject({ lineNo: 4, content: '', sha: SHA_A, summary: 'First commit', origLineNo: 3 })
  })
})

// ── diff ───────────────────────────────────────────────────────────────────

describe('parseUnifiedDiff', () => {
  it('parses a modification with multiple hunks and omitted counts', () => {
    const text = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,4 @@ function main() {',
      ' one',
      '-two',
      '+TWO',
      '+extra',
      ' three',
      '@@ -10 +11 @@',
      '-ten',
      '+TEN',
      ''
    ].join('\n')
    const [d] = parseUnifiedDiff(text)
    expect(d.path).toBe('src/app.ts')
    expect(d.status).toBe('modified')
    expect(d.binary).toBe(false)
    expect(d.isImage).toBe(false)
    expect(d.additions).toBe(3)
    expect(d.deletions).toBe(2)
    expect(d.hunks).toHaveLength(2)
    expect(d.hunks[0]).toMatchObject({ header: '@@ -1,3 +1,4 @@ function main() {', oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 })
    expect(d.hunks[0].lines).toEqual([
      { type: 'context', content: 'one', oldLine: 1, newLine: 1 },
      { type: 'del', content: 'two', oldLine: 2, newLine: null },
      { type: 'add', content: 'TWO', oldLine: null, newLine: 2 },
      { type: 'add', content: 'extra', oldLine: null, newLine: 3 },
      { type: 'context', content: 'three', oldLine: 3, newLine: 4 }
    ])
    expect(d.hunks[1]).toMatchObject({ oldStart: 10, oldLines: 1, newStart: 11, newLines: 1 })
    expect(d.hunks[1].lines.map((l) => [l.type, l.oldLine, l.newLine])).toEqual([
      ['del', 10, null],
      ['add', null, 11]
    ])
  })

  it('parses renames with spaces (trailing TAB on ---/+++)', () => {
    const text = [
      'diff --git a/old name.txt b/new name.txt',
      'similarity index 80%',
      'rename from old name.txt',
      'rename to new name.txt',
      'index 1111111..2222222 100644',
      '--- a/old name.txt\t',
      '+++ b/new name.txt\t',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+c'
    ].join('\n')
    const [d] = parseUnifiedDiff(text)
    expect(d).toMatchObject({ path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed', additions: 1, deletions: 1 })
  })

  it('parses a pure rename without hunks', () => {
    const [d] = parseUnifiedDiff('diff --git a/a.txt b/b.txt\nsimilarity index 100%\nrename from a.txt\nrename to b.txt\n')
    expect(d).toMatchObject({ path: 'b.txt', oldPath: 'a.txt', status: 'renamed', hunks: [] })
  })

  it('flags binary files and images', () => {
    const [d] = parseUnifiedDiff('diff --git a/img.png b/img.png\nindex 1111111..2222222 100644\nBinary files a/img.png and b/img.png differ\n')
    expect(d).toMatchObject({ path: 'img.png', binary: true, isImage: true, status: 'modified', hunks: [] })
    const [n] = parseUnifiedDiff('diff --git a/bin.dat b/bin.dat\nnew file mode 100644\nindex 0000000..2222222\nBinary files /dev/null and b/bin.dat differ\n')
    expect(n).toMatchObject({ path: 'bin.dat', binary: true, status: 'added', newMode: '100644' })
  })

  it('handles "\\ No newline at end of file" on both sides', () => {
    const text = [
      'diff --git a/f b/f',
      'index 1..2 100644',
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
      ''
    ].join('\n')
    const [d] = parseUnifiedDiff(text)
    const lines = d.hunks[0].lines
    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatchObject({ type: 'del', content: 'old', noNewline: true })
    expect(lines[2]).toMatchObject({ type: 'add', content: 'new', noNewline: true })
    expect(lines[0].noNewline).toBeUndefined()
  })

  it('parses mode-only changes as an empty diff with modes', () => {
    const [d] = parseUnifiedDiff('diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n')
    expect(d).toMatchObject({ path: 'script.sh', status: 'modified', oldMode: '100644', newMode: '100755', hunks: [], additions: 0, deletions: 0 })
  })

  it('parses new and deleted files', () => {
    const text = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..e69de29',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100755',
      'index e69de29..0000000',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
      'diff --git a/empty.txt b/empty.txt',
      'new file mode 100644',
      'index 0000000..e69de29',
      ''
    ].join('\n')
    const [n, g, e] = parseUnifiedDiff(text)
    expect(n).toMatchObject({ path: 'new.txt', status: 'added', newMode: '100644', additions: 2, deletions: 0 })
    expect(n.hunks[0].lines.map((l) => l.newLine)).toEqual([1, 2])
    expect(g).toMatchObject({ path: 'gone.txt', status: 'deleted', oldMode: '100755', additions: 0, deletions: 1 })
    expect(e).toMatchObject({ path: 'empty.txt', status: 'added', hunks: [] })
  })

  it('removes CR from content but records it (crlf)', () => {
    const text = ['diff --git a/w.txt b/w.txt', '--- a/w.txt', '+++ b/w.txt', '@@ -1,2 +1,2 @@', ' same\r', '-old\r', '+new\r', ''].join('\n')
    const [d] = parseUnifiedDiff(text)
    const lines = d.hunks[0].lines as DiffLineWithEol[]
    expect(lines.map((l) => l.content)).toEqual(['same', 'old', 'new'])
    expect(lines.every((l) => l.crlf === true)).toBe(true)
  })

  it('treats empty lines inside hunks as context (diff.suppressBlankEmpty) and lines starting with --- as content', () => {
    const text = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', 'a'.replace('a', ' a'), '', '--- not a header', '+++ neither', ''].join('\n')
    const [d] = parseUnifiedDiff(text)
    expect(d.hunks[0].lines.map((l) => [l.type, l.content])).toEqual([
      ['context', 'a'],
      ['context', ''],
      ['del', '-- not a header'],
      ['add', '++ neither']
    ])
  })

  it('decodes quoted paths in headers', () => {
    const text = ['diff --git "a/tab\\there.txt" "b/tab\\there.txt"', 'new file mode 100644', 'index 0000000..1111111', '--- /dev/null', '+++ "b/tab\\there.txt"', '@@ -0,0 +1 @@', '+x'].join('\n')
    const [d] = parseUnifiedDiff(text)
    expect(d.path).toBe('tab\there.txt')
    expect(parseGitHeaderPaths('a/with space.txt b/with space.txt')).toEqual({ old: 'with space.txt', new: 'with space.txt' })
    expect(parseGitHeaderPaths('a/x b/y')).toEqual({ old: 'x', new: 'y' })
  })

  it('parses combined diffs of unmerged paths', () => {
    const text = [
      'diff --cc conflict.txt',
      'index 1111111,2222222..0000000',
      '--- a/conflict.txt',
      '+++ b/conflict.txt',
      '@@@ -1,1 -1,1 +1,5 @@@',
      '++<<<<<<< HEAD',
      ' +ours',
      '++=======',
      '+ theirs',
      '++>>>>>>> feature',
      ''
    ].join('\n')
    const [d] = parseUnifiedDiff(text)
    expect(d.status).toBe('conflicted')
    expect(d.path).toBe('conflict.txt')
    expect(d.hunks[0].lines.map((l) => l.content)).toEqual(['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> feature'])
    expect(d.hunks[0].lines.every((l) => l.type === 'add')).toBe(true)
  })

  it('coalesces delete+add of the same path into a typechange', () => {
    const text = [
      'diff --git a/link b/link',
      'deleted file mode 100644',
      'index 1..0',
      '--- a/link',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-content',
      'diff --git a/link b/link',
      'new file mode 120000',
      'index 0..2',
      '--- /dev/null',
      '+++ b/link',
      '@@ -0,0 +1 @@',
      '+target',
      '\\ No newline at end of file'
    ].join('\n')
    const files = parseUnifiedDiff(text)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: 'link', status: 'typechange', oldMode: '100644', newMode: '120000', additions: 1, deletions: 1 })
    expect(files[0].hunks).toHaveLength(2)
    expect(coalesceTypeChanges([])).toEqual([])
  })

  it('countOnly keeps totals but no hunks', () => {
    const text = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', '-a', '-b', '+c', '+d', ''].join('\n')
    const [d] = parseUnifiedDiff(text, { countOnly: true })
    expect(d.hunks).toEqual([])
    expect(d.additions).toBe(2)
    expect(d.deletions).toBe(2)
  })

  it('returns [] for empty output and skips junk before the first header', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    const [d] = parseUnifiedDiff(`${SHA_A}\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n`)
    expect(d.path).toBe('x')
  })
})

describe('combined --raw --numstat -z', () => {
  it('merges raw statuses with numstat counts, renames and binaries', async () => {
    const { parseRawNumstatZ } = await import('./files')
    const out = [
      '\n:100644 100644 aaa bbb M',
      'src/a.ts',
      ':000000 100644 000 ccc A',
      'bin.dat',
      ':100644 100644 ddd eee R087',
      'old name.txt',
      'new name.txt',
      ':100644 000000 fff 000 D',
      'gone.txt',
      '3\t1\tsrc/a.ts',
      '-\t-\tbin.dat',
      '2\t0\t',
      'old name.txt',
      'new name.txt',
      '0\t5\tgone.txt',
      ''
    ].join('\0')
    expect(parseRawNumstatZ(out)).toEqual([
      { path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 },
      { path: 'bin.dat', status: 'added', additions: 0, deletions: 0, binary: true },
      { path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed', additions: 2, deletions: 0 },
      { path: 'gone.txt', status: 'deleted', additions: 0, deletions: 5 }
    ])
    expect(parseRawNumstatZ('')).toEqual([])
  })
})

describe('batched tracking helpers', () => {
  it('parses ahead-behind values and applies them to branches', async () => {
    const { applyTracking, parseAheadBehind, parseRefValues, FOR_EACH_REF_FORMAT, FOR_EACH_REF_FORMAT_NO_TRACK } = await import('./refs')
    expect(FOR_EACH_REF_FORMAT_NO_TRACK.split('%00')).toHaveLength(FOR_EACH_REF_FORMAT.split('%00').length)
    expect(FOR_EACH_REF_FORMAT_NO_TRACK).not.toContain('upstream:track')
    const values = parseRefValues('refs/heads/a\x003 1\nrefs/heads/b\x00[gone]\n\n')
    expect([...values]).toEqual([
      ['refs/heads/a', '3 1'],
      ['refs/heads/b', '[gone]']
    ])
    expect(parseAheadBehind('3 1')).toEqual({ ahead: 3, behind: 1, gone: false })
    expect(parseAheadBehind('')).toBeNull()
    const branches = [
      { name: 'a', fullName: 'refs/heads/a', type: 'branch' as const, sha: '1', upstream: 'origin/a', ahead: 0, behind: 0 },
      { name: 'b', fullName: 'refs/heads/b', type: 'branch' as const, sha: '2', upstream: 'origin/b', ahead: 0, behind: 0 },
      { name: 'c', fullName: 'refs/heads/c', type: 'branch' as const, sha: '3' }
    ]
    applyTracking(
      branches,
      new Map([
        ['refs/heads/a', { ahead: 3, behind: 1, gone: false }],
        ['refs/heads/b', { ahead: 0, behind: 0, gone: true }],
        ['refs/heads/c', { ahead: 9, behind: 9, gone: false }]
      ])
    )
    expect(branches[0]).toMatchObject({ ahead: 3, behind: 1 })
    expect(branches[0]).not.toHaveProperty('upstreamGone')
    expect(branches[1]).toMatchObject({ upstreamGone: true })
    expect(branches[2]).not.toHaveProperty('ahead')
  })
})
