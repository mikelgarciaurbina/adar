// Repositories inside WSL: path forms, the wsl.exe command and its environment, wsl.exe's failures.
import { describe, expect, it } from 'vitest'
import {
  ASKPASS_WSL_ENV,
  homeFromPrintenv,
  isWslPath,
  parseWslLoginEnv,
  parseWslPath,
  windowsToWsl,
  WSL_LOGIN_SCRIPT,
  wslFailure,
  wslGitCommand,
  wslTarget,
  wslToWindows,
  wslUncPath
} from './wsl'

const ubuntu = { host: 'wsl.localhost' as const, distro: 'Ubuntu', linux: '/home/me/repo' }
const base = { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\System32' }

describe('parseWslPath', () => {
  it('reads both UNC hosts, either slash, and normalises the Linux path', () => {
    expect(parseWslPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo')).toEqual(ubuntu)
    expect(parseWslPath('\\\\wsl$\\Ubuntu-22.04\\home\\me\\')).toEqual({ host: 'wsl$', distro: 'Ubuntu-22.04', linux: '/home/me' })
    expect(parseWslPath('//WSL.LOCALHOST/Debian/srv/./a/../b')).toEqual({ host: 'wsl.localhost', distro: 'Debian', linux: '/srv/b' })
    expect(parseWslPath('\\\\wsl.localhost\\Ubuntu')).toEqual({ host: 'wsl.localhost', distro: 'Ubuntu', linux: '/' })
    expect(parseWslPath('\\\\wsl.localhost\\Ubuntu\\..\\..\\etc')).toEqual({ host: 'wsl.localhost', distro: 'Ubuntu', linux: '/etc' })
  })

  it('ignores other paths and distribution names that could be options', () => {
    for (const p of ['C:\\Users\\me\\repo', '\\\\server\\share\\repo', '/home/me/repo', '\\\\wsl.localhost\\-d\\x', '\\\\wsl.localhost\\', '', 42]) {
      expect(parseWslPath(p)).toBeNull()
    }
  })

  it('only means WSL on Windows', () => {
    const p = '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'
    expect(isWslPath(p, 'win32')).toBe(true)
    expect(isWslPath(p, 'darwin')).toBe(false)
    expect(wslTarget(p, 'win32')).toEqual(ubuntu)
    expect(wslTarget(p, 'linux')).toBeNull()
    expect(wslTarget(undefined, 'win32')).toBeNull()
  })
})

describe('path forms', () => {
  it('turns what git prints into paths Windows reaches', () => {
    expect(wslToWindows(ubuntu, '/home/me/repo/.git')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\\.git')
    expect(wslToWindows(ubuntu, '.git')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo\\.git')
    expect(wslToWindows(ubuntu, '../other')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\other')
    expect(wslToWindows({ ...ubuntu, host: 'wsl$' }, '/')).toBe('\\\\wsl$\\Ubuntu\\')
    expect(wslToWindows(ubuntu, '/mnt/c/Users/me/work')).toBe('C:\\Users\\me\\work')
    expect(wslToWindows(ubuntu, '/mnt/d')).toBe('D:\\')
    // /mnt/wsl is WSL's own folder, not a drive.
    expect(wslToWindows(ubuntu, '/mnt/wsl/x')).toBe('\\\\wsl.localhost\\Ubuntu\\mnt\\wsl\\x')
  })

  it('round-trips through the share', () => {
    const unc = wslUncPath(ubuntu, '/home/me/a b/ñ')
    expect(unc).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\a b\\ñ')
    expect(windowsToWsl('Ubuntu', unc)).toBe('/home/me/a b/ñ')
  })

  it('turns Windows paths into what git inside the distribution reaches', () => {
    expect(windowsToWsl('Ubuntu', '\\\\wsl$\\ubuntu\\home\\me\\wt')).toBe('/home/me/wt')
    expect(windowsToWsl('Ubuntu', 'C:\\Users\\me\\AppData\\Local\\Temp\\adar\\todo')).toBe('/mnt/c/Users/me/AppData/Local/Temp/adar/todo')
    expect(windowsToWsl('Ubuntu', 'D:/x/../y')).toBe('/mnt/d/y')
    expect(windowsToWsl('Ubuntu', 'C:\\')).toBe('/mnt/c')
    expect(windowsToWsl('Ubuntu', '\\\\wsl.localhost\\Debian\\home\\me')).toBeNull()
    expect(windowsToWsl('Ubuntu', '\\\\server\\share\\x')).toBeNull()
    expect(windowsToWsl('Ubuntu', 'relative\\path')).toBeNull()
  })
})

describe('wslGitCommand', () => {
  it('runs git directly in the distribution, in the repository, with System32’s wsl.exe', () => {
    const cmd = wslGitCommand(ubuntu, ['status', '--porcelain'], {}, null, base)
    expect(cmd.file).toBe('C:\\Windows\\System32\\wsl.exe')
    expect(cmd.args).toEqual(['-d', 'Ubuntu', '--cd', '/home/me/repo', '--exec', 'git', 'status', '--porcelain'])
    expect(cmd.env.WSL_UTF8).toBe('1')
    expect(cmd.env.WSLENV).toBe('')
  })

  it('sends only the variables Adar sets, through WSLENV, and the login PATH through env', () => {
    const cmd = wslGitCommand(
      ubuntu,
      ['log'],
      { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: undefined, DISPLAY: ':0', PATH: 'C:\\x', 'BAD-NAME': 'x' },
      { path: '/home/me/.local/bin:/usr/bin', sshAuthSock: '/tmp/ssh-x/agent.1' },
      base
    )
    expect(cmd.args).toEqual(['-d', 'Ubuntu', '--cd', '/home/me/repo', '--exec', 'env', 'PATH=/home/me/.local/bin:/usr/bin', 'git', 'log'])
    expect(cmd.env.WSLENV).toBe('LC_ALL:GIT_TERMINAL_PROMPT:SSH_AUTH_SOCK')
    expect(cmd.env.SSH_AUTH_SOCK).toBe('/tmp/ssh-x/agent.1')
    expect(cmd.env.Path).toBe('C:\\Windows\\System32')
    expect(cmd.env.DISPLAY).toBeUndefined()
  })

  it('translates path-valued variables and refuses ones the distribution cannot reach', () => {
    const cmd = wslGitCommand(ubuntu, ['add', '--all'], { GIT_INDEX_FILE: 'C:\\Temp\\adar-review-1\\index' }, null, base)
    expect(cmd.env.GIT_INDEX_FILE).toBe('/mnt/c/Temp/adar-review-1/index')
    expect(() => wslGitCommand(ubuntu, ['add'], { GIT_INDEX_FILE: '\\\\server\\share\\index' }, null, base)).toThrow(/cannot be reached/)
  })

  it('swaps the askpass helper for the WSL one, or drops it', () => {
    const askpass = {
      GIT_ASKPASS: 'C:\\Users\\me\\AppData\\Roaming\\Adar\\askpass\\askpass.sh',
      SSH_ASKPASS: 'C:\\Users\\me\\AppData\\Roaming\\Adar\\askpass\\askpass.sh',
      SSH_ASKPASS_REQUIRE: 'force',
      ADAR_ASKPASS_PORT: '5000',
      ADAR_ASKPASS_TOKEN: 'secret'
    }
    const wsl = wslGitCommand(ubuntu, ['fetch'], { ...askpass, [ASKPASS_WSL_ENV]: 'C:\\Users\\me\\AppData\\Roaming\\Adar\\askpass\\askpass-wsl.sh' }, null, base)
    expect(wsl.env.GIT_ASKPASS).toBe('/mnt/c/Users/me/AppData/Roaming/Adar/askpass/askpass-wsl.sh')
    expect(wsl.env.SSH_ASKPASS).toBe(wsl.env.GIT_ASKPASS)
    expect(wsl.env.WSLENV!.split(':')).toEqual(['GIT_ASKPASS', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'ADAR_ASKPASS_PORT', 'ADAR_ASKPASS_TOKEN'])
    // The token travels in the environment, never on the command line.
    expect(wsl.args.join(' ')).not.toContain('secret')

    const none = wslGitCommand(ubuntu, ['fetch'], askpass, null, base)
    expect(none.env.WSLENV!.split(':')).toEqual(['ADAR_ASKPASS_PORT', 'ADAR_ASKPASS_TOKEN'])
  })

  it('keeps an SSH agent the caller set or unset', () => {
    const login = { path: null, sshAuthSock: '/tmp/agent' }
    expect(wslGitCommand(ubuntu, ['fetch'], { SSH_AUTH_SOCK: undefined }, login, base).env.WSLENV).toBe('')
    expect(wslGitCommand(ubuntu, ['fetch'], {}, login, base).env.WSLENV).toBe('SSH_AUTH_SOCK')
  })
})

describe('wslFailure', () => {
  it('names a missing git, a missing distribution, and leaves git’s own exit codes alone', () => {
    expect(wslFailure('Ubuntu', 1, '<3>WSL (12) ERROR: CreateProcessEntryCommon:577: execvpe git failed 2\n', '')?.code).toBe('GIT_NOT_INSTALLED')
    expect(wslFailure('Ubuntu', 127, "env: 'git': No such file or directory\n", '')?.code).toBe('GIT_NOT_INSTALLED')
    const gone = wslFailure('Ubuntu', 4294967295, '', 'There is no distribution with the supplied name.\r\nError code: Wsl/Service/WSL_E_DISTRO_NOT_FOUND\r\n')
    expect(gone).toEqual({ code: 'NOT_FOUND', message: 'WSL could not run git in Ubuntu: There is no distribution with the supplied name.' })
    expect(wslFailure('Ubuntu', 128, 'fatal: not a git repository', '')).toBeNull()
    expect(wslFailure('Ubuntu', 1, '', '')).toBeNull()
  })
})

describe('login environment', () => {
  it('reads PATH and SSH_AUTH_SOCK after the marker, whatever the profile printed before', () => {
    const marker = WSL_LOGIN_SCRIPT.split(';')[0].replace('echo ', '')
    const out = `Welcome to Ubuntu\nPATH=/fake\n${marker}\nHOME=/home/me\0PATH=/home/me/bin:/usr/bin\0SSH_AUTH_SOCK=/tmp/a b/agent\0EMPTY=\0`
    expect(parseWslLoginEnv(out)).toEqual({ path: '/home/me/bin:/usr/bin', sshAuthSock: '/tmp/a b/agent' })
    expect(parseWslLoginEnv(`${marker}\nHOME=/home/me\0`)).toEqual({ path: null, sshAuthSock: null })
    expect(parseWslLoginEnv('no marker')).toBeNull()
  })

  it('finds the default distribution’s home folder', () => {
    expect(homeFromPrintenv('Ubuntu\n/home/me\n')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me')
    expect(homeFromPrintenv('Ubuntu\r\n')).toBeNull()
    expect(homeFromPrintenv('')).toBeNull()
  })
})
