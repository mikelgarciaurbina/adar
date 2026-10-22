// In-app updates from GitHub Releases (works for unsigned macOS builds, where
// Squirrel.Mac auto-update is not available). Implemented in src/main/updater.ts,
// exposed over the same invoke channel as AdarApi (method names below), and
// surfaced in the renderer by components/update.

export const UPDATE_REPO = 'mikelgarciaurbina/adar'
/** CFBundleIdentifier of release builds (electron-builder.yml appId). */
export const APP_BUNDLE_ID = 'dev.adar.gitclient'
/** Hosts GitHub serves release downloads from (browser_download_url and its redirect targets). */
export const UPDATE_DOWNLOAD_HOSTS: readonly string[] = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']

export type UpdateState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateAsset {
  name: string
  url: string
  size: number
  /** SHA-256 (lower-case hex) from the release API's asset "digest" ("sha256:<hex>"), when GitHub provides it. */
  sha256?: string | null
}

/** Asset as returned by GET /repos/{owner}/{repo}/releases/latest. */
export interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  /** "sha256:<hex>" (GitHub computes it on upload; null for assets uploaded before it existed). */
  digest?: string | null
  /** "uploaded" once complete ("open" while an upload is in progress). */
  state?: string
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseName: string
  /** Release notes (Markdown body of the GitHub release). */
  notes: string
  /** Web page of the release. */
  releaseUrl: string
  publishedAt: string
  /**
   * .zip for in-place install (preferred) and .dmg for manual install, for this CPU architecture. Always null on
   * Windows and Linux, which update from the release page (see updatesFromReleasePage).
   */
  zip: UpdateAsset | null
  dmg: UpdateAsset | null
}

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  /** Latest release info when known (available / downloading / downloaded). */
  info: UpdateInfo | null
  /** 0–100 while downloading. */
  progress?: number
  /** True when "Update & restart" can replace the installed app in place. */
  canInstall: boolean
  error?: string
  /** Set on the status that answers a user-initiated check (menu / palette). */
  manual?: boolean
  checkedAt?: number
}

export const UPDATE_METHODS = ['updateGetStatus', 'updateCheck', 'updateDownload', 'updateInstall', 'updateSkip'] as const
export type UpdateMethod = (typeof UPDATE_METHODS)[number]

export interface UpdateApi {
  updateGetStatus(): Promise<UpdateStatus>
  /** manual = user-initiated: the answer is always surfaced (even "up to date") and skipped versions are ignored. */
  updateCheck(manual?: boolean): Promise<UpdateStatus>
  updateDownload(): Promise<UpdateStatus>
  /** Replace the app and relaunch (packaged macOS builds), or open the downloaded .dmg / release page otherwise. */
  updateInstall(): Promise<void>
  /** Do not notify about this version again. */
  updateSkip(version: string): Promise<void>
}

/** Compare dotted versions ("1.2.10" > "1.2.9"; "1.0.0" > "1.0.0-beta.1"). Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre = ''] = v.trim().replace(/^v/i, '').split('-', 2)
    return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre.localeCompare(pb.pre, undefined, { numeric: true }) > 0 ? 1 : -1
}

/** Hex SHA-256 from an asset digest ("sha256:<64 hex>"), or null when absent / another algorithm. */
export function parseAssetDigest(digest: unknown): string | null {
  if (typeof digest !== 'string') return null
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim())
  return m ? m[1].toLowerCase() : null
}

/** How asset names spell each CPU architecture (electron-builder: x64 / x86_64 for AppImage / amd64 for deb). */
const ARCH_NAMES: Record<string, RegExp> = { x64: /x64|x86_64|amd64|intel/i, arm64: /arm64|aarch64|apple-silicon/i }
/** Systems named in asset names. macOS assets name none (Adar-<version>-arm64.zip); Windows and Linux ones do. */
const OS_NAMES: Record<string, RegExp> = { darwin: /\b(mac|macos|darwin)\b/i, win32: /\b(win|windows)\b/i, linux: /\blinux\b/i }

/**
 * Pick the .zip / .dmg assets for this system and CPU architecture (falls back to universal / arch-less names).
 * Only macOS updates from release assets: Windows and Linux get none and are sent to the release page.
 */
export function pickAssets(assets: GithubReleaseAsset[], arch: string, platform: string): { zip: UpdateAsset | null; dmg: UpdateAsset | null } {
  if (platform !== 'darwin') return { zip: null, dmg: null }
  const own = ARCH_NAMES[arch] ?? new RegExp(arch, 'i')
  const otherArch = (name: string) => Object.entries(ARCH_NAMES).some(([a, re]) => a !== arch && re.test(name))
  const otherOs = (name: string) => Object.entries(OS_NAMES).some(([os, re]) => os !== platform && re.test(name))
  const score = (name: string) => (otherOs(name) ? 0 : own.test(name) ? 3 : /universal/i.test(name) ? 2 : otherArch(name) ? 0 : 1)
  const best = (ext: string): UpdateAsset | null => {
    const list = assets
      .filter((a) => a.name.toLowerCase().endsWith(ext) && !a.name.toLowerCase().endsWith('.blockmap') && score(a.name) > 0)
      // An upload still in progress (or failed) is not offered.
      .filter((a) => a.state === undefined || a.state === 'uploaded')
      .sort((x, y) => score(y.name) - score(x.name))
    const a = list[0]
    if (!a) return null
    const sha256 = parseAssetDigest(a.digest)
    return { name: a.name, url: a.browser_download_url, size: a.size, ...(sha256 ? { sha256 } : {}) }
  }
  return { zip: best('.zip'), dmg: best('.dmg') }
}

/** No asset this build can download (Windows, Linux, or a release without one): "Update" opens the release page. */
export function updatesFromReleasePage(info: UpdateInfo): boolean {
  return !info.zip && !info.dmg
}

/**
 * Whether the updater may download from `url`: https on GitHub's release hosts only (on github.com,
 * only this repository's release downloads). With a test feed (ADAR_UPDATE_FEED,
 * scripts/test-updater.sh) plain http on 127.0.0.1 is allowed too.
 */
export function isAllowedDownloadUrl(url: string, opts: { allowLoopbackHttp?: boolean } = {}): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.username || u.password) return false
  if (u.protocol === 'https:' && !u.port) {
    const host = u.hostname.toLowerCase()
    if (host === 'github.com') return u.pathname.toLowerCase().startsWith(`/${UPDATE_REPO.toLowerCase()}/releases/download/`)
    return UPDATE_DOWNLOAD_HOSTS.includes(host)
  }
  return !!opts.allowLoopbackHttp && u.protocol === 'http:' && u.hostname === '127.0.0.1'
}

/** The release page to open: GitHub's html_url when it is one, else the repository's releases page. */
export function releasePageUrl(htmlUrl: unknown): string {
  const fallback = `https://github.com/${UPDATE_REPO}/releases`
  if (typeof htmlUrl !== 'string') return fallback
  try {
    const u = new URL(htmlUrl)
    return u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username ? u.href : fallback
  } catch {
    return fallback
  }
}

/**
 * Why an extracted update bundle must not replace the running app (null when it may): it has to be
 * the same app (bundle identifier) at exactly the advertised version, and newer than the running one.
 */
export function bundleMismatch(
  bundle: { id: unknown; version: unknown },
  expected: { id: string; version: string; currentVersion: string }
): string | null {
  if (bundle.id !== expected.id) return `The update is a different app (${String(bundle.id)}, expected ${expected.id})`
  if (typeof bundle.version !== 'string' || bundle.version !== expected.version) {
    return `The update contains version ${String(bundle.version)}, expected ${expected.version}`
  }
  if (compareVersions(bundle.version, expected.currentVersion) <= 0) {
    return `Refusing to replace Adar ${expected.currentVersion} with ${bundle.version} (not newer)`
  }
  return null
}
