// Dev HTTP bridge: token, same-site and content-type checks (fake backend, real HTTP).
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Backend } from '../main/backend'
import { createBridge, isSameSite, tokenMatches } from './bridge'

const TOKEN = 'a'.repeat(48)
const calls: unknown[][] = []
const backend = {
  async getAppInfo() {
    calls.push(['getAppInfo'])
    return { version: 'test' }
  },
  async runGit(...args: unknown[]) {
    calls.push(['runGit', ...args])
    return { stdout: '', stderr: '', code: 0 }
  }
} as unknown as Backend

let port = 0
let server: http.Server

beforeAll(async () => {
  server = createBridge({ backend, token: TOKEN, allowedOrigins: ['http://127.0.0.1:5898'] }).server
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

function request(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: opts.method ?? 'POST', path: opts.path ?? '/api/invoke', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      }
    )
    req.on('error', reject)
    req.end(opts.body)
  })
}

/** Status of a request whose response may be an endless stream (closed as soon as headers arrive). */
function statusOf(pathname: string, headers: Record<string, string> = {}, method = 'GET'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      resolve(res.statusCode ?? 0)
      res.destroy()
    })
    req.on('error', reject)
    req.end()
  })
}

const invoke = JSON.stringify({ method: 'runGit', args: ['/repo', ['-c', 'alias.x=!touch /tmp/pwned', 'x']] })
const json = { 'content-type': 'application/json', 'x-adar-token': TOKEN }

describe('dev bridge', () => {
  it('serves same-origin JSON calls with the token', async () => {
    const res = await request({ headers: { ...json, origin: 'http://127.0.0.1:5898', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ method: 'getAppInfo', args: [] }) })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, value: { version: 'test' } })
  })

  it('rejects a missing or wrong token', async () => {
    const before = calls.length
    expect((await request({ headers: { 'content-type': 'application/json' }, body: invoke })).status).toBe(403)
    expect((await request({ headers: { ...json, 'x-adar-token': TOKEN.slice(1) + 'b' }, body: invoke })).status).toBe(403)
    expect(calls.length).toBe(before)
  })

  it('rejects cross-site browser requests even when a proxy added the token', async () => {
    const before = calls.length
    expect((await request({ headers: { ...json, origin: 'https://evil.example' }, body: invoke })).status).toBe(403)
    expect((await request({ headers: { ...json, 'sec-fetch-site': 'cross-site' }, body: invoke })).status).toBe(403)
    // DNS rebinding: the page's own host name reaches the loopback port.
    expect((await request({ headers: { ...json, host: 'evil.example:5899' }, body: invoke })).status).toBe(403)
    expect(calls.length).toBe(before)
  })

  it('requires application/json (no CORS-simple text/plain bodies)', async () => {
    const before = calls.length
    const res = await request({ headers: { 'content-type': 'text/plain', 'x-adar-token': TOKEN }, body: invoke })
    expect(res.status).toBe(415)
    expect(calls.length).toBe(before)
  })

  it('answers unknown methods and malformed bodies with errors', async () => {
    const unknown = await request({ headers: json, body: JSON.stringify({ method: 'dispose', args: [] }) })
    expect(JSON.parse(unknown.body)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    const bad = await request({ headers: json, body: '{nope' })
    expect(bad.status).toBe(400)
    expect((await request({ method: 'OPTIONS', headers: { 'x-adar-token': TOKEN } })).status).toBe(404)
  })

  it('accepts the token in the URL for the event stream only (EventSource cannot set headers)', async () => {
    expect(await statusOf('/api/events')).toBe(403)
    expect(await statusOf(`/api/events?t=${TOKEN.slice(1)}b`)).toBe(403)
    expect(await statusOf(`/api/events?t=${TOKEN}`, { 'sec-fetch-site': 'same-origin' })).toBe(200)
    expect(await statusOf('/api/events', { 'x-adar-token': TOKEN })).toBe(200)
    expect(await statusOf('//')).toBe(400)
    // Cross-site pages cannot use the query form either.
    expect(await statusOf(`/api/events?t=${TOKEN}`, { origin: 'https://evil.example' })).toBe(403)
    const before = calls.length
    expect((await request({ path: `/api/invoke?t=${TOKEN}`, headers: { 'content-type': 'application/json' }, body: invoke })).status).toBe(403)
    expect(calls.length).toBe(before)
  })

  it('is not reachable through the Vite dev proxy without the caller presenting the token', async () => {
    // The proxy used to add x-adar-token itself, letting any local process that reached port 5898 run git commands.
    const { default: config } = await import('../../vite.web.config')
    const proxy = (config as { server?: { proxy?: Record<string, { headers?: unknown }> } }).server?.proxy ?? {}
    expect(Object.keys(proxy)).toContain('/api')
    for (const entry of Object.values(proxy)) expect(entry.headers).toBeUndefined()
  })

  it('compares tokens and sites strictly', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
    expect(tokenMatches(undefined, TOKEN)).toBe(false)
    expect(tokenMatches([TOKEN], TOKEN)).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
    const req = (headers: Record<string, string>) => ({ headers }) as unknown as http.IncomingMessage
    expect(isSameSite(req({ host: '127.0.0.1:5899' }), [])).toBe(true)
    expect(isSameSite(req({ host: 'localhost:5899', 'sec-fetch-site': 'none' }), [])).toBe(true)
    expect(isSameSite(req({ host: '127.0.0.1.evil.example' }), [])).toBe(false)
    expect(isSameSite(req({ host: '127.0.0.1:5899', origin: 'null' }), ['http://127.0.0.1:5898'])).toBe(false)
  })
})
