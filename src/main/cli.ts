// Installs / removes the `adar` command (a symlink to the script bundled at
// Contents/Resources/bin/adar) in a directory on the user's PATH, like VS Code's
// "Install 'code' command in PATH". Prefers a directory the user can write to; only
// falls back to /usr/local/bin with an administrator prompt (macOS authorization dialog).

import { execFile } from 'node:child_process'
import { promises as fs, constants as fsc } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { AdarError } from '@shared/errors'
import type { CliStatus } from '@shared/cli'
import { loginShellPath } from './system/shellEnv'

const execFileP = promisify(execFile)

export const CLI_NAME = 'adar'
/** Candidate directories, in PATH-precedence order on a typical Apple Silicon Mac. */
export const CLI_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'] as const
/** Marker line present in the bundled script (also identifies copies of it). */
export const CLI_MARKER = 'adar — open a Git repository in Adar'

export type Existing = { kind: 'none' } | { kind: 'ours' } | { kind: 'other'; detail: string }

export interface DirState {
  dir: string
  exists: boolean
  writable: boolean
  existing: Existing
}

export type InstallPlan = { dir: string; needsAdmin: boolean } | { conflict: string }

/** Pure decision: where to put the link (or why not without `force`). */
export function planInstall(dirs: readonly DirState[], force: boolean): InstallPlan {
  const ours = dirs.find((d) => d.existing.kind === 'ours')
  if (ours) return { dir: ours.dir, needsAdmin: !ours.writable }
  const conflictOf = (d: DirState) => `${path.join(d.dir, CLI_NAME)} (${(d.existing as { detail: string }).detail})`
  for (const d of dirs) {
    if (!d.exists || !d.writable) continue
    // An unrelated `adar` earlier in PATH would shadow ours: report it instead of installing elsewhere.
    if (d.existing.kind === 'other' && !force) return { conflict: conflictOf(d) }
    return { dir: d.dir, needsAdmin: false }
  }
  const fallback = dirs.find((d) => d.dir === '/usr/local/bin') ?? dirs[dirs.length - 1]
  if (fallback.existing.kind === 'other' && !force) return { conflict: conflictOf(fallback) }
  return { dir: fallback.dir, needsAdmin: true }
}

/** A link into the script of any Adar*.app bundle (also when that copy was moved away: dangling link). */
const BUNDLED_SCRIPT = /\/Adar[^/]*\.app\/Contents\/Resources\/bin\/adar$/

/** Only symlinks can be ours: a regular file named adar is never deleted or replaced without asking. */
async function isOurLink(file: string, source: string): Promise<boolean> {
  const raw = await fs.readlink(file).catch(() => null)
  if (raw === null) return false
  if (BUNDLED_SCRIPT.test(path.resolve(path.dirname(file), raw))) return true
  try {
    const [a, b] = await Promise.all([fs.realpath(file), fs.realpath(source)])
    if (a === b || BUNDLED_SCRIPT.test(a)) return true
    // A link to a copy of the script elsewhere (read just the head; never a FIFO/device).
    const st = await fs.stat(a)
    if (!st.isFile()) return false
    const fh = await fs.open(a, 'r')
    try {
      const { buffer, bytesRead } = await fh.read(Buffer.alloc(400), 0, 400, 0)
      return buffer.subarray(0, bytesRead).toString('utf8').includes(CLI_MARKER)
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}

async function inspect(dir: string, source: string): Promise<DirState> {
  const exists = await fs.stat(dir).then((s) => s.isDirectory(), () => false)
  const writable = exists && (await fs.access(dir, fsc.W_OK).then(() => true, () => false))
  const file = path.join(dir, CLI_NAME)
  let existing: Existing = { kind: 'none' }
  const st = await fs.lstat(file).catch(() => null)
  if (st) {
    if (st.isSymbolicLink() && (await isOurLink(file, source))) existing = { kind: 'ours' }
    else if (st.isSymbolicLink()) existing = { kind: 'other', detail: `links to ${await fs.readlink(file).catch(() => '?')}` }
    else existing = { kind: 'other', detail: 'another program' }
  }
  return { dir, exists, writable, existing }
}

/** Whether `dir` is on the user's own PATH (their login shell's, not Adar's augmented one). */
async function onPath(dir: string, pathOverride?: string | null): Promise<boolean> {
  const list = pathOverride !== undefined ? pathOverride : await loginShellPath()
  if (list === null) return true // unknown: do not show a false warning
  return list.split(':').some((p) => p && path.resolve(p) === dir)
}

/** Run a shell snippet with administrator rights via the macOS authorization dialog (args are quoted by AppleScript). */
async function runAsAdmin(script: string, args: string[]): Promise<void> {
  // `script` uses $1, $2… ; AppleScript builds `sh -c '<script>' sh 'arg1' 'arg2'` with `quoted form of`.
  const lines = [
    'on run argv',
    '  set cmd to "/bin/sh -c " & quoted form of (item 1 of argv) & " sh"',
    '  repeat with i from 2 to count of argv',
    '    set cmd to cmd & " " & quoted form of (item i of argv)',
    '  end repeat',
    '  do shell script cmd with administrator privileges',
    'end run'
  ]
  try {
    await execFileP('/usr/bin/osascript', [...lines.flatMap((l) => ['-e', l]), script, ...args])
  } catch (err) {
    const text = `${(err as { stderr?: string }).stderr ?? ''} ${(err as Error).message}`
    if (/-128|User cancell?ed/i.test(text)) throw new AdarError({ code: 'CANCELLED', message: 'Cancelled' })
    throw new AdarError({ code: 'UNKNOWN', message: 'Could not get administrator rights to install the command', stderr: text.trim() })
  }
}

export async function cliStatus(source: string, candidates: readonly string[] = CLI_DIRS, userPath?: string | null): Promise<CliStatus> {
  const available = process.platform === 'darwin' && (await fs.stat(source).then((s) => s.isFile(), () => false))
  if (!available) return { available: false, source: null, installedAt: null, onPath: false, conflict: null }
  const dirs = await Promise.all(candidates.map((d) => inspect(d, source)))
  const ours = dirs.find((d) => d.existing.kind === 'ours')
  if (ours) return { available, source, installedAt: path.join(ours.dir, CLI_NAME), onPath: await onPath(ours.dir, userPath), conflict: null }
  const plan = planInstall(dirs, false)
  return { available, source, installedAt: null, onPath: false, conflict: 'conflict' in plan ? plan.conflict : null }
}

export async function installCli(source: string, force = false, candidates: readonly string[] = CLI_DIRS, userPath?: string | null): Promise<CliStatus> {
  const status = await cliStatus(source, candidates, userPath)
  if (!status.available) throw new AdarError({ code: 'NOT_FOUND', message: 'The adar command is only available in the macOS app' })
  // A link into a mounted disk image or a translocated copy would break once it goes away.
  if (source.startsWith('/Volumes/') || source.includes('/AppTranslocation/')) {
    throw new AdarError({ code: 'INVALID_ARGUMENT', message: 'Move Adar to your Applications folder and open it from there before installing the adar command.' })
  }
  const dirs = await Promise.all(candidates.map((d) => inspect(d, source)))
  const plan = planInstall(dirs, force)
  if ('conflict' in plan) {
    throw new AdarError({ code: 'INVALID_ARGUMENT', message: `Another "adar" command already exists: ${plan.conflict}`, details: [plan.conflict] })
  }
  await fs.chmod(source, 0o755).catch(() => undefined)
  const target = path.join(plan.dir, CLI_NAME)
  if (plan.needsAdmin) {
    await runAsAdmin('mkdir -p "$1" && ln -sfn "$2" "$3"', [plan.dir, source, target])
  } else {
    await fs.rm(target, { force: true })
    await fs.symlink(source, target)
  }
  return cliStatus(source, candidates, userPath)
}

export async function uninstallCli(source: string, candidates: readonly string[] = CLI_DIRS, userPath?: string | null): Promise<CliStatus> {
  const dirs = await Promise.all(candidates.map((d) => inspect(d, source)))
  for (const d of dirs) {
    if (d.existing.kind !== 'ours') continue
    const target = path.join(d.dir, CLI_NAME)
    if (d.writable) await fs.rm(target, { force: true })
    else await runAsAdmin('rm -f "$1"', [target])
  }
  return cliStatus(source, candidates, userPath)
}
