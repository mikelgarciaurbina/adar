// Host capabilities that differ between Electron and the browser dev bridge.
// The git backend only talks to the host through this interface.

export interface PlatformAdapter {
  isElectron: boolean
  appVersion: string
  /** Directory for settings.json / recents.json. */
  userDataDir: string
  pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
  openExternal(url: string): Promise<void>
  showInFolder(path: string): Promise<void>
}
