import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '@shared/api'
import type { MenuCommand, AdarEvent } from '@shared/types'
import { UPDATE_METHODS, type UpdateMethod } from '@shared/update'
import { toErrorPayload } from '@shared/errors'
import { createBackend, type Backend } from './backend'
import { dispatch } from './dispatch'
import type { PlatformAdapter } from './platform'
import { Updater } from './updater'

// Test hooks (development builds only): isolated user data dir and scripted screenshots.
if (!app.isPackaged && process.env['ADAR_USER_DATA']) app.setPath('userData', process.env['ADAR_USER_DATA'])

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
const UPDATE_METHOD_SET: ReadonlySet<string> = new Set(UPDATE_METHODS)

function emit(event: AdarEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_EVENT_CHANNEL, event)
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
    backgroundColor: '#1c1e24',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
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
  type Step = { wait?: number; js?: string; jsFile?: string; shot?: string; size?: [number, number] }
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
      if (step.shot) {
        const img = await win.webContents.capturePage()
        const path = join(outDir, `${step.shot}.png`)
        await fs.writeFile(path, img.toPNG())
        console.log(`[capture] saved ${path}`)
      }
    }
  } catch (err) {
    console.log(`[capture] failed: ${String(err)}`)
  } finally {
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
const gotLock = process.env['ADAR_USER_DATA'] && !app.isPackaged ? true : app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
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

  ipcMain.handle(IPC_INVOKE_CHANNEL, (event, method: unknown, args: unknown) => {
    // Only accept calls from our own main frame.
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return { ok: false, error: { message: 'Untrusted sender', code: 'INVALID_ARGUMENT' } }
    }
    if (typeof method === 'string' && UPDATE_METHOD_SET.has(method)) {
      const fn = updater![method as UpdateMethod] as (...a: unknown[]) => Promise<unknown>
      return fn
        .apply(updater, Array.isArray(args) ? args : [])
        .then((value) => ({ ok: true, value: value ?? null }), (err) => ({ ok: false, error: toErrorPayload(err) }))
    }
    return dispatch(backend!, method, args)
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

app.on('before-quit', () => {
  updater?.stop()
  void backend?.dispose()
})
