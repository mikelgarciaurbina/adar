// How Adar signs in to the hosting services: the GitHub CLI's and GitLab CLI's own sign-ins (asked for
// each time, never stored by Adar) or tokens kept encrypted with the system keychain (Electron safeStorage).
// Tokens are never logged, sent to the renderer or written in clear.

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

/** The `user:` of a host's entry (github.com by default) in gh's hosts.yml, or null. */
export function ghUserFromHosts(yaml: string, host = 'github.com'): string | null {
  let inHost = false
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      inHost = /^"?([^"]+?)"?:\s*$/.exec(line)?.[1] === host
      continue
    }
    const m = inHost ? /^\s+user:\s*"?([A-Za-z0-9-]{1,39})"?\s*$/.exec(line) : null
    if (m) return m[1]
  }
  return null
}

/** The GitHub CLI (`gh`), when it is installed and signed in to github.com or a GitHub Enterprise host. */
export class GhCli {
  private readonly cached = new Map<string, { token: string; at: number }>()

  /** `ready` resolves once the login-shell PATH is in place (gh usually lives in /opt/homebrew/bin). */
  constructor(private readonly ready: Promise<void>) {}

  /** gh's token for a host (github.com by default), or null when gh is missing or signed out there. */
  async token(host = 'github.com'): Promise<string | null> {
    const hit = this.cached.get(host)
    if (hit && Date.now() - hit.at < GH_TOKEN_TTL_MS) return hit.token
    await this.ready
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null
    try {
      const { stdout } = await execFileP('gh', ['auth', 'token', '--hostname', host], {
        timeout: 10_000,
        windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }
      })
      const token = stdout.trim()
      if (!isPlausibleToken(token)) return null
      this.cached.set(host, { token, at: Date.now() })
      return token
    } catch {
      this.cached.delete(host)
      return null
    }
  }

  /** gh's user on a host ('' when gh is signed in but does not say who), or null when it is not signed in there. */
  async login(host = 'github.com'): Promise<string | null> {
    if (!(await this.token(host))) return null
    const yaml = await fs.readFile(path.join(ghConfigDir(), 'hosts.yml'), 'utf8').catch(() => '')
    return ghUserFromHosts(yaml, host) ?? ''
  }

  forget(host?: string): void {
    if (host) this.cached.delete(host)
    else this.cached.clear()
  }
}

/**
 * The GitLab CLI (`glab`), when it is installed and signed in to a GitLab host: its token is asked for each time and
 * never stored by Adar. `glab config get token` answers when the token is in glab's config file; newer versions keep
 * it in the system keychain, which `glab auth status --show-token` reads.
 */
export class GlabCli {
  private readonly cached = new Map<string, { token: string; at: number }>()

  constructor(private readonly ready: Promise<void>) {}

  async token(host: string): Promise<string | null> {
    const hit = this.cached.get(host)
    if (hit && Date.now() - hit.at < GH_TOKEN_TTL_MS) return hit.token
    await this.ready
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null
    const fromConfig = (await glab(['config', 'get', 'token', '--host', host])).stdout.trim()
    const token = isPlausibleToken(fromConfig) ? fromConfig : glabStatusToken(await glab(['auth', 'status', '--hostname', host, '--show-token']))
    if (!token) {
      this.cached.delete(host)
      return null
    }
    this.cached.set(host, { token, at: Date.now() })
    return token
  }

  forget(host?: string): void {
    if (host) this.cached.delete(host)
    else this.cached.clear()
  }
}

/** Runs glab without prompts; its output even when it fails (auth status exits 1 when any host is signed out). */
async function glab(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileP('glab', args, {
      timeout: 15_000,
      windowsHide: true,
      env: { ...process.env, NO_PROMPT: '1', GLAB_CHECK_UPDATE: 'false', NO_COLOR: '1' }
    })
  } catch (err) {
    const e = err as { stdout?: unknown; stderr?: unknown }
    return { stdout: typeof e.stdout === 'string' ? e.stdout : '', stderr: typeof e.stderr === 'string' ? e.stderr : '' }
  }
}

/** The token in `glab auth status --show-token` ("✓ Token: glpat-…", on stderr), or null. */
export function glabStatusToken(out: { stdout: string; stderr: string }): string | null {
  const token = /\bToken(?: found)?:\s*(\S+)/i.exec(`${out.stderr}\n${out.stdout}`)?.[1] ?? ''
  return isPlausibleToken(token) && !/^\*+$/.test(token) ? token : null
}

/** A token, encrypted at rest in <userData>/<fileName> (github-token.json, bitbucket-token.json…). */
export class TokenStore {
  private readonly file: string

  constructor(
    userDataDir: string,
    private readonly box: SecretBox | undefined,
    fileName = 'github-token.json'
  ) {
    this.file = path.join(userDataDir, fileName)
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
