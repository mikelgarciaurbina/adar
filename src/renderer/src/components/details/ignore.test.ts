import { describe, expect, it } from 'vitest'
import { escapeGitignore, fileExtension, ignoreOptions } from './ignore'

describe('escapeGitignore', () => {
  it('escapes glob metacharacters, leading # / ! and trailing spaces', () => {
    expect(escapeGitignore('a*b?c[d].txt')).toBe('a\\*b\\?c\\[d\\].txt')
    expect(escapeGitignore('#notes')).toBe('\\#notes')
    expect(escapeGitignore('!important')).toBe('\\!important')
    expect(escapeGitignore('trailing  ')).toBe('trailing\\ \\ ')
    expect(escapeGitignore('back\\slash')).toBe('back\\\\slash')
    expect(escapeGitignore('plain/path.txt')).toBe('plain/path.txt')
  })
})

describe('fileExtension', () => {
  it('returns the last extension, ignoring dotfiles', () => {
    expect(fileExtension('app.log')).toBe('log')
    expect(fileExtension('archive.tar.gz')).toBe('gz')
    expect(fileExtension('.env')).toBeNull()
    expect(fileExtension('Makefile')).toBeNull()
    expect(fileExtension('weird.')).toBeNull()
  })
})

describe('ignoreOptions', () => {
  it('offers the file, its extension and its folder', () => {
    expect(ignoreOptions('logs/today/app.log')).toEqual([
      { label: 'Ignore app.log', pattern: '/logs/today/app.log' },
      { label: 'Ignore all *.log files', pattern: '*.log' },
      { label: 'Ignore folder logs/today/', pattern: '/logs/today/' }
    ])
  })

  it('omits extension and folder options when not applicable', () => {
    expect(ignoreOptions('.env')).toEqual([{ label: 'Ignore .env', pattern: '/.env' }])
  })

  it('treats a trailing slash as an untracked folder', () => {
    expect(ignoreOptions('build/out/')).toEqual([
      { label: 'Ignore folder build/out/', pattern: '/build/out/' },
      { label: 'Ignore folder build/', pattern: '/build/' }
    ])
  })

  it('escapes special characters in patterns', () => {
    expect(ignoreOptions('notes/[draft].md')[0].pattern).toBe('/notes/\\[draft\\].md')
  })

  it('returns nothing for an empty path', () => {
    expect(ignoreOptions('')).toEqual([])
    expect(ignoreOptions('/')).toEqual([])
  })
})
