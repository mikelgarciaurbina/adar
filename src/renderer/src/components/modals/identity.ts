// Pure validation for author identity (user.name / user.email).

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+$/

export function validateIdentity(name: string, email: string): string | null {
  if (!name.trim()) return 'Name is required'
  if (/[<>\n]/.test(name)) return 'Name cannot contain < > or line breaks'
  if (!email.trim()) return 'Email is required'
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address'
  return null
}

export function scopeDescription(scope: 'local' | 'global' | 'system' | 'none'): string {
  switch (scope) {
    case 'local':
      return 'this repository (.git/config)'
    case 'global':
      return 'your global config (~/.gitconfig)'
    case 'system':
      return 'the system-wide git config'
    default:
      return 'nowhere — no identity is configured'
  }
}
