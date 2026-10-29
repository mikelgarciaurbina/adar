// Administrator rights on macOS through the standard authorization dialog (AppleScript's `do shell script … with
// administrator privileges`), for the few things a standard account cannot do itself: linking the adar command into
// /usr/local/bin, replacing Adar in a folder only administrators can change.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AdarError } from '@shared/errors'

const execFileP = promisify(execFile)

export interface AdminOptions {
  /** Shown in the dialog (macOS's own text otherwise). */
  prompt?: string
  /**
   * Start the snippet and return without waiting for it (Apple TN2065: output redirected, started with &). It keeps
   * running as root after Adar quits.
   */
  background?: boolean
  /** Message of the error when the rights could not be obtained (cancelling throws CANCELLED instead). */
  failure: string
}

/**
 * The AppleScript run as `osascript -e … <script> <background|wait> <prompt> <args…>`: builds `/bin/sh -c '<script>' sh
 * 'arg1' 'arg2'…` with `quoted form of`, so the arguments reach the script as $1, $2… and are never parsed by a shell.
 * `privileges` is only false in tests.
 */
export function adminAppleScript(privileges = true): string[] {
  const run = (extra: string) => `do shell script cmd${extra}${privileges ? ' with administrator privileges' : ''}`
  return [
    'on run argv',
    '  set cmd to "/bin/sh -c " & quoted form of (item 1 of argv) & " sh"',
    '  repeat with i from 4 to count of argv',
    '    set cmd to cmd & " " & quoted form of (item i of argv)',
    '  end repeat',
    '  if item 2 of argv is "background" then set cmd to cmd & " > /dev/null 2>&1 &"',
    '  if item 3 of argv is "" then',
    `    ${run('')}`,
    '  else',
    `    ${run(' with prompt (item 3 of argv)')}`,
    '  end if',
    'end run'
  ]
}

/** osascript's arguments for `script` with `args` ($1, $2…). */
export function adminCommand(script: string, args: readonly string[], opts: Omit<AdminOptions, 'failure'>, privileges = true): string[] {
  return [...adminAppleScript(privileges).flatMap((l) => ['-e', l]), script, opts.background ? 'background' : 'wait', opts.prompt ?? '', ...args]
}

/** The error for a failed osascript run: CANCELLED when the user cancelled the dialog, else `failure` and its reason. */
export function adminError(err: unknown, failure: string): AdarError {
  const text = `${(err as { stderr?: string }).stderr ?? ''} ${(err as Error).message}`
  if (/-128|User cancell?ed/i.test(text)) return new AdarError({ code: 'CANCELLED', message: 'Cancelled' })
  // "0:12: execution error: The administrator user name or password was incorrect. (-60005)"
  const reason = /execution error: (.+?)(?: \(-?\d+\))?\s*$/m.exec(text)?.[1]
  return new AdarError({ code: 'UNKNOWN', message: reason ? `${failure}: ${reason}` : failure, stderr: text.trim() })
}

/** Run a shell snippet as root after the user authenticates. Throws CANCELLED when they cancel the dialog. */
export async function runAsAdmin(script: string, args: readonly string[], opts: AdminOptions): Promise<void> {
  try {
    await execFileP('/usr/bin/osascript', adminCommand(script, args, opts))
  } catch (err) {
    throw adminError(err, opts.failure)
  }
}
