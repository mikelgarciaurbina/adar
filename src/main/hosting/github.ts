// Minimal GitHub API client (api.github.com only): GraphQL for reading pull requests, REST for
// creating and merging them. Failures become AdarErrors with GitHub's own explanation.

import { AdarError } from '@shared/errors'
import { GITHUB_API, githubErrorMessage } from '@shared/hosting'
import { ApiClient, type FetchFn } from './http'

export type { FetchFn } from './http'

export class GithubClient {
  private readonly api: ApiClient

  constructor(
    fetchFn: FetchFn,
    token: string,
    userAgent: string,
    /** Called when GitHub rejects the credentials (revoked token, gh signed out). */
    onUnauthorized: () => void = () => undefined,
    base: string = GITHUB_API
  ) {
    this.api = new ApiClient({
      fetch: fetchFn,
      base,
      auth: `Bearer ${token}`,
      userAgent,
      service: 'GitHub',
      errorMessage: githubErrorMessage,
      onUnauthorized,
      accept: 'application/vnd.github+json',
      headers: { 'X-GitHub-Api-Version': '2022-11-28' }
    })
  }

  /** REST call; `apiPath` starts with "/" and is built from validated parts only. */
  async rest(method: 'GET' | 'POST' | 'PUT', apiPath: string, body?: unknown): Promise<unknown> {
    return this.api.json(method, apiPath, body)
  }

  async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const res = (await this.api.json('POST', '/graphql', { query, variables })) as { data?: unknown; errors?: unknown }
    if (Array.isArray(res?.errors) && res.errors.length) {
      const message = githubErrorMessage({ errors: res.errors }, 'GitHub could not answer')
      const notFound = res.errors.some((e) => typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'NOT_FOUND')
      if (!res.data || notFound) throw new AdarError({ message: `GitHub: ${message}`, code: notFound ? 'NOT_FOUND' : 'UNKNOWN' })
    }
    return res?.data ?? null
  }
}
