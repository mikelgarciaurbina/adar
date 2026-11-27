// Editing files in Adar, the pure part: the tree of a repository's files, finding one by name, a file's indent.

import { describe, expect, it } from 'vitest'
import type { FileListing } from '@shared/files'
import type { DiffHunk, DiffLine, WorkingStatus } from '@shared/types'
import { buildTree, changeMarks, countLabel, detectIndent, findFiles, foldersAbove, lineOfChange, nodeAt, positionLabel, visibleRows, type TreeNode } from './model'

const listing = (over: Partial<FileListing> = {}): FileListing => ({ files: [], ignored: [], folders: [], repositories: [], truncated: false, ...over })

const names = (node: TreeNode | undefined): string[] => (node?.children ?? []).map((c) => (c.kind === 'folder' ? `${c.name}/` : c.name))

describe('the tree of a repository’s files', () => {
  const tree = buildTree(
    listing({
      files: ['src/main.ts', 'README.md', 'src/lib/b10.ts', 'src/lib/b2.ts', 'src/lib/A.ts', 'package.json', 'Zebra.txt', 'apple.txt'],
      ignored: ['.env', 'src/local.json'],
      folders: ['node_modules', 'src/dist'],
      repositories: ['vendor/lib']
    })
  )

  it('puts folders first, then files, by name as a person reads it', () => {
    expect(names(tree)).toEqual(['node_modules/', 'src/', 'vendor/', '.env', 'apple.txt', 'package.json', 'README.md', 'Zebra.txt'])
    expect(names(nodeAt(tree, 'src'))).toEqual(['dist/', 'lib/', 'local.json', 'main.ts'])
    expect(names(nodeAt(tree, 'src/lib'))).toEqual(['A.ts', 'b2.ts', 'b10.ts'])
  })

  it('marks what git ignores, and the folders it does not look into', () => {
    expect(nodeAt(tree, '.env')).toMatchObject({ kind: 'file', ignored: true })
    expect(nodeAt(tree, 'src/local.json')).toMatchObject({ ignored: true })
    // A folder that only holds an ignored file among others is not ignored itself.
    expect(nodeAt(tree, 'src')?.ignored).toBeUndefined()
    expect(nodeAt(tree, 'node_modules')).toMatchObject({ kind: 'folder', lazy: true, ignored: true })
    expect(nodeAt(tree, 'src/dist')).toMatchObject({ lazy: true, ignored: true })
    // Another repository inside: not listed either, and not ignored.
    expect(nodeAt(tree, 'vendor/lib')).toMatchObject({ kind: 'folder', lazy: true })
    expect(nodeAt(tree, 'vendor/lib')?.ignored).toBeUndefined()
    expect(nodeAt(tree, 'nowhere/x')).toBeUndefined()
    expect(nodeAt(tree, '')).toBe(tree)
  })

  it('shows what was read of a folder it does not list, each folder inside one more to read', () => {
    const read = buildTree(listing({ folders: ['node_modules'] }), {
      node_modules: [
        { name: 'pkg', kind: 'folder' },
        { name: 'a.js', kind: 'file' },
        { name: 'link', kind: 'link' }
      ],
      'node_modules/pkg': [{ name: 'index.js', kind: 'file' }]
    })
    expect(names(nodeAt(read, 'node_modules'))).toEqual(['pkg/', 'a.js', 'link'])
    expect(nodeAt(read, 'node_modules/pkg')).toMatchObject({ lazy: true, ignored: true })
    expect(nodeAt(read, 'node_modules/pkg/index.js')).toMatchObject({ kind: 'file', ignored: true })
    expect(nodeAt(read, 'node_modules/link')).toMatchObject({ kind: 'file', special: true })
  })

  it('lists the rows of the folders that are open, each under its own', () => {
    const rows = (open: string[]) => visibleRows(tree, new Set(open)).map((r) => `${'  '.repeat(r.depth)}${r.node.name}${r.node.kind === 'folder' ? (r.open ? ' ▾' : ' ▸') : ''}`)
    expect(rows([])).toEqual(['node_modules ▸', 'src ▸', 'vendor ▸', '.env', 'apple.txt', 'package.json', 'README.md', 'Zebra.txt'])
    expect(rows(['src', 'src/lib']).slice(1, 9)).toEqual(['src ▾', '  dist ▸', '  lib ▾', '    A.ts', '    b2.ts', '    b10.ts', '  local.json', '  main.ts'])
    // A folder open inside one that is closed shows nothing.
    expect(rows(['src/lib'])).toEqual(rows([]))
  })

  it('names the folders to open so that a file shows', () => {
    expect(foldersAbove('a/b/c.ts')).toEqual(['a', 'a/b'])
    expect(foldersAbove('c.ts')).toEqual([])
  })

  it('tells what changed, and the folders that hold a change', () => {
    const status = {
      staged: [{ path: 'src/a.ts', status: 'added' }],
      unstaged: [
        { path: 'src/lib/b.ts', status: 'modified' },
        { path: 'gone.ts', status: 'deleted' },
        { path: 'new.txt', status: 'untracked' },
        { path: 'both.ts', status: 'modified' }
      ],
      conflicted: [{ path: 'both.ts', kind: 'both-modified' }]
    } as unknown as WorkingStatus
    const marks = changeMarks(status)
    expect([...marks.files]).toEqual([
      ['src/a.ts', 'added'],
      ['src/lib/b.ts', 'modified'],
      ['new.txt', 'untracked'],
      ['both.ts', 'conflicted']
    ])
    expect([...marks.folders].sort()).toEqual(['src', 'src/lib'])
    expect(changeMarks(null).files.size).toBe(0)
  })
})

describe('finding a file by name', () => {
  const files = listing({
    files: ['src/main/index.ts', 'src/renderer/index.html', 'src/renderer/src/components/editor/FileTree.tsx', 'docs/index.md', 'README.md', 'src/main/files.ts', 'in/dex/other.txt'],
    ignored: ['.env', '.env.local', 'dist/index.js']
  })
  const found = (q: string) => findFiles(files, q).map((f) => f.path)

  it('reads the name before the folders, and what git tracks before what it ignores', () => {
    expect(found('index')).toEqual(['docs/index.md', 'src/main/index.ts', 'src/renderer/index.html', 'dist/index.js', 'in/dex/other.txt'])
    expect(found('env')).toEqual(['.env', '.env.local'])
    expect(found('ftree')).toEqual(['src/renderer/src/components/editor/FileTree.tsx'])
    expect(found('')).toEqual([])
    expect(found('zzz')).toEqual([])
  })

  it('reads a query with a slash against the whole path', () => {
    expect(found('main/ind')).toEqual(['src/main/index.ts'])
    expect(found('main/')).toEqual(['src/main/files.ts', 'src/main/index.ts'])
  })

  it('says which letters matched, in the path', () => {
    const [first] = findFiles(files, 'files')
    expect(first.path).toBe('src/main/files.ts')
    expect(first.indexes.map((i) => first.path[i]).join('')).toBe('files')
    expect(first.indexes[0]).toBe('src/main/'.length)
  })

  it('stops at the limit', () => {
    expect(findFiles(files, 'e', 2)).toHaveLength(2)
  })
})

describe('how a file is indented', () => {
  it('is read from its lines', () => {
    expect(detectIndent('function a() {\n  return 1\n}\n')).toEqual({ tabs: false, size: 2 })
    expect(detectIndent('def a():\n    if x:\n        return 1\n    return 2\n')).toEqual({ tabs: false, size: 4 })
    expect(detectIndent('a {\n\tb {\n\t\tc\n\t}\n}\n')).toEqual({ tabs: true, size: 4 })
    expect(detectIndent('no indent\nat all\n')).toEqual({ tabs: false, size: 2 })
    expect(detectIndent('')).toEqual({ tabs: false, size: 2 })
  })

  it('does not take a comment block’s stars, or one odd line, for the indent', () => {
    expect(detectIndent('/**\n * A comment\n * of three lines\n */\nfunction a() {\n    return 1\n}\nfunction b() {\n    if (x) {\n        y()\n    }\n}\n')).toEqual({ tabs: false, size: 4 })
    expect(detectIndent('a:\n  b:\n    c: 1\n  d:\n    e: 2\n   odd: 3\n')).toEqual({ tabs: false, size: 2 })
  })

  it('reads Windows line endings the same', () => {
    expect(detectIndent('a {\r\n    b\r\n}\r\n')).toEqual({ tabs: false, size: 4 })
  })
})

describe('the line a diff’s Edit goes to', () => {
  const line = (type: DiffLine['type'], oldLine: number | null, newLine: number | null): DiffLine => ({ type, content: '', oldLine, newLine })
  const hunks: DiffHunk[] = [
    {
      header: '@@ -1,5 +1,6 @@',
      oldStart: 1,
      oldLines: 5,
      newStart: 1,
      newLines: 6,
      lines: [line('context', 1, 1), line('del', 2, null), line('add', null, 2), line('add', null, 3), line('context', 3, 4), line('del', 4, null), line('context', 5, 5)]
    },
    { header: '@@ -20,2 +20,3 @@', oldStart: 20, oldLines: 2, newStart: 20, newLines: 3, lines: [line('context', 20, 20), line('add', null, 21), line('context', 21, 22)] }
  ]

  it('is where the change the view is on starts in the file', () => {
    expect(lineOfChange(hunks, 0)).toBe(2)
    // Only lines removed: the line that follows them.
    expect(lineOfChange(hunks, 1)).toBe(5)
    expect(lineOfChange(hunks, 2)).toBe(21)
  })

  it('is the first change when the view is above them all, or names none', () => {
    expect(lineOfChange(hunks, -1)).toBe(2)
    expect(lineOfChange(hunks, 9)).toBe(2)
    expect(lineOfChange([], 0)).toBeUndefined()
  })

  it('is the top of a file whose first lines were removed', () => {
    expect(lineOfChange([{ header: '', oldStart: 1, oldLines: 2, newStart: 1, newLines: 1, lines: [line('del', 1, null), line('context', 2, 1)] }], 0)).toBe(1)
  })
})

describe('what the editor says', () => {
  it('counts the matches of a search', () => {
    expect(countLabel({ total: 12, current: 3, more: false }, 'x')).toBe('3 of 12')
    expect(countLabel({ total: 12, current: 0, more: false }, 'x')).toBe('12')
    expect(countLabel({ total: 9999, current: 1, more: true }, 'x')).toBe('1 of 9999+')
    expect(countLabel({ total: 0, current: 0, more: false }, 'x')).toBe('No results')
    expect(countLabel({ total: 0, current: 0, more: false }, '')).toBe('')
    expect(countLabel(null, 'x')).toBe('')
  })

  it('tells where the cursor is', () => {
    expect(positionLabel(12, 4, 0, 0)).toBe('Ln 12, Col 4')
    expect(positionLabel(12, 4, 9, 1)).toBe('Ln 12, Col 4 (9 selected)')
    expect(positionLabel(12, 4, 90, 3)).toBe('Ln 12, Col 4 (90 selected, 3 lines)')
  })
})
