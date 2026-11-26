// Markdown documents Adar previews (a plan an agent wrote, a README): the file read as text, the pictures it shows
// and where its links lead. Only Markdown files are read, by the type of the real file behind any link, and only
// pictures are read for one; nothing a document says is ever run or opened here.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { AdarApi } from '@shared/api'
import { AdarError } from '@shared/errors'
import { MARKDOWN_EXTENSIONS, MAX_MARKDOWN_BYTES, isMarkdownPath, type MarkdownFile, type MarkdownLink } from '@shared/markdown'
import type { PlatformAdapter } from './platform'
import { readTerminalImage } from './terminal/files'

const execFileP = promisify(execFile)

const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })

const absolute = (p: unknown): p is string => typeof p === 'string' && !!p && !p.includes('\0') && path.isAbsolute(p)

/**
 * A Markdown file to preview. Null when `unless` is still its version (the preview asks again and again to follow a
 * file an agent is writing). Refused: anything that is not a Markdown file itself, and one too large to show.
 */
export async function readMarkdownFile(p: unknown, opts?: { unless?: string }): Promise<MarkdownFile | null> {
  if (!absolute(p)) throw invalid('A Markdown file to preview needs its full path')
  let real: string
  try {
    real = await fs.realpath(p)
  } catch {
    throw new AdarError({ message: `There is no file at ${p}`, code: 'NOT_FOUND' })
  }
  const stat = await fs.stat(real)
  if (!stat.isFile()) throw invalid(`${p} is not a file`)
  if (!isMarkdownPath(real)) throw invalid(`${path.basename(p)} is not a Markdown file`)
  if (stat.size > MAX_MARKDOWN_BYTES) throw invalid(`${path.basename(p)} is too large to preview (${Math.round(stat.size / 1024 / 1024)} MB)`)
  const version = `${stat.mtimeMs}:${stat.size}`
  if (opts && typeof opts.unless === 'string' && opts.unless === version) return null
  const text = (await fs.readFile(real, 'utf8')).replace(/^﻿/, '')
  return { path: p, text, size: stat.size, version }
}

/** The repository (or worktree) a folder is in: the closest folder up with a `.git`; null when there is none. */
async function rootOf(dir: string): Promise<string | null> {
  let at = dir
  for (let i = 0; i < 64; i++) {
    if (await fs.stat(path.join(at, '.git')).then(() => true, () => false)) return at
    const up = path.dirname(at)
    if (up === at) return null
    at = up
  }
  return null
}

/**
 * Where an address written in a document leads on this machine: a path beside the document, `~/…`, a `file://` URL or
 * a full path; `/docs/a.md` is read from the document's repository when the machine has no such file (as GitHub reads
 * it). Null for the web and any other scheme.
 */
export async function resolveReference(doc: unknown, ref: unknown): Promise<{ path: string; anchor: string } | null> {
  if (!absolute(doc) || typeof ref !== 'string' || !ref.trim() || ref.includes('\0')) return null
  let target = ref.trim()
  let anchor = ''
  if (/^file:\/\//i.test(target)) {
    try {
      const url = new URL(target)
      if (url.host && url.host !== 'localhost') return null
      anchor = decodeURIComponent(url.hash.slice(1))
      url.hash = ''
      url.search = ''
      url.host = ''
      return { path: fileURLToPath(url), anchor }
    } catch {
      return null
    }
  }
  // Another scheme (https:, mailto:, javascript:…); a Windows drive letter is none.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-zA-Z]:[\\/]/.test(target)) return null
  if (target.startsWith('//')) return null
  const hash = target.indexOf('#')
  if (hash >= 0) {
    anchor = target.slice(hash + 1)
    target = target.slice(0, hash)
  }
  const query = target.indexOf('?')
  if (query >= 0) target = target.slice(0, query)
  try {
    target = decodeURIComponent(target)
    anchor = decodeURIComponent(anchor)
  } catch {
    // Not percent-encoded: read as written.
  }
  if (target.includes('\0')) return null
  if (!target) return { path: doc, anchor }
  if (target === '~' || target.startsWith('~/')) return { path: path.join(os.homedir(), target.slice(1)), anchor }
  const dir = path.dirname(doc)
  const direct = path.resolve(dir, target)
  if (target.startsWith('/') && !(await fs.stat(direct).then(() => true, () => false))) {
    const root = await rootOf(dir)
    if (root) return { path: path.join(root, target), anchor }
  }
  return { path: direct, anchor }
}

/** A picture a document shows, by the address it gives, as a data: URL; null when it is none Adar can show. */
export async function readMarkdownImage(doc: unknown, src: unknown): Promise<string | null> {
  const target = await resolveReference(doc, src)
  if (!target) return null
  return (await readTerminalImage(target.path))?.url ?? null
}

/** Where a link of a document leads, when it is something on this machine; null otherwise (the web, a missing file). */
export async function resolveMarkdownLink(doc: unknown, href: unknown): Promise<MarkdownLink | null> {
  const target = await resolveReference(doc, href)
  if (!target) return null
  try {
    const real = await fs.realpath(target.path)
    const stat = await fs.stat(real)
    return { path: target.path, markdown: stat.isFile() && isMarkdownPath(real), anchor: target.anchor }
  } catch {
    return null
  }
}

// ── The app Markdown files open with (macOS) ──────────────────────────
// Adar declares that it opens Markdown files, so the Finder offers it under "Open With"; making it the app they open
// with by default is the user's choice, set through Launch Services (the same change as Get Info → Change All…).

/** The type macOS gives .md files. */
export const MARKDOWN_UTI = 'net.daringfireball.markdown'

const HANDLER_SCRIPT = [
  'function run(argv) {',
  '  ObjC.import("CoreServices");',
  '  if (argv[0] === "get") {',
  '    ObjC.bindFunction("LSCopyDefaultRoleHandlerForContentType", ["id", ["id", "unsigned int"]]);',
  '    var handler = $.LSCopyDefaultRoleHandlerForContentType($(argv[1]), 0xFFFFFFFF);',
  '    return handler.isNil() ? "" : ObjC.unwrap(handler);',
  '  }',
  '  ObjC.bindFunction("LSSetDefaultRoleHandlerForContentType", ["int", ["id", "unsigned int", "id"]]);',
  '  return String($.LSSetDefaultRoleHandlerForContentType($(argv[1]), 0xFFFFFFFF, $(argv[2])));',
  '}'
].join('\n')

const launchServices = async (...args: string[]): Promise<string> =>
  (await execFileP('/usr/bin/osascript', ['-l', 'JavaScript', '-e', HANDLER_SCRIPT, ...args], { timeout: 10_000 })).stdout.trim()

/** macOS: the bundle id of the app Markdown files open with ('' when there is none); null when it cannot be told. */
export async function markdownHandler(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    return await launchServices('get', MARKDOWN_UTI)
  } catch {
    return null
  }
}

/** macOS: make the app with this bundle id the one Markdown files open with. */
export async function setMarkdownHandler(bundleId: string): Promise<void> {
  if (process.platform !== 'darwin') throw invalid('Only macOS lets Adar choose the app Markdown files open with')
  if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) throw invalid('Not a bundle identifier')
  let status: string
  try {
    status = await launchServices('set', MARKDOWN_UTI, bundleId)
  } catch (err) {
    throw new AdarError({ message: `macOS did not let Adar change the app Markdown files open with: ${err instanceof Error ? err.message : String(err)}`, code: 'UNKNOWN' })
  }
  if (status !== '0') throw new AdarError({ message: `macOS did not change the app Markdown files open with (error ${status})`, code: 'UNKNOWN' })
}

// ── The API ───────────────────────────────────────────────────────────

type MarkdownMethods = 'readMarkdownFile' | 'markdownImage' | 'markdownLink' | 'pickMarkdownFile' | 'markdownDefaultApp' | 'setMarkdownDefaultApp'

/** The AdarApi methods of the Markdown preview: the desktop app only (the browser bridge reads no files by their path). */
export function createMarkdownOps(platform: PlatformAdapter): Pick<AdarApi, MarkdownMethods> {
  const need = (): void => {
    if (!platform.isElectron) throw invalid('Markdown files open in the desktop app only')
  }
  return {
    async readMarkdownFile(p, opts) {
      need()
      return readMarkdownFile(p, opts)
    },
    async markdownImage(doc, src) {
      need()
      return readMarkdownImage(doc, src)
    },
    async markdownLink(doc, href) {
      need()
      return resolveMarkdownLink(doc, href)
    },
    async pickMarkdownFile(opts) {
      need()
      if (!platform.pickFile) return null
      return platform.pickFile({
        title: 'Open Markdown file',
        defaultPath: typeof opts?.defaultPath === 'string' ? opts.defaultPath : undefined,
        filters: [{ name: 'Markdown', extensions: [...MARKDOWN_EXTENSIONS] }]
      })
    },
    async markdownDefaultApp() {
      if (!platform.bundleId) return null
      const handler = await markdownHandler()
      return handler === null ? null : handler.toLowerCase() === platform.bundleId.toLowerCase()
    },
    async setMarkdownDefaultApp() {
      if (!platform.bundleId) throw invalid('Only an installed Adar on macOS can become the app Markdown files open with')
      await setMarkdownHandler(platform.bundleId)
    }
  }
}
