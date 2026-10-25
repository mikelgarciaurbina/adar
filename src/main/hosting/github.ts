// Minimal GitHub API client (api.github.com only): GraphQL for reading pull requests, REST for
// creating and merging them. Failures become AdarErrors with GitHub's own explanation.

import { AdarError } from '@shared/errors'
import { GITHUB_API, githubErrorMessage } from '@shared/hosting'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 20_000

export class GithubClient {
  constructor(
    private readonly fetchFn: FetchFn,
    private readonly token: string,
    private readonly userAgent: string,
    /** Called when GitHub rejects the credentials (revoked token, gh signed out). */
    private readonly onUnauthorized: () => void = () => undefined,
    private readonly base: string = GITHUB_API
  ) {}

  /** REST call; `apiPath` starts with "/" and is built from validated parts only. */
  async rest(method: 'GET' | 'POST' | 'PUT', apiPath: string, body?: unknown): Promise<unknown> {
    return this.request(method, `${this.base}${apiPath}`, body)
  }

  async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const res = (await this.request('POST', `${this.base}/graphql`, { query, variables })) as { data?: unknown; errors?: unknown }
    if (Array.isArray(res?.errors) && res.errors.length) {
      const message = githubErrorMessage({ errors: res.errors }, 'GitHub could not answer')
      const notFound = res.errors.some((e) => typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'NOT_FOUND')
      if (!res.data || notFound) throw new AdarError({ message: `GitHub: ${message}`, code: notFound ? 'NOT_FOUND' : 'UNKNOWN' })
    }
    return res?.data ?? null
  }

  private async request(method: string, url: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'User-Agent': this.userAgent,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      throw new AdarError({ message: 'Could not reach GitHub. Check your connection and try again.', code: 'NETWORK' })
    }
    const text = await res.text().catch(() => '')
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (res.ok) return json
    const detail = githubErrorMessage(json, `${res.status} ${res.statusText}`.trim())
    if (res.status === 401) {
      this.onUnauthorized()
      throw new AdarError({ message: `GitHub did not accept the sign-in: ${detail}`, code: 'AUTH_FAILED' })
    }
    if (res.status === 403 && /saml|sso/i.test(detail)) {
      throw new AdarError({ message: `GitHub: ${detail} Authorize the token for this organization on github.com.`, code: 'AUTH_FAILED' })
    }
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      throw new AdarError({ message: 'GitHub rate limit reached. Try again in a few minutes.', code: 'NETWORK' })
    }
    if (res.status === 404) {
      throw new AdarError({ message: `GitHub: not found, or this sign-in has no access to it (${detail})`, code: 'NOT_FOUND' })
    }
    throw new AdarError({ message: `GitHub: ${detail}`, code: res.status >= 500 ? 'NETWORK' : 'INVALID_ARGUMENT' })
  }
}
