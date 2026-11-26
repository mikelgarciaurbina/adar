// Folders the app is asked to open from outside the UI: the `adar` CLI / Finder / Dock
// (macOS "open documents" → app 'open-file'), `--open-repo=<path>` launch arguments and the same
// arguments forwarded by a second instance. Requests made before the renderer is ready are
// queued and handed over when it asks (cliTakeOpenRequests); later ones are pushed as events.
// A load that begins pauses the delivery; it goes on with the same page when the load went nowhere
// (a navigation the window refuses), and waits for the next page to ask when there is a new one.

import path from 'node:path'

const pending: string[] = []
let push: ((p: string) => void) | null = null
/** The delivery paused by a load that may yet go nowhere. */
let suspended: ((p: string) => void) | null = null

/** Queue (or deliver) a request to open `p` in a tab. */
export function requestOpen(p: string): void {
  if (typeof p !== 'string' || !p.trim()) return
  const abs = path.resolve(p)
  if (push) push(abs)
  else if (!pending.includes(abs)) pending.push(abs)
}

/** Called when the renderer is ready: returns queued requests and switches to push delivery. */
export function takeOpenRequests(deliver: (p: string) => void): string[] {
  push = deliver
  suspended = null
  return pending.splice(0)
}

/** The page starts loading something: queue until it is known whether the renderer goes away. */
export function pauseOpenRequests(): void {
  if (push) suspended = push
  push = null
}

/** The load went nowhere and the same renderer still listens: deliver again, starting with what waited. */
export function resumeOpenRequests(): void {
  if (push || !suspended) return
  push = suspended
  suspended = null
  for (const p of pending.splice(0)) push(p)
}

/** The renderer went away (a new page, the window closed): queue until the next one asks. */
export function endOpenRequests(): void {
  push = null
  suspended = null
}
