// Pure helpers for the Clone / Init / Remotes dialogs: URL validation, folder
// name derivation and path joining. No DOM or store access (unit-tested in node).

const ALLOWED_PROTOCOLS = new Set(['https', 'http', 'ssh', 'git', 'file', 'git+ssh', 'ssh+git'])

/** scp-like syntax: [user@]host:path  (git@github.com:org/repo.git) */
const SCP_LIKE = /^(?:([^@/\s:]+)@)?([^@/\s:]+):(?!\/\/)(.*)$/

function isLocalPath(s: string): boolean {
  return s.startsWith('/') || s.startsWith('~/') || s.startsWith('./') || s.startsWith('../') || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')
}

export type CloneUrlKind = 'https' | 'ssh' | 'git' | 'file' | 'local'

/** Classify a clone URL (null when it is not recognised). */
export function cloneUrlKind(raw: string): CloneUrlKind | null {
  const url = raw.trim()
  if (!url) return null
  const proto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)
  if (proto) {
    const p = proto[1].toLowerCase()
    if (p === 'https' || p === 'http') return 'https'
    if (p === 'ssh' || p === 'git+ssh' || p === 'ssh+git') return 'ssh'
    if (p === 'git') return 'git'
    if (p === 'file') return 'file'
    return null
  }
  if (isLocalPath(url)) return 'local'
  if (SCP_LIKE.test(url)) return 'ssh'
  return null
}

/** Validate a repository URL for `git clone`. Returns an error message or null. */
export function validateCloneUrl(raw: string): string | null {
  const url = raw.trim()
  if (!url) return 'Repository URL is required'
  if (/\s/.test(url)) return 'The URL cannot contain spaces'

  const proto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)
  if (proto) {
    const p = proto[1].toLowerCase()
    if (!ALLOWED_PROTOCOLS.has(p)) return `Unsupported protocol "${proto[1]}://"`
    if (p === 'file') return url.length > 'file://'.length ? null : 'Missing path'
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return 'Invalid URL'
    }
    if (!parsed.hostname) return 'Missing host name'
    const path = parsed.pathname.replace(/\/+$/, '')
    if (!path || path === '/') return 'Missing repository path (e.g. /org/repo.git)'
    return null
  }

  if (isLocalPath(url)) return null

  const scp = SCP_LIKE.exec(url)
  if (scp) {
    const host = scp[2]
    const path = scp[3]
    if (host.length === 1 && /^[A-Za-z]$/.test(host)) return 'Invalid URL'
    if (!path || path === '/') return 'Missing repository path (e.g. git@host:org/repo.git)'
    return null
  }

  return 'Enter an HTTPS or SSH URL, e.g. https://host/org/repo.git or git@host:org/repo.git'
}

/** Soft warnings shown under a valid URL. */
export function cloneUrlWarning(raw: string): string | null {
  const url = raw.trim()
  if (/^https?:\/\/[^/@\s]+:[^/@\s]+@/i.test(url)) {
    return 'The URL contains a password or token. It will be stored in plain text in .git/config — prefer a credential helper.'
  }
  if (/^http:\/\//i.test(url)) return 'Plain HTTP is not encrypted. Use HTTPS or SSH when the server supports it.'
  return null
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Folder name git would derive for a clone URL:
 *   https://github.com/org/repo.git → "repo", git@host:org/repo → "repo",
 *   https://dev.azure.com/org/proj/_git/repo → "repo", /path/to/repo/.git → "repo".
 * Returns '' when nothing sensible can be derived.
 */
export function repoNameFromUrl(raw: string): string {
  let s = raw.trim()
  if (!s) return ''
  // Drop query string and fragment.
  s = s.replace(/[?#].*$/, '')

  const proto = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(s)
  let path: string
  if (proto) {
    const rest = proto[2]
    if (proto[1].toLowerCase() === 'file') path = rest
    else {
      const slash = rest.indexOf('/')
      path = slash >= 0 ? rest.slice(slash) : ''
    }
  } else if (isLocalPath(s)) {
    path = s
  } else {
    const scp = SCP_LIKE.exec(s)
    path = scp ? scp[3] : s
  }

  const parts = path
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
  // ".../repo/.git" → "repo"
  while (parts.length && parts[parts.length - 1].toLowerCase() === '.git') parts.pop()
  let name = parts[parts.length - 1] ?? ''
  name = safeDecode(name).replace(/\.git$/i, '').replace(/\.bundle$/i, '')
  // Characters that are invalid in folder names on common file systems.
  name = name.replace(/[<>:"|?*\x00-\x1f]/g, '-').trim()
  if (name === '.' || name === '..') return ''
  return name
}

/** Validate a single folder name (no path separators). */
export function validateFolderName(raw: string): string | null {
  const name = raw.trim()
  if (!name) return 'Folder name is required'
  if (/[\\/]/.test(name)) return 'Use a single folder name (no "/")'
  if (name === '.' || name === '..') return 'Invalid folder name'
  if (/[<>:"|?*\x00-\x1f]/.test(name)) return 'Contains characters not allowed in folder names'
  return null
}

/** Join a parent directory and a child name using the parent's separator style. */
export function joinPath(parent: string, name: string): string {
  const p = parent.trim()
  const n = name.trim().replace(/^[\\/]+/, '')
  if (!p) return n
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/'
  const base = p.length > 1 ? p.replace(/[\\/]+$/, '') : p
  if (!n) return base || p
  if (base === '' || base === '/' || /^[A-Za-z]:$/.test(base)) return `${base === '/' ? '' : base}${sep}${n}`
  return `${base}${sep}${n}`
}

/** Expand a leading "~" using the home directory. */
export function expandHome(path: string, homeDir: string | undefined): string {
  const p = path.trim()
  if (!homeDir) return p
  if (p === '~') return homeDir
  if (p.startsWith('~/')) return joinPath(homeDir, p.slice(2))
  return p
}

/** True when the path looks absolute (POSIX, "~", Windows drive or UNC). */
export function isAbsolutePath(path: string): boolean {
  const p = path.trim()
  return p.startsWith('/') || p === '~' || p.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
}

/** Validate a git remote name. */
export function validateRemoteName(raw: string, existing: readonly string[] = []): string | null {
  const name = raw.trim()
  if (!name) return 'Name is required'
  if (/\s/.test(name)) return 'Spaces are not allowed'
  if (/[~^:?*[\\\x00-\x1f\x7f]/.test(name)) return 'Contains invalid characters'
  if (name.includes('..') || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock'))
    return 'Invalid remote name'
  if (existing.includes(name)) return `A remote named "${name}" already exists`
  return null
}

/** Host name of a remote URL (https, ssh:// or scp-like), or null for local paths. */
export function urlHost(raw: string): string | null {
  const url = raw.trim()
  const proto = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url)
  if (proto) return proto[1].toLowerCase() === 'file' ? null : proto[2].toLowerCase()
  if (isLocalPath(url)) return null
  const scp = SCP_LIKE.exec(url)
  return scp ? scp[2].toLowerCase() : null
}
