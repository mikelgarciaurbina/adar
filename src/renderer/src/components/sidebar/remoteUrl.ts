// Converts git remote URLs into browsable web URLs (for "Open in browser").
// Pure and dependency-free so it can be unit-tested.
//
//   git@github.com:org/repo.git                → https://github.com/org/repo
//   ssh://git@gitlab.example.com:2222/g/s/r.git → https://gitlab.example.com/g/s/r
//   https://user:token@bitbucket.org/t/r.git    → https://bitbucket.org/t/r
//   git@ssh.dev.azure.com:v3/org/proj/repo      → https://dev.azure.com/org/proj/_git/repo
//   /local/path, file:///x, C:\repo             → null

interface ParsedRemote {
  /** 'http' | 'https' for web URLs; everything else is browsed over https. */
  scheme: string
  host: string
  port: string | null
  path: string
  /** True for ssh / git / scp-like transports (their port is not the web port). */
  sshLike: boolean
}

/** Known hosted services that people alias in ~/.ssh/config ("github.com-work"). */
const ALIASABLE_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org']

function splitAuthority(authority: string): { host: string; port: string | null; extraPath: string } {
  // Strip credentials (user[:password]@).
  const at = authority.lastIndexOf('@')
  let hostPort = at >= 0 ? authority.slice(at + 1) : authority
  if (hostPort.startsWith('[')) {
    // IPv6 literal: [::1]:22
    const end = hostPort.indexOf(']')
    if (end < 0) return { host: hostPort, port: null, extraPath: '' }
    const host = hostPort.slice(0, end + 1)
    const rest = hostPort.slice(end + 1)
    const port = rest.startsWith(':') && /^\d+$/.test(rest.slice(1)) ? rest.slice(1) : null
    return { host, port, extraPath: '' }
  }
  const colon = hostPort.indexOf(':')
  if (colon < 0) return { host: hostPort, port: null, extraPath: '' }
  const after = hostPort.slice(colon + 1)
  hostPort = hostPort.slice(0, colon)
  if (/^\d*$/.test(after)) return { host: hostPort, port: after || null, extraPath: '' }
  // "ssh://git@host:org/repo" — scp syntax mistakenly prefixed with ssh://.
  return { host: hostPort, port: null, extraPath: after }
}

export function parseRemoteUrl(raw: string): ParsedRemote | null {
  const url = raw.trim()
  if (!url) return null

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(url)
  if (schemeMatch) {
    const proto = schemeMatch[1].toLowerCase()
    if (proto === 'file') return null
    const rest = schemeMatch[2]
    const slash = rest.indexOf('/')
    const authority = slash >= 0 ? rest.slice(0, slash) : rest
    let path = slash >= 0 ? rest.slice(slash + 1) : ''
    const { host, port, extraPath } = splitAuthority(authority)
    if (extraPath) path = extraPath + (path ? '/' + path : '')
    if (!host) return null
    const web = proto === 'http' || proto === 'https'
    return { scheme: web ? proto : 'https', host, port, path, sshLike: !web }
  }

  // scp-like syntax: [user@]host:path (no slash before the first colon).
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.*)$/.exec(url)
  if (!scp) return null
  const host = scp[1]
  // "C:\repo" / "C:/repo" are Windows paths, not hosts.
  if (/^[a-z]$/i.test(host)) return null
  return { scheme: 'https', host, port: null, path: scp[2], sshLike: true }
}

function cleanPath(path: string): string {
  let p = path.replace(/^\/+/, '').replace(/\/+$/, '')
  p = p.replace(/\.git$/i, '').replace(/\/+$/, '')
  return p
}

function unalias(host: string): string {
  for (const known of ALIASABLE_HOSTS) {
    if (host === known) return host
    if (host.startsWith(known) && /^[-_]/.test(host.slice(known.length))) return known
  }
  return host
}

/**
 * Browsable https URL for a remote, or null when the remote is a local path or
 * cannot be interpreted. Handles GitHub, GitLab (incl. subgroups), Bitbucket
 * Cloud & Server, Azure DevOps / VSTS and generic self-hosted servers.
 */
export function remoteWebUrl(raw: string): string | null {
  const parsed = parseRemoteUrl(raw)
  if (!parsed) return null
  const host = unalias(parsed.host.toLowerCase())
  const path = cleanPath(parsed.path)
  if (!host) return null

  // Azure DevOps over SSH: v3/{org}/{project}/{repo}
  if (host === 'ssh.dev.azure.com' || host.endsWith('vs-ssh.visualstudio.com')) {
    const parts = path.split('/')
    if (parts[0] === 'v3' && parts.length >= 4) {
      const [, org, project, ...repo] = parts
      if (host === 'ssh.dev.azure.com') return `https://dev.azure.com/${org}/${project}/_git/${repo.join('/')}`
      return `https://${org}.visualstudio.com/${project}/_git/${repo.join('/')}`
    }
  }

  // Bitbucket Server / Data Center: https://host/scm/PROJ/repo.git or ssh on port 7999.
  const bbScm = !parsed.sshLike ? /^scm\/([^/]+)\/([^/]+)$/i.exec(path) : null
  const bbSsh = parsed.sshLike && parsed.port === '7999' ? /^([^/]+)\/([^/]+)$/.exec(path) : null
  const bb = bbScm ?? bbSsh
  if (bb) {
    const portPart = !parsed.sshLike && parsed.port ? `:${parsed.port}` : ''
    const scheme = parsed.sshLike ? 'https' : parsed.scheme
    return `${scheme}://${host}${portPart}/projects/${bb[1].toUpperCase()}/repos/${bb[2]}`
  }

  // Generic: keep an explicit web port for http(s) remotes, drop ssh ports.
  const portPart = !parsed.sshLike && parsed.port ? `:${parsed.port}` : ''
  return `${parsed.scheme}://${host}${portPart}${path ? '/' + path : ''}`
}

/** Short provider label for menus ("GitHub", "GitLab"...), or null for unknown hosts. */
export function remoteProvider(raw: string): string | null {
  const parsed = parseRemoteUrl(raw)
  if (!parsed) return null
  const host = unalias(parsed.host.toLowerCase())
  if (host === 'github.com' || host.startsWith('github.')) return 'GitHub'
  if (host === 'gitlab.com' || host.startsWith('gitlab.')) return 'GitLab'
  if (host === 'bitbucket.org' || host.startsWith('bitbucket.')) return 'Bitbucket'
  if (host.endsWith('dev.azure.com') || host.endsWith('visualstudio.com')) return 'Azure DevOps'
  if (host === 'codeberg.org') return 'Codeberg'
  return null
}
