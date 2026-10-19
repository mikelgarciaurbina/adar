import type { AdarErrorCode, AdarErrorPayload } from './types'

/** Error type used on both sides of the IPC boundary. */
export class AdarError extends Error {
  readonly code: AdarErrorCode
  readonly command?: string
  readonly stderr?: string
  readonly exitCode?: number
  readonly details?: string[]

  constructor(payload: AdarErrorPayload) {
    super(payload.message)
    this.name = 'AdarError'
    this.code = payload.code
    this.command = payload.command
    this.stderr = payload.stderr
    this.exitCode = payload.exitCode
    this.details = payload.details
  }

  toPayload(): AdarErrorPayload {
    return {
      message: this.message,
      code: this.code,
      command: this.command,
      stderr: this.stderr,
      exitCode: this.exitCode,
      details: this.details
    }
  }
}

export function toErrorPayload(err: unknown): AdarErrorPayload {
  if (err instanceof AdarError) return err.toPayload()
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code: unknown; message: unknown }
    if (typeof e.code === 'string' && typeof e.message === 'string' && isAdarCode(e.code)) {
      return err as AdarErrorPayload
    }
  }
  if (err instanceof Error) return { message: err.message, code: 'UNKNOWN' }
  return { message: String(err), code: 'UNKNOWN' }
}

const CODES: ReadonlySet<string> = new Set<AdarErrorCode>([
  'GIT_FAILED',
  'NOT_A_REPO',
  'AUTH_FAILED',
  'NETWORK',
  'CONFLICT',
  'DIRTY_WORKTREE',
  'NOT_FOUND',
  'INVALID_ARGUMENT',
  'CANCELLED',
  'GIT_NOT_INSTALLED',
  'UNTRUSTED_REPO',
  'UNKNOWN'
])

function isAdarCode(code: string): code is AdarErrorCode {
  return CODES.has(code)
}

/** Short human message for toasts: the most relevant stderr line, else the message. */
export function describeError(err: unknown): string {
  const p = toErrorPayload(err)
  // The backend writes plain-language messages; only fall back to parsing git's stderr without one.
  if (p.message && p.message.trim()) return p.message.trim()
  const stderr = (p.stderr || '').trim()
  if (stderr) {
    const lines = stderr
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('hint:'))
    const important = lines.find((l) => /^(fatal|error):/i.test(l)) || lines[0]
    if (important) return important.replace(/^(fatal|error):\s*/i, '')
  }
  return 'Something went wrong'
}

/**
 * Raw git output worth showing under a friendly message: stderr minus hints, blank lines and
 * lines that merely repeat the message. Returns undefined when nothing new remains.
 */
export function errorDetail(err: unknown, message: string): string | undefined {
  const p = toErrorPayload(err)
  const raw = (p.stderr || '').trim()
  // The backend's dirty-worktree message already names the files; git's text would only restate it.
  if (!raw || p.code === 'DIRTY_WORKTREE' || p.code === 'CANCELLED') return undefined
  const norm = (s: string) => s.replace(/^(fatal|error|warning):\s*/i, '').replace(/[:.]\s*$/, '').trim().toLowerCase()
  const msg = norm(message)
  const lines = raw
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !/^hint:/i.test(l.trim()))
    .filter((l) => {
      const n = norm(l)
      return n && n !== msg && !(n.length > 12 && msg.includes(n))
    })
  return lines.length ? lines.join('\n') : undefined
}
