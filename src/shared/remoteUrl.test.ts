import { describe, expect, it } from 'vitest'
import { hostingOf, parseRemoteUrl, remoteProvider, remoteWebUrl } from './remoteUrl'

describe('remoteWebUrl', () => {
  const cases: Array<[string, string | null]> = [
    // GitHub
    ['git@github.com:org/repo.git', 'https://github.com/org/repo'],
    ['git@github.com:org/repo', 'https://github.com/org/repo'],
    ['https://github.com/org/repo.git', 'https://github.com/org/repo'],
    ['https://github.com/org/repo', 'https://github.com/org/repo'],
    ['https://github.com/org/repo/', 'https://github.com/org/repo'],
    ['https://user:ghp_secret@github.com/org/repo.git', 'https://github.com/org/repo'],
    ['ssh://git@github.com/org/repo.git', 'https://github.com/org/repo'],
    ['ssh://git@github.com:22/org/repo.git', 'https://github.com/org/repo'],
    ['ssh://git@github.com:org/repo.git', 'https://github.com/org/repo'],
    ['git://github.com/org/repo.git', 'https://github.com/org/repo'],
    ['git+ssh://git@github.com/org/repo.git', 'https://github.com/org/repo'],
    ['  git@github.com:org/repo.git\n', 'https://github.com/org/repo'],
    // ssh config host aliases
    ['git@github.com-work:org/repo.git', 'https://github.com/org/repo'],
    ['git@gitlab.com_personal:group/repo.git', 'https://gitlab.com/group/repo'],
    // GitLab with subgroups and self-hosted ssh port
    ['git@gitlab.com:group/sub/repo.git', 'https://gitlab.com/group/sub/repo'],
    ['ssh://git@gitlab.example.com:2222/group/sub/repo.git', 'https://gitlab.example.com/group/sub/repo'],
    ['https://gitlab.example.com:8443/group/repo.git', 'https://gitlab.example.com:8443/group/repo'],
    ['http://git.intranet.local/team/repo.git', 'http://git.intranet.local/team/repo'],
    // Bitbucket Cloud
    ['git@bitbucket.org:team/repo.git', 'https://bitbucket.org/team/repo'],
    ['https://someone@bitbucket.org/team/repo.git', 'https://bitbucket.org/team/repo'],
    // Bitbucket Server / Data Center
    ['https://bitbucket.corp.com/scm/proj/repo.git', 'https://bitbucket.corp.com/projects/PROJ/repos/repo'],
    ['ssh://git@bitbucket.corp.com:7999/proj/repo.git', 'https://bitbucket.corp.com/projects/PROJ/repos/repo'],
    // Azure DevOps
    ['git@ssh.dev.azure.com:v3/myorg/My%20Project/my-repo', 'https://dev.azure.com/myorg/My%20Project/_git/my-repo'],
    ['https://myorg@dev.azure.com/myorg/project/_git/repo', 'https://dev.azure.com/myorg/project/_git/repo'],
    ['myorg@vs-ssh.visualstudio.com:v3/myorg/project/repo', 'https://myorg.visualstudio.com/project/_git/repo'],
    ['https://myorg.visualstudio.com/project/_git/repo', 'https://myorg.visualstudio.com/project/_git/repo'],
    // Generic scp-like / self-hosted
    ['deploy@git.example.org:srv/repos/tool.git', 'https://git.example.org/srv/repos/tool'],
    ['git.example.org:tool.git', 'https://git.example.org/tool'],
    ['git@host.example.com:/abs/path/repo.git', 'https://host.example.com/abs/path/repo'],
    ['ssh://admin@[::1]:2222/repo.git', 'https://[::1]/repo'],
    ['ssh://user@review.example.com:29418/project', 'https://review.example.com/project'],
    // Local / unsupported
    ['/Users/me/repos/project.git', null],
    ['../sibling', null],
    ['./repo', null],
    ['file:///Users/me/repo.git', null],
    ['C:\\repos\\project', null],
    ['C:/repos/project', null],
    ['', null],
    ['   ', null],
    ['just-a-name', null]
  ]

  it.each(cases)('%s → %s', (input, expected) => {
    expect(remoteWebUrl(input)).toBe(expected)
  })

  it('only strips a trailing .git suffix', () => {
    expect(remoteWebUrl('git@github.com:org/repo.github.io.git')).toBe('https://github.com/org/repo.github.io')
    expect(remoteWebUrl('git@github.com:org/.github.git')).toBe('https://github.com/org/.github')
  })

  it('never leaks credentials', () => {
    const out = remoteWebUrl('https://x-access-token:abc123@github.com/org/repo.git')
    expect(out).toBe('https://github.com/org/repo')
    expect(out).not.toContain('abc123')
  })
})

describe('parseRemoteUrl', () => {
  it('marks ssh transports', () => {
    expect(parseRemoteUrl('git@github.com:a/b.git')?.sshLike).toBe(true)
    expect(parseRemoteUrl('https://github.com/a/b.git')?.sshLike).toBe(false)
  })
  it('extracts ports', () => {
    expect(parseRemoteUrl('ssh://git@host:2222/a/b')?.port).toBe('2222')
    expect(parseRemoteUrl('https://host/a/b')?.port).toBeNull()
  })
})

describe('remoteProvider', () => {
  it('recognises hosted providers', () => {
    expect(remoteProvider('git@github.com:a/b.git')).toBe('GitHub')
    expect(remoteProvider('https://gitlab.com/a/b.git')).toBe('GitLab')
    expect(remoteProvider('git@bitbucket.org:a/b.git')).toBe('Bitbucket')
    expect(remoteProvider('git@ssh.dev.azure.com:v3/o/p/r')).toBe('Azure DevOps')
    expect(remoteProvider('git@git.example.com:a/b.git')).toBeNull()
    expect(remoteProvider('/local/path')).toBeNull()
  })
})

describe('hostingOf: Azure DevOps', () => {
  const azure = (owner: string, name: string, org = 'contoso') => ({ provider: 'azure', host: 'dev.azure.com', owner, name, server: `https://dev.azure.com/${org}` })
  it('finds the organization, project and repository of every kind of Azure DevOps remote', () => {
    expect(hostingOf('https://dev.azure.com/contoso/Web/_git/widgets')).toEqual(azure('Web', 'widgets'))
    expect(hostingOf('https://Contoso@dev.azure.com/Contoso/Web/_git/widgets')).toEqual(azure('Web', 'widgets'))
    expect(hostingOf('https://dev.azure.com/contoso/My%20Project/_git/My%20Repo')).toEqual(azure('My Project', 'My Repo'))
    expect(hostingOf('git@ssh.dev.azure.com:v3/contoso/Web/widgets')).toEqual(azure('Web', 'widgets'))
    expect(hostingOf('git@ssh.dev.azure.com:v3/contoso/My%20Project/widgets')).toEqual(azure('My Project', 'widgets'))
    expect(hostingOf('https://contoso.visualstudio.com/Web/_git/widgets')).toEqual(azure('Web', 'widgets'))
    expect(hostingOf('https://contoso.visualstudio.com/DefaultCollection/Web/_git/widgets')).toEqual(azure('Web', 'widgets'))
    expect(hostingOf('contoso@vs-ssh.visualstudio.com:v3/contoso/Web/widgets')).toEqual(azure('Web', 'widgets'))
    // A repository with its project's name leaves the project out.
    expect(hostingOf('https://dev.azure.com/contoso/_git/widgets')).toEqual(azure('widgets', 'widgets'))
  })

  it('refuses what is not a repository', () => {
    expect(hostingOf('https://dev.azure.com/contoso/Web')).toBeNull()
    expect(hostingOf('https://dev.azure.com/contoso/Web/_git')).toBeNull()
    expect(hostingOf('https://dev.azure.com/contoso/Web/_git/a/b')).toBeNull()
    expect(hostingOf('git@ssh.dev.azure.com:v2/contoso/Web/widgets')).toBeNull()
    expect(hostingOf('https://dev.azure.com/contoso/..%2F/_git/widgets')).toBeNull()
    expect(hostingOf('https://dev.azure.com/contoso/Web/_git/%E0%A4%A')).toBeNull()
  })
})

describe('hostingOf: GitHub Enterprise', () => {
  it('finds a known server, and guesses hosts named github.*', () => {
    const servers = { github: [{ url: 'https://code.example.com', hosts: ['code.example.com', 'ssh.code.example.com'] }] }
    expect(hostingOf('git@ssh.code.example.com:acme/widgets.git', servers)).toEqual({
      provider: 'github',
      host: 'ssh.code.example.com',
      owner: 'acme',
      name: 'widgets',
      server: 'https://code.example.com'
    })
    expect(hostingOf('https://github.example.com/acme/widgets.git')).toEqual({
      provider: 'github',
      host: 'github.example.com',
      owner: 'acme',
      name: 'widgets',
      server: 'https://github.example.com'
    })
    expect(hostingOf('git@github.example.com:acme/team/widgets.git')).toBeNull()
    // github.com itself has no server.
    expect(hostingOf('git@github.com:acme/widgets.git')).toEqual({ provider: 'github', host: 'github.com', owner: 'acme', name: 'widgets' })
  })
})
