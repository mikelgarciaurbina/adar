// In-app updater: downloads are verified (host, SHA-256 digest / size) before they can be installed,
// a folder only administrators can change is updated through the password dialog, and the release
// pipeline only publishes complete, verified releases. Electron is replaced by a stub whose net.fetch
// is Node's fetch; the "GitHub" feed and assets are served from 127.0.0.1.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'adar-updater-')))
const openExternal = vi.hoisted(() => vi.fn(async (_url: string) => undefined))
const showItemInFolder = vi.hoisted(() => vi.fn((_file: string) => undefined))
/** The running app: unpackaged unless a test installs from a fake bundle (`exe` inside it). */
const running = vi.hoisted(() => ({ packaged: false, exe: '' }))
const runAsAdmin = vi.hoisted(() => vi.fn(async (_script: string, _args: readonly string[], _opts: unknown) => undefined))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return running.packaged
    },
    getPath: (name: string) => (name === 'exe' ? running.exe : tmp),
    quit: () => undefined
  },
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  shell: { openExternal, openPath: async () => '', showItemInFolder }
}))
vi.mock('./admin', () => ({ runAsAdmin }))

import { AdarError } from '@shared/errors'
import { withoutInstallSection, type UpdateStatus } from '@shared/update'
import { ADMIN_SWAP_SCRIPT, mainProcessPattern, Updater } from './updater'

let payload = Buffer.from('PK\u0003\u0004 pretend this is Adar.app zipped\n'.repeat(1000))
let sha256 = createHash('sha256').update(payload).digest('hex')
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

/** A bundle with what the updater reads: Info.plist (identifier, version), plus a `version` file for the tests. */
function fakeBundle(dir: string, version: string): string {
  const bundle = path.join(dir, 'Adar.app')
  mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'Adar'), '')
  writeFileSync(
    path.join(bundle, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.adar.gitclient.test</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`
  )
  writeFileSync(path.join(bundle, 'version'), version)
  return bundle
}

const versionOf = (bundle: string) => readFileSync(path.join(bundle, 'version'), 'utf8')

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; !check() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50))
}

// Packaged macOS builds only (ditto, plutil). As root every folder is writable, so nothing would need a password.
describe.skipIf(realPlatform !== 'darwin' || process.getuid?.() === 0)('installing into a folder only administrators can change', () => {
  const testPayload = { payload, sha256 }
  let apps: string
  let bundle: string

  beforeAll(() => {
    // The update: Adar.app 0.0.2, zipped as the release does.
    const src = mkdtempSync(path.join(tmp, 'next-'))
    const zip = path.join(src, 'next.zip')
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', fakeBundle(src, '0.0.2'), zip])
    payload = readFileSync(zip)
    sha256 = createHash('sha256').update(payload).digest('hex')
  })
  afterAll(() => {
    ;({ payload, sha256 } = testPayload)
  })
  beforeEach(() => {
    apps = mkdtempSync(path.join(tmp, 'Applications-'))
    bundle = fakeBundle(apps, '0.0.1')
    running.packaged = true
    running.exe = path.join(bundle, 'Contents', 'MacOS', 'Adar')
    runAsAdmin.mockReset()
    showItemInFolder.mockClear()
  })
  afterEach(() => {
    chmodSync(apps, 0o755)
    running.packaged = false
  })

  async function downloaded(): Promise<Updater> {
    feed({ digest: `sha256:${sha256}` })
    const updater = newUpdater()
    expect((await updater.updateCheck(true)).state).toBe('available')
    expect(await updater.updateDownload()).toMatchObject({ state: 'downloaded', canInstall: true })
    return updater
  }
  const unpacked = () => readdirSync(tmp).filter((e) => e.startsWith('adar-update-'))

  it('asks for the password while Adar is open; cancelling leaves the download to install by hand', async () => {
    chmodSync(apps, 0o555)
    const updater = await downloaded()
    runAsAdmin.mockRejectedValueOnce(new AdarError({ code: 'CANCELLED', message: 'Cancelled' }))
    expect(await updater.updateInstall()).toEqual({ reason: 'cancelled', folder: path.basename(apps) })
    // Only the swap runs as root, inline, after Adar quits; the verified bundle comes from this account's temp folder.
    expect(runAsAdmin).toHaveBeenCalledTimes(1)
    const [script, args, opts] = runAsAdmin.mock.calls[0]
    expect(script).toBe(ADMIN_SWAP_SCRIPT)
    expect(args).toEqual([String(process.pid), bundle, expect.stringMatching(/\/adar-update-[^/]+\/Adar\.app$/), mainProcessPattern(bundle)])
    expect(opts).toMatchObject({ background: true, prompt: `Adar needs an administrator's name and password to install version 0.0.2 in ${path.basename(apps)}.` })
    expect(unpacked()).toEqual([])
    expect(versionOf(bundle)).toBe('0.0.1')
    // Finder only opens when the user asks for it.
    expect(showItemInFolder).not.toHaveBeenCalled()
    await updater.updateShowDownload()
    expect(showItemInFolder).toHaveBeenCalledWith(path.join(tmp, 'updates', assetName))
  })

  it('reports why the rights could not be obtained', async () => {
    chmodSync(apps, 0o555)
    const updater = await downloaded()
    const message = 'Could not get administrator rights to replace Adar: The administrator user name or password was incorrect.'
    runAsAdmin.mockRejectedValueOnce(new AdarError({ code: 'UNKNOWN', message }))
    expect(await updater.updateInstall()).toEqual({ reason: 'failed', folder: path.basename(apps), error: message })
    expect(unpacked()).toEqual([])
  })

  it('never asks for a password for a read-only copy', async () => {
    // A quarantined download macOS runs from a temporary read-only copy until it is moved (App Translocation).
    const translocated = path.join(tmp, 'AppTranslocation', 'A1B2', 'd')
    mkdirSync(translocated, { recursive: true })
    running.exe = path.join(fakeBundle(translocated, '0.0.1'), 'Contents', 'MacOS', 'Adar')
    const updater = await downloaded()
    expect(await updater.updateInstall()).toEqual({ reason: 'read-only', folder: 'd' })
    expect(runAsAdmin).not.toHaveBeenCalled()
  })
})

describe.skipIf(realPlatform !== 'darwin')('ADMIN_SWAP_SCRIPT (run as this user)', () => {
  /** The script with shorter waits (each `from` must be in it). */
  function script(waits: Record<string, string>): string {
    let s = ADMIN_SWAP_SCRIPT
    for (const [from, to] of Object.entries(waits)) {
      expect(s).toContain(from)
      s = s.replace(from, to)
    }
    return s
  }
  const QUICK = { 'sleep 10': 'sleep 1' }

  function setup(): { current: string; fresh: string; backup: string } {
    const dir = mkdtempSync(path.join(tmp, 'swap-'))
    mkdirSync(path.join(dir, 'Apps'))
    mkdirSync(path.join(dir, 'work'))
    const current = fakeBundle(path.join(dir, 'Apps'), 'old')
    const fresh = fakeBundle(path.join(dir, 'work'), 'new')
    return { current, fresh, backup: `${current}.adar-old` }
  }
  function run(s: string, pid: number, current: string, fresh: string): Promise<number | null> {
    return new Promise((resolve) => {
      spawn('/bin/sh', ['-c', s, 'sh', String(pid), current, fresh, mainProcessPattern(current)], { stdio: 'ignore' }).on('exit', resolve)
    })
  }
  /** A process id that is no longer running. */
  const quitPid = () => spawnSync('/usr/bin/true').pid
  /** A process that looks like the new version to pgrep (its command line starts with the bundle's executable). */
  const startNewVersion = (current: string) => spawn('/bin/sleep', ['30'], { stdio: 'ignore', argv0: path.join(current, 'Contents', 'MacOS', 'Adar') })

  it('swaps once Adar has quit and removes the previous version once the new one has run', { timeout: 15_000 }, async () => {
    const { current, fresh, backup } = setup()
    const adar = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
    const done = run(script(QUICK), adar.pid!, current, fresh)
    await new Promise((r) => setTimeout(r, 500))
    expect(versionOf(current)).toBe('old')
    adar.kill()
    await waitFor(() => !existsSync(fresh))
    expect(versionOf(current)).toBe('new')
    expect(versionOf(backup)).toBe('old')
    const next = startNewVersion(current)
    try {
      expect(await done).toBe(0)
      expect(existsSync(backup)).toBe(false)
    } finally {
      next.kill()
    }
  })

  it('keeps the previous version when the new one does not start', { timeout: 15_000 }, async () => {
    const { current, fresh, backup } = setup()
    expect(await run(script({ ...QUICK, '-gt 300': '-gt 3' }), quitPid(), current, fresh)).toBe(0)
    expect(versionOf(current)).toBe('new')
    expect(versionOf(backup)).toBe('old')
  })

  it('puts the installed version back when the new one cannot be moved in', async () => {
    const { current, fresh, backup } = setup()
    rmSync(fresh, { recursive: true })
    expect(await run(script(QUICK), quitPid(), current, fresh)).toBe(1)
    expect(versionOf(current)).toBe('old')
    expect(existsSync(backup)).toBe(false)
  })

  it('changes nothing when Adar does not quit', { timeout: 15_000 }, async () => {
    const { current, fresh, backup } = setup()
    const adar = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
    try {
      expect(await run(script({ '-gt 1500': '-gt 3' }), adar.pid!, current, fresh)).toBe(1)
    } finally {
      adar.kill()
    }
    expect(versionOf(current)).toBe('old')
    expect(versionOf(fresh)).toBe('new')
    expect(existsSync(backup)).toBe(false)
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

  it("has the notes of this version in build/release-notes.md (the release body, bundled for What's new)", () => {
    const { version } = JSON.parse(read('package.json')) as { version: string }
    const notes = read('build/release-notes.md')
    expect(notes, `build/release-notes.md should be the notes of ${version} (its Install section names Adar-${version}-…)`).toContain(`Adar-${version}-`)
    expect(workflow).toContain('-f body="$(cat build/release-notes.md)"')
    const shown = withoutInstallSection(notes)
    expect(shown).toMatch(/^#{1,6} \S/)
    expect(shown).not.toMatch(/^#{1,6}\s+Install/im)
  })

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
