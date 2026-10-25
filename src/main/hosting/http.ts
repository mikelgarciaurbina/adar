// JSON client for the hosting APIs (GitHub, Bitbucket Cloud, Bitbucket Data Center). Only ever
// talks to its own base address; failures become AdarErrors with the service's own explanation.

import { AdarError } from '@shared/errors'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 20_000

export interface ApiClientOptions {
  fetch: FetchFn
  /** https://api.github.com, https://api.bitbucket.org/2.0 or a Bitbucket server's address. */
  base: string
  /** Authorization header value ("Bearer …" or "Basic …"). */
  auth: string
  userAgent: string
  /** "GitHub" or "Bitbucket", for messages. */
  service: string
  /** The service's error answer as text (see githubErrorMessage / bitbucketErrorMessage). */
  errorMessage: (body: unknown, fallback: string) => string
  /** Called when the service rejects the credentials (revoked token, signed out). */
  onUnauthorized?: () => void
  accept?: string
  headers?: Record<string, string>
}

export interface ApiResponse {
  status: number
  headers: Headers
  text: string
  json: unknown
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  get base(): string {
    return this.opts.base
  }

  /** JSON answer of `method path` (path starts with "/" and is built from validated parts only). */
  async json(method: string, path: string, body?: unknown): Promise<unknown> {
    return (await this.call(method, path, body)).json
  }

  /** The full answer, for status codes and headers. `path` may also be an absolute URL under the base address. */
  async call(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    const url = path.startsWith('/') ? `${this.opts.base}${path}` : path
    if (!url.startsWith(`${this.opts.base}/`)) throw new AdarError({ message: `${this.opts.service}: refusing to call ${url}`, code: 'INVALID_ARGUMENT' })
    let res: Response
    try {
      res = await this.opts.fetch(url, {
        method,
        headers: {
          Accept: this.opts.accept ?? 'application/json',
          Authorization: this.opts.auth,
          'User-Agent': this.opts.userAgent,
          ...this.opts.headers,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      throw new AdarError({ message: `Could not reach ${this.opts.service}. Check your connection and try again.`, code: 'NETWORK' })
    }
    const text = await res.text().catch(() => '')
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (res.ok) return { status: res.status, headers: res.headers, text, json }
    const { service } = this.opts
    const detail = this.opts.errorMessage(json, `${res.status} ${res.statusText}`.trim())
    if (res.status === 401) {
      this.opts.onUnauthorized?.()
      throw new AdarError({ message: `${service} did not accept the sign-in: ${detail}`, code: 'AUTH_FAILED' })
    }
    if (res.status === 403 && /saml|sso/i.test(detail)) {
      throw new AdarError({ message: `${service}: ${detail} Authorize the token for this organization.`, code: 'AUTH_FAILED' })
    }
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
      throw new AdarError({ message: `${service} rate limit reached. Try again in a few minutes.`, code: 'NETWORK' })
    }
    if (res.status === 404) {
      throw new AdarError({ message: `${service}: not found, or this sign-in has no access to it (${detail})`, code: 'NOT_FOUND' })
    }
    throw new AdarError({ message: `${service}: ${detail}`, code: res.status >= 500 ? 'NETWORK' : 'INVALID_ARGUMENT' })
  }
}

/** Run `fn` over `items`, at most `limit` at a time, keeping their order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** A small map that forgets its oldest entries past `max`. */
export class BoundedCache<V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly max = 500) {}

  get(key: string): V | undefined {
    return this.map.get(key)
  }

  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
  }
}
