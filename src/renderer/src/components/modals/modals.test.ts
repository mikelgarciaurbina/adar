import { describe, expect, it } from 'vitest'
import {
  cloneUrlKind,
  cloneUrlWarning,
  expandHome,
  isAbsolutePath,
  joinPath,
  repoNameFromUrl,
  urlHost,
  validateCloneUrl,
  validateFolderName,
  validateRemoteName
} from './cloneUrl'
import { scopeDescription, validateIdentity } from './identity'
import { credentialHint, credentialLabel, credentialTitle, inferKind, parseCredentialTarget } from './credentials'

describe('repoNameFromUrl', () => {
  const cases: Array<[string, string]> = [
    ['https://github.com/org/repo.git', 'repo'],
    ['https://github.com/org/repo', 'repo'],
    ['https://github.com/org/repo/', 'repo'],
    ['https://github.com/org/repo.git/', 'repo'],
    ['  https://gitlab.com/group/sub/my-project.git  ', 'my-project'],
    ['git@github.com:org/repo.git', 'repo'],
    ['git@github.com:repo.git', 'repo'],
    ['github.com:org/repo', 'repo'],
    ['ssh://git@host.example:2222/org/repo.git', 'repo'],
    ['ssh://host/~user/repo.git', 'repo'],
    ['git://host.xz/path/to/repo.git', 'repo'],
    ['https://dev.azure.com/org/project/_git/repo', 'repo'],
    ['https://user@bitbucket.org/team/repo.git', 'repo'],
    ['https://user:token@github.com/org/private-repo.git', 'private-repo'],
    ['https://host/org/repo.git?ref=main#readme', 'repo'],
    ['https://host/org/my%20repo.git', 'my repo'],
    ['/Users/me/src/repo.git', 'repo'],
    ['/Users/me/src/repo/.git', 'repo'],
    ['/Users/me/src/repo/', 'repo'],
    ['file:///srv/git/project.git', 'project'],
    ['C:\\code\\repo', 'repo'],
    ['https://example.com', ''],
    ['', '']
  ]
  for (const [url, name] of cases) {
    it(`${JSON.stringify(url)} → ${JSON.stringify(name)}`, () => {
      expect(repoNameFromUrl(url)).toBe(name)
    })
  }
})

describe('validateCloneUrl', () => {
  it('accepts common URL forms', () => {
    for (const url of [
      'https://github.com/org/repo.git',
      'http://intranet/git/repo',
      'ssh://git@host:2222/org/repo.git',
      'git@github.com:org/repo.git',
      'git@gitlab.example.com:group/sub/repo',
      'git://host/repo.git',
      'file:///srv/repo.git',
      '/abs/path/repo',
      '~/code/repo',
      'C:\\code\\repo'
    ]) {
      expect(validateCloneUrl(url), url).toBeNull()
    }
  })

  it('rejects invalid input with a message', () => {
    expect(validateCloneUrl('')).toMatch(/required/)
    expect(validateCloneUrl('   ')).toMatch(/required/)
    expect(validateCloneUrl('https://github.com/org/my repo')).toMatch(/spaces/)
    expect(validateCloneUrl('ftp://host/repo')).toMatch(/Unsupported protocol/)
    expect(validateCloneUrl('https://github.com')).toMatch(/path/)
    expect(validateCloneUrl('https://github.com/')).toMatch(/path/)
    expect(validateCloneUrl('git@github.com:')).toMatch(/path/)
    expect(validateCloneUrl('just-some-words')).toMatch(/HTTPS or SSH/)
    expect(validateCloneUrl('ssh://git@host:org/repo')).toMatch(/Invalid URL/)
  })

  it('classifies URLs', () => {
    expect(cloneUrlKind('https://h/o/r')).toBe('https')
    expect(cloneUrlKind('git@h:o/r')).toBe('ssh')
    expect(cloneUrlKind('ssh://h/o/r')).toBe('ssh')
    expect(cloneUrlKind('/x/y')).toBe('local')
    expect(cloneUrlKind('nonsense')).toBeNull()
  })

  it('warns about embedded credentials and plain http', () => {
    expect(cloneUrlWarning('https://me:ghp_x@github.com/o/r.git')).toMatch(/token/)
    expect(cloneUrlWarning('http://host/o/r.git')).toMatch(/HTTP/)
    expect(cloneUrlWarning('https://me@github.com/o/r.git')).toBeNull()
    expect(cloneUrlWarning('git@github.com:o/r.git')).toBeNull()
  })
})

describe('paths', () => {
  it('joins with the parent separator style', () => {
    expect(joinPath('/Users/me/Projects', 'repo')).toBe('/Users/me/Projects/repo')
    expect(joinPath('/Users/me/Projects/', 'repo')).toBe('/Users/me/Projects/repo')
    expect(joinPath('/', 'repo')).toBe('/repo')
    expect(joinPath('C:\\Users\\me', 'repo')).toBe('C:\\Users\\me\\repo')
    expect(joinPath('C:\\', 'repo')).toBe('C:\\repo')
    expect(joinPath('', 'repo')).toBe('repo')
    expect(joinPath('/a', '')).toBe('/a')
  })

  it('expands ~ and detects absolute paths', () => {
    expect(expandHome('~/Projects', '/Users/me')).toBe('/Users/me/Projects')
    expect(expandHome('~', '/Users/me')).toBe('/Users/me')
    expect(expandHome('/x', '/Users/me')).toBe('/x')
    expect(isAbsolutePath('/x')).toBe(true)
    expect(isAbsolutePath('~/x')).toBe(true)
    expect(isAbsolutePath('D:\\x')).toBe(true)
    expect(isAbsolutePath('x/y')).toBe(false)
  })

  it('validates folder names', () => {
    expect(validateFolderName('repo')).toBeNull()
    expect(validateFolderName('my repo')).toBeNull()
    expect(validateFolderName('')).toMatch(/required/)
    expect(validateFolderName('a/b')).toMatch(/single folder/)
    expect(validateFolderName('..')).toMatch(/Invalid/)
    expect(validateFolderName('a:b')).toMatch(/not allowed/)
  })

  it('validates remote names', () => {
    expect(validateRemoteName('upstream')).toBeNull()
    expect(validateRemoteName('')).toMatch(/required/)
    expect(validateRemoteName('my remote')).toMatch(/Spaces/)
    expect(validateRemoteName('origin', ['origin'])).toMatch(/already exists/)
    expect(validateRemoteName('-x')).toMatch(/Invalid/)
  })
})

describe('credential helpers', () => {
  it('parses the target host from git prompts', () => {
    expect(parseCredentialTarget("Password for 'https://me@github.com':")).toEqual({ protocol: 'https', host: 'github.com', user: 'me' })
    expect(parseCredentialTarget("Username for 'https://gitlab.example.com':")).toEqual({ protocol: 'https', host: 'gitlab.example.com', user: undefined })
    expect(parseCredentialTarget("Enter passphrase for key '/Users/me/.ssh/id_ed25519':")).toBeNull()
  })

  it('infers the kind of "other" prompts', () => {
    expect(inferKind('other', 'Are you sure you want to continue connecting (yes/no/[fingerprint])?')).toBe('yesno')
    expect(inferKind('other', "Enter passphrase for key '/k':")).toBe('passphrase')
    expect(inferKind('other', 'Something else')).toBe('other')
    expect(inferKind('password', 'whatever')).toBe('password')
  })

  it('builds titles and labels', () => {
    expect(credentialTitle('password', "Password for 'https://me@github.com':")).toBe('Password for github.com')
    expect(credentialTitle('passphrase', 'Enter passphrase')).toBe('SSH key passphrase')
    expect(credentialTitle('yesno', 'The authenticity of host ... (yes/no)?')).toBe('Verify SSH host')
    expect(credentialLabel('password', '')).toBe('Password or token')
  })

  it('suggests personal access tokens for HTTPS passwords', () => {
    expect(credentialHint('password', "Password for 'https://me@github.com':")).toMatch(/personal access token/)
    expect(credentialHint('password', "Password for 'https://me@github.com':")).toMatch(/^GitHub/)
    expect(credentialHint('password', "Password for 'https://git.mycorp.net':")).toMatch(/personal access token/)
    expect(credentialHint('password', 'Password:')).toBeNull()
    expect(credentialHint('passphrase', 'Enter passphrase')).toMatch(/SSH/)
  })
})

describe('urlHost', () => {
  it('extracts hosts from remote URLs', () => {
    expect(urlHost('https://github.com/o/r.git')).toBe('github.com')
    expect(urlHost('https://user:tok@GitLab.example.com:8443/g/r')).toBe('gitlab.example.com')
    expect(urlHost('ssh://git@bitbucket.org:22/t/r.git')).toBe('bitbucket.org')
    expect(urlHost('git@ssh.dev.azure.com:v3/org/proj/repo')).toBe('ssh.dev.azure.com')
    expect(urlHost('/srv/git/repo.git')).toBeNull()
    expect(urlHost('file:///srv/git/repo.git')).toBeNull()
  })
})

describe('identity validation', () => {
  it('requires a name and a plausible email', () => {
    expect(validateIdentity('Jane Doe', 'jane@example.com')).toBeNull()
    expect(validateIdentity('', 'jane@example.com')).toMatch(/Name/)
    expect(validateIdentity('Jane <x>', 'jane@example.com')).toMatch(/cannot contain/)
    expect(validateIdentity('Jane', '')).toMatch(/Email is required/)
    expect(validateIdentity('Jane', 'not-an-email')).toMatch(/valid email/)
    expect(validateIdentity('Jane', 'jane doe@x.com')).toMatch(/valid email/)
  })

  it('describes config scopes', () => {
    expect(scopeDescription('global')).toMatch(/gitconfig/)
    expect(scopeDescription('none')).toMatch(/no identity/)
  })
})
