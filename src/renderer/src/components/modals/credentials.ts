// Pure helpers for the credential dialog: titles, labels and hints derived from the
// prompt git / ssh printed. Never sees the secret value itself.

import type { CredentialRequest } from '@renderer/store/appStore'

export interface CredentialTarget {
  protocol: string
  host: string
  user?: string
}

/** Extract the URL git asks about: "Password for 'https://me@github.com':" → github.com. */
export function parseCredentialTarget(prompt: string): CredentialTarget | null {
  const m = /([a-z][a-z0-9+.-]*):\/\/(?:([^@'"\s/]+)@)?([^/'"\s:]+)/i.exec(prompt)
  if (!m) return null
  return { protocol: m[1].toLowerCase(), host: m[3].toLowerCase(), user: m[2] ? safeDecode(m[2]) : undefined }
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
  if (kind !== 'other') return kind
  if (/\(yes\/no(\/\[fingerprint\])?\)/i.test(prompt)) return 'yesno'
  if (/passphrase/i.test(prompt)) return 'passphrase'
  if (/password|token/i.test(prompt)) return 'password'
  if (/username/i.test(prompt)) return 'username'
  return 'other'
}

export function credentialTitle(kind: Kind, prompt: string): string {
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

const TOKEN_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)github\.com$/, 'GitHub'],
  [/(^|\.)gitlab\.com$|gitlab/, 'GitLab'],
  [/(^|\.)bitbucket\.org$|bitbucket/, 'Bitbucket'],
  [/(^|\.)dev\.azure\.com$|visualstudio\.com$/, 'Azure DevOps']
]

export function hostingProvider(host: string): string | null {
  for (const [re, name] of TOKEN_HOSTS) if (re.test(host)) return name
  return null
}

/** Helpful hint shown under the input, or null. */
export function credentialHint(kind: Kind, prompt: string): string | null {
  const k = inferKind(kind, prompt)
  const target = parseCredentialTarget(prompt)
  const isHttp = target?.protocol === 'https' || target?.protocol === 'http'
  if (k === 'password' && isHttp) {
    const provider = target ? hostingProvider(target.host) : null
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
