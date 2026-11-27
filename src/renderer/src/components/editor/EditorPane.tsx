// One file open to edit, wherever it is shown (a repository's Files view, or the sheet over the window): its bar
// (name, Save, what else can be done with the file), what there is to say about it (it changed on disk under the
// text, it cannot be changed here) and the editor.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ClipboardCopy, Copy, Ellipsis, ExternalLink, Eye, FileWarning, FolderOpen, RotateCcw, RotateCcwClock, Save, ScanText, Search, TriangleAlert, WrapText, X } from 'lucide-react'
import * as git from '@renderer/actions/git'
import { relOf } from '@renderer/actions/editor'
import { isMac } from '@renderer/api/client'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { showMenuBelow, type MenuItem } from '@renderer/components/common/ContextMenu'
import { confirm } from '@renderer/components/common/dialogs'
import { tildify } from '@renderer/components/layout/chrome'
import { openMarkdown } from '@renderer/components/markdown/markdownStore'
import { shortcutLabel } from '@renderer/lib/keys'
import { useApp } from '@renderer/store/appStore'
import { isMarkdownPath } from '@shared/markdown'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import { checkDisk, keepMine, openDoc, reloadDoc, saveDoc, setWrap, useEditor } from './editorStore'

const FOLDER = isMac ? 'Show in Finder' : 'Show in folder'

/** How often an open file is looked at on disk, to notice what an agent writes meanwhile. */
const LOOK_EVERY_MS = 1500

export interface EditorPaneProps {
  docKey: string
  /** Leave the file (Esc, ×): the view decides whether anything is asked. */
  onClose(): void
  /** What the view puts at the start of the bar (its own controls). */
  lead?: ReactNode
  autoFocus?: boolean
}

export function EditorPane({ docKey, onClose, lead, autoFocus }: EditorPaneProps) {
  const doc = useEditor((s) => s.docs[docKey])
  const wrap = useEditor((s) => s.wrap)
  const home = useApp((s) => s.appInfo?.homeDir)
  const editor = useRef<CodeEditorHandle>(null)
  const [updated, setUpdated] = useState(false)

  // Look at the file on disk while it is shown, and whenever the window comes back.
  const ready = doc?.phase === 'ready'
  useEffect(() => {
    if (!ready) return
    const look = (): void => {
      if (document.visibilityState === 'visible') void checkDisk(docKey)
    }
    const timer = window.setInterval(look, LOOK_EVERY_MS)
    window.addEventListener('focus', look)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', look)
    }
  }, [docKey, ready])

  // "Updated", for a moment, when the text followed what something else wrote.
  useEffect(() => {
    if (!doc?.updated) return
    setUpdated(true)
    const timer = window.setTimeout(() => setUpdated(false), 2500)
    return () => window.clearTimeout(timer)
  }, [doc?.updated])

  if (!doc) return null
  const repo = doc.repo
  const rel = repo ? relOf(repo, docKey) : null
  const shown = rel ?? tildify(docKey, home)
  const cut = shown.lastIndexOf('/')
  const folder = cut > 0 ? shown.slice(0, cut) : ''
  const failed = (err: unknown): void => void err

  const discard = async (): Promise<void> => {
    const ok = await confirm({
      title: `Discard your changes to ${doc.name}?`,
      message: 'The file goes back to what is on disk. This cannot be undone.',
      confirmLabel: 'Discard changes',
      danger: true
    })
    if (ok) void reloadDoc(docKey)
  }

  const more = (el: HTMLElement): void => {
    const items: MenuItem[] = [
      { label: 'Find…', icon: <Search size={14} />, shortcut: shortcutLabel('Mod+F'), disabled: !ready, onClick: () => editor.current?.find(false) },
      { label: 'Replace…', icon: <Search size={14} />, shortcut: shortcutLabel('Mod+Alt+F'), disabled: !ready || !!doc.readOnly, onClick: () => editor.current?.find(true) },
      { label: 'Wrap long lines', icon: <WrapText size={14} />, checked: wrap, onClick: () => setWrap(!wrap) },
      { type: 'separator' },
      { label: 'Discard my changes…', icon: <RotateCcw size={14} />, disabled: !doc.dirty, danger: true, onClick: () => void discard() },
      { type: 'separator' },
      ...(repo && rel
        ? ([
            { label: 'File history', icon: <RotateCcwClock size={14} />, onClick: () => git.openFileHistory(repo, rel) },
            { label: 'Blame', icon: <ScanText size={14} />, onClick: () => git.openBlame(repo, rel) },
            { type: 'separator' }
          ] as MenuItem[])
        : []),
      { label: 'Open in your editor', icon: <ExternalLink size={14} />, onClick: () => void git.openInEditor(docKey).catch(failed) },
      { label: FOLDER, icon: <FolderOpen size={14} />, onClick: () => void git.showInFolder(docKey) },
      { type: 'separator' },
      ...(rel ? ([{ label: 'Copy path', icon: <Copy size={14} />, onClick: () => git.copyText(rel, 'Path copied') }] as MenuItem[]) : []),
      { label: 'Copy full path', icon: <ClipboardCopy size={14} />, onClick: () => git.copyText(docKey, 'Full path copied') }
    ]
    showMenuBelow(el, items)
  }

  /** No file to save over yet (it is gone and the text is kept): Save puts it back. */
  const toPutBack = ready && doc.version === undefined && !doc.disk
  const canSave = ready && !doc.readOnly && !doc.disk && (doc.dirty || toPutBack)

  return (
    <div className="ed-pane">
      <div className="ed-bar">
        {lead}
        <div className="ed-bar-file" title={docKey}>
          {doc.dirty && <span className="ed-bar-dot" role="img" aria-label="Not saved" title="Not saved" />}
          {folder && (
            <>
              <span className="ed-bar-folder">{folder}</span>
              <span className="ed-bar-sep">/</span>
            </>
          )}
          <span className="ed-bar-name">{doc.name}</span>
        </div>
        {updated && <span className="ed-badge ed-badge-news">Updated</span>}
        {doc.readOnly && <span className="ed-badge">Read only</span>}
        <span className="ed-bar-fill" />
        {ready && isMarkdownPath(docKey) && (
          <Button size="sm" variant="ghost" icon={<Eye size={14} />} title={doc.dirty ? 'Preview the document as it was last saved' : 'Preview: the document as it reads'} onClick={() => openMarkdown(docKey)}>
            Preview
          </Button>
        )}
        {ready && !doc.readOnly && (
          <Button
            size="sm"
            variant={canSave ? 'primary' : 'ghost'}
            className="ed-save"
            icon={doc.saving ? <Spinner size="sm" /> : <Save size={14} />}
            disabled={!canSave || doc.saving}
            title={`Save (${shortcutLabel('Mod+S')})`}
            onClick={() => void saveDoc(docKey)}
          >
            {toPutBack ? 'Save again' : 'Save'}
          </Button>
        )}
        <IconButton size="sm" label="More" onClick={(e) => more(e.currentTarget)}>
          <Ellipsis size={15} />
        </IconButton>
        <IconButton size="sm" label="Close (Esc)" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>

      {doc.disk === 'changed' && (
        <div className="ed-notice ed-notice-warn" role="alert">
          <TriangleAlert size={15} />
          <span className="ed-notice-text">
            <strong>{doc.name} changed on disk</strong> while you were editing it. Saving would write your text over what is there now.
          </span>
          <Button size="sm" onClick={() => void reloadDoc(docKey)} title="Give up your changes and take the file as it is now">
            Reload from disk
          </Button>
          <Button size="sm" variant="primary" onClick={() => void keepMine(docKey)} title="Keep your text: the next save writes over the file">
            Keep my text
          </Button>
        </div>
      )}
      {doc.disk === 'gone' && (
        <div className="ed-notice ed-notice-warn" role="alert">
          <TriangleAlert size={15} />
          <span className="ed-notice-text">
            <strong>{doc.name} was deleted</strong> while it was open here.
          </span>
          <Button size="sm" onClick={onClose}>
            Close it
          </Button>
          <Button size="sm" variant="primary" onClick={() => void keepMine(docKey)} title="Keep the text: saving puts the file back">
            Keep the text
          </Button>
        </div>
      )}
      {doc.readOnly && (
        <div className="ed-notice">
          <FileWarning size={15} />
          <span className="ed-notice-text">{doc.readOnly}</span>
          <Button size="sm" onClick={() => void git.openInEditor(docKey).catch(failed)}>
            Open in your editor
          </Button>
        </div>
      )}

      {doc.phase === 'failed' ? (
        <div className="ed-failed">
          <EmptyState icon={<FileWarning size={28} />} title={doc.missing ? 'This file is not there' : 'Adar cannot edit this file'}>
            <p className="ed-failed-why">{doc.error}</p>
            <div className="ed-failed-actions">
              {doc.missing ? (
                <Button size="sm" onClick={() => void openDoc(docKey, repo)}>
                  Look again
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={() => void git.openInEditor(docKey).catch(failed)}>
                    Open in your editor
                  </Button>
                  <Button size="sm" onClick={() => void git.showInFolder(docKey)}>
                    {FOLDER}
                  </Button>
                </>
              )}
            </div>
          </EmptyState>
        </div>
      ) : (
        <CodeEditor ref={editor} docKey={docKey} autoFocus={autoFocus} onEscape={() => (onClose(), true)} />
      )}
    </div>
  )
}
