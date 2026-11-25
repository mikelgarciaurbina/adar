// Files a terminal links to (a picture an agent made, the web page it wrote): read a picture to show it in Adar, and
// open a file with its own app. Only pictures, web pages and PDFs, by the type of the file itself (a link named
// `x.html` that leads to a program is not opened): nothing a terminal prints is ever run.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { TerminalImage } from '@shared/terminal'

/** Pictures Adar can show, by extension. */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon'
}

/** What a link may open with its app besides those: pictures Adar cannot show itself, web pages, PDFs. */
const DOCUMENTS = new Set(['tif', 'tiff', 'heic', 'html', 'htm', 'pdf'])

/** The largest picture read to show (bytes); a larger one is only opened with its app. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

const invalid = (message: string) => new AdarError({ message, code: 'INVALID_ARGUMENT' })

const extOf = (p: string): string => path.extname(p).slice(1).toLowerCase()

/** The file itself behind an absolute path a link gave: its real path (through links) and size; it must be a file. */
async function realFile(p: unknown): Promise<{ real: string; size: number }> {
  if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) throw invalid('A file to open needs its full path')
  let real: string
  try {
    real = await fs.realpath(p)
  } catch {
    throw new AdarError({ message: `There is no file at ${p}`, code: 'NOT_FOUND' })
  }
  const stat = await fs.stat(real)
  if (!stat.isFile()) throw invalid(`${p} is not a file`)
  return { real, size: stat.size }
}

/** A picture a terminal links to, as a data: URL to show; null when it is none, missing, or too large to read. */
export async function readTerminalImage(p: unknown): Promise<TerminalImage | null> {
  let file: { real: string; size: number }
  try {
    file = await realFile(p)
  } catch {
    return null
  }
  const type = IMAGE_TYPES[extOf(file.real)]
  if (!type || file.size > MAX_IMAGE_BYTES) return null
  const data = await fs.readFile(file.real)
  return { url: `data:${type};base64,${data.toString('base64')}`, size: file.size }
}

/** The real path of a file a terminal links to, when it may be opened with its app; refused otherwise. */
export async function openableFile(p: unknown): Promise<string> {
  const { real } = await realFile(p)
  const ext = extOf(real)
  if (!(ext in IMAGE_TYPES) && !DOCUMENTS.has(ext)) throw invalid(`Adar opens pictures, web pages and PDFs from a terminal, not .${ext || 'extensionless'} files`)
  return real
}
