// In-app updates from GitHub Releases (works for unsigned macOS builds, where
// Squirrel.Mac auto-update is not available). Implemented in src/main/updater.ts,
// exposed over the same invoke channel as AdarApi (method names below), and
// surfaced in the renderer by components/update.

export const UPDATE_REPO = 'mikelgarciaurbina/adar'

export type UpdateState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateAsset {
  name: string
  url: string
  size: number
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
  /** .zip for in-place install (preferred) and .dmg for manual install, for this CPU architecture. */
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

/** Pick the .zip / .dmg assets matching the CPU architecture (falls back to universal / arch-less names). */
export function pickAssets(
  assets: Array<{ name: string; browser_download_url: string; size: number }>,
  arch: string
): { zip: UpdateAsset | null; dmg: UpdateAsset | null } {
  const otherArch = arch === 'arm64' ? /x64|x86_64|intel/i : /arm64|aarch64|apple-silicon/i
  const score = (name: string) => (new RegExp(arch, 'i').test(name) ? 3 : /universal/i.test(name) ? 2 : otherArch.test(name) ? 0 : 1)
  const best = (ext: string): UpdateAsset | null => {
    const list = assets
      .filter((a) => a.name.toLowerCase().endsWith(ext) && !a.name.toLowerCase().endsWith('.blockmap') && score(a.name) > 0)
      .sort((x, y) => score(y.name) - score(x.name))
    const a = list[0]
    return a ? { name: a.name, url: a.browser_download_url, size: a.size } : null
  }
  return { zip: best('.zip'), dmg: best('.dmg') }
}
