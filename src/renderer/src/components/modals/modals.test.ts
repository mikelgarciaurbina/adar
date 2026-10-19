import { describe, expect, it } from 'vitest'
import {
  cloneUrlKind,
  cloneUrlWarning,
  expandHome,
  isAbsolutePath,
  joinPath,
  normalizePathInput,
  repoNameFromUrl,
  urlHost,
  validateCloneUrl,
  validateFolderName,
  validateRemoteName
} from './cloneUrl'
import { scopeDescription, validateIdentity } from './identity'
import { describeUpdateStatus, REPO_URL } from './updates'
import type { UpdateStatus } from '@shared/update'
import {
  credentialHint,
  credentialIsSecret,
  credentialLabel,
  credentialTitle,
  hostingProvider,
  inferKind,
  parseCredentialTarget,
  parseSshServerPrompt
} from './credentials'

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

  it('only trusts git\'s own "Username/Password for \'<url>\'" prompt for the target', () => {
    expect(parseCredentialTarget("Password for 'https://me@github.com/org/repo.git':")).toEqual({ protocol: 'https', host: 'github.com', user: 'me' })
    expect(parseCredentialTarget("Username for 'https://git.example.com:8443'")).toEqual({ protocol: 'https', host: 'git.example.com', user: undefined })
    expect(parseCredentialTarget("Password for 'https://[::1]:8443':")?.host).toBe('[::1]')
    // A URL anywhere else in free text names nothing.
    expect(parseCredentialTarget("Verification code (see https://github.com/login):")).toBeNull()
    expect(parseCredentialTarget("Please re-enter Password for 'https://github.com': ")).toBeNull()
    expect(parseCredentialTarget("Password for 'https://github.com': and more")).toBeNull()
  })

  it('treats an SSH keyboard-interactive prompt as untrusted server text (no spoofed GitHub target or hint)', () => {
    const spoof = "(git@gitlab-mirror.evil.example) Password for 'https://github.com':"
    expect(parseSshServerPrompt(spoof)).toEqual({ user: 'git', host: 'gitlab-mirror.evil.example', message: "Password for 'https://github.com':" })
    expect(parseCredentialTarget(spoof)).toBeNull()
    expect(credentialHint('password', spoof)).toBeNull()
    expect(credentialTitle('password', spoof)).toBe('Prompt from SSH server gitlab-mirror.evil.example')
    expect(credentialTitle('password', spoof)).not.toMatch(/github/i)
    expect(inferKind('password', spoof)).toBe('other')
    expect(inferKind('yesno', '(git@evil.example) Trust github.com? (yes/no)')).toBe('other')
    expect(credentialLabel('username', "(git@evil.example) Username for 'https://github.com':")).toBe('Response')
    // Always masked, whatever the server claims to want.
    expect(credentialIsSecret({ kind: 'username', prompt: "(git@evil.example) Username for 'https://github.com':", secret: false })).toBe(true)
    // The host is what follows the last "@" of OpenSSH's prefix (the user part comes from the URL).
    expect(parseSshServerPrompt("(a@github.com@evil.example) Password for 'https://github.com':")?.host).toBe('evil.example')
    expect(parseSshServerPrompt("Password for 'https://github.com':")).toBeNull()
  })

  it('gives provider-branded advice only for the providers\' own domains', () => {
    expect(hostingProvider('gitlab.evil.example', { exact: true })).toBeNull()
    expect(hostingProvider('bitbucket.evil.example', { exact: true })).toBeNull()
    expect(hostingProvider('gitlab.com', { exact: true })).toBe('GitLab')
    expect(hostingProvider('gitlab.mycorp.net')).toBe('GitLab') // remotes list still labels self-hosted installs
    expect(credentialHint('password', "Password for 'https://gitlab.evil.example':")).not.toMatch(/^GitLab/)
    expect(credentialHint('password', "Password for 'https://gitlab.com':")).toMatch(/^GitLab/)
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

describe('normalizePathInput', () => {
  it('trims and strips matching quotes', () => {
    expect(normalizePathInput('  /Users/me/repo  ')).toBe('/Users/me/repo')
    expect(normalizePathInput("'/Users/me/My Repo'")).toBe('/Users/me/My Repo')
    expect(normalizePathInput('"~/code/x"')).toBe('~/code/x')
    expect(normalizePathInput('"/half')).toBe('"/half')
  })
  it('unescapes shell escapes in POSIX paths only', () => {
    expect(normalizePathInput('/Users/me/My\\ Repo')).toBe('/Users/me/My Repo')
    expect(normalizePathInput('~/a\\(1\\)')).toBe('~/a(1)')
    expect(normalizePathInput('C:\\code\\repo')).toBe('C:\\code\\repo')
  })
  it('converts file:// URLs', () => {
    expect(normalizePathInput('file:///Users/me/My%20Repo')).toBe('/Users/me/My Repo')
    expect(normalizePathInput('file://localhost/srv/repo')).toBe('/srv/repo')
    expect(normalizePathInput('file:///C:/code/repo')).toBe('C:/code/repo')
  })
  it('keeps empty input empty', () => {
    expect(normalizePathInput('   ')).toBe('')
    expect(normalizePathInput('""')).toBe('')
  })
})

describe('describeUpdateStatus', () => {
  const info = {
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    releaseName: 'Adar 0.2.0',
    notes: '',
    releaseUrl: `${REPO_URL}/releases/tag/v0.2.0`,
    publishedAt: '',
    zip: null,
    dmg: null
  }
  const st = (patch: Partial<UpdateStatus>): UpdateStatus => ({ state: 'idle', currentVersion: '0.1.0', info: null, canInstall: false, ...patch })
  const desktop = { isElectron: true }

  it('points to the public repository', () => {
    expect(REPO_URL).toBe('https://github.com/mikelgarciaurbina/adar')
  })
  it('explains that browser mode cannot update', () => {
    expect(describeUpdateStatus(st({ state: 'available', info }), { isElectron: false })).toMatchObject({ action: null, text: expect.stringMatching(/desktop app/) })
  })
  it('offers to update when a release is available', () => {
    expect(describeUpdateStatus(st({ state: 'available', info }), desktop)).toMatchObject({ text: 'Adar 0.2.0 is available', tone: 'accent', action: 'update', actionLabel: 'Update' })
  })
  it('shows download progress as a busy update', () => {
    const d = describeUpdateStatus(st({ state: 'downloading', info, progress: 41.6 }), desktop)
    expect(d.text).toContain('42%')
    expect(d).toMatchObject({ action: 'update', busy: true })
  })
  it('offers restart or installer once downloaded', () => {
    expect(describeUpdateStatus(st({ state: 'downloaded', info, canInstall: true }), desktop)).toMatchObject({ action: 'install', actionLabel: 'Restart to update' })
    expect(describeUpdateStatus(st({ state: 'downloaded', info, canInstall: false }), desktop)).toMatchObject({ action: 'open-installer', actionLabel: 'Open installer' })
  })
  it('reports errors (retry when a release is known)', () => {
    expect(describeUpdateStatus(st({ state: 'error', info, error: 'disk full' }), desktop)).toMatchObject({ tone: 'error', action: 'retry', text: expect.stringContaining('disk full') })
    expect(describeUpdateStatus(st({ state: 'error', error: 'offline' }), desktop)).toMatchObject({ tone: 'error', action: null, text: expect.stringContaining('offline') })
    expect(describeUpdateStatus(st({ state: 'error', error: 'offline' }), { ...desktop, checking: true }).text).toMatch(/Checking/)
  })
  it('describes checking, up to date and idle states', () => {
    expect(describeUpdateStatus(null, { ...desktop, checking: true }).text).toBe('Checking for updates…')
    const now = Date.UTC(2026, 9, 19, 12)
    expect(describeUpdateStatus(st({ state: 'not-available', checkedAt: now - 10_000 }), { ...desktop, now }).text).toBe("You're up to date. Last checked just now.")
    expect(describeUpdateStatus(st({ state: 'not-available' }), desktop).text).toBe("You're up to date.")
    expect(describeUpdateStatus(null, desktop).text).toBe('Not checked yet.')
    expect(describeUpdateStatus(st({}), { ...desktop, automatic: false }).text).toBe('Automatic checks are off.')
  })
})
