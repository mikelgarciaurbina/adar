// `adar` command-line tool: open a repository in Adar from a terminal (like `code .`).
// The script lives in the app bundle (Contents/Resources/bin/adar) and runs `open -a Adar <dir>`;
// "Install Command Line Tool…" links it into a directory on the user's PATH. Implemented in
// src/main/cli.ts and src/main/openRequests.ts, exposed over the invoke channel (methods below).

export interface CliStatus {
  /** The script exists in this build (false in the browser dev bridge or a broken bundle). */
  available: boolean
  /** Absolute path of the bundled script. */
  source: string | null
  /** Where `adar` is linked to this build's script, when installed. */
  installedAt: string | null
  /** The directory of installedAt is on the user's login-shell PATH. */
  onPath: boolean
  /** An unrelated `adar` already exists where we would install (needs force to replace). */
  conflict: string | null
}

export const CLI_METHODS = ['cliTakeOpenRequests', 'cliStatus', 'cliInstall', 'cliUninstall'] as const
export type CliMethod = (typeof CLI_METHODS)[number]

export interface CliApi {
  /** Folders the app was asked to open (CLI, Dock, launch args) that the UI has not handled yet. */
  cliTakeOpenRequests(): Promise<string[]>
  cliStatus(): Promise<CliStatus>
  /** Link `adar` into PATH (asks for an administrator password only when no writable directory exists). */
  cliInstall(opts?: { force?: boolean }): Promise<CliStatus>
  cliUninstall(): Promise<CliStatus>
}

export const OPEN_REPO_FLAG = '--open-repo='

/** Folders requested on a command line: only explicit `--open-repo=<abs path>` arguments are honoured. */
export function parseOpenRepoArgs(argv: readonly string[]): string[] {
  const out: string[] = []
  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg.startsWith(OPEN_REPO_FLAG)) continue
    const p = arg.slice(OPEN_REPO_FLAG.length)
    // Absolute POSIX or Windows paths only; relative paths would depend on an unknown cwd.
    if (p && (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) && !out.includes(p)) out.push(p)
  }
  return out
}
