// A repository's Files view (a centre view): the tree of its files on the left and the file being edited beside it,
// with the changes panel still on the right, so a fix is typed, saved, seen among the changes and committed without
// leaving Adar. Esc goes back to where the view was opened from; the text stays, saved or not.

import { useEffect, useState } from 'react'
import { FileCode2, PanelLeft } from 'lucide-react'
import { closeFiles, editFile } from '@renderer/actions/editor'
import { absPath } from '@renderer/actions/git'
import { EmptyState, IconButton, Kbd } from '@renderer/components/common/Button'
import { Resizer } from '@renderer/components/common/Resizer'
import { shortcutLabel } from '@renderer/lib/keys'
import type { CenterView, RepoTab } from '@renderer/store/appStore'
import { EditorPane } from './EditorPane'
import { openDoc, useEditor } from './editorStore'
import { FileTree } from './FileTree'
import './editor.css'

const WIDTH_KEY = 'adar.editor.treeWidth'
const SHOWN_KEY = 'adar.editor.tree'

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A convenience only.
  }
}

export function FilesView({ tab, view }: { tab: RepoTab; view: Extract<CenterView, { kind: 'files' }> }) {
  const repo = tab.path
  const key = view.path ? absPath(repo, view.path) : null
  const doc = useEditor((s) => (key ? s.docs[key] : undefined))
  const [width, setWidth] = useState(() => Math.max(160, Math.min(520, Number(stored(WIDTH_KEY)) || 250)))
  const [tree, setTree] = useState(() => stored(SHOWN_KEY) !== '0')

  // The view was shown again (or the window loaded anew) on a file that is not open yet. Whatever file it shows is
  // the one it comes back to.
  useEffect(() => {
    if (!key) return
    if (!doc) void openDoc(key, repo)
    if (useEditor.getState().last[repo] !== key) useEditor.setState((s) => ({ last: { ...s.last, [repo]: key } }))
  }, [key, repo, !doc])

  // Esc with the keyboard outside the editor (in the tree): back to where the view was opened from.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.ui-backdrop, .ui-menu, .pal-overlay')) return
      const el = e.target as HTMLElement | null
      if (el?.closest('.cm-editor, .ed-find, input, textarea, .tm-root, .xterm')) return
      e.preventDefault()
      closeFiles(repo)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repo])

  const toggleTree = (): void => {
    setTree((shown) => {
      store(SHOWN_KEY, shown ? '0' : '1')
      return !shown
    })
  }
  const treeButton = (
    <IconButton size="sm" label={tree ? 'Hide the files' : 'Show the files'} aria-pressed={tree} onClick={toggleTree}>
      <PanelLeft size={15} />
    </IconButton>
  )

  return (
    <div className="ed-view">
      {tree && (
        <>
          <div className="ed-view-tree" style={{ width }}>
            <FileTree repo={repo} status={tab.status} current={view.path} unsaved={!!doc?.dirty} onOpen={(path) => void editFile(repo, path)} />
          </div>
          <Resizer
            side="left"
            width={width}
            min={160}
            max={520}
            onResize={(w) => {
              setWidth(w)
              store(WIDTH_KEY, String(Math.round(w)))
            }}
          />
        </>
      )}
      <div className="ed-view-main">
        {key ? (
          <EditorPane key={key} docKey={key} lead={treeButton} autoFocus onClose={() => closeFiles(repo)} />
        ) : (
          <div className="ed-pane">
            <div className="ed-bar">
              {treeButton}
              <span className="ed-bar-fill" />
            </div>
            <div className="ed-failed">
              <EmptyState icon={<FileCode2 size={28} />} title="Pick a file to edit">
                <p>
                  Choose one in the tree, or find it by name with <Kbd>{shortcutLabel('Mod+P')}</Kbd>.
                </p>
                <p className="ed-hint">A click on a path in a terminal, or Edit on a diff, opens the file here too.</p>
              </EmptyState>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
