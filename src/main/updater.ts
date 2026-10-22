// In-app updater backed by GitHub Releases.
//
// Unsigned macOS apps cannot use Squirrel.Mac (electron-updater), so Adar does it itself:
//  1. check:    GET /repos/<owner>/<repo>/releases/latest and compare versions;
//  2. download: stream the .zip (or .dmg) asset for this CPU into the cache dir, with progress;
//  3. install:  packaged macOS build + .zip → extract with ditto, then a small detached helper
//               waits for Adar to quit, swaps the .app bundle and relaunches it. Anything else
//               (dev build, .dmg only, read-only /Applications) falls back to opening the .dmg
//               or the release page.
// Windows and Linux builds only check: the release has no asset for them to install in place, so
// "Update" opens the release page (pickAssets gives them none).
//
// Integrity (releases are unsigned, so this catches corruption, truncation, replaced or mixed-up
// assets — not a compromised GitHub account): downloads only from GitHub's release hosts over https;
// the file must match the asset's SHA-256 "digest" from the release API (or its size when GitHub
// gives no digest); the extracted bundle must be this app (CFBundleIdentifier) at exactly the
// advertised version, newer than the running one. The previous bundle is kept as
// "<Adar.app>.adar-old" until the new version has started, so a broken update can be rolled back.

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, net, shell } from 'electron'
import { bypassQuitGuard } from './quitGuard'
import {
  APP_BUNDLE_ID,
  bundleMismatch,
  compareVersions,
  isAllowedDownloadUrl,
  pickAssets,
  releasePageUrl,
  UPDATE_REPO,
  type GithubReleaseAsset,
  type UpdateApi,
  type UpdateInfo,
  type UpdateStatus
} from '@shared/update'

const execFileP = promisify(execFile)
const FIRST_CHECK_DELAY = 15_000
const CHECK_INTERVAL = 6 * 60 * 60 * 1000
/** Suffix of the previous bundle kept by the install helper until the new version has started. */
const BACKUP_SUFFIX = '.adar-old'
/** The new version deletes the backup once it has been running this long. */
const BACKUP_CLEANUP_DELAY = 10_000

export interface UpdaterDeps {
  currentVersion: string
  emit(status: UpdateStatus): void
  /** Settings access (backend settings store). */
  getSettings(): Promise<{ checkForUpdates: boolean; skippedUpdateVersion: string }>
  updateSettings(patch: { skippedUpdateVersion?: string }): Promise<unknown>
}

interface GithubRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string
  draft: boolean
  prerelease: boolean
  assets: GithubReleaseAsset[]
}

/** Path of the running .app bundle (packaged macOS builds only). */
function currentBundle(): string | null {
  if (process.platform !== 'darwin' || !app.isPackaged) return null
  const bundle = path.resolve(app.getPath('exe'), '../../..')
  return bundle.endsWith('.app') ? bundle : null
}

/** A string value of a bundle's Info.plist (plutil reads XML and binary plists), or null. */
async function plistValue(bundle: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * rm -rf for app bundles. Not fs.rm: Electron's fs treats the app.asar inside a bundle as a directory,
 * so a recursive fs.rm stops there and leaves the bundle behind.
 */
async function removeBundleTree(p: string): Promise<void> {
  await execFileP('/bin/rm', ['-rf', p]).catch(() => undefined)
}

/** The downloaded update is not the app / version it claims to be. */
class UpdateRejected extends Error {}

/** Test feeds (scripts/test-updater.sh) are served over http from 127.0.0.1. */
function allowLoopbackHttp(): boolean {
  return !!process.env['ADAR_UPDATE_FEED']
}

export class Updater implements UpdateApi {
  private status: UpdateStatus
  private downloadedFile: string | null = null
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private checking: Promise<UpdateStatus> | null = null
  private downloading: Promise<UpdateStatus> | null = null

  constructor(private readonly deps: UpdaterDeps) {
    this.status = { state: 'idle', currentVersion: deps.currentVersion, info: null, canInstall: false }
  }

  /** Start periodic background checks (packaged builds only). */
  start(): void {
    // Downloads from a previous session are never resumed: free the space (~100 MB per update).
    void fs.rm(path.join(app.getPath('userData'), 'updates'), { recursive: true, force: true }).catch(() => undefined)
    // This version started fine: the bundle it replaced is no longer needed for a rollback.
    const bundle = currentBundle()
    let backupRemoved: Promise<void> = Promise.resolve()
    if (bundle && existsSync(bundle + BACKUP_SUFFIX)) {
      backupRemoved = new Promise((resolve) => {
        this.timers.push(setTimeout(() => void removeBundleTree(bundle + BACKUP_SUFFIX).then(resolve), BACKUP_CLEANUP_DELAY))
      })
    }
    // Test hook: with a custom feed, check → download → install immediately (used by scripts/test-updater.sh).
    // The relaunched (updated) app inherits the environment: it finds nothing newer and quits once it
    // has removed the previous bundle.
    if (process.env['ADAR_UPDATE_FEED'] && process.env['ADAR_UPDATE_TEST_AUTOINSTALL'] === '1') {
      setTimeout(() => {
        void (async () => {
          const s = await this.updateCheck(true)
          console.log(`[updater-test] check → ${s.state} ${s.info?.latestVersion ?? ''}`)
          if (s.state !== 'available') {
            await backupRemoved
            return app.quit()
          }
          const d = await this.updateDownload()
          console.log(`[updater-test] download → ${d.state} canInstall=${d.canInstall}`)
          await this.updateInstall()
        })().catch((err) => {
          console.log(`[updater-test] failed: ${String(err)}`)
          app.quit()
        })
      }, 3000)
      return
    }
    if (!app.isPackaged) return
    const tick = () => void this.updateCheck(false).catch(() => undefined)
    this.timers.push(setTimeout(tick, FIRST_CHECK_DELAY))
    this.timers.push(setInterval(tick, CHECK_INTERVAL))
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  async updateGetStatus(): Promise<UpdateStatus> {
    return this.status
  }

  updateCheck(manual = false): Promise<UpdateStatus> {
    // A manual check while downloading/downloaded just re-announces the current state.
    if (this.status.state === 'downloading' || this.status.state === 'downloaded') {
      const s = { ...this.status, manual }
      this.deps.emit(s)
      return Promise.resolve(s)
    }
    if (this.checking) return this.checking
    this.checking = this.doCheck(manual).finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async doCheck(manual: boolean): Promise<UpdateStatus> {
    const settings = await this.deps.getSettings().catch(() => ({ checkForUpdates: true, skippedUpdateVersion: '' }))
    if (!manual && !settings.checkForUpdates) return this.status
    this.set({ state: 'checking', manual: false }, manual)
    try {
      const release = await this.fetchLatest()
      if (!release) {
        return this.set({ state: 'not-available', info: null, manual, checkedAt: Date.now(), error: undefined })
      }
      const latest = release.tag_name.replace(/^v/i, '')
      const newer = compareVersions(latest, this.deps.currentVersion) > 0
      const skipped = !manual && settings.skippedUpdateVersion === latest
      if (!newer || skipped) {
        // Background checks stay silent when nothing is new.
        return this.set({ state: 'not-available', info: null, manual, checkedAt: Date.now(), error: undefined }, manual)
      }
      const { zip, dmg } = pickAssets(Array.isArray(release.assets) ? release.assets : [], process.arch, process.platform)
      const info: UpdateInfo = {
        currentVersion: this.deps.currentVersion,
        latestVersion: latest,
        releaseName: release.name || `Adar ${latest}`,
        notes: release.body || '',
        releaseUrl: releasePageUrl(release.html_url),
        publishedAt: release.published_at,
        zip,
        dmg
      }
      return this.set({ state: 'available', info, manual, checkedAt: Date.now(), error: undefined, progress: undefined })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Background failures (offline…) are silent; manual ones are reported.
      return this.set({ state: 'error', error: message, manual, checkedAt: Date.now() }, manual)
    }
  }

  private async fetchLatest(): Promise<GithubRelease | null> {
    // ADAR_UPDATE_FEED (testing only) points at a JSON document in GitHub's release format.
    const feed = process.env['ADAR_UPDATE_FEED'] || `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
    const res = await net.fetch(feed, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Adar/${this.deps.currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (res.status === 404) return null // no releases published yet
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`)
    const rel = (await res.json()) as GithubRelease
    if (rel.draft || rel.prerelease) return null
    return rel
  }

  updateDownload(): Promise<UpdateStatus> {
    if (this.downloading) return this.downloading
    this.downloading = this.doDownload().finally(() => {
      this.downloading = null
    })
    return this.downloading
  }

  private async doDownload(): Promise<UpdateStatus> {
    const info = this.status.info
    if (!info) throw new Error('No update available to download')
    const preferZip = !!currentBundle()
    const asset = (preferZip ? info.zip ?? info.dmg : info.dmg ?? info.zip) ?? null
    if (!asset) {
      // Nothing downloadable for this platform: send the user to the release page.
      await shell.openExternal(info.releaseUrl)
      return this.status
    }
    const dir = path.join(app.getPath('userData'), 'updates')
    await fs.mkdir(dir, { recursive: true })
    const target = path.join(dir, path.basename(asset.name))
    const partial = `${target}.part`
    this.downloadedFile = null
    await fs.rm(target, { force: true })
    this.set({ state: 'downloading', progress: 0, manual: false, error: undefined })
    try {
      if (!isAllowedDownloadUrl(asset.url, { allowLoopbackHttp: allowLoopbackHttp() })) {
        throw new Error(`Refusing to download the update from ${asset.url}`)
      }
      if (!asset.sha256 && !asset.size) throw new Error('The release gives no checksum or size to verify the download')
      const res = await net.fetch(asset.url, { headers: { 'User-Agent': `Adar/${this.deps.currentVersion}` } })
      // Redirects are followed (github.com → release-assets.githubusercontent.com): check where the body comes from.
      if (res.url && !isAllowedDownloadUrl(res.url, { allowLoopbackHttp: allowLoopbackHttp() })) {
        throw new Error(`Refusing to download the update from ${new URL(res.url).host}`)
      }
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      const total = Number(res.headers.get('content-length')) || asset.size || 0
      const out = createWriteStream(partial)
      const hash = createHash('sha256')
      const reader = res.body.getReader()
      let received = 0
      let lastEmit = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (asset.size && received > asset.size) {
          await reader.cancel().catch(() => undefined)
          out.destroy()
          throw new Error('Downloaded file is larger than the release asset')
        }
        hash.update(value)
        if (!out.write(Buffer.from(value))) await new Promise<void>((r) => out.once('drain', () => r()))
        const now = Date.now()
        if (total && now - lastEmit > 150) {
          lastEmit = now
          this.set({ progress: Math.min(99, Math.round((received / total) * 100)) })
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
      if (asset.size && received !== asset.size) throw new Error('Downloaded file is incomplete')
      if (asset.sha256 && hash.digest('hex') !== asset.sha256) {
        throw new Error('The downloaded file does not match the release checksum (SHA-256)')
      }
      await fs.rename(partial, target)
      this.downloadedFile = target
      return this.set({
        state: 'downloaded',
        progress: 100,
        canInstall: !!currentBundle() && target.endsWith('.zip')
      })
    } catch (err) {
      await fs.rm(partial, { force: true }).catch(() => undefined)
      const message = err instanceof Error ? err.message : String(err)
      this.set({ state: 'error', error: message, manual: true })
      throw err
    }
  }

  async updateInstall(): Promise<void> {
    // Only a file that passed doDownload()'s checks is ever set here.
    const file = this.downloadedFile
    const info = this.status.info
    if (!file || !existsSync(file) || !info) {
      if (info) await shell.openExternal(info.releaseUrl)
      return
    }
    const bundle = currentBundle()
    if (bundle && file.endsWith('.zip')) {
      try {
        await this.installInPlace(file, bundle, info.latestVersion)
        return
      } catch (err) {
        if (process.env['ADAR_UPDATE_TEST_AUTOINSTALL'] === '1') console.log(`[updater-test] install failed: ${String(err)}`)
        if (err instanceof UpdateRejected) {
          // Not the expected app: never offer it for a manual install either.
          this.downloadedFile = null
          await fs.rm(file, { force: true }).catch(() => undefined)
          this.set({ state: 'error', error: err.message, manual: true })
          throw err
        }
        console.error('[adar] in-place update failed, falling back', err)
      }
    }
    // Fallback: open the .dmg (Finder shows the drag-to-Applications window) or reveal the archive.
    if (file.endsWith('.dmg')) await shell.openPath(file)
    else shell.showItemInFolder(file)
  }

  private async installInPlace(zip: string, bundle: string, version: string): Promise<void> {
    await fs.access(path.dirname(bundle), fs.constants.W_OK)
    const work = await fs.mkdtemp(path.join(app.getPath('temp'), 'adar-update-'))
    await execFileP('/usr/bin/ditto', ['-x', '-k', zip, work])
    const entries = (await fs.readdir(work)).filter((e) => e.endsWith('.app'))
    if (entries.length !== 1) {
      await removeBundleTree(work)
      throw new UpdateRejected('The update archive must contain exactly one app')
    }
    const fresh = path.join(work, entries[0])
    // Same app (the running bundle's identifier; test builds use their own), advertised version, newer.
    const mismatch = bundleMismatch(
      { id: await plistValue(fresh, 'CFBundleIdentifier'), version: await plistValue(fresh, 'CFBundleShortVersionString') },
      { id: (await plistValue(bundle, 'CFBundleIdentifier')) ?? APP_BUNDLE_ID, version, currentVersion: this.deps.currentVersion }
    )
    if (mismatch) {
      await removeBundleTree(work)
      throw new UpdateRejected(mismatch)
    }
    // Helper runs after we quit: wait for our pid, swap bundles (rolling back on failure), relaunch.
    // The previous bundle stays as $current.adar-old until the new version has started (start()).
    const script = path.join(work, 'install.sh')
    await fs.writeFile(
      script,
      [
        '#!/bin/sh',
        'pid="$1"; current="$2"; fresh="$3"',
        'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
        `backup="$current${BACKUP_SUFFIX}"`,
        'rm -rf "$backup"',
        'if ! { mv "$current" "$backup" && mv "$fresh" "$current"; }; then',
        '  [ -d "$backup" ] && [ ! -d "$current" ] && mv "$backup" "$current"',
        'fi',
        '/usr/bin/xattr -dr com.apple.quarantine "$current" 2>/dev/null',
        '/usr/bin/open "$current"',
        ''
      ].join('\n'),
      { mode: 0o755 }
    )
    const child = spawn('/bin/sh', [script, String(process.pid), bundle, fresh], { detached: true, stdio: 'ignore' })
    child.unref()
    bypassQuitGuard() // the renderer already confirmed the restart
    app.quit()
  }

  async updateSkip(version: string): Promise<void> {
    await this.deps.updateSettings({ skippedUpdateVersion: version })
    if (this.status.info?.latestVersion === version) this.set({ state: 'not-available', info: null })
  }

  private set(patch: Partial<UpdateStatus>, emit = true): UpdateStatus {
    this.status = { ...this.status, ...patch, currentVersion: this.deps.currentVersion }
    if (patch.state && patch.state !== 'downloaded') this.status.canInstall = patch.canInstall ?? false
    if (emit) this.deps.emit(this.status)
    return this.status
  }
}
