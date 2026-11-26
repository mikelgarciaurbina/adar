// The notifications Adar shows (new commits after a fetch, pull requests, an agent's commits, a terminal that
// finished or needs the user) and what a click on each opens. Every one goes through here, for two reasons:
//  - A notification only answers a click while its object is alive: one that nothing keeps is collected, and its
//    click then does nothing (on macOS it also leaves Notification Center). They are kept while Adar runs.
//  - What a click opens is written in the notification's own identifier (macOS), so one left in Notification Center
//    by an Adar that has since restarted (an update, a quit) still opens its project.

export type NoticeTarget =
  /** New commits: that repository's tab. */
  | { kind: 'repo'; repo: string }
  /** A pull request: its review, its conversation, or the inbox. */
  | { kind: 'pull'; repo: string; number: number; view: 'review' | 'conversation' | 'inbox' }
  /** A commit or push Adar did not make: that folder's tab, on its changes or the commit. */
  | { kind: 'agent'; path: string; repo: string; view: 'changes' | 'commit'; sha?: string }
  /** A terminal: its owner's tab (or group) with that terminal in front. */
  | { kind: 'terminal'; owner: string; id: string }

export interface NoticeText {
  title: string
  subtitle: string
  body: string
}

/** What Electron's Notification is to this file. */
export interface NoticeHandle {
  on(event: 'click' | 'failed', listener: () => void): unknown
  show(): void
  readonly id?: string
}

export interface NoticeOptions extends NoticeText {
  /** macOS only: the identifier Notification Center keeps the notification under. */
  id?: string
}

export interface NoticesDeps {
  create(options: NoticeOptions): NoticeHandle
  /** A click on a notification: show what it is about. */
  open(target: NoticeTarget): void
  /** macOS: what a click opens travels in the notification's identifier, and a restart can pick it up again. */
  ids: boolean
  /** macOS: the notifications of this app still in Notification Center, as live objects. */
  history?(): Promise<NoticeHandle[]>
}

/** How many notifications are kept alive: older ones stop answering clicks (and leave Notification Center on macOS). */
export const MAX_KEPT = 100

const PREFIX = 'adar.'
const MAX_ID = 6000

const str = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0')
const absolute = (v: unknown): v is string => str(v) && (v.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('\\\\'))

/** A target read from outside this process (an identifier Notification Center gave back): only what Adar writes. */
export function parseTarget(v: unknown): NoticeTarget | null {
  if (!v || typeof v !== 'object') return null
  const t = v as Record<string, unknown>
  switch (t.kind) {
    case 'repo':
      return absolute(t.repo) ? { kind: 'repo', repo: t.repo } : null
    case 'pull':
      if (!absolute(t.repo) || typeof t.number !== 'number' || !Number.isSafeInteger(t.number) || t.number <= 0) return null
      return t.view === 'review' || t.view === 'conversation' || t.view === 'inbox' ? { kind: 'pull', repo: t.repo, number: t.number, view: t.view } : null
    case 'agent': {
      if (!absolute(t.path) || !absolute(t.repo) || (t.view !== 'changes' && t.view !== 'commit')) return null
      const sha = typeof t.sha === 'string' && /^[0-9a-f]{7,64}$/i.test(t.sha) ? t.sha : undefined
      return { kind: 'agent', path: t.path, repo: t.repo, view: t.view, ...(sha ? { sha } : {}) }
    }
    case 'terminal':
      // A repository's path, or a tab group's own terminals ("group:<id>").
      return (absolute(t.owner) || (str(t.owner, 200) && t.owner.startsWith('group:'))) && str(t.id, 64) ? { kind: 'terminal', owner: t.owner, id: t.id } : null
    default:
      return null
  }
}

/** The identifier of a notification: what a click opens, and a mark that makes each one its own. */
export function noticeId(target: NoticeTarget, mark: string): string {
  return `${PREFIX}${mark}.${Buffer.from(JSON.stringify(target), 'utf8').toString('base64url')}`
}

/** What a click on the notification with this identifier opens; null when it is not one of Adar's. */
export function targetOfId(id: unknown): NoticeTarget | null {
  if (typeof id !== 'string' || !id.startsWith(PREFIX) || id.length > MAX_ID) return null
  const data = id.slice(id.indexOf('.', PREFIX.length) + 1)
  if (!/^[A-Za-z0-9_-]+$/.test(data)) return null
  try {
    return parseTarget(JSON.parse(Buffer.from(data, 'base64url').toString('utf8')))
  } catch {
    return null
  }
}

export class Notices {
  /** The notifications that still answer a click, oldest first. */
  private readonly kept = new Map<string, NoticeHandle>()
  private readonly started = Date.now().toString(36)
  private count = 0
  /** Clicks taken a moment ago: a notification can be two objects (shown here, and read back from Notification Center). */
  private readonly clicked = new Map<string, number>()

  constructor(private readonly deps: NoticesDeps) {}

  /** Show a notification; a click opens `target`. */
  show(text: NoticeText, target: NoticeTarget): void {
    const key = noticeId(target, `${this.started}${(this.count++).toString(36)}`)
    const handle = this.deps.create(this.deps.ids && key.length <= MAX_ID ? { ...text, id: key } : { ...text })
    this.keep(key, handle, target)
    handle.show()
  }

  /**
   * macOS: answer the clicks on notifications an earlier run of Adar left in Notification Center. Resolves with how
   * many it found.
   */
  async restore(): Promise<number> {
    if (!this.deps.history) return 0
    let found = 0
    try {
      for (const handle of await this.deps.history()) {
        const id = handle.id
        const target = targetOfId(id)
        if (!id || !target || this.kept.has(id)) continue
        this.keep(id, handle, target)
        found++
      }
    } catch {
      // Notification Center would not say: those notifications only bring Adar to the front.
    }
    return found
  }

  /** How many notifications still answer a click. */
  get size(): number {
    return this.kept.size
  }

  private keep(key: string, handle: NoticeHandle, target: NoticeTarget): void {
    handle.on('click', () => {
      // Clicked, it has left the screen and Notification Center: nothing more to answer.
      this.kept.delete(key)
      const now = Date.now()
      const last = this.clicked.get(key)
      this.clicked.set(key, now)
      for (const [k, at] of this.clicked) if (now - at > 5000) this.clicked.delete(k)
      if (last !== undefined && now - last < 2000) return
      this.deps.open(target)
    })
    handle.on('failed', () => void this.kept.delete(key))
    // Kept until clicked, whatever the system says about banners that went away: it is still in Notification Center.
    this.kept.set(key, handle)
    while (this.kept.size > MAX_KEPT) this.kept.delete(this.kept.keys().next().value!)
  }
}

/**
 * Events that show something in the window (what a clicked notification opens) wait for a window that listens: one
 * just created, because the window had been closed, hears nothing until its page has asked for what waited for it.
 */
export class WindowGate<E> {
  private readonly held: E[] = []
  private listening = false
  /** It listened when a load began that may yet go nowhere. */
  private suspended = false

  constructor(private readonly send: (event: E) => void) {}

  /** Send now, or keep until the window listens. */
  emit(event: E): void {
    if (this.listening) this.send(event)
    else this.held.push(event)
  }

  /** The window's page listens: it gets what waited, in order. */
  ready(): void {
    this.listening = true
    this.suspended = false
    for (const event of this.held.splice(0)) this.send(event)
  }

  /** The page starts loading something: nothing is sent until it is known whether it goes away. */
  paused(): void {
    if (this.listening) this.suspended = true
    this.listening = false
  }

  /** The load went nowhere (a navigation the window refuses): the same page still listens. */
  resumed(): void {
    if (this.suspended) this.ready()
  }

  /** The page is gone (a new one loads, or the window closed): the next one says when it listens. */
  gone(): void {
    this.listening = false
    this.suspended = false
  }
}
