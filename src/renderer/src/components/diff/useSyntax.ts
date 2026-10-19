// Incremental, non-blocking syntax highlighting of text blocks. Blocks are
// highlighted in time-sliced chunks after the first paint; rows re-render as
// tokens arrive (plain text until then). Cached results fill in synchronously.

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { detectLanguage, highlightBlock, loadedHighlighter, loadHighlighter, type Token } from './highlight'
import type { HLJSApi } from 'highlight.js'

/** Lines per highlight chunk (highlight state restarts at chunk boundaries). */
const CHUNK_LINES = 800
/** Above this many lines in total, syntax highlighting is skipped. */
const MAX_TOTAL_LINES = 120_000
/** Time budget per slice, ms. */
const SLICE_MS = 12

export type TokenLookup = (block: number, index: number) => Token[] | null

/**
 * Highlight `blocks` (arrays of lines) for the language of `path`. Returns a
 * lookup function whose identity changes whenever new tokens are available.
 */
export function useSyntax(path: string, blocks: string[][] | null, enabled = true): TokenLookup {
  const store = useRef<Array<Array<Token[] | null> | undefined>>([])
  const [version, setVersion] = useState(0)

  useLayoutEffect(() => {
    store.current = []
    if (!enabled || !blocks || !blocks.length) {
      setVersion((v) => v + 1)
      return
    }
    let total = 0
    for (const b of blocks) total += b.length
    if (total === 0 || total > MAX_TOTAL_LINES) {
      setVersion((v) => v + 1)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const queue: Array<{ block: number; start: number; end: number }> = []
    blocks.forEach((lines, block) => {
      for (let start = 0; start < lines.length; start += CHUNK_LINES) {
        queue.push({ block, start, end: Math.min(lines.length, start + CHUNK_LINES) })
      }
    })

    const run = (hljs: HLJSApi, lang: string) => {
      const t0 = performance.now()
      while (queue.length && performance.now() - t0 < SLICE_MS) {
        const job = queue.shift()!
        const lines = blocks[job.block]
        const tokens = highlightBlock(hljs, lines.slice(job.start, job.end), lang)
        const target = (store.current[job.block] ??= new Array<Token[] | null>(lines.length).fill(null))
        for (let k = 0; k < tokens.length; k++) target[job.start + k] = tokens[k]
      }
      setVersion((v) => v + 1)
      if (queue.length && !cancelled) timer = setTimeout(() => !cancelled && run(hljs, lang), 0)
    }

    const start = (hljs: HLJSApi, sync: boolean) => {
      if (cancelled) return
      const lang = detectLanguage(path, hljs)
      if (!lang) {
        setVersion((v) => v + 1)
        return
      }
      if (sync) run(hljs, lang)
      else timer = setTimeout(() => !cancelled && run(hljs, lang), 0)
    }

    const loaded = loadedHighlighter()
    if (loaded) {
      // First slice before paint: cached / small blocks show up without a plain-text flash.
      start(loaded, true)
    } else {
      setVersion((v) => v + 1)
      loadHighlighter().then(
        (hljs) => start(hljs, false),
        () => undefined
      )
    }
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [path, blocks, enabled])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((block: number, index: number) => store.current[block]?.[index] ?? null, [version])
}
