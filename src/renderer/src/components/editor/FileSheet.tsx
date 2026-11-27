// A file that is in no open repository (opened with Adar from the Finder, a path in a terminal elsewhere), edited in
// a sheet over the window, as Markdown documents are read. Esc, × or a click beside it closes it, asking first when
// its text was not saved.

import { closeSheet } from '@renderer/actions/editor'
import { EditorPane } from './EditorPane'
import { useEditor } from './editorStore'
import './editor.css'

export function FileSheet() {
  const sheet = useEditor((s) => s.sheet)
  const name = useEditor((s) => (s.sheet ? s.docs[s.sheet.key]?.name : undefined))
  if (!sheet) return null
  return (
    <div className="ui-backdrop ed-sheet-back" role="dialog" aria-label={name ?? 'File'} onMouseDown={(e) => e.target === e.currentTarget && void closeSheet()}>
      <div className="ed-sheet">
        <EditorPane key={sheet.key} docKey={sheet.key} autoFocus onClose={() => void closeSheet()} />
      </div>
    </div>
  )
}
