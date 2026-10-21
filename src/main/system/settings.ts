// Persistent app settings (<userDataDir>/settings.json), recent repositories
// (<userDataDir>/recents.json) and trusted repositories (<userDataDir>/trusted.json).
// Writes are atomic (tmp file + rename) and serialised.

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, LEGACY_GROUP_COLORS, TAB_GROUP_COLORS, type AppSettings, type RecentRepo, type TabGroup, type TabGroupColor } from '@shared/types'

export const MAX_RECENTS = 30
export const MAX_TAB_GROUPS = 100
const MAX_GROUP_NAME = 80
/** Trusted repositories kept (most recently trusted first). */
export const MAX_TRUSTED = 1000

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

/** Well-formed groups only: known colours, absolute paths, each repository in one group, unique ids. */
/** A saved group colour: a current one, an older name mapped to its Basoa colour, or mist. */
function groupColor(raw: unknown): TabGroupColor {
  if (typeof raw !== 'string') return 'mist'
  if ((TAB_GROUP_COLORS as readonly string[]).includes(raw)) return raw as TabGroupColor
  return Object.hasOwn(LEGACY_GROUP_COLORS, raw) ? LEGACY_GROUP_COLORS[raw] : 'mist'
}

export function sanitizeTabGroups(raw: unknown): TabGroup[] | null {
  if (!Array.isArray(raw)) return null
  const out: TabGroup[] = []
  const ids = new Set<string>()
  const taken = new Set<string>()
  for (const g of raw) {
    if (!isPlainObject(g) || typeof g.id !== 'string' || !g.id || g.id.length > 64 || ids.has(g.id) || !Array.isArray(g.repos)) continue
    const repos = g.repos.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p) && !taken.has(p))
    const unique = [...new Set(repos)]
    if (!unique.length) continue
    ids.add(g.id)
    for (const p of unique) taken.add(p)
    out.push({
      id: g.id,
      name: typeof g.name === 'string' ? g.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_GROUP_NAME) : '',
      color: groupColor(g.color),
      repos: unique,
      collapsed: g.collapsed === true
    })
    if (out.length >= MAX_TAB_GROUPS) break
  }
  return out
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
    if (key === 'tabGroups') {
      const groups = sanitizeTabGroups(value)
      if (groups) target[key] = groups
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

function sanitizeTrusted(raw: unknown): string[] {
  const list = isPlainObject(raw) && Array.isArray(raw.repos) ? raw.repos : []
  return [...new Set(list.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)))].slice(0, MAX_TRUSTED)
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
  private readonly trustedFile: string
  private settings: AppSettings | null = null
  private recents: RecentRepo[] | null = null
  private trusted: string[] | null = null
  private loading: Promise<void> | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(userDataDir: string) {
    this.settingsFile = path.join(userDataDir, 'settings.json')
    this.recentsFile = path.join(userDataDir, 'recents.json')
    this.trustedFile = path.join(userDataDir, 'trusted.json')
  }

  private load(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        const [s, r, t] = await Promise.all([readJson(this.settingsFile), readJson(this.recentsFile), readJson(this.trustedFile)])
        this.settings = sanitizeSettings(DEFAULT_SETTINGS, s)
        this.recents = sanitizeRecents(r)
        const firstRun = t === undefined && !(await fs.stat(this.trustedFile).then(() => true, () => false))
        if (firstRun) {
          // The trust gate is new: repositories the user already opened in Adar (open tabs, recents) stay trusted.
          const known = [...this.settings.openTabs, ...this.recents.map((x) => x.path)]
          this.trusted = sanitizeTrusted({ repos: known })
          void this.persist(this.trustedFile, { version: 1, repos: this.trusted }).catch(() => undefined)
        } else {
          // A corrupt file trusts nothing (fail closed); it is rewritten on the next trustRepo().
          this.trusted = sanitizeTrusted(t)
        }
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

  /** True when any of `repoPaths` (worktree roots / bare git dirs as git reports them) was trusted. */
  async isTrustedRepo(repoPaths: readonly string[]): Promise<boolean> {
    await this.load()
    return repoPaths.some((p) => this.trusted!.includes(p))
  }

  /** Remember a repository as trusted: openRepo() then skips the repo-config check for it. */
  async trustRepo(repoPath: string): Promise<void> {
    await this.load()
    if (!path.isAbsolute(repoPath)) return
    if (this.trusted![0] === repoPath) return
    this.trusted = [repoPath, ...this.trusted!.filter((p) => p !== repoPath)].slice(0, MAX_TRUSTED)
    await this.persist(this.trustedFile, { version: 1, repos: this.trusted })
  }

  /** Wait for pending writes (used on dispose). */
  async flush(): Promise<void> {
    await this.writeChain
  }
}
