// Links in a terminal, pure: the paths of pictures, Markdown documents, web pages and PDFs in a line of output
// (Claude Code and Codex write the path of a file they link to, as "the guide (docs/guide.html)"), and where a link
// goes, read against the terminal's folder. Adar shows a picture when the pointer is over its link and large with
// ⌘-click, shows a Markdown document's preview, and opens a web page or a PDF with its app; a click without ⌘ stays
// the program's, as in other terminals.

/** Where a link goes: the web, or a file, by what Adar does with it. */
export type LinkTarget =
  | { kind: 'web'; url: string }
  /** Shown in Adar: over its link, and large with ⌘-click. */
  | { kind: 'image'; path: string }
  /** A Markdown document: ⌘-click shows its preview in Adar. */
  | { kind: 'markdown'; path: string }
  /** Opened with its app: the browser for a web page, Preview for a PDF. */
  | { kind: 'page'; path: string }
  /** Any other file (an OSC 8 link to it): shown in its folder. */
  | { kind: 'file'; path: string }

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i
const PAGE = /\.(html?|pdf|tiff?|heic)$/i
const MARKDOWN = /\.(md|markdown|mdx)$/i

/**
 * A path in a line of output: an optional `file://`, `~/`, `./`, `../` or `/`, then letters of any alphabet, digits
 * and the punctuation file names take (a space only after a backslash, as a shell writes it), ending in the extension
 * of a picture, a Markdown document, a web page or a PDF. Never in the middle of a word, of a web address or of a
 * longer name.
 */
const PATH =
  /(?<![\p{L}\p{N}\p{M}_\-.+@%=~/\\:])(?:file:\/\/|~\/|\.{1,2}\/|\/)?(?:[\p{L}\p{N}\p{M}_\-.+@%=~,/]|\\ )*?[\p{L}\p{N}\p{M}_\-+@%=~]\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico|html?|pdf|tiff?|heic|md|markdown|mdx)(?!\.?[\p{L}\p{N}\p{M}_\-/])/giu

/** The paths in a line of output: where each starts and ends (string indices, end excluded). */
export function findPaths(text: string): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = []
  for (const m of text.matchAll(PATH)) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  return out
}

/** "/a/./b/../c" → "/a/c". */
function normalize(p: string): string {
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/**
 * Where a link's text or URI goes, read against the terminal's folder (`cwd`) and the user's home; null when it is
 * nothing Adar opens (another scheme such as mailto:, a file on another host).
 */
export function linkTarget(raw: string, cwd: string, home: string): LinkTarget | null {
  const text = raw.trim()
  if (/^https?:\/\/\S+$/i.test(text)) return { kind: 'web', url: text }
  let p: string
  if (/^file:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      if (url.host && url.host !== 'localhost') return null
      p = decodeURIComponent(url.pathname)
    } catch {
      return null
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    return null
  } else {
    p = text.replace(/\\ /g, ' ')
    if (p === '~' || p.startsWith('~/')) {
      if (!home) return null
      p = home + p.slice(1)
    } else if (!p.startsWith('/')) {
      if (!cwd.startsWith('/')) return null
      p = `${cwd}/${p}`
    }
  }
  if (!p.startsWith('/')) return null
  p = normalize(p)
  return { kind: IMAGE.test(p) ? 'image' : MARKDOWN.test(p) ? 'markdown' : PAGE.test(p) ? 'page' : 'file', path: p }
}

/** "guide.html" from "/a/b/guide.html". */
export const fileName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
