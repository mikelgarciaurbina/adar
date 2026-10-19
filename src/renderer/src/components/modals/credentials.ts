// Pure helpers for the credential dialog: titles, labels and hints derived from the
// prompt git / ssh printed. Never sees the secret value itself.
//
// Trust: only text git or OpenSSH generate themselves may name the host or pick
// provider advice. git's own prompts are exactly "Username for '<url>': " and
// "Password for '<url>': ". An SSH server, though, can send any text through
// keyboard-interactive auth (OpenSSH prefixes it with "(user@host) "), e.g. a
// fake "Password for 'https://github.com':" to phish a GitHub token — such text is
// shown as the server's words, with the host taken from OpenSSH's prefix.

import type { CredentialRequest } from '@renderer/store/appStore'

export interface CredentialTarget {
  protocol: string
  host: string
  user?: string
}

/** git's own credential prompt: "Username for '<url>': " / "Password for '<url>': " (askpass trims the space). */
const GIT_PROMPT = /^(?:Username|Password) for '([a-z][a-z0-9+.-]*):\/\/(?:([^@'\/]*)@)?(\[[0-9a-f:.]+\]|[^\/'@:\[\]]+)(?::\d+)?(?:\/[^']*)?':?$/i

/**
 * The URL git asks about: "Password for 'https://me@github.com':" → github.com. Only git's own
 * prompt format counts; a URL anywhere else in the text (e.g. sent by an SSH server) is ignored.
 */
export function parseCredentialTarget(prompt: string): CredentialTarget | null {
  if (parseSshServerPrompt(prompt)) return null
  const m = GIT_PROMPT.exec(prompt.trim())
  if (!m) return null
  return { protocol: m[1].toLowerCase(), host: m[3].toLowerCase(), user: m[2] ? safeDecode(m[2]) : undefined }
}

export interface SshServerPrompt {
  /** Remote user and host from OpenSSH's "(user@host) " prefix (not from the server's text). */
  user: string
  host: string
  /** The server's own text: untrusted, shown verbatim. */
  message: string
}

/**
 * A keyboard-interactive prompt: free text chosen by the SSH server, which OpenSSH hands to
 * askpass as "(user@host) <text>". The host is taken from the prefix; the user part may itself
 * contain "@", so the host is what follows the last one.
 */
export function parseSshServerPrompt(prompt: string): SshServerPrompt | null {
  const m = /^\(([^\s()]+)@([^\s()@]+)\) ([\s\S]*)$/.exec(prompt.trimStart())
  if (!m) return null
  return { user: m[1], host: m[2].toLowerCase(), message: m[3].trim() }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

type Kind = CredentialRequest['kind']

/** Effective kind: some prompts arrive as 'other' but are recognisable. */
export function inferKind(kind: Kind, prompt: string): Kind {
  // The server's text decides nothing (it may claim to want a "token" or a yes/no): free-form input.
  if (parseSshServerPrompt(prompt)) return 'other'
  if (kind !== 'other') return kind
  if (/\(yes\/no(\/\[fingerprint\])?\)/i.test(prompt)) return 'yesno'
  if (/passphrase/i.test(prompt)) return 'passphrase'
  if (/password|token/i.test(prompt)) return 'password'
  if (/username/i.test(prompt)) return 'username'
  return 'other'
}

/** Answers to an SSH server's prompt are always masked: the server's text cannot be trusted to say what it wants. */
export function credentialIsSecret(req: Pick<CredentialRequest, 'kind' | 'prompt' | 'secret'>): boolean {
  const k = inferKind(req.kind, req.prompt)
  return req.secret || k === 'password' || k === 'passphrase' || !!parseSshServerPrompt(req.prompt)
}

export function credentialTitle(kind: Kind, prompt: string): string {
  const server = parseSshServerPrompt(prompt)
  if (server) return `Prompt from SSH server ${server.host}`
  const k = inferKind(kind, prompt)
  const target = parseCredentialTarget(prompt)
  const where = target ? ` for ${target.host}` : ''
  switch (k) {
    case 'username':
      return `Username${where}`
    case 'password':
      return `Password${where}`
    case 'passphrase':
      return 'SSH key passphrase'
    case 'yesno':
      return /authenticity of host|host key|fingerprint/i.test(prompt) ? 'Verify SSH host' : 'Confirm'
    default:
      return 'Git needs your input'
  }
}

export function credentialLabel(kind: Kind, prompt: string): string {
  switch (inferKind(kind, prompt)) {
    case 'username':
      return 'Username'
    case 'password':
      return 'Password or token'
    case 'passphrase':
      return 'Passphrase'
    default:
      return 'Response'
  }
}

/** [exact hosts of the hosted service, loose pattern that also matches self-hosted installs, name] */
const TOKEN_HOSTS: Array<[RegExp, RegExp, string]> = [
  [/(^|\.)github\.com$/, /(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)gitlab\.com$/, /(^|\.)gitlab\.com$|gitlab/, 'GitLab'],
  [/(^|\.)bitbucket\.org$/, /(^|\.)bitbucket\.org$|bitbucket/, 'Bitbucket'],
  [/(^|\.)dev\.azure\.com$|(^|\.)visualstudio\.com$/, /(^|\.)dev\.azure\.com$|visualstudio\.com$/, 'Azure DevOps']
]

/**
 * The hosting service a host belongs to. `exact` only recognises the services' own domains (used
 * for credential advice, where a look-alike such as gitlab.evil.example must get none); otherwise
 * a self-hosted "gitlab.mycorp.net" is labelled GitLab too.
 */
export function hostingProvider(host: string, opts: { exact?: boolean } = {}): string | null {
  for (const [exact, loose, name] of TOKEN_HOSTS) if ((opts.exact ? exact : loose).test(host)) return name
  return null
}

/** Helpful hint shown under the input, or null. */
export function credentialHint(kind: Kind, prompt: string): string | null {
  // An SSH server's prompt never gets provider / token advice (the dialog warns about it instead).
  if (parseSshServerPrompt(prompt)) return null
  const k = inferKind(kind, prompt)
  const target = parseCredentialTarget(prompt)
  const isHttp = target?.protocol === 'https' || target?.protocol === 'http'
  if (k === 'password' && isHttp) {
    const provider = target ? hostingProvider(target.host, { exact: true }) : null
    const lead = provider ? `${provider} does not accept account passwords over HTTPS. ` : ''
    return `${lead}For GitHub/GitLab use a personal access token as the password (Bitbucket: app password or API token; Azure DevOps: PAT).`
  }
  if (k === 'username' && isHttp) {
    return 'Your account username on this server. A credential helper (e.g. osxkeychain or Git Credential Manager) can remember it.'
  }
  if (k === 'passphrase') return 'The passphrase protecting your SSH private key. It is passed to ssh only and never stored by Adar.'
  if (k === 'yesno') {
    if (/authenticity of host|fingerprint/i.test(prompt))
      return 'Only accept if the fingerprint matches the one published by your Git host. Accepting adds it to ~/.ssh/known_hosts.'
    return null
  }
  return null
}
