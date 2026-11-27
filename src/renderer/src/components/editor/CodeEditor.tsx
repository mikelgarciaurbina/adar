// The editor of one open file: CodeMirror in the page while this is shown (its state is kept in editorStore, so it
// comes back as it was), the find bar over its corner and the line under it that says where the cursor is.

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Spinner } from '@renderer/components/common/Button'
import type { EditorState } from './cm'
import { attach, detach, loadCodeMirror, loadedCodeMirror, useEditor, viewOf } from './editorStore'
import { FindBar, type FindRequest } from './FindBar'
import { positionLabel } from './model'

export interface CodeEditorHandle {
  focus(): void
  find(replace: boolean): void
}

interface Cursor {
  line: number
  column: number
  selected: number
  lines: number
}

function cursorOf(state: EditorState): Cursor {
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.head)
  const selected = sel.to - sel.from
  return {
    line: line.number,
    column: sel.head - line.from + 1,
    selected,
    lines: selected ? state.doc.lineAt(sel.to).number - state.doc.lineAt(sel.from).number + 1 : 0
  }
}

export interface CodeEditorProps {
  docKey: string
  /** Take the keyboard when the editor is put in the page. */
  autoFocus?: boolean
  /** Esc with nothing of the editor's to dismiss; true when it was taken. */
  onEscape(): boolean
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor({ docKey, autoFocus, onEscape }, ref) {
  const ready = useEditor((s) => s.docs[docKey]?.phase === 'ready')
  const doc = useEditor((s) => s.docs[docKey])
  const [cm, setCm] = useState(() => loadedCodeMirror())
  const host = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<Cursor | null>(null)
  const [finding, setFinding] = useState<FindRequest | null>(null)
  /** Counts the changes of text and selection: the find bar counts its matches again. */
  const [tick, setTick] = useState(0)
  const escape = useRef(onEscape)
  escape.current = onEscape
  const findOpen = useRef(false)
  findOpen.current = !!finding

  useEffect(() => {
    if (cm) return
    let live = true
    void loadCodeMirror().then((m) => live && setCm(() => m))
    return () => {
      live = false
    }
  }, [cm])

  const openFind = (replace: boolean): void => {
    const view = viewOf(docKey)
    const seed = view ? (loadedCodeMirror()?.selectedWord(view.state) ?? '') : ''
    setFinding((f) => ({ replace, seed, n: (f?.n ?? 0) + 1 }))
  }
  const closeFind = (): void => {
    setFinding(null)
    viewOf(docKey)?.focus()
  }

  useImperativeHandle(ref, () => ({ focus: () => viewOf(docKey)?.focus(), find: openFind }), [docKey])

  useLayoutEffect(() => {
    if (!cm || !ready || !host.current) return
    const view = attach(docKey, host.current, {
      onFind: openFind,
      onEscape: () => {
        if (findOpen.current) {
          closeFind()
          return true
        }
        return escape.current()
      },
      onCursor: (state) => {
        setCursor(cursorOf(state))
        setTick((t) => t + 1)
      }
    })
    if (view && autoFocus) view.focus()
    return () => {
      detach(docKey)
      setFinding(null)
    }
  }, [cm, ready, docKey])

  return (
    <div className="ed-code">
      <div className="ed-code-host" ref={host} data-editor={docKey} />
      {(!cm || !ready) && (
        <div className="ed-code-wait">
          <Spinner />
        </div>
      )}
      {finding && ready && <FindBar docKey={docKey} request={finding} tick={tick} readOnly={!!doc?.readOnly} onClose={closeFind} />}
      {doc && ready && (
        <div className="ed-status" aria-label="About this file">
          <span className="ed-status-at">{cursor ? positionLabel(cursor.line, cursor.column, cursor.selected, cursor.lines) : ''}</span>
          <span className="ed-status-fill" />
          {doc.readOnly && <span>Read only</span>}
          <span title={doc.indent.tabs ? 'Indented with tabs' : `Indented with ${doc.indent.size} spaces`}>{doc.indent.tabs ? 'Tabs' : `Spaces: ${doc.indent.size}`}</span>
          <span title={doc.eol === '\r\n' ? 'Windows line endings (CRLF), kept when saving' : 'Unix line endings (LF)'}>{doc.eol === '\r\n' ? 'CRLF' : 'LF'}</span>
          <span title={doc.bom ? 'UTF-8 with a byte order mark, kept when saving' : 'UTF-8'}>{doc.bom ? 'UTF-8 BOM' : 'UTF-8'}</span>
          {doc.language && <span>{doc.language}</span>}
        </div>
      )}
    </div>
  )
})
