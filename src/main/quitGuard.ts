// Cmd+Q / closing the app asks the renderer first when work would be lost (running git
// operations, commit drafts, unsaved conflict edits). Programmatic quits that already asked
// (update restart, e2e capture) bypass the guard.

let bypass = false

export function bypassQuitGuard(): void {
  bypass = true
}

export function isQuitGuardBypassed(): boolean {
  return bypass
}
