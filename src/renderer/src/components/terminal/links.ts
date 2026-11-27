// Links in a terminal, pure: the paths of pictures, Markdown documents, web pages, PDFs and files of text or code in a
// line of output (Claude Code and Codex write the path of a file they link to, as "the guide (docs/guide.html)", and
// of the code they changed, as "src/main/index.ts:120"), and where a link goes, read against the terminal's folder.
// Adar shows a picture when the pointer is over its link and large with ⌘-click, shows a Markdown document's preview,
// opens a file of text or code to edit (at the line named after it) and opens a web page or a PDF with its app; a
// click without ⌘ stays the program's, as in other terminals.

import { splitPosition } from '@shared/files'

/** Where a link goes: the web, or a file, by what Adar does with it. */
export type LinkTarget =
  | { kind: 'web'; url: string }
  /** Shown in Adar: over its link, and large with ⌘-click. */
  | { kind: 'image'; path: string }
  /** A Markdown document: ⌘-click shows its preview in Adar. */
  | { kind: 'markdown'; path: string }
  /** Opened with its app: the browser for a web page, Preview for a PDF. */
  | { kind: 'page'; path: string }
  /** A file of text or code: ⌘-click opens it in Adar to edit, at the line written after its path. */
  | { kind: 'code'; path: string; line?: number; column?: number }
  /** Any other file (an OSC 8 link to it): shown in its folder. */
  | { kind: 'file'; path: string }

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i
const PAGE = /\.(html?|pdf|tiff?|heic)$/i
const MARKDOWN = /\.(md|markdown|mdx)$/i

/** What Adar shows or hands to an app. */
const SHOWN = 'png|jpe?g|gif|webp|svg|bmp|avif|ico|html?|pdf|tiff?|heic|md|markdown|mdx'
/** Text and code, which Adar opens to edit. */
const TEXT =
  'tsx?|jsx?|[mc][jt]s|jsonc?|json5|ya?ml|toml|ini|cfg|conf|env|properties|xml|css|scss|sass|less|vue|svelte|astro|py|rb|go|rs|java|kts?|swift|[ch]|cc|[ch]pp|cs|php|sh|bash|zsh|fish|sql|graphql|gql|proto|lua|dart|scala|exs?|tf|hcl|gradle|txt|log|csv|tsv|lock|patch|diff|plist'
/** Files of text that have no such ending. */
const NAMED = '\\.env(?:\\.[\\p{L}\\p{N}_-]+)?|\\.gitignore|\\.gitattributes|\\.npmrc|\\.editorconfig|Dockerfile|Makefile'
const CODE = new RegExp(`(?:\\.(?:${TEXT})|(?:^|/)(?:${NAMED}))$`, 'iu')
const WORD = '\\p{L}\\p{N}\\p{M}_'

/**
 * A path in a line of output: an optional `file://`, `~/`, `./`, `../` or `/`, then letters of any alphabet, digits
 * and the punctuation file names take (a space only after a backslash, as a shell writes it), ending in the extension
 * of a picture, a Markdown document, a web page, a PDF or a file of text or code (or in the name of one that has no
 * extension, as `.env`), with the line and column a program may write after it (`index.ts:120:7`). Never in the
 * middle of a word, of a web address or of a longer name.
 */
const PATH = new RegExp(
  `(?<![${WORD}\\-.+@%=~/\\\\:])(?:file:\\/\\/|~\\/|\\.{1,2}\\/|\\/)?(?:[${WORD}\\-.+@%=~,/]|\\\\ )*?` +
    `(?:[${WORD}\\-+@%=~]\\.(?:${SHOWN}|${TEXT})|(?<![${WORD}\\-.+@%=~])(?:${NAMED}))` +
    `(?::\\d{1,7}(?::\\d{1,5})?)?(?!\\.?[${WORD}\\-/])`,
  'giu'
)

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
  let text = raw.trim()
  if (/^https?:\/\/\S+$/i.test(text)) return { kind: 'web', url: text }
  // The line and column written after a path are where to go in the file, not part of its name.
  let at: { line?: number; column?: number } = {}
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const split = splitPosition(text)
    if (split.line && (CODE.test(split.path) || MARKDOWN.test(split.path) || IMAGE.test(split.path) || PAGE.test(split.path))) {
      text = split.path
      at = { line: split.line, ...(split.column ? { column: split.column } : {}) }
    }
  }
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
  if (CODE.test(p)) return { kind: 'code', path: p, ...at }
  return { kind: IMAGE.test(p) ? 'image' : MARKDOWN.test(p) ? 'markdown' : PAGE.test(p) ? 'page' : 'file', path: p }
}

/** "guide.html" from "/a/b/guide.html". */
export const fileName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
