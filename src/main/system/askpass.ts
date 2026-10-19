// Credential prompts (HTTPS username/token, SSH key passphrase, host-key confirmation)
// are routed to the UI: git/ssh run our askpass helper, which POSTs the prompt to a
// local HTTP server (127.0.0.1, random port, random token). The server emits a
// 'credential-request' event and holds the request until answerCredentialRequest().

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { AdarEvent } from '@shared/types'
import { ASKPASS_OP_ENV } from '../git/context'

export type CredentialKind = 'username' | 'password' | 'passphrase' | 'yesno' | 'other'

export const ASKPASS_TOKEN_HEADER = 'x-adar-askpass-token'
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const MAX_BODY = 64 * 1024

/** Classify a git/ssh prompt into the kind of input the UI should ask for. */
export function classifyPrompt(prompt: string): { kind: CredentialKind; secret: boolean } {
  if (/^\s*username\b/i.test(prompt) || /username for/i.test(prompt)) return { kind: 'username', secret: false }
  if (/\(yes\/no/i.test(prompt) || /yes\/no\/\[fingerprint\]/i.test(prompt)) return { kind: 'yesno', secret: false }
  if (/passphrase/i.test(prompt)) return { kind: 'passphrase', secret: true }
  if (/password for/i.test(prompt) || /password:/i.test(prompt) || /^\s*password\b/i.test(prompt)) {
    return { kind: 'password', secret: true }
  }
  return { kind: 'other', secret: true }
}

/** Escape a value for use inside double quotes in a POSIX shell script. */
export function shDoubleQuote(value: string): string {
  return '"' + value.replace(/[\\"$`]/g, (c) => '\\' + c) + '"'
}

/** Node helper run by git/ssh: prints the answer on stdout (exit 0) or exits 1 when cancelled. */
export const ASKPASS_JS = `#!/usr/bin/env node
'use strict'
// Adar askpass helper (generated). Uses node core only.
const http = require('http')
const port = Number(process.env.ADAR_ASKPASS_PORT || 0)
const token = process.env.ADAR_ASKPASS_TOKEN || ''
const prompt = process.argv[2] || ''
const op = process.env.${ASKPASS_OP_ENV} || ''
if (!port || !token) process.exit(1)
const body = JSON.stringify({ prompt, op })
const req = http.request(
  {
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/askpass',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      '${ASKPASS_TOKEN_HEADER}': token
    }
  },
  (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (res.statusCode === 200 && data && typeof data.value === 'string') {
          process.stdout.write(data.value + '\\n', () => process.exit(0))
          return
        }
      } catch (e) {}
      process.exit(1)
    })
    res.on('error', () => process.exit(1))
  }
)
req.setTimeout(${REQUEST_TIMEOUT_MS + 60_000}, () => { req.destroy(); process.exit(1) })
req.on('error', () => process.exit(1))
req.end(body)
`

export function askpassShellScript(execPath: string, jsPath: string): string {
  return `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 ${shDoubleQuote(execPath)} ${shDoubleQuote(jsPath)} "$@"\n`
}

interface Pending {
  resolve: (value: string | null) => void
  timer: ReturnType<typeof setTimeout>
  /** Network command that raised the prompt (ADAR_ASKPASS_OP), '' when unknown. */
  op: string
}

/** Cancelled-op markers older than this are forgotten. */
const CANCEL_TTL_MS = 30 * 60 * 1000

export class AskpassService {
  private server: http.Server | null = null
  private readonly token = randomBytes(24).toString('hex')
  private readonly pending = new Map<string, Pending>()
  /** op id → time the user cancelled a prompt of that network command. */
  private readonly cancelledOps = new Map<string, number>()
  private port = 0
  private disposed = false

  constructor(
    private readonly dir: string,
    private readonly emit: (e: AdarEvent) => void
  ) {}

  /**
   * Start the server and write the helper scripts. Returns the environment to give
   * network git commands (GIT_ASKPASS, SSH_ASKPASS...).
   */
  async start(): Promise<Record<string, string>> {
    const server = http.createServer((req, res) => void this.handle(req, res))
    server.requestTimeout = 0
    server.headersTimeout = 30_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.unref()
    this.server = server
    this.port = (server.address() as AddressInfo).port
    if (this.disposed) {
      await this.dispose()
      return {}
    }

    await fs.mkdir(this.dir, { recursive: true })
    const jsPath = path.join(this.dir, 'askpass.js')
    await fs.writeFile(jsPath, ASKPASS_JS, { mode: 0o755 })
    await fs.chmod(jsPath, 0o755)
    // A shebang script works everywhere git runs it (Git for Windows executes "#!/bin/sh" scripts too).
    const helper = path.join(this.dir, 'askpass.sh')
    await fs.writeFile(helper, askpassShellScript(process.execPath, jsPath), { mode: 0o755 })
    await fs.chmod(helper, 0o755)
    return {
      GIT_ASKPASS: helper,
      SSH_ASKPASS: helper,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY || ':0',
      ADAR_ASKPASS_PORT: String(this.port),
      ADAR_ASKPASS_TOKEN: this.token
    }
  }

  /** Resolve a pending prompt; null cancels (the helper exits 1). Unknown ids are ignored. */
  answer(id: string, value: string | null): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    const v = typeof value === 'string' ? value : null
    if (v === null && p.op) this.markCancelled(p.op)
    p.resolve(v)
  }

  /** True (once) when the user cancelled a prompt raised by network command `op`. */
  takeCancelled(op: string): boolean {
    return this.cancelledOps.delete(op)
  }

  private markCancelled(op: string): void {
    const now = Date.now()
    for (const [k, t] of this.cancelledOps) if (now - t > CANCEL_TTL_MS) this.cancelledOps.delete(k)
    this.cancelledOps.set(op, now)
  }

  /** Ask the UI (exposed for tests). `op` identifies the git command that asked. */
  request(prompt: string, op = ''): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null)
    const id = randomUUID()
    const { kind, secret } = classifyPrompt(prompt)
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => this.answer(id, null), REQUEST_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set(id, { resolve, timer, op })
      this.emit({ type: 'credential-request', id, prompt, kind, secret })
    })
  }

  private checkToken(header: string | string[] | undefined): boolean {
    if (typeof header !== 'string') return false
    const a = Buffer.from(header)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown) => {
      if (res.writableEnded) return
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }
    if (req.method !== 'POST' || req.url !== '/askpass' || !this.checkToken(req.headers[ASKPASS_TOKEN_HEADER])) {
      reply(403, { error: 'forbidden' })
      return
    }
    let raw = ''
    try {
      raw = await new Promise<string>((resolve, reject) => {
        let size = 0
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BODY) {
            reject(new Error('too large'))
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
      })
    } catch {
      reply(400, { error: 'bad request' })
      return
    }
    let prompt = ''
    let op = ''
    try {
      const data = JSON.parse(raw) as { prompt?: unknown; op?: unknown }
      prompt = typeof data.prompt === 'string' ? data.prompt : ''
      op = typeof data.op === 'string' && /^[\w-]{1,64}$/.test(data.op) ? data.op : ''
    } catch {
      reply(400, { error: 'bad request' })
      return
    }
    const value = await this.request(prompt.trim().slice(0, 2000) || 'Credentials required', op)
    if (value === null) reply(200, { cancelled: true })
    else reply(200, { value })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const id of [...this.pending.keys()]) this.answer(id, null)
    const server = this.server
    this.server = null
    if (server) {
      server.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
