// Markdown documents Adar shows (a plan an agent wrote, a README): which files they are, what the main process reads
// of one for the preview, and where its links lead. The Markdown itself is parsed in the renderer
// (`components/markdown/parse.ts`); nothing here or there ever runs what a document says.

/** Extensions of the files Adar previews as Markdown. */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx'] as const

const MARKDOWN_PATH = new RegExp(`\\.(?:${MARKDOWN_EXTENSIONS.join('|')})$`, 'i')

/** Whether a path names a Markdown file (by its extension). */
export function isMarkdownPath(p: unknown): p is string {
  return typeof p === 'string' && MARKDOWN_PATH.test(p)
}

/** The largest document read to preview (bytes). */
export const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024

/** A Markdown file as read for the preview. */
export interface MarkdownFile {
  /** Its path as it was asked for. */
  path: string
  text: string
  size: number
  /** Changes whenever the file does (its time and size): asked again with it, an unchanged file is not read. */
  version: string
}

/** Where a link of a document leads, when it is a file on this machine. */
export interface MarkdownLink {
  path: string
  /** Another Markdown document: Adar shows it. */
  markdown: boolean
  /** The part after `#`, without it ('' when there is none). */
  anchor: string
}
