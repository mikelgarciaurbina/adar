// The antlers in the macOS menu bar (Settings → "Menu bar icon"): a template image that lights up from the root to
// the tips while Adar fetches, pulls or pushes and shows a dot when a fetch brings new commits, and a small panel
// under it with one project, its branch and its latest commits on their lanes (src/renderer/menubar.html).
// Notifications about new commits work on every platform; the icon and the panel only on macOS.

import path from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, Notification, screen, Tray, type NativeImage, type WebContents } from 'electron'
import { IPC_EVENT_CHANNEL } from '@shared/api'
import { AdarError } from '@shared/errors'
import { PANEL_MAX_HEIGHT, PANEL_MIN_HEIGHT, PANEL_WIDTH, type MenuBarMethod, type MenuBarState } from '@shared/menubar'
import type { AdarEvent, AppSettings, MenuCommand } from '@shared/types'
import type { Backend } from './backend'

export interface MenuBarDeps {
  backend: Backend
  /** Folder with the tray*Template.png images (resources/tray). */
  iconDir: string
  preload: string
  /** Load the panel page into its window (dev server URL or the built file). */
  loadPanel(win: BrowserWindow): void
  /** Bring Adar's window to the front (creating it if needed) and, with a path, switch to that repository. */
  openInAdar(repo: string | null): void
  sendMenu(command: MenuCommand): void
  /** Events for the main window (settings the menu bar changed). */
  emit(event: AdarEvent): void
}

/** What a repository's checked-out branch tracked at the last look, to tell when a fetch brought new commits. */
interface Upstream {
  branch: string
  sha: string
  behind: number
}

/** Fetch animation: the commits light up from the root to the tips, hold, and start again. */
const FETCH_FRAMES = [1, 2, 3, 4, 4, 4] as const
const FRAME_MS = 170
/** A click on the icon right after the panel hid on blur (that same click) must not reopen it. */
const REOPEN_GUARD_MS = 300

export class MenuBar {
  private tray: Tray | null = null
  private panel: BrowserWindow | null = null
  private images = new Map<string, NativeImage>()
  private settings: AppSettings | null = null
  private network = 0
  /** Network operations started from the panel and still running (credential prompts then bring Adar forward). */
  private panelOps = 0
  private frame = 0
  private timer: NodeJS.Timeout | null = null
  /** A fetch brought new commits the panel has not shown yet: the icon carries a dot. */
  private unseen = false
  private hiddenAt = 0
  /** Scripted captures (ADAR_CAPTURE_STEPS) keep the panel open when it loses focus. */
  stayOpen = false
  private readonly upstreams = new Map<string, Upstream>()
  private readonly lastFetch = new Map<string, number>()
  /** Repositories opened through openRepo (and so past its trust check) since Adar started: the panel may read them. */
  private readonly opened = new Set<string>()

  constructor(private readonly deps: MenuBarDeps) {}

  /** Apply settings: show or remove the icon, remember the notification choice. */
  apply(settings: AppSettings): void {
    this.settings = settings
    const want = process.platform === 'darwin' && settings.menuBarIcon
    if (want && !this.tray) this.createTray()
    else if (!want && this.tray) this.destroyTray()
  }

  dispose(): void {
    this.destroyTray()
  }

  isPanel(sender: WebContents): boolean {
    return !!this.panel && !this.panel.isDestroyed() && sender === this.panel.webContents
  }

  /** Adar opened this repository (a tab, a clone, or the panel's own menuBarUseRepo). */
  admit(repo: string): void {
    this.opened.add(repo)
  }

  isAdmitted(repo: unknown): boolean {
    return typeof repo === 'string' && this.opened.has(repo)
  }

  /** Pass an event on to the panel while it shows (repository changes, to redraw it). */
  sendToPanel(event: AdarEvent): void {
    if (this.panel && !this.panel.isDestroyed() && this.panel.isVisible()) this.panel.webContents.send(IPC_EVENT_CHANNEL, event)
  }

  /** A network operation from the panel is running: credential prompts must come to the front. */
  get panelOperationRunning(): boolean {
    return this.panelOps > 0
  }

  // ── Network activity and new commits ────────────────────────────────────

  networkStarted(fromPanel: boolean): void {
    this.network += 1
    if (fromPanel) this.panelOps += 1
    this.updateIcon()
  }

  networkEnded(fromPanel: boolean): void {
    this.network = Math.max(0, this.network - 1)
    if (fromPanel) this.panelOps = Math.max(0, this.panelOps - 1)
    this.updateIcon()
  }

  /** Before a fetch: what the checked-out branch tracks now, to compare with afterwards. */
  async beforeFetch(repo: string): Promise<void> {
    const now = await this.readUpstream(repo)
    if (now) this.upstreams.set(repo, now)
    else this.upstreams.delete(repo)
  }

  /** After a successful fetch: a dot on the icon and a notification when it brought commits to pull. */
  async afterFetch(repo: string): Promise<void> {
    this.lastFetch.set(repo, Date.now())
    const before = this.upstreams.get(repo)
    const now = await this.readUpstream(repo)
    if (!now) return
    this.upstreams.set(repo, now)
    if (!before || before.branch !== now.branch || before.sha === now.sha) return
    const added = now.behind - before.behind
    if (added <= 0) return
    this.unseen = true
    this.updateIcon()
    if (this.settings?.notifyNewCommits) this.notify(repo, now.branch, now.remote, added)
  }

  private async readUpstream(repo: string): Promise<(Upstream & { remote: string }) | null> {
    try {
      const refs = await this.deps.backend.getRefs(repo)
      const head = refs.branches.find((b) => b.isHead)
      if (!head?.upstream || head.upstreamGone) return null
      const up = refs.remotes.find((r) => r.name === head.upstream)
      if (!up) return null
      return { branch: head.name, sha: up.sha, behind: head.behind ?? 0, remote: up.remote ?? head.upstream.split('/')[0] }
    } catch {
      return null
    }
  }

  private notify(repo: string, branch: string, remote: string, count: number): void {
    if (!Notification.isSupported()) return
    const name = path.basename(repo)
    const group = this.settings?.tabGroups.find((g) => g.repos.includes(repo))
    const n = new Notification({
      title: group?.name ? `${name} · ${group.name}` : name,
      body: `${count} new commit${count === 1 ? '' : 's'} on ${branch} from ${remote}.`
    })
    n.on('click', () => this.deps.openInAdar(repo))
    n.show()
  }

  // ── Icon ────────────────────────────────────────────────────────────────

  private image(name: string): NativeImage {
    let img = this.images.get(name)
    if (!img) {
      // Loads name@2x.png alongside on Retina displays; the "Template" suffix makes it a template image.
      img = nativeImage.createFromPath(path.join(this.deps.iconDir, `${name}.png`))
      img.setTemplateImage(true)
      this.images.set(name, img)
    }
    return img
  }

  private createTray(): void {
    this.tray = new Tray(this.image('trayTemplate'))
    this.tray.setToolTip('Adar')
    this.tray.setIgnoreDoubleClickEvents(true)
    this.tray.on('click', () => this.togglePanel())
    this.tray.on('right-click', () => this.togglePanel())
    this.updateIcon()
  }

  private destroyTray(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray?.destroy()
    this.tray = null
    if (this.panel && !this.panel.isDestroyed()) this.panel.destroy()
    this.panel = null
  }

  private updateIcon(): void {
    if (!this.tray) return
    if (this.network > 0) {
      if (!this.timer) {
        this.frame = 0
        const tick = () => {
          this.tray?.setImage(this.image(`trayFetch${FETCH_FRAMES[this.frame % FETCH_FRAMES.length]}Template`))
          this.frame += 1
        }
        tick()
        this.timer = setInterval(tick, FRAME_MS)
      }
      return
    }
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray.setImage(this.image(this.unseen ? 'trayNewTemplate' : 'trayTemplate'))
  }

  // ── Panel ───────────────────────────────────────────────────────────────

  private createPanel(): BrowserWindow {
    const win = new BrowserWindow({
      width: PANEL_WIDTH,
      height: 520,
      show: false,
      // A non-activating panel: it takes the keyboard without bringing Adar's window to the front.
      type: 'panel',
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'popover',
      visualEffectState: 'active',
      hasShadow: true,
      webPreferences: { preload: this.deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
    })
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('blur', () => {
      if (!win.webContents.isDevToolsOpened() && !this.stayOpen) this.hidePanel()
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.deps.loadPanel(win)
    return win
  }

  togglePanel(): void {
    if (this.panel?.isVisible()) this.hidePanel()
    else if (Date.now() - this.hiddenAt > REOPEN_GUARD_MS) this.showPanel()
  }

  showPanel(): void {
    if (!this.panel || this.panel.isDestroyed()) this.panel = this.createPanel()
    const win = this.panel
    const point = screen.getCursorScreenPoint()
    const anchor = this.tray?.getBounds() ?? { x: point.x, y: point.y, width: 0, height: 0 }
    const area = screen.getDisplayMatching({ x: anchor.x, y: anchor.y, width: 1, height: 1 }).workArea
    const [w] = win.getSize()
    const centre = anchor.x + anchor.width / 2
    const x = Math.round(Math.min(Math.max(centre - w / 2, area.x + 8), area.x + area.width - w - 8))
    win.setPosition(x, area.y + 6, false)
    win.show()
    win.focus()
    win.webContents.send(IPC_EVENT_CHANNEL, { type: 'menubar-shown' } satisfies AdarEvent)
    this.unseen = false
    this.updateIcon()
  }

  hidePanel(): void {
    if (this.panel && !this.panel.isDestroyed() && this.panel.isVisible()) {
      this.panel.hide()
      this.hiddenAt = Date.now()
    }
  }

  /** The panel window (for scripted screenshots). */
  panelWindow(): BrowserWindow | null {
    return this.panel && !this.panel.isDestroyed() ? this.panel : null
  }

  private setHeight(height: number): void {
    const win = this.panel
    if (!win || win.isDestroyed() || !Number.isFinite(height)) return
    const h = Math.round(Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, height)))
    if (win.getSize()[1] !== h) win.setSize(PANEL_WIDTH, h, false)
  }

  private async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const next = await this.deps.backend.updateSettings(patch)
    this.deps.emit({ type: 'settings-changed', patch })
    this.apply(next)
  }

  private showMenu(): void {
    const win = this.panel
    if (!win || win.isDestroyed()) return
    const notify = !!this.settings?.notifyNewCommits
    Menu.buildFromTemplate([
      { label: 'Notify About New Commits', type: 'checkbox', checked: notify, click: () => void this.updateSettings({ notifyNewCommits: !notify }) },
      { label: 'Hide Menu Bar Icon', click: () => void this.updateSettings({ menuBarIcon: false }) },
      { type: 'separator' },
      {
        label: 'Settings…',
        click: () => {
          this.hidePanel()
          this.deps.openInAdar(null)
          this.deps.sendMenu('settings')
        }
      },
      { type: 'separator' },
      { label: 'Quit Adar', click: () => app.quit() }
    ]).popup({ window: win })
  }

  /** Calls from the panel window (see src/shared/menubar.ts). */
  async handle(method: MenuBarMethod, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'menuBarState':
        return { lastFetch: Object.fromEntries(this.lastFetch) } satisfies MenuBarState
      case 'menuBarUseRepo': {
        if (typeof args[0] !== 'string' || !path.isAbsolute(args[0])) throw new AdarError({ code: 'INVALID_ARGUMENT', message: 'Expected a repository path' })
        const info = await this.deps.backend.openRepo(args[0])
        this.admit(args[0])
        this.admit(info.path)
        return info
      }
      case 'menuBarOpenInAdar':
        this.hidePanel()
        this.deps.openInAdar(typeof args[0] === 'string' && path.isAbsolute(args[0]) ? args[0] : null)
        return null
      case 'menuBarHide':
        this.hidePanel()
        return null
      case 'menuBarShowMenu':
        this.showMenu()
        return null
      case 'menuBarSetHeight':
        this.setHeight(Number(args[0]))
        return null
    }
  }
}
