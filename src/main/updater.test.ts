// In-app updater: downloads are verified (host, SHA-256 digest / size) before they can be installed,
// and the release pipeline only publishes complete, verified releases. Electron is replaced by a
// stub whose net.fetch is Node's fetch; the "GitHub" feed and assets are served from 127.0.0.1.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'adar-updater-')))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmp, quit: () => undefined },
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  shell: { openExternal: async () => undefined, openPath: async () => '', showItemInFolder: () => undefined }
}))

import type { UpdateStatus } from '@shared/update'
import { Updater } from './updater'

const payload = Buffer.from('PK\u0003\u0004 pretend this is Adar.app zipped\n'.repeat(1000))
const sha256 = createHash('sha256').update(payload).digest('hex')
const assetName = `Adar-0.0.2-${process.arch}.zip`
let release: Record<string, unknown> = {}
let hits: string[] = []
let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/latest.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(release))
    if (req.url === `/${assetName}`) return void res.writeHead(200, { 'content-length': payload.length }).end(payload)
    if (req.url === '/redirect') return void res.writeHead(302, { location: `http://localhost:${(server.address() as AddressInfo).port}/${assetName}` }).end()
    res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env['ADAR_UPDATE_FEED'] = `${base}/latest.json`
})

afterAll(async () => {
  delete process.env['ADAR_UPDATE_FEED']
  await new Promise<void>((r) => server.close(() => r()))
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  hits = []
})

function feed(asset: Record<string, unknown>): void {
  release = {
    tag_name: 'v0.0.2',
    name: 'Adar 0.0.2',
    body: '',
    html_url: 'https://github.com/mikelgarciaurbina/adar/releases/tag/v0.0.2',
    published_at: '2026-10-20T00:00:00Z',
    draft: false,
    prerelease: false,
    assets: [{ name: assetName, browser_download_url: `${base}/${assetName}`, size: payload.length, ...asset }]
  }
}

async function download(): Promise<{ status: UpdateStatus | null; error: string | null; file: string }> {
  const updater = new Updater({
    currentVersion: '0.0.1',
    emit: () => undefined,
    getSettings: async () => ({ checkForUpdates: true, skippedUpdateVersion: '' }),
    updateSettings: async () => undefined
  })
  const checked = await updater.updateCheck(true)
  expect(checked.state).toBe('available')
  const file = path.join(tmp, 'updates', assetName)
  try {
    return { status: await updater.updateDownload(), error: null, file }
  } catch (err) {
    return { status: await updater.updateGetStatus(), error: String(err), file }
  }
}

describe('update download verification', () => {
  it('accepts a download that matches the release digest', async () => {
    feed({ digest: `sha256:${sha256}` })
    const res = await download()
    expect(res.error).toBeNull()
    expect(res.status?.state).toBe('downloaded')
    expect(readFileSync(res.file).equals(payload)).toBe(true)
  })

  it('rejects a download whose SHA-256 differs from the digest, even with the right size', async () => {
    feed({ digest: `sha256:${'0'.repeat(64)}` })
    const res = await download()
    expect(res.error).toMatch(/SHA-256/)
    expect(res.status?.state).toBe('error')
    expect(existsSync(res.file)).toBe(false)
    expect(existsSync(`${res.file}.part`)).toBe(false)
  })

  it('falls back to the size when the API gives no digest', async () => {
    feed({ size: payload.length + 1 })
    expect((await download()).error).toMatch(/incomplete/)
    feed({ size: payload.length - 1 })
    expect((await download()).error).toMatch(/larger/)
    feed({ digest: null })
    expect((await download()).status?.state).toBe('downloaded')
  })

  it('never downloads from hosts other than GitHub release storage (or the loopback test feed)', async () => {
    feed({ browser_download_url: 'https://github.com/someone/else/releases/download/v0.0.2/Adar.zip', digest: `sha256:${sha256}` })
    expect((await download()).error).toMatch(/Refusing to download/)
    feed({ browser_download_url: 'https://evil.example/Adar.zip' })
    expect((await download()).error).toMatch(/Refusing to download/)
    expect(hits.filter((h) => h !== '/latest.json')).toEqual([])
    // A redirect to another host is refused before the body is used.
    feed({ browser_download_url: `${base}/redirect`, digest: `sha256:${sha256}` })
    const redirected = await download()
    expect(redirected.error).toMatch(/Refusing to download/)
    expect(existsSync(redirected.file)).toBe(false)
  })
})

describe('release configuration', () => {
  const root = path.resolve(__dirname, '../..')
  const builder = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  const workflow = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')

  it('uploads to a draft release that is published only after all assets are verified', () => {
    // A published release is what /releases/latest (the updater) returns while the other arch still uploads.
    expect(builder).toMatch(/^\s*releaseType:\s*draft\s*$/m)
    expect(workflow).toMatch(/gh release edit "\$TAG" --draft=false --target "\$GITHUB_SHA"/)
    // Apple Silicon only: exactly the arm64 .zip (in-place updates) and .dmg (manual installs) are verified.
    for (const name of ['arm64.zip', 'arm64.dmg']) expect(workflow).toContain(name)
    expect(workflow).not.toMatch(/x64\.(zip|dmg)/)
    // Incomplete uploads are retried and leftovers from earlier runs never get published.
    expect(workflow).toMatch(/gh release upload "\$TAG" "release\/\$f" --clobber/)
    expect(workflow).toMatch(/Removing stale asset/)
  })

  it('builds Apple Silicon artifacts only', () => {
    expect(builder).toMatch(/arch: \[arm64\]/)
    expect(builder).not.toMatch(/x64/)
  })

  it('serialises release runs and keeps the token away from checkout and tests', () => {
    expect(workflow).toMatch(/^concurrency:\s*\n\s+group: release\s*\n\s+cancel-in-progress: false/m)
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents: read/m)
    expect(workflow).toMatch(/persist-credentials: false/)
  })
})
