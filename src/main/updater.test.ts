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
const openExternal = vi.hoisted(() => vi.fn(async (_url: string) => undefined))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmp, quit: () => undefined },
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  shell: { openExternal, openPath: async () => '', showItemInFolder: () => undefined }
}))

import type { UpdateStatus } from '@shared/update'
import { Updater } from './updater'

const payload = Buffer.from('PK\u0003\u0004 pretend this is Adar.app zipped\n'.repeat(1000))
const sha256 = createHash('sha256').update(payload).digest('hex')
const assetName = `Adar-0.0.2-${process.arch}.zip`
const realPlatform = process.platform
/** The updater reads process.platform: pin it (only macOS downloads release assets). */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}
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
  setPlatform(realPlatform)
  delete process.env['ADAR_UPDATE_FEED']
  await new Promise<void>((r) => server.close(() => r()))
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  hits = []
  setPlatform('darwin')
  openExternal.mockClear()
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

function newUpdater(): Updater {
  return new Updater({
    currentVersion: '0.0.1',
    emit: () => undefined,
    getSettings: async () => ({ checkForUpdates: true, skippedUpdateVersion: '' }),
    updateSettings: async () => undefined
  })
}

async function download(): Promise<{ status: UpdateStatus | null; error: string | null; file: string }> {
  const updater = newUpdater()
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

describe('Windows and Linux builds', () => {
  it('open the release page instead of downloading a macOS asset', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      setPlatform(platform)
      openExternal.mockClear()
      hits = []
      feed({ digest: `sha256:${sha256}` })
      const updater = newUpdater()
      expect(await updater.updateCheck(true)).toMatchObject({ state: 'available', info: { latestVersion: '0.0.2', zip: null, dmg: null } })
      expect((await updater.updateDownload()).state).toBe('available')
      expect(openExternal).toHaveBeenCalledWith('https://github.com/mikelgarciaurbina/adar/releases/tag/v0.0.2')
      expect(hits).toEqual(['/latest.json'])
    }
  })
})

describe('release configuration', () => {
  const root = path.resolve(__dirname, '../..')
  // Windows checkouts may have CRLF line endings (no .gitattributes): the patterns below expect \n.
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
  const builder = read('electron-builder.yml')
  const workflow = read('.github/workflows/release.yml')

  /** A top-level block of electron-builder.yml (its indented lines). */
  const section = (key: string) => builder.match(new RegExp(`^${key}:\\n((?:[ \\t].*\\n|\\n)*)`, 'm'))?.[1] ?? ''

  it('publishes a single fresh draft only after every asset is verified', () => {
    // A published release is what /releases/latest (the updater) returns, so assets must be complete first.
    for (const script of ['dist', 'dist:win', 'dist:linux']) expect(workflow).toMatch(new RegExp(`^\\s+script: ${script}$`, 'm'))
    expect(workflow).toMatch(/run: npm run \$\{\{ matrix\.script \}\}/)
    expect(workflow).not.toMatch(/--publish always|npm run release/)
    // One job publishes, after every build has succeeded.
    expect(workflow).toMatch(/^ {2}publish:\s*\n\s+needs: build$/m)
    // Drafts left by earlier runs are deleted and exactly one new draft is created and used by id.
    expect(workflow).toMatch(/select\(\.draft and \.tag_name == \\"\$TAG\\"\)/)
    expect(workflow).toMatch(/gh api -X DELETE "repos\/\$R\/releases\/\$OLD"/)
    expect(workflow).toMatch(/-F draft=true/)
    // Already-published releases are never modified.
    expect(workflow).toMatch(/already published: refusing to change it/)
    // macOS: the arm64 .zip (in-place updates) and .dmg (manual installs), named by architecture only as installed
    // apps expect. Windows and Linux: installers named after their system, never a .zip or .dmg.
    for (const name of ['arm64.zip', 'arm64.dmg', 'win-x64.exe', 'linux-x86_64.AppImage', 'linux-amd64.deb']) expect(workflow).toContain(`Adar-$V-${name}`)
    expect(workflow).not.toMatch(/x64\.(zip|dmg)/)
    expect(workflow).not.toMatch(/(win|linux)-[\w-]+\.(zip|dmg)\b/)
    // Name + size + "uploaded" state are checked before publishing.
    expect(workflow).toMatch(/grep -qxF "\$f \$SIZE uploaded"/)
    expect(workflow).toMatch(/-F draft=false -f make_latest=true/)
  })

  it('builds Apple Silicon for macOS and x64 installers named after their system for Windows and Linux', () => {
    expect(section('mac')).toMatch(/arch: \[arm64\]/)
    expect(section('mac')).not.toMatch(/x64/)
    // Installed macOS apps (and the website) pick their files by architecture alone: Adar-<version>-arm64.zip.
    expect(builder).toMatch(/^artifactName: \$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m)
    expect(section('win')).toMatch(/^\s+artifactName: \$\{productName\}-\$\{version\}-win-\$\{arch\}\.\$\{ext\}$/m)
    expect(section('linux')).toMatch(/^\s+artifactName: \$\{productName\}-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m)
    expect(section('win')).toMatch(/target: nsis\s+arch: \[x64\]/)
    expect(section('linux')).toMatch(/target: AppImage\s+arch: \[x64\]\s+- target: deb\s+arch: \[x64\]/)
    for (const os of ['win', 'linux']) expect(section(os)).not.toMatch(/target: (zip|dmg)\b/)
  })

  it('signs and notarizes the macOS build, with the Apple secrets in that step only', () => {
    expect(workflow).not.toContain('CSC_IDENTITY_AUTO_DISCOVERY')
    const steps = workflow.split(/\n(?= {6}- )/)
    const macBuild = steps.filter((s) => s.includes("if: runner.os == 'macOS'") && s.includes('npm run ${{ matrix.script }}'))
    expect(macBuild).toHaveLength(1)
    // Signed with one Developer ID certificate only (hardened runtime by default), never another one in the keychain;
    // the release workflow checks that the signed app belongs to its team.
    const identity = section('mac').match(/^\s+identity: (.+) \(([A-Z0-9]{10})\)$/m)
    expect(identity?.[1]).toBe('Mikel Garcia')
    expect(macBuild[0]).toContain(`grep -F 'Developer ID Application: ${identity?.[1]} (${identity?.[2]})'`)
    expect(macBuild[0]).toContain(`grep -qx 'TeamIdentifier=${identity?.[2]}'`)
    // The certificate goes into a keychain of the workflow's own, unlocked with that keychain's password: with
    // CSC_LINK, electron-builder 26 passes the certificate's password instead and current macOS refuses it.
    expect(workflow).not.toMatch(/^\s+CSC_LINK:/m)
    expect(macBuild[0]).toContain('export CSC_KEYCHAIN="$RUNNER_TEMP/')
    expect(macBuild[0]).toContain('security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$CSC_KEYCHAIN"')
    expect(macBuild[0]).toContain('https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer')
    for (const secret of ['MAC_CERT_P12_BASE64', 'MAC_CERT_PASSWORD', 'APPLE_API_KEY_P8', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
      expect(steps.filter((s) => s.includes(`secrets.${secret}`))).toEqual(macBuild)
    }
    // A missing secret fails the build; the app must be Developer ID signed, notarized and stapled before upload.
    expect(macBuild[0]).toContain('::error::Missing secret for $v')
    expect(macBuild[0]).toMatch(/grep -q '\^Authority=Developer ID Application:'/)
    expect(macBuild[0]).toMatch(/spctl --assess --type execute/)
    expect(macBuild[0]).toMatch(/xcrun stapler validate/)
    // Windows and Linux build without any signing secret.
    const otherBuild = steps.find((s) => s.includes("if: runner.os != 'macOS'"))
    expect(otherBuild).toMatch(/run: npm run \$\{\{ matrix\.script \}\}/)
    expect(otherBuild).not.toContain('secrets.')
    // Every other secret is used by the publish job, which runs no project code.
    const publish = workflow.slice(workflow.indexOf('\n  publish:'))
    for (const step of steps.filter((s) => s.includes('secrets.') && !macBuild.includes(s))) expect(publish).toContain(step)
  })

  it('serialises release runs and keeps the token away from checkout and tests', () => {
    expect(workflow).toMatch(/^concurrency:\s*\n\s+group: release\s*\n\s+cancel-in-progress: false/m)
    expect(workflow).toMatch(/^permissions:\s*\n\s+contents: read/m)
    expect(workflow).toMatch(/persist-credentials: false/)
    expect(workflow).not.toMatch(/persist-credentials: true/)
    // Only the publish job (which runs no project code) may write to the repository.
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    expect(workflow.slice(workflow.indexOf('\n  publish:'))).toContain('contents: write')
  })
})
