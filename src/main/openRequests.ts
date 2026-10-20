// Folders the app is asked to open from outside the UI: the `adar` CLI / Finder / Dock
// (macOS "open documents" → app 'open-file'), `--open-repo=<path>` launch arguments and the same
// arguments forwarded by a second instance. Requests made before the renderer is ready are
// queued and handed over when it asks (cliTakeOpenRequests); later ones are pushed as events.

import path from 'node:path'

const pending: string[] = []
let push: ((p: string) => void) | null = null

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
  return pending.splice(0)
}

/** The renderer went away (reload/close): queue again until it asks next time. */
export function pauseOpenRequests(): void {
  push = null
}
