import type { AdarErrorCode, AdarErrorPayload } from './types'

/** Error type used on both sides of the IPC boundary. */
export class AdarError extends Error {
  readonly code: AdarErrorCode
  readonly command?: string
  readonly stderr?: string
  readonly exitCode?: number

  constructor(payload: AdarErrorPayload) {
    super(payload.message)
    this.name = 'AdarError'
    this.code = payload.code
    this.command = payload.command
    this.stderr = payload.stderr
    this.exitCode = payload.exitCode
  }

  toPayload(): AdarErrorPayload {
    return {
      message: this.message,
      code: this.code,
      command: this.command,
      stderr: this.stderr,
      exitCode: this.exitCode
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
  'UNKNOWN'
])

function isAdarCode(code: string): code is AdarErrorCode {
  return CODES.has(code)
}

/** Short human message for toasts: the most relevant stderr line, else the message. */
export function describeError(err: unknown): string {
  const p = toErrorPayload(err)
  const stderr = (p.stderr || '').trim()
  if (stderr) {
    const lines = stderr
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('hint:'))
    const important = lines.find((l) => /^(fatal|error):/i.test(l)) || lines[0]
    if (important) return important.replace(/^(fatal|error):\s*/i, '')
  }
  return p.message
}
