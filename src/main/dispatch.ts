// Shared request dispatcher used by Electron IPC and the HTTP dev bridge.
import { API_METHODS, type InvokeResponse, type AdarApiMethod } from '@shared/api'
import { toErrorPayload } from '@shared/errors'
import type { Backend } from './backend'

const ALLOWED: ReadonlySet<string> = new Set(API_METHODS)

export function isApiMethod(name: unknown): name is AdarApiMethod {
  return typeof name === 'string' && ALLOWED.has(name)
}

export async function dispatch(backend: Backend, method: unknown, args: unknown): Promise<InvokeResponse> {
  if (!isApiMethod(method)) {
    return { ok: false, error: { message: `Unknown method: ${String(method)}`, code: 'INVALID_ARGUMENT' } }
  }
  if (!Array.isArray(args)) {
    return { ok: false, error: { message: 'Arguments must be an array', code: 'INVALID_ARGUMENT' } }
  }
  try {
    const fn = backend[method] as (...a: unknown[]) => Promise<unknown>
    const value = await fn.apply(backend, args)
    return { ok: true, value: value === undefined ? null : value }
  } catch (err) {
    return { ok: false, error: toErrorPayload(err) }
  }
}
