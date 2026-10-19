// Editable merged output: a monospace <textarea> (wrap off) with a line-number
// gutter and, while the output is generated from chunk choices, coloured bands
// behind the text showing which lines came from A, from B, or are still
// unresolved. Gutter and bands follow the textarea scroll via transforms so
// scrolling never re-renders React.

import { forwardRef, memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react'
import type { OutputRegion } from './conflictParser'

export const OUTPUT_LINE_H = 20
const PAD_TOP = 4

export interface OutputEditorHandle {
  focus(): void
  /** Scroll so that `line` (0-based) sits about a third down the viewport. */
  revealLine(line: number, behavior?: ScrollBehavior): void
}

export interface OutputEditorProps {
  value: string
  onChange(value: string): void
  /** Regions to highlight (null when the output was edited manually). */
  regions: readonly OutputRegion[] | null
  currentChunk: number
  readOnly?: boolean
  ariaLabel?: string
}

function countLines(text: string): number {
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++
  return n
}

function lineNumbers(count: number): string {
  const parts = new Array<string>(count)
  for (let i = 0; i < count; i++) parts[i] = String(i + 1)
  return parts.join('\n')
}

export const OutputEditor = forwardRef<OutputEditorHandle, OutputEditorProps>(function OutputEditor(
  { value, onChange, regions, currentChunk, readOnly, ariaLabel },
  ref
) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLPreElement>(null)
  const bandsRef = useRef<HTMLDivElement>(null)

  const lineCount = useMemo(() => countLines(value), [value])
  const numbers = useMemo(() => lineNumbers(lineCount), [lineCount])
  const gutterCh = Math.max(3, String(lineCount).length)

  const syncScroll = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const y = `translateY(${-ta.scrollTop}px)`
    if (gutterRef.current) gutterRef.current.style.transform = y
    if (bandsRef.current) bandsRef.current.style.transform = y
  }, [])

  // Keep gutter/bands aligned when the content (and possibly the scroll position) changes.
  useLayoutEffect(syncScroll, [value, regions, syncScroll])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => taRef.current?.focus(),
      revealLine(line: number, behavior: ScrollBehavior = 'auto') {
        const ta = taRef.current
        if (!ta) return
        ta.scrollTo({ top: Math.max(0, PAD_TOP + line * OUTPUT_LINE_H - ta.clientHeight / 3), behavior })
      }
    }),
    []
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Insert a real tab instead of moving focus (keeps the native undo stack).
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !readOnly) {
      e.preventDefault()
      if (!document.execCommand('insertText', false, '\t')) {
        const ta = e.currentTarget
        const { selectionStart: s, selectionEnd: en } = ta
        onChange(ta.value.slice(0, s) + '\t' + ta.value.slice(en))
        requestAnimationFrame(() => ta.setSelectionRange(s + 1, s + 1))
      }
    }
  }

  return (
    <div className="cf-out-editor" style={{ ['--cf-out-gutter-ch' as string]: gutterCh }}>
      <div className="cf-out-gutter" aria-hidden>
        <pre ref={gutterRef} style={{ paddingTop: PAD_TOP }}>
          {numbers}
        </pre>
      </div>
      <div className="cf-out-main">
        {regions && <Bands ref={bandsRef} regions={regions} currentChunk={currentChunk} />}
        <textarea
          ref={taRef}
          className="cf-out-textarea selectable"
          value={value}
          readOnly={readOnly}
          wrap="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={ariaLabel ?? 'Merged output'}
          style={{ paddingTop: PAD_TOP }}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
})

const Bands = memo(
  forwardRef<HTMLDivElement, { regions: readonly OutputRegion[]; currentChunk: number }>(function Bands({ regions, currentChunk }, ref) {
    return (
      <div ref={ref} className="cf-out-bands" aria-hidden>
        {regions.map((r, i) => (
          <div
            key={i}
            className={`cf-band cf-band-${r.source}${r.chunk === currentChunk ? ' cf-band-current' : ''}${r.lineCount === 0 ? ' cf-band-empty' : ''}`}
            style={{ top: PAD_TOP + r.startLine * OUTPUT_LINE_H, height: r.lineCount ? r.lineCount * OUTPUT_LINE_H : 2 }}
          />
        ))}
      </div>
    )
  })
)
