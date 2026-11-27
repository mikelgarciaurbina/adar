// The files Adar edits itself: a repository's files listed for the tree and the palette, one file read for the
// editor and its text written back. Rules that hold whatever asks:
//  - Only a regular file is read or written, never through a link: a link is refused and names the file it leads to.
//    The folders above it may be links (/tmp is one on a Mac), and with a repository given the file behind them must
//    still be inside it.
//  - Git's own files (anything in a .git folder) are never opened: a hook is a program git runs.
//  - A save names the version it started from and is refused when the file is another one now (an agent wrote it
//    meanwhile): nothing is written over without the editor having seen it.
//  - Reading and saving are the desktop app's: never the HTTP bridge, which would hand any text file of the machine to
//    whoever holds its token.
// Nothing here runs a file, and a file's text is never logged.

import { createHash } from 'node:crypto'
import { constants as fsConstants, promises as fs, type Stats } from 'node:fs'
import path from 'node:path'
import type { AdarApi } from '@shared/api'
import { AdarError } from '@shared/errors'
import {
  MAX_EDIT_BYTES,
  MAX_FOLDER_ENTRIES,
  MAX_LISTED_FILES,
  MAX_LISTED_IGNORED,
  contentOf,
  isGitInternal,
  type FileListing,
  type FolderEntry,
  type PathKind,
  type SavedFile,
  type TextFile
} from '@shared/files'
import { isMarkdownPath } from '@shared/markdown'
import type { GitContext } from './git/context'
import { assertRepo, validateRelPath } from './git/read/common'
import { looksBinary } from './git/parsers/util'

const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })
const notFound = (message: string) => new AdarError({ message, code: 'NOT_FOUND' })

const absolute = (p: unknown): p is string => typeof p === 'string' && !!p && !p.includes('\0') && path.isAbsolute(p)

/** open() flag refusing a symbolic link as the last path component; 0 where there is none (Windows). */
const O_NOFOLLOW: number = fsConstants.O_NOFOLLOW ?? 0
/** Never wait for a FIFO put where a file was. */
const O_NONBLOCK: number = fsConstants.O_NONBLOCK ?? 0

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

const gone = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const megabytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`

/** What names a file's content, and when it was last seen with it: `<hash>.<size>.<time>`. */
function versionOf(data: Buffer, stat: Stats): string {
  return `${createHash('sha256').update(data).digest('hex').slice(0, 32)}.${stat.size}.${Math.round(stat.mtimeMs)}`
}

const seenAt = (stat: Stats): string => `.${stat.size}.${Math.round(stat.mtimeMs)}`

/**
 * Where the file at `p` really is: its folder with every link above it followed, then its own name. Refused: a path
 * that is not a full one, one outside `root` (as written, or behind a link), Git's own files, a folder that is not
 * there.
 */
async function locate(p: unknown, root: unknown): Promise<string> {
  if (!absolute(p)) throw invalid('A file to edit needs its full path')
  if (root !== undefined && !absolute(root)) throw invalid('The repository of a file to edit needs its full path')
  const lexical = path.resolve(p)
  if (root !== undefined && (!isInside(path.resolve(root), lexical) || path.resolve(root) === lexical)) {
    throw invalid(`${path.basename(lexical)} is outside the repository`)
  }
  if (isGitInternal(lexical)) throw invalid("Adar does not open Git's own files (what is inside a .git folder)")
  let folder: string
  try {
    folder = await fs.realpath(path.dirname(lexical))
  } catch (err) {
    if (gone(err)) throw notFound(`There is no file at ${lexical}`)
    throw err
  }
  if (root !== undefined) {
    const realRoot = await fs.realpath(root).catch(() => null)
    if (!realRoot || !isInside(realRoot, folder)) throw invalid(`${path.basename(lexical)} is outside the repository: a link among its folders leads elsewhere`)
  }
  const real = path.join(folder, path.basename(lexical))
  if (isGitInternal(real)) throw invalid("Adar does not open Git's own files (what is inside a .git folder)")
  return real
}

/** What is at `real`: null when nothing is. Refused: a link (it names where it leads), a folder, anything else that is no file. */
async function fileAt(real: string): Promise<Stats | null> {
  let stat: Stats
  try {
    stat = await fs.lstat(real)
  } catch (err) {
    if (gone(err)) return null
    throw err
  }
  const name = path.basename(real)
  if (stat.isSymbolicLink()) {
    const target = await fs.realpath(real).catch(() => null)
    throw invalid(target ? `${name} is a link to ${target}. Open that file to edit it.` : `${name} is a link that leads nowhere`)
  }
  if (stat.isDirectory()) throw invalid(`${name} is a folder`)
  if (!stat.isFile()) throw invalid(`${name} is not a file Adar can edit`)
  return stat
}

/** The bytes of the file at `real`, never through a link put there meanwhile. */
async function readBytes(real: string): Promise<{ data: Buffer; stat: Stats }> {
  const handle = await fs.open(real, fsConstants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw invalid(`${path.basename(real)} is not a file Adar can edit`)
    return { data: await handle.readFile(), stat }
  } finally {
    await handle.close()
  }
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * A file to edit. Null when `unless` is the version it still has (the editor asks again and again, to notice what an
 * agent writes meanwhile). Refused: what `locate` and `fileAt` refuse, a file too large, and one that is not UTF-8
 * text, which could not be written back as it is.
 */
export async function readTextFile(p: unknown, opts?: { root?: string; unless?: string }): Promise<TextFile | null> {
  const real = await locate(p, opts?.root)
  const before = await fileAt(real)
  const name = path.basename(real)
  if (!before) throw notFound(`There is no file at ${real}`)
  if (before.size > MAX_EDIT_BYTES) throw invalid(`${name} is too large to edit here (${megabytes(before.size)})`)
  // Same size and time as when it was last read: not read again.
  if (opts && typeof opts.unless === 'string' && opts.unless.endsWith(seenAt(before))) return null
  const { data, stat } = await readBytes(real)
  if (stat.size > MAX_EDIT_BYTES) throw invalid(`${name} is too large to edit here (${megabytes(stat.size)})`)
  if (looksBinary(data)) throw invalid(`${name} is not a text file`)
  const bom = data.length >= 3 && data.subarray(0, 3).equals(BOM)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? data.subarray(3) : data)
  } catch {
    throw invalid(`${name} is not UTF-8 text: Adar could not save it back as it is`)
  }
  return { path: p as string, real, text, size: stat.size, version: versionOf(data, stat), bom }
}

/** What a path given to Adar is: a folder (a repository to open), a Markdown document, another file, or nothing. */
export async function pathKind(p: unknown): Promise<PathKind> {
  if (!absolute(p)) return 'missing'
  try {
    const stat = await fs.stat(p)
    if (stat.isDirectory()) return 'folder'
    if (!stat.isFile()) return 'missing'
    return isMarkdownPath(await fs.realpath(p)) ? 'markdown' : 'file'
  } catch {
    return 'missing'
  }
}

function parseSave(save: unknown): { text: string; expected: string | null; root?: string } {
  if (!save || typeof save !== 'object') throw invalid('Nothing to save')
  const s = save as Record<string, unknown>
  if (typeof s.text !== 'string') throw invalid('Nothing to save')
  if (s.expected !== null && typeof s.expected !== 'string') throw invalid('A save names the version it started from')
  if (s.root !== undefined && typeof s.root !== 'string') throw invalid('The repository of a file to edit needs its full path')
  return { text: s.text, expected: s.expected, ...(s.root !== undefined ? { root: s.root } : {}) }
}

/**
 * Write a file's text back, in place: its permissions stay, and nothing is written through a link. Refused with
 * CONFLICT when the file is no longer the version the editor started from.
 */
export async function saveTextFile(p: unknown, save: unknown, exclusive?: <T>(repo: string, fn: () => Promise<T>) => Promise<T>): Promise<SavedFile> {
  const { text, expected, root } = parseSave(save)
  const real = await locate(p, root)
  const name = path.basename(real)
  if (text.includes('\0')) throw invalid(`${name} would no longer be a text file`)
  const data = Buffer.from(text, 'utf8')
  if (data.length > MAX_EDIT_BYTES * 2) throw invalid(`${name} would be too large (${megabytes(data.length)})`)
  const write = async (): Promise<SavedFile> => {
    const there = await fileAt(real)
    const current = there ? versionOf((await readBytes(real)).data, there) : null
    const same = expected === null ? current === null : current !== null && contentOf(current) === contentOf(expected)
    if (!same) {
      throw new AdarError({
        message: current === null ? `${name} is no longer there` : `${name} changed on disk since it was opened`,
        code: 'CONFLICT'
      })
    }
    let handle
    try {
      handle = await fs.open(real, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | O_NOFOLLOW, 0o666)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ELOOP' || code === 'EMLINK') throw invalid(`${name} is a link: Adar does not write through one`)
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw invalid(`${name} cannot be written: you do not have permission to change it`)
      if (gone(err)) throw notFound(`The folder of ${name} is no longer there`)
      throw err
    }
    try {
      if (!(await handle.stat()).isFile()) throw invalid(`${name} is not a file Adar can edit`)
      await handle.writeFile(data)
      return { version: versionOf(data, await handle.stat()), size: data.length }
    } finally {
      await handle.close()
    }
  }
  // Inside a repository, after whatever Adar is doing there (a checkout, a stash): the version check then sees its result.
  return root !== undefined && exclusive ? exclusive(root, write) : write()
}

/** NUL-separated paths as git prints them with -z. */
const names = (out: string): string[] => out.split('\0').filter(Boolean)

/**
 * The files of a repository's working tree: what git tracks and is there, what it does not know, and what it ignores
 * (with the folders it ignores whole, and other repositories inside, by name only).
 */
export async function listFiles(ctx: GitContext, repo: unknown): Promise<FileListing> {
  await assertRepo(ctx, repo)
  const root = repo as string
  const run = (args: string[]) => ctx.git(root, ['ls-files', '-z', ...args], { env: { GIT_OPTIONAL_LOCKS: '0' } })
  const [tracked, deleted, others, ignored] = await Promise.all([
    run(['--stage']),
    run(['--deleted']),
    run(['--others', '--exclude-standard']),
    run(['--others', '--ignored', '--exclude-standard', '--directory'])
  ])
  const missing = new Set(names(deleted.stdout))
  const files = new Set<string>()
  const folders = new Set<string>()
  const repositories = new Set<string>()
  for (const entry of names(tracked.stdout)) {
    // "<mode> <object> <stage>\t<path>"; a file in conflict is listed once per side.
    const tab = entry.indexOf('\t')
    if (tab < 0) continue
    const file = entry.slice(tab + 1)
    if (missing.has(file)) continue
    // Another repository checked out here (a submodule): a folder.
    if (entry.startsWith('160000 ')) repositories.add(file)
    else files.add(file)
  }
  for (const file of names(others.stdout)) {
    // A repository git does not track, inside this one: named with a slash, never looked into.
    if (file.endsWith('/')) repositories.add(file.slice(0, -1))
    else files.add(file)
  }
  const ignoredFiles: string[] = []
  let truncated = false
  let count = 0
  for (const file of names(ignored.stdout)) {
    if (++count > MAX_LISTED_IGNORED) {
      truncated = true
      break
    }
    if (file.endsWith('/')) folders.add(file.slice(0, -1))
    else ignoredFiles.push(file)
  }
  let list = [...files]
  if (list.length > MAX_LISTED_FILES) {
    list = list.slice(0, MAX_LISTED_FILES)
    truncated = true
  }
  const named = (set: Set<string>): string[] => [...set].filter((f) => !isGitInternal(f))
  return { files: list, ignored: ignoredFiles, folders: named(folders), repositories: named(repositories).filter((f) => !folders.has(f)), truncated }
}

/** What is in a folder of a repository whose content was not listed (an ignored one): names only, no link followed. */
export async function listFolder(ctx: GitContext, repo: unknown, dir: unknown): Promise<FolderEntry[]> {
  await assertRepo(ctx, repo)
  const root = repo as string
  const rel = validateRelPath(dir, 'folder')
  if (isGitInternal(rel)) throw invalid("Adar does not open Git's own files (what is inside a .git folder)")
  const stat = await fs.lstat(path.join(root, rel)).catch(() => null)
  if (!stat) throw notFound(`There is no folder at ${rel}`)
  if (stat.isSymbolicLink()) throw invalid(`${rel} is a link: Adar does not look into one`)
  if (!stat.isDirectory()) throw invalid(`${rel} is not a folder`)
  // The folder is found as a file inside it would be: links above it followed, and still inside the repository.
  const real = path.dirname(await locate(path.join(root, rel, 'x'), root))
  const entries = await fs.readdir(real, { withFileTypes: true })
  const out: FolderEntry[] = []
  for (const entry of entries) {
    if (isGitInternal(entry.name)) continue
    if (out.length >= MAX_FOLDER_ENTRIES) break
    out.push({
      name: entry.name,
      kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'other'
    })
  }
  return out
}

type FileOps = Pick<AdarApi, 'listFiles' | 'listFolder' | 'readTextFile' | 'saveTextFile' | 'pathKind' | 'pickFile'>

export function createFileOps(ctx: GitContext): FileOps {
  const desktop = (what: string): void => {
    if (!ctx.platform.isElectron) throw invalid(`${what} is only done in the desktop app`)
  }
  return {
    listFiles: (repo) => listFiles(ctx, repo),
    listFolder: (repo, dir) => listFolder(ctx, repo, dir),
    async readTextFile(p, opts) {
      desktop('Opening a file to edit')
      return readTextFile(p, opts)
    },
    async saveTextFile(p, save) {
      desktop('Saving a file')
      return saveTextFile(p, save, ctx.exclusive)
    },
    async pathKind(p) {
      desktop('Opening a file')
      return pathKind(p)
    },
    async pickFile(opts) {
      desktop('Opening a file')
      if (!ctx.platform.pickFile) return null
      return ctx.platform.pickFile({ title: 'Open a file', defaultPath: typeof opts?.defaultPath === 'string' ? opts.defaultPath : undefined, filters: [] })
    }
  }
}
