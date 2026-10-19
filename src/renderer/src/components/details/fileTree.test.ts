import { describe, expect, it } from 'vitest'
import type { FileChange } from '@shared/types'
import {
  allDirPaths,
  buildRows,
  buildTree,
  comparePaths,
  displayOrder,
  fileBaseName,
  fileDirName,
  filesUnder,
  flattenTree,
  sortByPath
} from './fileTree'

const f = (path: string, status: FileChange['status'] = 'modified'): FileChange => ({ path, status })

describe('path helpers', () => {
  it('splits base and dir names, tolerating trailing slashes', () => {
    expect(fileBaseName('src/a/b.ts')).toBe('b.ts')
    expect(fileDirName('src/a/b.ts')).toBe('src/a')
    expect(fileBaseName('README.md')).toBe('README.md')
    expect(fileDirName('README.md')).toBe('')
    expect(fileBaseName('build/out/')).toBe('out')
    expect(fileDirName('build/out/')).toBe('build')
  })

  it('compares naturally and case-insensitively', () => {
    expect(comparePaths('file2', 'file10')).toBeLessThan(0)
    expect(comparePaths('B.ts', 'a.ts')).toBeGreaterThan(0)
    expect(comparePaths('a', 'a')).toBe(0)
  })

  it('sortByPath does not mutate its input', () => {
    const input = [f('b'), f('a')]
    const sorted = sortByPath(input)
    expect(sorted.map((x) => x.path)).toEqual(['a', 'b'])
    expect(input.map((x) => x.path)).toEqual(['b', 'a'])
  })
})

describe('buildTree', () => {
  const files = [f('src/renderer/src/App.tsx'), f('src/renderer/src/main.tsx'), f('src/main/index.ts'), f('README.md'), f('package.json')]

  it('nests folders, sorts folders and files, and counts files', () => {
    const root = buildTree(files, false)
    expect(root.count).toBe(5)
    expect(root.dirs.map((d) => d.name)).toEqual(['src'])
    expect(root.files.map((x) => x.path)).toEqual(['package.json', 'README.md'])
    const src = root.dirs[0]
    expect(src.dirs.map((d) => d.name)).toEqual(['main', 'renderer'])
    expect(src.count).toBe(3)
  })

  it('compacts single-child folder chains', () => {
    const root = buildTree(files)
    const src = root.dirs[0]
    expect(src.name).toBe('src')
    const names = src.dirs.map((d) => d.name)
    expect(names).toEqual(['main', 'renderer/src'])
    const rendererSrc = src.dirs[1]
    expect(rendererSrc.path).toBe('src/renderer/src')
    expect(rendererSrc.files.map((x) => fileBaseName(x.path))).toEqual(['App.tsx', 'main.tsx'])
  })

  it('compacts a chain starting at the top level', () => {
    const root = buildTree([f('a/b/c/d.txt'), f('a/b/c/e.txt')])
    expect(root.dirs).toHaveLength(1)
    expect(root.dirs[0].name).toBe('a/b/c')
    expect(root.dirs[0].path).toBe('a/b/c')
    expect(root.dirs[0].count).toBe(2)
  })

  it('lists all directory paths', () => {
    expect(allDirPaths(buildTree(files))).toEqual(['src', 'src/main', 'src/renderer/src'])
  })
})

describe('flattenTree / buildRows', () => {
  const files = [f('src/b.ts'), f('src/a.ts'), f('src/lib/x.ts'), f('top.md')]

  it('produces depth-first rows with folders before files', () => {
    const rows = flattenTree(buildTree(files), new Set())
    expect(rows.map((r) => (r.kind === 'dir' ? `D:${r.path}@${r.depth}` : `F:${r.file.path}@${r.depth}`))).toEqual([
      'D:src@0',
      'D:src/lib@1',
      'F:src/lib/x.ts@2',
      'F:src/a.ts@1',
      'F:src/b.ts@1',
      'F:top.md@0'
    ])
  })

  it('hides children of collapsed folders', () => {
    const rows = flattenTree(buildTree(files), new Set(['src']))
    expect(rows.map((r) => r.key)).toEqual(['d:src', 'f:top.md'])
    const dir = rows[0]
    expect(dir.kind === 'dir' && dir.collapsed).toBe(true)
    expect(dir.kind === 'dir' && dir.count).toBe(3)
  })

  it('path mode is a sorted flat list', () => {
    const rows = buildRows(files, 'path', new Set())
    expect(rows.every((r) => r.kind === 'file' && r.depth === 0)).toBe(true)
    expect(rows.map((r) => r.key)).toEqual(['f:src/a.ts', 'f:src/b.ts', 'f:src/lib/x.ts', 'f:top.md'])
  })

  it('displayOrder matches the visible order of each mode', () => {
    expect(displayOrder(files, 'path').map((x) => x.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/lib/x.ts', 'top.md'])
    expect(displayOrder(files, 'tree').map((x) => x.path)).toEqual(['src/lib/x.ts', 'src/a.ts', 'src/b.ts', 'top.md'])
  })

  it('handles an empty list', () => {
    expect(buildRows([], 'tree', new Set())).toEqual([])
    expect(buildRows([], 'path', new Set())).toEqual([])
  })
})

describe('filesUnder', () => {
  it('matches folder prefixes exactly', () => {
    const files = [f('src/a.ts'), f('src2/b.ts'), f('src/x/y.ts')]
    expect(filesUnder(files, 'src').map((x) => x.path)).toEqual(['src/a.ts', 'src/x/y.ts'])
    expect(filesUnder(files, '').length).toBe(3)
  })
})
