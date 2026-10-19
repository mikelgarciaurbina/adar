// In-app updater backed by GitHub Releases.
//
// Unsigned macOS apps cannot use Squirrel.Mac (electron-updater), so Adar does it itself:
//  1. check:    GET /repos/<owner>/<repo>/releases/latest and compare versions;
//  2. download: stream the .zip (or .dmg) asset for this CPU into the cache dir, with progress;
//  3. install:  packaged macOS build + .zip → extract with ditto, then a small detached helper
//               waits for Adar to quit, swaps the .app bundle and relaunches it. Anything else
//               (dev build, .dmg only, read-only /Applications) falls back to opening the .dmg
//               or the release page.

import { execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app, net, shell } from 'electron'
import {
  compareVersions,
  pickAssets,
  UPDATE_REPO,
  type UpdateApi,
  type UpdateInfo,
  type UpdateStatus
} from '@shared/update'

const execFileP = promisify(execFile)
const FIRST_CHECK_DELAY = 15_000
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

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
  assets: Array<{ name: string; browser_download_url: string; size: number }>
}

/** Path of the running .app bundle (packaged macOS builds only). */
function currentBundle(): string | null {
  if (process.platform !== 'darwin' || !app.isPackaged) return null
  const bundle = path.resolve(app.getPath('exe'), '../../..')
  return bundle.endsWith('.app') ? bundle : null
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
    this.set({ state: 'checking', manual }, false)
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
      const { zip, dmg } = pickAssets(release.assets, process.arch)
      const info: UpdateInfo = {
        currentVersion: this.deps.currentVersion,
        latestVersion: latest,
        releaseName: release.name || `Adar ${latest}`,
        notes: release.body || '',
        releaseUrl: release.html_url,
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
    const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
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
    this.set({ state: 'downloading', progress: 0, manual: false, error: undefined })
    try {
      const res = await net.fetch(asset.url, { headers: { 'User-Agent': `Adar/${this.deps.currentVersion}` } })
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      const total = Number(res.headers.get('content-length')) || asset.size || 0
      const out = createWriteStream(partial)
      const reader = res.body.getReader()
      let received = 0
      let lastEmit = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (!out.write(Buffer.from(value))) await new Promise<void>((r) => out.once('drain', () => r()))
        const now = Date.now()
        if (total && now - lastEmit > 150) {
          lastEmit = now
          this.set({ progress: Math.min(99, Math.round((received / total) * 100)) })
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
      if (asset.size && received !== asset.size) throw new Error('Downloaded file is incomplete')
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
    const file = this.downloadedFile
    const info = this.status.info
    if (!file || !existsSync(file)) {
      if (info) await shell.openExternal(info.releaseUrl)
      return
    }
    const bundle = currentBundle()
    if (bundle && file.endsWith('.zip')) {
      try {
        await this.installInPlace(file, bundle)
        return
      } catch (err) {
        console.error('[adar] in-place update failed, falling back', err)
      }
    }
    // Fallback: open the .dmg (Finder shows the drag-to-Applications window) or reveal the archive.
    if (file.endsWith('.dmg')) await shell.openPath(file)
    else shell.showItemInFolder(file)
  }

  private async installInPlace(zip: string, bundle: string): Promise<void> {
    await fs.access(path.dirname(bundle), fs.constants.W_OK)
    const work = await fs.mkdtemp(path.join(app.getPath('temp'), 'adar-update-'))
    await execFileP('/usr/bin/ditto', ['-x', '-k', zip, work])
    const entries = await fs.readdir(work)
    const appName = entries.find((e) => e.endsWith('.app'))
    if (!appName) throw new Error('The update archive does not contain an app')
    const fresh = path.join(work, appName)
    // Helper runs after we quit: wait for our pid, swap bundles (rolling back on failure), relaunch.
    const script = path.join(work, 'install.sh')
    await fs.writeFile(
      script,
      [
        '#!/bin/sh',
        'pid="$1"; current="$2"; fresh="$3"',
        'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
        'backup="$current.adar-old"',
        'rm -rf "$backup"',
        'if mv "$current" "$backup" && mv "$fresh" "$current"; then',
        '  rm -rf "$backup"',
        'else',
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
