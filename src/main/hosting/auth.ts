// How Adar signs in to GitHub: the GitHub CLI's own sign-in (asked for each time, never stored
// by Adar) or a personal access token kept encrypted with the system keychain (Electron
// safeStorage). Tokens are never logged, sent to the renderer or written in clear.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { writeJsonAtomic } from '../system/settings'

const execFileP = promisify(execFile)

/** gh's token is asked for again after this long (it can be refreshed or signed out meanwhile). */
const GH_TOKEN_TTL_MS = 5 * 60_000

/** Encrypts secrets with a key held by the operating system (Keychain, DPAPI, libsecret). */
export interface SecretBox {
  /** False when the system offers no protected storage (e.g. Linux without a keyring). */
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

/** A personal access token as GitHub issues them: printable, no spaces, sensible length. */
export function isPlausibleToken(token: unknown): token is string {
  return typeof token === 'string' && token.length >= 20 && token.length <= 255 && /^[\x21-\x7e]+$/.test(token)
}

/** gh's config folder (GH_CONFIG_DIR, XDG_CONFIG_HOME/gh, %AppData%\GitHub CLI or ~/.config/gh). */
export function ghConfigDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = os.homedir()): string {
  if (env.GH_CONFIG_DIR) return env.GH_CONFIG_DIR
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'gh')
  if (platform === 'win32' && env.AppData) return path.join(env.AppData, 'GitHub CLI')
  return path.join(home, '.config', 'gh')
}

/** The `user:` of the github.com entry in gh's hosts.yml, or null. */
export function ghUserFromHosts(yaml: string): string | null {
  let inHost = false
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      inHost = /^"?github\.com"?:\s*$/.test(line)
      continue
    }
    const m = inHost ? /^\s+user:\s*"?([A-Za-z0-9-]{1,39})"?\s*$/.exec(line) : null
    if (m) return m[1]
  }
  return null
}

/** The GitHub CLI (`gh`), when it is installed and signed in to github.com. */
export class GhCli {
  private cached: { token: string; at: number } | null = null

  /** `ready` resolves once the login-shell PATH is in place (gh usually lives in /opt/homebrew/bin). */
  constructor(private readonly ready: Promise<void>) {}

  /** gh's token for github.com, or null when gh is missing or signed out. */
  async token(): Promise<string | null> {
    if (this.cached && Date.now() - this.cached.at < GH_TOKEN_TTL_MS) return this.cached.token
    await this.ready
    try {
      const { stdout } = await execFileP('gh', ['auth', 'token', '--hostname', 'github.com'], {
        timeout: 10_000,
        windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }
      })
      const token = stdout.trim()
      if (!isPlausibleToken(token)) return null
      this.cached = { token, at: Date.now() }
      return token
    } catch {
      this.cached = null
      return null
    }
  }

  /** gh's github.com user ('' when gh is signed in but does not say who), or null when it is not signed in. */
  async login(): Promise<string | null> {
    if (!(await this.token())) return null
    const yaml = await fs.readFile(path.join(ghConfigDir(), 'hosts.yml'), 'utf8').catch(() => '')
    return ghUserFromHosts(yaml) ?? ''
  }

  forget(): void {
    this.cached = null
  }
}

/** A personal access token, encrypted at rest in <userData>/github-token.json. */
export class TokenStore {
  private readonly file: string

  constructor(
    userDataDir: string,
    private readonly box: SecretBox | undefined
  ) {
    this.file = path.join(userDataDir, 'github-token.json')
  }

  available(): boolean {
    try {
      return !!this.box?.available()
    } catch {
      return false
    }
  }

  async read(): Promise<string | null> {
    if (!this.box || !this.available()) return null
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as { v?: unknown; token?: unknown }
      if (data.v !== 1 || typeof data.token !== 'string') return null
      const token = this.box.decrypt(Buffer.from(data.token, 'base64'))
      return isPlausibleToken(token) ? token : null
    } catch {
      return null
    }
  }

  async write(token: string): Promise<void> {
    if (!this.box || !this.available()) throw new Error('This computer offers no protected storage for the token')
    await writeJsonAtomic(this.file, { v: 1, token: this.box.encrypt(token).toString('base64') })
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true })
  }
}
