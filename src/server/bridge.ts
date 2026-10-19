// HTTP request handling of the browser dev bridge (see devServer.ts), separated from the
// process entry point so it can be unit-tested with a fake backend.
//
// Security model (the bridge can run arbitrary git commands through runGit):
//  - listen on 127.0.0.1 only;
//  - every request must carry the random x-adar-token header (constant-time compare);
//  - browsers may only reach it from the dev page's own origin: requests whose Origin /
//    Sec-Fetch-Site say they come from another site are refused (CSRF, DNS rebinding);
//  - POST bodies must be application/json, which a cross-site page cannot send without a
//    CORS preflight (and the bridge never answers preflights with CORS headers).

import { timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AdarEvent } from '@shared/types'
import type { Backend } from '../main/backend'
import { dispatch } from '../main/dispatch'

export const MAX_BODY = 50 * 1024 * 1024

export interface BridgeOptions {
  backend: Backend
  token: string
  /** Origins (scheme://host:port) allowed to call the bridge from a browser, e.g. the Vite dev page. */
  allowedOrigins: string[]
}

export interface Bridge {
  server: http.Server
  emit(event: AdarEvent): void
}

export function tokenMatches(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== 'string' || !token) return false
  const a = Buffer.from(header)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i

/** Refuse requests a browser sent on behalf of another site (or after DNS rebinding). */
export function isSameSite(req: http.IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const host = req.headers.host
  // DNS rebinding: a page on evil.example resolving to 127.0.0.1 still sends Host: evil.example.
  // (The Vite proxy rewrites Host to the target, which is loopback too.)
  if (host && !LOOPBACK_HOST.test(host)) return false
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (origin !== undefined && !allowedOrigins.includes(String(origin))) return false
  return true
}

function readBody(req: http.IncomingMessage, max = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createBridge(opts: BridgeOptions): Bridge {
  const clients = new Set<http.ServerResponse>()

  const emit = (event: AdarEvent): void => {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const res of clients) res.write(data)
  }

  const server = http.createServer(async (req, res) => {
    if (!tokenMatches(req.headers['x-adar-token'], opts.token) || !isSameSite(req, opts.allowedOrigins)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const url = new URL(req.url || '/', 'http://localhost')

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      res.write(': connected\n\n')
      clients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 15000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/invoke') {
      const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (type !== 'application/json') {
        res.writeHead(415).end('unsupported media type')
        return
      }
      try {
        const body = JSON.parse(await readBody(req)) as { method?: unknown; args?: unknown }
        const result = await dispatch(opts.backend, body.method, body.args ?? [])
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result))
      } catch (err) {
        res
          .writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: { message: String(err), code: 'INVALID_ARGUMENT' } }))
      }
      return
    }

    res.writeHead(404).end('not found')
  })

  return { server, emit }
}
