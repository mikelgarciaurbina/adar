// Find and replace in the file being edited: Adar's own bar over the editor's corner, driving CodeMirror's search.

import { useEffect, useRef, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Regex, WholeWord, X } from 'lucide-react'
import { isMac } from '@renderer/api/client'
import { loadedCodeMirror, viewOf } from './editorStore'
import { countLabel, type FindOptions } from './model'

export interface FindRequest {
  /** Open with the replace row. */
  replace: boolean
  /** The text to look for at first (the word selected in the editor). */
  seed: string
  /** Counts the times it was asked for: asking again takes the keyboard back to the bar. */
  n: number
}

export function FindBar({ docKey, request, tick, readOnly, onClose }: { docKey: string; request: FindRequest; tick: number; readOnly: boolean; onClose(): void }) {
  const [options, setOptions] = useState<FindOptions>({ text: request.seed, replace: '', matchCase: false, regexp: false, wholeWord: false })
  const [replacing, setReplacing] = useState(request.replace && !readOnly)
  const [valid, setValid] = useState(true)
  const [count, setCount] = useState<{ total: number; current: number; more: boolean } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { text, replace, matchCase, regexp, wholeWord } = options

  // Asked for again (⌘F with the bar open): the keyboard comes back, with the word selected now.
  useEffect(() => {
    if (request.seed) setOptions((o) => ({ ...o, text: request.seed }))
    if (request.replace && !readOnly) setReplacing(true)
    input.current?.focus()
    input.current?.select()
  }, [request.n])

  useEffect(() => {
    const view = viewOf(docKey)
    const cm = loadedCodeMirror()
    if (view && cm) setValid(cm.find(view, { text, replace, matchCase, regexp, wholeWord }))
  }, [docKey, text, replace, matchCase, regexp, wholeWord])

  useEffect(() => {
    const view = viewOf(docKey)
    const cm = loadedCodeMirror()
    setCount(view && cm ? cm.countMatches(view.state, { text, replace, matchCase, regexp, wholeWord }) : null)
  }, [docKey, text, matchCase, regexp, wholeWord, tick])

  // Closed: the matches are no longer marked.
  useEffect(
    () => () => {
      const view = viewOf(docKey)
      if (view) loadedCodeMirror()?.stopFinding(view)
    },
    [docKey]
  )

  const step = (dir: 1 | -1): void => {
    const view = viewOf(docKey)
    if (view && text && valid) loadedCodeMirror()?.findStep(view, dir)
  }
  const replaceOne = (): void => {
    const view = viewOf(docKey)
    if (view && text && valid) loadedCodeMirror()?.replaceOne(view)
  }
  const replaceAll = (): void => {
    const view = viewOf(docKey)
    if (view && text && valid) loadedCodeMirror()?.replaceEvery(view)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, field: 'find' | 'replace'): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (field === 'replace') (e.metaKey || e.ctrlKey) && e.altKey ? replaceAll() : replaceOne()
      else step(e.shiftKey ? -1 : 1)
    } else if (e.key.toLowerCase() === 'g' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault()
      step(e.shiftKey ? -1 : 1)
    }
  }

  const toggle = (key: 'matchCase' | 'regexp' | 'wholeWord', label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className={`ed-find-toggle${options[key] ? ' ed-find-on' : ''}`}
      aria-pressed={options[key]}
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setOptions((o) => ({ ...o, [key]: !o[key] }))}
    >
      {icon}
    </button>
  )
  const says = !valid ? 'Not a regular expression' : countLabel(count, text)

  return (
    <div className="ed-find" role="search" aria-label="Find in this file">
      {!readOnly && (
        <button
          type="button"
          className="ed-find-fold"
          aria-expanded={replacing}
          title={replacing ? 'Hide replace' : 'Replace'}
          aria-label={replacing ? 'Hide replace' : 'Replace'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setReplacing((r) => !r)}
        >
          {replacing ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      )}
      <div className="ed-find-rows">
        <div className="ed-find-row">
          <input
            ref={input}
            className="ed-find-input"
            placeholder="Find"
            aria-label="Find"
            aria-invalid={!valid}
            spellCheck={false}
            value={text}
            onChange={(e) => setOptions((o) => ({ ...o, text: e.target.value }))}
            onKeyDown={(e) => onKeyDown(e, 'find')}
          />
          {toggle('matchCase', 'Match case', <CaseSensitive size={15} />)}
          {toggle('wholeWord', 'Whole word', <WholeWord size={15} />)}
          {toggle('regexp', 'Regular expression', <Regex size={14} />)}
          <span className={`ed-find-count${!valid || (text && count && !count.total) ? ' ed-find-none' : ''}`} aria-live="polite">
            {says}
          </span>
          <button type="button" className="ed-find-button" title="Previous (⇧Enter)" aria-label="Previous match" disabled={!count?.total} onMouseDown={(e) => e.preventDefault()} onClick={() => step(-1)}>
            <ChevronUp size={15} />
          </button>
          <button type="button" className="ed-find-button" title="Next (Enter)" aria-label="Next match" disabled={!count?.total} onMouseDown={(e) => e.preventDefault()} onClick={() => step(1)}>
            <ChevronDown size={15} />
          </button>
          <button type="button" className="ed-find-button" title="Close (Esc)" aria-label="Close find" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        {replacing && !readOnly && (
          <div className="ed-find-row">
            <input
              className="ed-find-input"
              placeholder="Replace"
              aria-label="Replace with"
              spellCheck={false}
              value={replace}
              onChange={(e) => setOptions((o) => ({ ...o, replace: e.target.value }))}
              onKeyDown={(e) => onKeyDown(e, 'replace')}
            />
            <button type="button" className="ed-find-text" disabled={!count?.total} onMouseDown={(e) => e.preventDefault()} onClick={replaceOne} title="Replace this one (Enter)">
              Replace
            </button>
            <button type="button" className="ed-find-text" disabled={!count?.total} onMouseDown={(e) => e.preventDefault()} onClick={replaceAll} title="Replace every one">
              All
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
