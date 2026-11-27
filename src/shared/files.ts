// Files Adar edits itself (a quick fix in the code, a .env, a JSON opened from the Finder): what the main process
// lists of a repository for the file tree and the palette, what it reads of one file for the editor and what the
// editor sends back to save. A file's text is only ever shown and written: nothing here runs it.

/** The largest file opened to edit (bytes). */
export const MAX_EDIT_BYTES = 5 * 1024 * 1024

/** The most files listed of a repository; a larger one is cut, and says so. */
export const MAX_LISTED_FILES = 100_000
/** The most ignored files and folders listed of a repository. */
export const MAX_LISTED_IGNORED = 2_000
/** The most entries listed of one folder. */
export const MAX_FOLDER_ENTRIES = 5_000

/** The files of a repository's working tree, as git knows them. Paths are relative to it, with "/". */
export interface FileListing {
  /** Tracked files that are there, and the ones git does not know and does not ignore. */
  files: string[]
  /** Ignored files (a .env, a local configuration). */
  ignored: string[]
  /** Ignored folders (node_modules, dist), by name only: the tree reads one when it is opened. */
  folders: string[]
  /** Other repositories inside this one (submodules, a clone git does not track), by name only as well. */
  repositories: string[]
  /** There were more than the limits above: some are missing. */
  truncated: boolean
}

/** What is in a folder whose content was not listed. */
export interface FolderEntry {
  name: string
  /** A link is shown and never followed. */
  kind: 'file' | 'folder' | 'link' | 'other'
}

/** A file as read for the editor. */
export interface TextFile {
  /** Its path as it was asked for. */
  path: string
  /** The file itself, behind any link among the folders above it: what a save writes. */
  real: string
  /** Its text, without the byte order mark. */
  text: string
  /** Its size on disk (bytes). */
  size: number
  /** Changes whenever the file does: what a save names to say which text it started from. */
  version: string
  /** It starts with a UTF-8 byte order mark, which a save keeps. */
  bom: boolean
}

/** What the editor sends to save a file. */
export interface TextFileSave {
  /** The whole text, with the line endings and the byte order mark it is written with. */
  text: string
  /**
   * The version the editor started from (null: there was no file). The save is refused, with code CONFLICT, when the
   * file is another one now: something else wrote it meanwhile (an agent, another editor). To write over it all the
   * same, the editor first takes the version that is there now (the user was told, and kept their text).
   */
  expected: string | null
  /** The repository the file is edited in: the file must be inside it, behind any link too. */
  root?: string
}

/** A file after a save. */
export interface SavedFile {
  version: string
  size: number
}

/** Where a path given to Adar leads: what opening it shows. */
export type PathKind = 'folder' | 'markdown' | 'file' | 'missing'

const SEGMENTS = /[\\/]+/

/**
 * A path inside a `.git` folder (hooks, config, the objects), or a `.git` file itself: Git's own files, which Adar
 * never opens to edit (a hook is a program git runs; the config may name credentials). `GIT~1` is how Windows may also
 * call that folder.
 */
export function isGitInternal(p: string): boolean {
  return p.split(SEGMENTS).some((part) => /^(?:\.git|git~1)$/i.test(part.replace(/[. ]+$/, '')))
}

/** The part of a version that names the content (the rest only says when the file was last looked at). */
export function contentOf(version: string | null | undefined): string {
  if (!version) return ''
  const i = version.indexOf('.')
  return i < 0 ? version : version.slice(0, i)
}

/** A lone carriage return (the line ending of old Macs, or one inside a line): an editor would not keep it. */
export function hasLoneCarriageReturn(text: string): boolean {
  return /\r(?!\n)/.test(text)
}

/** "src/main/index.ts" → "index.ts". */
export function baseName(p: string): string {
  const parts = p.split(SEGMENTS).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** A position in a file as a program writes it after the path: "index.ts:120:7" → line 120, column 7 (from 1). */
export interface FilePosition {
  line?: number
  column?: number
}

/** Split "src/a.ts:12:3" (or "src/a.ts:12", or "src/a.ts(12,3)") into the path and the position it names. */
export function splitPosition(text: string): { path: string } & FilePosition {
  const m = /^(.*?)(?::(\d{1,7})(?::(\d{1,5}))?|\((\d{1,7})(?:,\s?(\d{1,5}))?\))$/.exec(text)
  if (!m || !m[1]) return { path: text }
  const line = Number(m[2] ?? m[4])
  const column = m[3] ?? m[5]
  if (!line) return { path: text }
  return { path: m[1], line, ...(column && Number(column) ? { column: Number(column) } : {}) }
}

/**
 * Bare command-line arguments that are full paths: how Windows and Linux hand over what is opened with Adar, as a
 * path or (Linux file managers) as a `file://` address of this machine. Whether each is a folder, a document or
 * nothing is for the main process to look up.
 */
export function parsePathArgs(argv: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of argv.slice(1)) {
    if (typeof raw !== 'string' || !raw || raw.startsWith('-') || raw.includes('\0')) continue
    let arg = raw
    if (/^file:\/\/\//i.test(arg)) {
      try {
        arg = decodeURIComponent(new URL(arg).pathname)
      } catch {
        continue
      }
      if (arg.includes('\0')) continue
    }
    // Full paths only: /home/me/notes.txt, C:\notes\plan.txt, \\server\share\plan.txt.
    if (!/^(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(arg)) continue
    if (!out.includes(arg)) out.push(arg)
  }
  return out
}
