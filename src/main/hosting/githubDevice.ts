// Signing in to github.com from the browser: OAuth's device flow with Adar's OAuth app (no client secret). Adar
// asks GitHub for a code, the person types it on github.com/login/device, and Adar asks GitHub every few seconds
// whether it was approved. The device code stays here; the renderer only sees the code to type and an id.

import { randomUUID } from 'node:crypto'
import { AdarError } from '@shared/errors'
import type { GithubDeviceCode } from '@shared/hosting'
import { isPlausibleToken } from './auth'

/**
 * Adar's OAuth app on GitHub (Device Flow enabled). Empty: signing in from the browser is not offered, and gh or a
 * personal access token are the ways in.
 */
export const GITHUB_OAUTH_CLIENT_ID = ''
/** What the token may do: read and write pull requests, including private repositories'. */
export const GITHUB_OAUTH_SCOPE = 'repo'
const GITHUB_WEB = 'https://github.com'
/** At most this many codes are waiting at once (a dialog opened again starts a new one). */
const MAX_PENDING = 4

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {})

interface Pending {
  deviceCode: string
  /** Seconds between questions, as GitHub asks (slow_down raises it). */
  interval: number
  /** Not asked again before this moment, however often the renderer checks. */
  nextAt: number
  expiresAt: number
}

export interface DeviceFlowOptions {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  userAgent: string
  /** Adar's OAuth app (GITHUB_OAUTH_CLIENT_ID, or a development stand-in). */
  clientId: string
  /** https://github.com, or a development stand-in on 127.0.0.1. */
  web?: string
  now?: () => number
}

export class GithubDeviceFlow {
  private readonly pending = new Map<string, Pending>()
  private readonly web: string
  private readonly now: () => number

  constructor(private readonly opts: DeviceFlowOptions) {
    this.web = opts.web ?? GITHUB_WEB
    this.now = opts.now ?? Date.now
  }

  /** Adar has an OAuth app to sign in with. */
  get available(): boolean {
    return /^[A-Za-z0-9._-]{8,64}$/.test(this.opts.clientId)
  }

  async start(): Promise<GithubDeviceCode> {
    if (!this.available) throw new AdarError({ message: 'Signing in from the browser is not available in this version of Adar', code: 'INVALID_ARGUMENT' })
    const res = obj(await this.post('/login/device/code', { client_id: this.opts.clientId, scope: GITHUB_OAUTH_SCOPE }))
    const deviceCode = typeof res.device_code === 'string' ? res.device_code : ''
    const userCode = typeof res.user_code === 'string' ? res.user_code : ''
    const uri = typeof res.verification_uri === 'string' ? res.verification_uri : ''
    if (!deviceCode || !/^[A-Z0-9-]{4,16}$/i.test(userCode) || !this.isGithubPage(uri)) {
      throw new AdarError({ message: deviceError(res, 'GitHub did not give a code to sign in with'), code: 'UNKNOWN' })
    }
    const interval = clamp(Number(res.interval) || 5, 1, 60)
    const expiresAt = this.now() + clamp(Number(res.expires_in) || 900, 60, 1800) * 1000
    this.forgetExpired()
    while (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string)
    const id = randomUUID()
    this.pending.set(id, { deviceCode, interval, nextAt: this.now() + interval * 1000, expiresAt })
    return { id, userCode, verificationUri: uri, interval, expiresAt }
  }

  /** The token once the code was approved; null while it is still waiting (or asked too soon). */
  async check(id: string): Promise<string | null> {
    const p = this.pending.get(id)
    if (!p) throw new AdarError({ message: 'This sign-in is over. Start again.', code: 'CANCELLED' })
    const now = this.now()
    if (now >= p.expiresAt) {
      this.pending.delete(id)
      throw new AdarError({ message: 'The code expired before it was entered on GitHub. Start again.', code: 'AUTH_FAILED' })
    }
    if (now < p.nextAt) return null
    p.nextAt = now + p.interval * 1000
    const res = obj(
      await this.post('/login/oauth/access_token', {
        client_id: this.opts.clientId,
        device_code: p.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    )
    if (isPlausibleToken(res.access_token)) {
      this.pending.delete(id)
      return res.access_token
    }
    switch (res.error) {
      case 'authorization_pending':
        return null
      case 'slow_down':
        p.interval = clamp(Number(res.interval) || p.interval + 5, p.interval, 60)
        p.nextAt = now + p.interval * 1000
        return null
      case 'access_denied':
        this.pending.delete(id)
        throw new AdarError({ message: 'The sign-in was cancelled on GitHub.', code: 'CANCELLED' })
      case 'expired_token':
        this.pending.delete(id)
        throw new AdarError({ message: 'The code expired before it was entered on GitHub. Start again.', code: 'AUTH_FAILED' })
      default:
        this.pending.delete(id)
        throw new AdarError({ message: deviceError(res, 'GitHub did not finish the sign-in'), code: 'AUTH_FAILED' })
    }
  }

  cancel(id: string): void {
    this.pending.delete(id)
  }

  private forgetExpired(): void {
    const now = this.now()
    for (const [id, p] of this.pending) if (now >= p.expiresAt) this.pending.delete(id)
  }

  /** The page to type the code on: GitHub's own (or the development stand-in). */
  private isGithubPage(uri: string): boolean {
    try {
      const u = new URL(uri)
      return u.origin === new URL(this.web).origin && !u.username && !u.password
    } catch {
      return false
    }
  }

  private async post(path: string, form: Record<string, string>): Promise<unknown> {
    let res: Response
    try {
      res = await this.opts.fetch(`${this.web}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': this.opts.userAgent },
        body: new URLSearchParams(form).toString()
      })
    } catch {
      throw new AdarError({ message: 'Could not reach GitHub. Check the connection and try again.', code: 'NETWORK' })
    }
    const body: unknown = await res.json().catch(() => null)
    if (res.status >= 500 || res.status === 429) throw new AdarError({ message: 'GitHub is not answering right now. Try again in a moment.', code: 'NETWORK' })
    if (!res.ok) throw new AdarError({ message: deviceError(obj(body), `GitHub refused the sign-in (HTTP ${res.status})`), code: 'AUTH_FAILED' })
    return body
  }
}

function deviceError(res: Obj, fallback: string): string {
  const text = typeof res.error_description === 'string' ? res.error_description.trim() : ''
  return text && text.length < 300 ? `GitHub: ${text}` : fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}
