// ".git"-equivalent folder names in the Clone / Init dialogs: never pre-filled, always refused.
import { describe, expect, it } from 'vitest'
import { isDotGitName, repoNameFromUrl, validateFolderName } from './cloneUrl'

describe('.git folder names', () => {
  it('does not derive ".git" (or a case / trailing-dot variant) from a clone URL', () => {
    for (const url of [
      'https://host/tools/.git.git',
      'https://host/tools/.GIT.git',
      'https://host/tools/.git..git',
      'https://host/x/.git%2Egit',
      'git@host:x/.git.git',
      '/srv/git/.git.git/'
    ]) {
      expect({ url, name: repoNameFromUrl(url) }).toEqual({ url, name: '' })
    }
    expect(repoNameFromUrl('https://host/tools/repo/.git')).toBe('repo')
    expect(repoNameFromUrl('https://host/tools/.github.git')).toBe('.github')
  })

  it('refuses ".git"-equivalent folder names (Clone and Init dialogs)', () => {
    for (const n of ['.git', '.GIT', '.git.', '.git ..', 'GIT~1']) {
      expect({ n, error: validateFolderName(n) }).toEqual({ n, error: 'A folder cannot be named ".git"' })
    }
    expect(validateFolderName('.github')).toBeNull()
    expect(validateFolderName('.gitignore')).toBeNull()
    expect(isDotGitName('repo.git')).toBe(false)
  })
})
