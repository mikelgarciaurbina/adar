// JSON client for the hosting APIs (GitHub, GitLab, Bitbucket, Azure DevOps). Only ever talks to its own base
// address (avatars: its own host); failures become AdarErrors with the service's own explanation.

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

  /**
   * A picture on the service's own host (such as a user's avatar), fetched with the sign-in, as a data: URL; null when
   * it is on another host or fails. A redirect elsewhere (a storage bucket) is followed once, without the sign-in.
   */
  async image(url: string): Promise<string | null> {
    try {
      const u = new URL(url)
      if (u.origin !== new URL(this.opts.base).origin || u.username || u.password) return null
      const headers = { Accept: 'image/*', 'User-Agent': this.opts.userAgent }
      let res = await this.opts.fetch(u.href, { headers: { ...headers, Authorization: this.opts.auth }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.status >= 300 && res.status < 400) {
        const next = new URL(res.headers.get('location') ?? '', u)
        if (next.protocol !== 'https:') return null
        res = await this.opts.fetch(next.href, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      }
      return await imageData(res)
    } catch {
      return null
    }
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

/** Pictures an avatar may be: small raster images (never SVG). */
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/
const MAX_IMAGE_BYTES = 256 * 1024

/** An answer's picture as a data: URL, or null (not a picture, too big, an error). */
export async function imageData(res: Response): Promise<string | null> {
  if (!res.ok) return null
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!IMAGE_TYPES.test(type)) return null
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_IMAGE_BYTES) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null
  return `data:${type};base64,${bytes.toString('base64')}`
}

/** A picture from a public avatar host (no sign-in sent), as a data: URL; null when it is anywhere else or fails. */
export async function publicImage(fetchFn: FetchFn, url: string, userAgent: string, hosts: readonly RegExp[]): Promise<string | null> {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.username || u.password || !hosts.some((h) => h.test(u.hostname))) return null
    return await imageData(await fetchFn(u.href, { headers: { Accept: 'image/*', 'User-Agent': userAgent }, signal: AbortSignal.timeout(TIMEOUT_MS) }))
  } catch {
    return null
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
