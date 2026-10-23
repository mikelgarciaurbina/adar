import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL, type InvokeResponse } from '@shared/api'
import { MENUBAR_METHODS, PANEL_API_METHODS, type MenuBarMethod } from '@shared/menubar'
import type { AppSettings, MenuCommand, AdarEvent, RepoInfo } from '@shared/types'
import { UPDATE_METHODS, type UpdateMethod } from '@shared/update'
import { CLI_METHODS, parseOpenRepoArgs, type CliMethod } from '@shared/cli'
import { toErrorPayload } from '@shared/errors'
import { createBackend, type Backend } from './backend'
import { dispatch } from './dispatch'
import type { PlatformAdapter } from './platform'
import { bundledCliPath } from './cliPath'
import { cliStatus, installCli, uninstallCli } from './cli'
import { MenuBar } from './menuBar'
import { pauseOpenRequests, requestOpen, takeOpenRequests } from './openRequests'
import { bypassQuitGuard, isQuitGuardBypassed } from './quitGuard'
import { Updater } from './updater'

// Test hooks (development builds only): isolated user data dir and scripted screenshots.
if (!app.isPackaged && process.env['ADAR_USER_DATA']) app.setPath('userData', process.env['ADAR_USER_DATA'])
const CAPTURE_MODE = !app.isPackaged && !!process.env['ADAR_CAPTURE_STEPS']
if (CAPTURE_MODE) {
  // e2e windows are usually covered by other windows: keep painting and timers running.
  for (const sw of ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding', 'disable-background-timer-throttling']) {
    app.commandLine.appendSwitch(sw)
  }
}

// The app was called "Rama" before; carry settings and recent repos over once.
function migrateLegacyUserData(): void {
  try {
    const dir = app.getPath('userData')
    if (existsSync(join(dir, 'settings.json'))) return
    const legacy = join(app.getPath('appData'), 'Rama')
    if (!existsSync(join(legacy, 'settings.json'))) return
    mkdirSync(dir, { recursive: true })
    for (const f of ['settings.json', 'recents.json']) {
      if (existsSync(join(legacy, f))) copyFileSync(join(legacy, f), join(dir, f))
    }
  } catch {
    /* best effort */
  }
}
migrateLegacyUserData()

let mainWindow: BrowserWindow | null = null
let backend: Backend | null = null
let updater: Updater | null = null
let menuBar: MenuBar | null = null
const UPDATE_METHOD_SET: ReadonlySet<string> = new Set(UPDATE_METHODS)
const CLI_METHOD_SET: ReadonlySet<string> = new Set(CLI_METHODS)
const MENUBAR_METHOD_SET: ReadonlySet<string> = new Set(MENUBAR_METHODS)
const PANEL_API_SET: ReadonlySet<string> = new Set(PANEL_API_METHODS)
/** Backend calls that talk to a remote: the menu bar icon animates while they run. */
const NETWORK_METHODS: ReadonlySet<string> = new Set(['fetch', 'pull', 'push'])
/** Calls that open a repository (past the trust check): the menu bar panel may then read it. */
const REPO_OPENING_METHODS: ReadonlySet<string> = new Set(['openRepo', 'initRepo', 'cloneRepo'])
/** Events that arrived with no window to show them (a credential prompt for a pull started from the menu bar). */
const heldEvents: AdarEvent[] = []

/** Bring the window to the front (or reopen it on macOS) after an external open request. */
function focusMainWindow(): void {
  if (!app.isReady()) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
}

// Folders to open from outside: Finder/Dock/`adar` CLI (macOS "open documents" event, delivered
// before or after launch) and `--open-repo=<path>` launch arguments.
app.on('open-file', (e, file) => {
  e.preventDefault()
  requestOpen(file)
  focusMainWindow()
})
for (const p of parseOpenRepoArgs(process.argv)) requestOpen(p)

function emit(event: AdarEvent): void {
  // A credential prompt for an operation started from the menu bar panel is answered in Adar's window.
  if (event.type === 'credential-request' && menuBar?.panelOperationRunning) {
    menuBar.hidePanel()
    if (!mainWindow || mainWindow.isDestroyed()) {
      heldEvents.push(event)
      focusMainWindow()
      return
    }
    focusMainWindow()
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_EVENT_CHANNEL, event)
  }
  if (event.type === 'repo-changed') menuBar?.sendToPanel(event)
}

/** The renderer is listening again (it asked for the open requests): deliver what waited for it. */
function releaseHeldEvents(): void {
  const events = heldEvents.splice(0)
  if (events.length) setTimeout(() => events.forEach(emit), 300)
}

/**
 * Run a backend call, tracking network operations for the menu bar: the icon animates while they run, and a
 * fetch is compared before and after to notice new commits on the checked-out branch's upstream.
 */
async function invokeBackend(method: unknown, args: unknown, fromPanel: boolean): Promise<InvokeResponse> {
  const repo = Array.isArray(args) && typeof args[0] === 'string' ? args[0] : null
  const mb = menuBar
  if (!mb || !repo || typeof method !== 'string' || !NETWORK_METHODS.has(method)) {
    const res = await dispatch(backend!, method, args)
    if (res.ok && method === 'updateSettings') mb?.apply(res.value as AppSettings)
    if (res.ok && REPO_OPENING_METHODS.has(method as string)) mb?.admit((res.value as RepoInfo).path)
    return res
  }
  if (method === 'fetch') await mb.beforeFetch(repo)
  mb.networkStarted(fromPanel)
  try {
    const res = await dispatch(backend!, method, args)
    if (res.ok && method === 'fetch') void mb.afterFetch(repo)
    return res
  } finally {
    mb.networkEnded(fromPanel)
  }
}

/** Show Adar's window and, with a path, switch to that repository (from the menu bar or a notification). */
function openInAdar(repo: string | null): void {
  if (repo) requestOpen(repo)
  focusMainWindow()
}

/** Load a renderer page (the app or the menu bar panel) from the dev server or the build. */
function loadRendererPage(win: BrowserWindow, page: 'index' | 'menubar'): void {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(page === 'index' ? process.env['ELECTRON_RENDERER_URL'] : `${process.env['ELECTRON_RENDERER_URL']}/${page}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`))
  }
}

function sendMenu(command: MenuCommand): void {
  emit({ type: 'menu', command })
}

const platform: PlatformAdapter = {
  isElectron: true,
  appVersion: typeof __ADAR_VERSION__ === 'string' ? __ADAR_VERSION__ : app.getVersion(),
  userDataDir: app.getPath('userData'),
  async pickDirectory(opts) {
    const options: Electron.OpenDialogOptions = {
      title: opts?.title ?? 'Select folder',
      defaultPath: opts?.defaultPath,
      properties: ['openDirectory', 'createDirectory']
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  },
  async openExternal(url) {
    if (!/^(https?|mailto):/i.test(url)) throw new Error(`Refusing to open non-web URL: ${url}`)
    await shell.openExternal(url)
  },
  async showInFolder(path) {
    shell.showItemInFolder(path)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Adar',
    backgroundColor: '#0a0d0c',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !CAPTURE_MODE
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Never let the renderer navigate away or open new windows inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
  })

  loadRendererPage(mainWindow, 'index')

  // Open requests arriving while the page (re)loads are queued until the renderer asks for them.
  mainWindow.webContents.on('did-start-loading', () => pauseOpenRequests())
  mainWindow.on('closed', () => {
    pauseOpenRequests()
    mainWindow = null
  })

  const steps = process.env['ADAR_CAPTURE_STEPS']
  if (!app.isPackaged && steps) {
    mainWindow.webContents.once('did-finish-load', () => void runCaptureSteps(steps))
  }
}

/**
 * Scripted e2e capture for development: ADAR_CAPTURE_STEPS points at a JSON array of
 * {wait: ms} | {js: "expression"} | {jsFile: "/abs/file.js"} | {shot: "name"} | {size: [w, h]} steps. Screenshots go to
 * ADAR_CAPTURE_DIR (default: cwd). Results of js steps are printed to stdout. Quits when done.
 */
async function runCaptureSteps(file: string): Promise<void> {
  const fs = await import('node:fs/promises')
  const outDir = process.env['ADAR_CAPTURE_DIR'] || process.cwd()
  type Step = { wait?: number; js?: string; jsFile?: string; shot?: string; size?: [number, number]; panel?: boolean; panelJs?: string; panelShot?: string }
  try {
    const list = JSON.parse(await fs.readFile(file, 'utf8')) as Step[]
    for (const step of list) {
      const win = mainWindow
      if (!win) break
      if (step.size) win.setContentSize(step.size[0], step.size[1])
      if (step.wait) await new Promise((r) => setTimeout(r, step.wait))
      if (step.jsFile) step.js = await fs.readFile(step.jsFile, 'utf8')
      if (step.js) {
        try {
          const res = await win.webContents.executeJavaScript(step.js, true)
          console.log(`[capture] js → ${JSON.stringify(res)?.slice(0, 2000)}`)
        } catch (err) {
          console.log(`[capture] js error: ${String(err)}`)
        }
      }
      // The menu bar panel: {"panel": true} opens it, {"panelJs"} runs in it, {"panelShot"} captures it.
      if (step.panel && menuBar) {
        menuBar.stayOpen = true
        menuBar.showPanel()
      }
      const panel = menuBar?.panelWindow()
      if (step.panelJs && panel) {
        try {
          const res = await panel.webContents.executeJavaScript(step.panelJs, true)
          console.log(`[capture] panel js → ${JSON.stringify(res)?.slice(0, 2000)}`)
        } catch (err) {
          console.log(`[capture] panel js error: ${String(err)}`)
        }
      }
      if (step.panelShot && panel) {
        try {
          const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 8000))
          const img = await Promise.race([panel.webContents.capturePage(), timeout])
          const path = join(outDir, `${step.panelShot}.png`)
          await fs.writeFile(path, img.toPNG())
          console.log(`[capture] saved ${path}`)
        } catch (err) {
          console.log(`[capture] panel shot error: ${String(err)}`)
        }
      }
      if (step.shot) {
        // Make sure the latest DOM state is painted before capturing.
        win.webContents.invalidate()
        await win.webContents
          .executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))', true)
          .catch(() => undefined)
        const img = await win.webContents.capturePage()
        const path = join(outDir, `${step.shot}.png`)
        await fs.writeFile(path, img.toPNG())
        console.log(`[capture] saved ${path}`)
      }
    }
  } catch (err) {
    console.log(`[capture] failed: ${String(err)}`)
  } finally {
    bypassQuitGuard()
    app.quit()
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => sendMenu(command)
  })

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              item('About Adar', 'about'),
              { label: 'Check for Updates…', click: () => void updater?.updateCheck(true) },
              item("What's New in Adar", 'whats-new'),
              item('Install Command Line Tool…', 'install-cli'),
              { type: 'separator' },
              item('Settings…', 'settings', 'CmdOrCtrl+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        item('Open Repository…', 'open-repo', 'CmdOrCtrl+O'),
        item('Open Repository by Path…', 'open-repo-path', 'CmdOrCtrl+Shift+O'),
        item('Clone Repository…', 'clone-repo', 'CmdOrCtrl+Shift+N'),
        item('Init Repository…', 'init-repo', 'CmdOrCtrl+Alt+N'),
        { type: 'separator' },
        item('Close Tab', 'close-tab', 'CmdOrCtrl+W'),
        item('Next Tab', 'next-tab', 'Ctrl+Tab'),
        item('Previous Tab', 'prev-tab', 'Ctrl+Shift+Tab'),
        ...(isMac ? [] : [{ type: 'separator' } as const, item('Settings…', 'settings', 'Ctrl+,'), { role: 'quit' } as const])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find Commit…', 'search-commits', 'CmdOrCtrl+F'),
        item('Command Palette…', 'command-palette', 'CmdOrCtrl+P')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Refresh', 'refresh', 'CmdOrCtrl+R'),
        { type: 'separator' },
        item('Toggle Left Panel', 'toggle-left-panel', 'CmdOrCtrl+J'),
        item('Filter Branches', 'focus-branch-filter', 'CmdOrCtrl+Alt+F'),
        item('Toggle Right Panel', 'toggle-right-panel', 'CmdOrCtrl+K'),
        { type: 'separator' },
        item('Zoom In', 'zoom-in', 'CmdOrCtrl+='),
        item('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
        item('Actual Size', 'zoom-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Repository',
      submenu: [
        item('Fetch All', 'fetch', 'CmdOrCtrl+Shift+F'),
        item('Pull', 'pull', 'CmdOrCtrl+Shift+Down'),
        item('Push', 'push', 'CmdOrCtrl+Shift+Up'),
        { type: 'separator' },
        item('Create Branch…', 'create-branch', 'CmdOrCtrl+B'),
        item('Stash', 'stash', 'CmdOrCtrl+Shift+S'),
        item('Pop Stash', 'pop-stash', 'CmdOrCtrl+Alt+S'),
        { type: 'separator' },
        item('Stage All Changes', 'stage-all', 'CmdOrCtrl+Shift+A'),
        item('Commit', 'commit'),
        { type: 'separator' },
        item('Undo Last Git Action', 'undo'),
        item('Redo Git Action', 'redo'),
        { type: 'separator' },
        item('Open in Terminal', 'open-in-terminal', 'CmdOrCtrl+Alt+T'),
        item(isMac ? 'Reveal in Finder' : 'Show in Folder', 'open-in-finder', 'CmdOrCtrl+Alt+R'),
        item('Git Console', 'git-console', 'Ctrl+`')
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ type: 'separator' } as const, { role: 'front' } as const] : [])]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// One instance per user-data dir: settings/recents/askpass files are shared.
const gotLock =
  process.env['ADAR_USER_DATA'] && !app.isPackaged ? true : app.requestSingleInstanceLock({ openRepo: parseOpenRepoArgs(process.argv) })
if (!gotLock) app.quit()
app.on('second-instance', (_e, argv, _cwd, additionalData) => {
  // A second launch (e.g. `Adar --open-repo=/path`) forwards its folders here, then exits.
  const fromData = (additionalData as { openRepo?: unknown } | null)?.openRepo
  const paths = new Set([...parseOpenRepoArgs(argv), ...(Array.isArray(fromData) ? parseOpenRepoArgs(fromData.map((p) => `--open-repo=${String(p)}`)) : [])])
  for (const p of paths) requestOpen(p)
  focusMainWindow()
})

app.whenReady().then(() => {
  app.setName('Adar')
  // Packaged builds get the icon from the bundle; show it in the Dock during development too.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const icon = join(__dirname, '../../resources/icon.png')
    if (existsSync(icon)) app.dock?.setIcon(icon)
  }
  backend = createBackend({ platform, emit })
  const b = backend
  updater = new Updater({
    currentVersion: platform.appVersion,
    emit: (status) => emit({ type: 'update-status', status }),
    getSettings: () => b.getSettings(),
    updateSettings: (patch) => b.updateSettings(patch)
  })

  menuBar = new MenuBar({
    backend: b,
    // Dev: resources/ next to out/ (npm run dev), or in the working directory for builds elsewhere (scripts/e2e.sh).
    iconDir: app.isPackaged ? join(process.resourcesPath, 'tray') : [join(__dirname, '../../resources/tray'), join(process.cwd(), 'resources/tray')].find((d) => existsSync(d)) ?? '',
    preload: join(__dirname, '../preload/index.js'),
    loadPanel: (win) => loadRendererPage(win, 'menubar'),
    openInAdar,
    sendMenu,
    emit
  })
  void b.getSettings().then((s) => menuBar?.apply(s), () => undefined)

  ipcMain.handle(IPC_INVOKE_CHANNEL, (event, method: unknown, args: unknown) => {
    // The menu bar panel may read a repository and fetch, pull or push, and drive its own window; nothing else.
    if (menuBar?.isPanel(event.sender)) {
      const a = Array.isArray(args) ? args : []
      if (typeof method === 'string' && MENUBAR_METHOD_SET.has(method)) {
        return menuBar.handle(method as MenuBarMethod, a).then((value) => ({ ok: true, value: value ?? null }), (err) => ({ ok: false, error: toErrorPayload(err) }))
      }
      if (typeof method === 'string' && PANEL_API_SET.has(method)) {
        if (method !== 'getSettings' && method !== 'getRecentRepos' && !menuBar.isAdmitted(a[0])) {
          return { ok: false, error: { message: 'Adar has not opened this repository', code: 'INVALID_ARGUMENT' } }
        }
        return invokeBackend(method, args, true)
      }
      return { ok: false, error: { message: 'Not available in the menu bar panel', code: 'INVALID_ARGUMENT' } }
    }
    // Otherwise only accept calls from our own main frame.
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return { ok: false, error: { message: 'Untrusted sender', code: 'INVALID_ARGUMENT' } }
    }
    if (typeof method === 'string' && CLI_METHOD_SET.has(method)) {
      const a = Array.isArray(args) ? args : []
      const source = bundledCliPath()
      const run = async (): Promise<unknown> => {
        switch (method as CliMethod) {
          case 'cliTakeOpenRequests':
            releaseHeldEvents()
            return takeOpenRequests((p) => emit({ type: 'open-repo-request', path: p }))
          case 'cliStatus':
            return cliStatus(source)
          case 'cliInstall':
            return installCli(source, !!(a[0] as { force?: boolean } | undefined)?.force)
          case 'cliUninstall':
            return uninstallCli(source)
        }
      }
      return run().then((value) => ({ ok: true, value: value ?? null }), (err) => ({ ok: false, error: toErrorPayload(err) }))
    }
    if (typeof method === 'string' && UPDATE_METHOD_SET.has(method)) {
      const fn = updater![method as UpdateMethod] as (...a: unknown[]) => Promise<unknown>
      return fn
        .apply(updater, Array.isArray(args) ? args : [])
        .then((value) => ({ ok: true, value: value ?? null }), (err) => ({ ok: false, error: toErrorPayload(err) }))
    }
    return invokeBackend(method, args, false)
  })

  buildMenu()
  createWindow()
  updater.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitCheckRunning = false
app.on('before-quit', (e) => {
  // Ask the renderer before quitting when work would be lost (git operation running, drafts…).
  if (!isQuitGuardBypassed() && mainWindow && !mainWindow.isDestroyed()) {
    e.preventDefault()
    if (quitCheckRunning) return
    quitCheckRunning = true
    mainWindow.webContents
      .executeJavaScript('window.__adarConfirmQuit ? window.__adarConfirmQuit() : true', true)
      .catch(() => true)
      .then((ok) => {
        quitCheckRunning = false
        if (ok) {
          bypassQuitGuard()
          app.quit()
        }
      })
    return
  }
  updater?.stop()
  menuBar?.dispose()
  void backend?.dispose()
})
