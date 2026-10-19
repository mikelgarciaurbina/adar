// Persistent app settings (<userDataDir>/settings.json) and recent repositories
// (<userDataDir>/recents.json). Writes are atomic (tmp file + rename) and serialised.

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings, type RecentRepo } from '@shared/types'

export const MAX_RECENTS = 30

/** Allowed values for enum-like string settings (anything else is ignored). */
const ENUMS: Partial<Record<keyof AppSettings, readonly string[]>> = {
  theme: ['dark', 'light', 'system'],
  defaultPullMode: ['ff-only', 'merge', 'rebase'],
  dateFormat: ['relative', 'absolute'],
  diffViewMode: ['unified', 'split']
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Keep only known keys whose value has the same shape as the default.
 * Unknown keys and wrongly-typed values are ignored (the default/current value wins).
 */
export function sanitizeSettings(base: AppSettings, rawPatch: unknown): AppSettings {
  const out: AppSettings = structuredClone(base)
  if (!isPlainObject(rawPatch)) return out
  let patch: Record<string, unknown> = rawPatch
  // Legacy diff modes (before layout and full-file were separate settings).
  // 'hunk' showed only the changed hunks, 'inline' the whole file.
  if (patch.diffViewMode === 'hunk' || patch.diffViewMode === 'inline') {
    const legacy = patch.diffViewMode
    patch = { ...patch, diffViewMode: 'unified', ...('diffFullFile' in patch ? {} : { diffFullFile: legacy === 'inline' }) }
  }
  const target = out as unknown as Record<string, unknown>
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in patch)) continue
    const value = patch[key]
    const def = defaults[key]
    if (key === 'activeTab') {
      if (value === null || typeof value === 'string') target[key] = value
      continue
    }
    if (Array.isArray(def)) {
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) target[key] = [...value]
      continue
    }
    if (isPlainObject(def)) {
      if (isPlainObject(value)) {
        const merged: Record<string, unknown> = { ...(target[key] as Record<string, unknown>) }
        for (const sub of Object.keys(def)) {
          if (sub in value && typeof value[sub] === typeof def[sub]) merged[sub] = value[sub]
        }
        target[key] = merged
      }
      continue
    }
    if (typeof def === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) target[key] = value
      continue
    }
    const allowed = ENUMS[key as keyof AppSettings]
    if (allowed) {
      if (typeof value === 'string' && allowed.includes(value)) target[key] = value
      continue
    }
    if (typeof value === typeof def) target[key] = value
  }
  return out
}

function sanitizeRecents(raw: unknown): RecentRepo[] {
  if (!Array.isArray(raw)) return []
  const out: RecentRepo[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    if (!isPlainObject(r) || typeof r.path !== 'string' || !r.path || seen.has(r.path)) continue
    seen.add(r.path)
    out.push({
      path: r.path,
      name: typeof r.name === 'string' && r.name ? r.name : path.basename(r.path),
      lastOpened: typeof r.lastOpened === 'number' && Number.isFinite(r.lastOpened) ? r.lastOpened : 0
    })
  }
  out.sort((a, b) => b.lastOpened - a.lastOpened)
  return out.slice(0, MAX_RECENTS)
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Write JSON atomically: mkdir -p, write a sibling tmp file, rename over the target. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

export class SettingsStore {
  private readonly settingsFile: string
  private readonly recentsFile: string
  private settings: AppSettings | null = null
  private recents: RecentRepo[] | null = null
  private loading: Promise<void> | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(userDataDir: string) {
    this.settingsFile = path.join(userDataDir, 'settings.json')
    this.recentsFile = path.join(userDataDir, 'recents.json')
  }

  private load(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        const [s, r] = await Promise.all([readJson(this.settingsFile), readJson(this.recentsFile)])
        this.settings = sanitizeSettings(DEFAULT_SETTINGS, s)
        this.recents = sanitizeRecents(r)
      })()
    }
    return this.loading
  }

  /** Queue a write after previous ones; failures are swallowed so the chain survives. */
  private persist(file: string, data: unknown): Promise<void> {
    const next = this.writeChain.then(() => writeJsonAtomic(file, data))
    this.writeChain = next.catch(() => undefined)
    return next
  }

  async getSettings(): Promise<AppSettings> {
    await this.load()
    return structuredClone(this.settings!)
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    await this.load()
    this.settings = sanitizeSettings(this.settings!, patch)
    const snapshot = structuredClone(this.settings)
    await this.persist(this.settingsFile, snapshot)
    return structuredClone(snapshot)
  }

  async getRecentRepos(): Promise<RecentRepo[]> {
    await this.load()
    return this.recents!.map((r) => ({ ...r }))
  }

  async addRecentRepo(repoPath: string, name = path.basename(repoPath)): Promise<void> {
    await this.load()
    const now = Math.max(Date.now(), (this.recents![0]?.lastOpened ?? 0) + 1)
    const list = this.recents!.filter((r) => r.path !== repoPath)
    list.unshift({ path: repoPath, name, lastOpened: now })
    this.recents = list.slice(0, MAX_RECENTS)
    await this.persist(this.recentsFile, this.recents)
  }

  async removeRecentRepo(repoPath: string): Promise<void> {
    await this.load()
    const before = this.recents!.length
    this.recents = this.recents!.filter((r) => r.path !== repoPath)
    if (this.recents.length !== before) await this.persist(this.recentsFile, this.recents)
  }

  /** Wait for pending writes (used on dispose). */
  async flush(): Promise<void> {
    await this.writeChain
  }
}
