// Host capabilities that differ between Electron and the browser dev bridge.
// The git backend only talks to the host through this interface.

import type { SecretBox } from './hosting/auth'

export interface PlatformAdapter {
  isElectron: boolean
  appVersion: string
  /** Directory for settings.json / recents.json. */
  userDataDir: string
  pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
  openExternal(url: string): Promise<void>
  showInFolder(path: string): Promise<void>
  /** HTTP client for web APIs (Electron's net.fetch follows the system proxy). Default: the global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** Encryption with a key the operating system protects, for tokens kept on disk; absent when unsupported. */
  secrets?: SecretBox
  /** Development only: a stand-in for https://api.github.com on 127.0.0.1 (ADAR_GITHUB_API, unpackaged builds). */
  githubApi?: string
}
