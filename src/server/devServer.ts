// Browser dev bridge: exposes the same backend over HTTP so the renderer can run
// in a regular browser tab (npm run web). Binds to 127.0.0.1 only and requires the
// random ADAR_DEV_TOKEN, which the page receives out of band (see bridge.ts).
//
//   POST /api/invoke   body: {"method": "...", "args": [...]}  → InvokeResponse
//   GET  /api/events   Server-Sent Events stream of AdarEvent

import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AdarEvent } from '@shared/types'
import { createBackend } from '../main/backend'
import type { PlatformAdapter } from '../main/platform'
import { createBridge } from './bridge'

const execFileP = promisify(execFile)
const PORT = Number(process.env.ADAR_API_PORT || 5899)
const WEB_PORT = Number(process.env.ADAR_WEB_PORT || 5898)
const TOKEN = process.env.ADAR_DEV_TOKEN || ''

if (!TOKEN || TOKEN.length < 16) {
  console.error('[adar-dev] ADAR_DEV_TOKEN (16+ random characters) is required (use `npm run web`).')
  process.exit(1)
}

let emitToClients: (event: AdarEvent) => void = () => undefined

const platform: PlatformAdapter = {
  isElectron: false,
  appVersion: '0.1.0-dev',
  userDataDir: process.env.ADAR_USER_DATA || path.join(os.homedir(), '.adar-dev'),
  async pickDirectory(opts) {
    if (process.platform !== 'darwin') return null
    // Passed to AppleScript as an argument (never interpolated into the script source).
    const prompt = opts?.title ?? 'Select folder'
    try {
      const { stdout } = await execFileP('osascript', [
        '-e',
        'on run argv',
        '-e',
        'POSIX path of (choose folder with prompt (item 1 of argv))',
        '-e',
        'end run',
        prompt
      ])
      const p = stdout.trim()
      return p ? p.replace(/\/$/, '') || '/' : null
    } catch {
      return null
    }
  },
  async openExternal(url) {
    if (!/^(https?|mailto):/i.test(url)) throw new Error(`Refusing to open non-web URL: ${url}`)
    await execFileP(process.platform === 'darwin' ? 'open' : 'xdg-open', [url])
  },
  async showInFolder(p) {
    if (process.platform === 'darwin') await execFileP('open', ['-R', p])
    else await execFileP('xdg-open', [path.dirname(p)])
  }
}

const backend = createBackend({ platform, emit: (e) => emitToClients(e) })
const bridge = createBridge({
  backend,
  token: TOKEN,
  allowedOrigins: [`http://127.0.0.1:${WEB_PORT}`, `http://localhost:${WEB_PORT}`]
})
emitToClients = bridge.emit

bridge.server.listen(PORT, '127.0.0.1', () => {
  console.log(`[adar-dev] API bridge listening on http://127.0.0.1:${PORT}`)
})

const shutdown = () => {
  void backend.dispose().finally(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
