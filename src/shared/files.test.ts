import { describe, expect, it } from 'vitest'
import { baseName, contentOf, hasLoneCarriageReturn, isGitInternal, parsePathArgs, splitPosition } from './files'

describe('files Adar edits', () => {
  it('never takes Git’s own files for one', () => {
    for (const p of ['.git', '.git/config', '/repo/.git/hooks/pre-commit', 'C:\\repo\\.git\\config', 'a/.GIT/b', 'sub/.git', '/repo/GIT~1/config', '/repo/.git./config', '/repo/.git /x']) {
      expect(isGitInternal(p), p).toBe(true)
    }
    for (const p of ['.gitignore', '.github/workflows/ci.yml', 'src/git/runner.ts', '.gitattributes', 'a.git', 'my.git/config', '.gitmodules', '..', '']) {
      expect(isGitInternal(p), p).toBe(false)
    }
  })

  it('reads the content of a version, whenever the file was looked at', () => {
    expect(contentOf('abc.12.1700000000000')).toBe('abc')
    expect(contentOf('abc')).toBe('abc')
    expect(contentOf(null)).toBe('')
    expect(contentOf(undefined)).toBe('')
  })

  it('finds the line endings an editor would not keep', () => {
    expect(hasLoneCarriageReturn('a\r\nb\r\n')).toBe(false)
    expect(hasLoneCarriageReturn('a\nb')).toBe(false)
    expect(hasLoneCarriageReturn('a\rb')).toBe(true)
    expect(hasLoneCarriageReturn('a\r\nb\r')).toBe(true)
  })

  it('names a file by the end of its path', () => {
    expect(baseName('/a/b/c.ts')).toBe('c.ts')
    expect(baseName('C:\\a\\b.txt')).toBe('b.txt')
    expect(baseName('.env')).toBe('.env')
    expect(baseName('/a/b/')).toBe('b')
  })

  it('splits a path from the line and column a program writes after it', () => {
    expect(splitPosition('src/a.ts:12:3')).toEqual({ path: 'src/a.ts', line: 12, column: 3 })
    expect(splitPosition('src/a.ts:12')).toEqual({ path: 'src/a.ts', line: 12 })
    expect(splitPosition('src/a.ts(12,3)')).toEqual({ path: 'src/a.ts', line: 12, column: 3 })
    expect(splitPosition('src/a.ts(12)')).toEqual({ path: 'src/a.ts', line: 12 })
    expect(splitPosition('src/a.ts')).toEqual({ path: 'src/a.ts' })
    expect(splitPosition('src/a.ts:0')).toEqual({ path: 'src/a.ts:0' })
    expect(splitPosition(':12')).toEqual({ path: ':12' })
    // A Windows drive is no line.
    expect(splitPosition('C:\\a\\b.ts')).toEqual({ path: 'C:\\a\\b.ts' })
    expect(splitPosition('C:\\a\\b.ts:7')).toEqual({ path: 'C:\\a\\b.ts', line: 7 })
  })

  it('takes the full paths a command line starts Adar with', () => {
    expect(parsePathArgs(['/opt/Adar/adar', '--no-sandbox', '/home/me/plan.txt', 'relative.txt', '--open-repo=/x/y.txt', '/home/me/plan.txt', '/home/me/code'])).toEqual(['/home/me/plan.txt', '/home/me/code'])
    expect(parsePathArgs(['C:\\Adar\\Adar.exe', 'C:\\docs\\plan.json', '\\\\server\\share\\a.ts'])).toEqual(['C:\\docs\\plan.json', '\\\\server\\share\\a.ts'])
    expect(parsePathArgs(['adar', 'file:///home/me/my%20plan.md', 'file://server/share/a.md', 'file:///home/me/a.txt'])).toEqual(['/home/me/my plan.md', '/home/me/a.txt'])
    // The program itself is never one, nor is what has a NUL in it.
    expect(parsePathArgs(['/tmp/odd.txt'])).toEqual([])
    expect(parsePathArgs(['adar', '/tmp/a\0b', 'file:///tmp/a%00b'])).toEqual([])
  })
})
