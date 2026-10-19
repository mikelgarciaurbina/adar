// Pure helper for addToGitignore (unit-tested).

/**
 * Return the new .gitignore content with `pattern` appended on its own line,
 * or null when the exact line is already present. Keeps the file's line
 * ending style (CRLF when the file already uses it).
 */
export function appendIgnorePattern(existing: string | null, pattern: string): string | null {
  const content = existing ?? ''
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  if (content) {
    const lines = content.split(/\r?\n/)
    if (lines.includes(pattern)) return null
  }
  let out = content
  if (out && !out.endsWith('\n')) out += eol
  return `${out}${pattern}${eol}`
}

/** Validate and normalise a pattern for .gitignore. Returns null when invalid. */
export function normalizeIgnorePattern(pattern: unknown): string | null {
  if (typeof pattern !== 'string') return null
  const p = pattern.trim()
  if (!p || /[\r\n\0]/.test(p)) return null
  return p
}
