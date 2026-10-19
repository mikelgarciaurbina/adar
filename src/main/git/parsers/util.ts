// Small helpers shared by the git output parsers.

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'])

/** True for common image extensions (the UI renders those as image diffs). */
export function isImagePath(p: string): boolean {
  const base = p.slice(p.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return IMAGE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase())
}

/** Git's binary heuristic: a NUL byte in the first `limit` bytes. */
export function looksBinary(buf: Uint8Array, limit = 8000): boolean {
  const n = Math.min(buf.length, limit)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

const SIMPLE_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  '\\': 92
}

/**
 * Decode a path as printed by git. Paths containing special characters are
 * C-quoted ("a\tb", "\303\251" octal bytes); others are returned verbatim.
 */
export function unquoteGitPath(s: string): string {
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s
  return decodeCQuoted(s.slice(1, -1))
}

function decodeCQuoted(inner: string): string {
  const bytes: number[] = []
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch !== '\\') {
      for (const b of Buffer.from(ch, 'utf8')) bytes.push(b)
      continue
    }
    const next = inner[i + 1]
    if (next === undefined) {
      bytes.push(92)
      continue
    }
    if (/[0-7]/.test(next)) {
      let j = i + 1
      let oct = ''
      while (j < inner.length && oct.length < 3 && /[0-7]/.test(inner[j])) oct += inner[j++]
      bytes.push(parseInt(oct, 8) & 0xff)
      i = j - 1
      continue
    }
    const simple = SIMPLE_ESCAPES[next]
    if (simple !== undefined) bytes.push(simple)
    else for (const b of Buffer.from(next, 'utf8')) bytes.push(b)
    i++
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * Read one (possibly C-quoted) path token from `s` starting at `from`.
 * Returns the decoded path and the index right after the token.
 */
export function readPathToken(s: string, from: number): { value: string; end: number } | null {
  if (from >= s.length) return null
  if (s[from] === '"') {
    let i = from + 1
    while (i < s.length) {
      if (s[i] === '\\') {
        i += 2
        continue
      }
      if (s[i] === '"') break
      i++
    }
    if (i >= s.length) return null
    return { value: decodeCQuoted(s.slice(from + 1, i)), end: i + 1 }
  }
  const sp = s.indexOf(' ', from)
  const end = sp < 0 ? s.length : sp
  return { value: s.slice(from, end), end }
}

/** Remove the trailing newline(s) git appends to message bodies. */
export function trimTrailingNewlines(s: string): string {
  return s.replace(/[\r\n]+$/, '')
}

/** Parse a decimal integer; NaN-safe. */
export function toInt(s: string | undefined, fallback = 0): number {
  if (s === undefined || s === '') return fallback
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : fallback
}
