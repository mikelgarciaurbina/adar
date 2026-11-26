// The Markdown document Adar is showing over its window (`MarkdownReader.tsx`): one at a time, opened from the Finder,
// from a terminal's link, from a file of the repository or by following a link of another document.

import { create } from 'zustand'
import { isElectron } from '@renderer/api/client'
import { toast } from '@renderer/components/common/toast'

export interface OpenDocument {
  /** The file, by its full path. */
  path: string
  /** A heading to show first ('' for the top). */
  anchor: string
  /** The documents whose links led here, the first one first: Back returns to the last. */
  back: string[]
  /** The terminal whose link opened it: closing gives it the keyboard back. */
  terminal: string | null
}

export const useMarkdown = create<{ doc: OpenDocument | null }>()(() => ({ doc: null }))

/**
 * Show a Markdown file's preview. `follow`: it is reached through a link of the document on screen, which Back
 * returns to; otherwise it replaces whatever was shown.
 */
export function openMarkdown(path: string, opts: { anchor?: string; terminal?: string | null; follow?: boolean } = {}): void {
  if (!isElectron) return void toast.info('Markdown files open in the desktop app.')
  const cur = useMarkdown.getState().doc
  const anchor = opts.anchor ?? ''
  if (opts.follow && cur) {
    const back = cur.path === path ? cur.back : [...cur.back, cur.path]
    useMarkdown.setState({ doc: { path, anchor, back, terminal: cur.terminal } })
  } else useMarkdown.setState({ doc: { path, anchor, back: [], terminal: opts.terminal ?? null } })
}

/** Back to the document whose link led to this one. */
export function markdownBack(): void {
  const cur = useMarkdown.getState().doc
  if (!cur?.back.length) return
  useMarkdown.setState({ doc: { ...cur, path: cur.back[cur.back.length - 1], anchor: '', back: cur.back.slice(0, -1) } })
}

export function closeMarkdown(): void {
  useMarkdown.setState({ doc: null })
}
