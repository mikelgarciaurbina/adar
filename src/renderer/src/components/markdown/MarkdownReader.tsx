// A Markdown file read over the window: the document as it will look, its outline, and its source a click away. It
// follows the file while it is open (an agent writing its plan is read as it grows), goes from one document to
// another through their links, and leaves with Esc, a click beside it or ×.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Code, Eye, FileText, FolderOpen, ListTree, SquarePen, X } from 'lucide-react'
import { api, isMac } from '@renderer/api/client'
import { editMarkdown } from '@renderer/actions/editor'
import { Button, EmptyState, IconButton, Spinner } from '@renderer/components/common/Button'
import { toast } from '@renderer/components/common/toast'
import { focusTerminal } from '@renderer/components/terminal/terminalStore'
import { useApp } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { MarkdownFile } from '@shared/markdown'
import { MarkdownView, scrollToAnchor, type MarkdownHost } from './MarkdownView'
import { closeMarkdown, markdownBack, openMarkdown, useMarkdown, type OpenDocument } from './markdownStore'
import { parseMarkdown, type Heading } from './parse'
import './markdown.css'

/** How often an open document's file is looked at again (ms). */
const FOLLOW_EVERY = 1000

const OUTLINE_KEY = 'adar.markdown.outline'
function outlinePref(): boolean {
  try {
    return localStorage.getItem(OUTLINE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** "/Users/me/code/app/docs" → "~/code/app/docs". */
function shortFolder(path: string, home: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dir = cut > 0 ? path.slice(0, cut) : path
  return home && (dir === home || dir.startsWith(`${home}/`)) ? `~${dir.slice(home.length)}` : dir
}

const nameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

export function MarkdownReader() {
  const doc = useMarkdown((s) => s.doc)
  return doc ? <Reader key={doc.path} doc={doc} /> : null
}

function Outline({ headings, onPick }: { headings: Heading[]; onPick: (id: string) => void }) {
  const top = Math.min(...headings.map((h) => h.level))
  return (
    <nav className="doc-outline" aria-label="Outline">
      {headings.map((h, i) => (
        <button key={i} className="doc-outline-item" style={{ paddingLeft: 12 + (h.level - top) * 12 }} title={h.text} onClick={() => onPick(h.id)}>
          {h.text}
        </button>
      ))}
    </nav>
  )
}

function Reader({ doc }: { doc: OpenDocument }) {
  const { path } = doc
  const home = useApp((s) => s.appInfo?.homeDir ?? '')
  const [file, setFile] = useState<MarkdownFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The file was read before and is no longer there: what was read stays on screen. */
  const [gone, setGone] = useState(false)
  /** The file changed a moment ago. */
  const [fresh, setFresh] = useState(false)
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [outline, setOutline] = useState(outlinePref)
  const scroll = useRef<HTMLDivElement>(null)
  const version = useRef<string | null>(null)

  const close = useCallback(() => {
    const terminal = useMarkdown.getState().doc?.terminal
    closeMarkdown()
    if (terminal) focusTerminal(terminal)
  }, [])

  // Read the file, then keep looking at it: the document on screen is the file as it is now.
  useEffect(() => {
    let live = true
    let busy = false
    const load = async () => {
      if (busy) return
      busy = true
      try {
        const next = await api.readMarkdownFile(path, version.current ? { unless: version.current } : undefined)
        if (!live) return
        setGone(false)
        if (!next) return
        if (version.current) setFresh(true)
        version.current = next.version
        setFile(next)
        setError(null)
      } catch (err) {
        if (!live) return
        if (version.current) setGone(true)
        else setError(describeError(err))
      } finally {
        busy = false
      }
    }
    void load()
    const timer = setInterval(() => !document.hidden && void load(), FOLLOW_EVERY)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [path])

  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setFresh(false), 1800)
    return () => clearTimeout(t)
  }, [fresh])

  // Esc leaves, before anything under the document hears it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.ui-menu')) return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [close])

  const parsed = useMemo(() => (file ? parseMarkdown(file.text) : null), [file])
  const loaded = !!parsed

  // The keyboard scrolls the document; a link to a heading opens on it.
  useEffect(() => {
    if (!loaded) return
    scroll.current?.focus({ preventScroll: true })
    if (doc.anchor) scrollToAnchor(scroll.current, doc.anchor)
  }, [loaded, doc.anchor])

  const host = useMemo<MarkdownHost>(
    () => ({
      image: (src) => api.markdownImage(path, src),
      openLink: (href) => {
        const failed = (err: unknown) => toast.error(describeError(err))
        if (/^(?:https?|mailto):/i.test(href)) return void api.openExternal(href).catch(failed)
        void api.markdownLink(path, href).then((link) => {
          if (!link) return void toast.info(`Nothing to open at ${href}`)
          // Another document is read here; any other file is only shown in its folder, never opened.
          if (!link.markdown) return void api.showInFolder(link.path).catch(failed)
          if (link.path === path) scrollToAnchor(scroll.current, link.anchor)
          else openMarkdown(link.path, { anchor: link.anchor, follow: true })
        }, failed)
      }
    }),
    [path]
  )

  const toggleOutline = () => {
    const next = !outline
    setOutline(next)
    try {
      localStorage.setItem(OUTLINE_KEY, next ? 'on' : 'off')
    } catch {
      // Remembered for this window only.
    }
  }

  const name = nameOf(path)
  const headings = useMemo(() => (parsed ? parsed.headings.filter((h) => h.level <= 3 && h.text) : []), [parsed])
  const hasOutline = headings.length > 1
  const failed = (err: unknown) => toast.error(describeError(err))

  return (
    <div className="ui-backdrop doc-reader" role="dialog" aria-label={name} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="doc-sheet">
        <div className="doc-bar">
          {doc.back.length > 0 && (
            <IconButton size="sm" label={`Back to ${nameOf(doc.back[doc.back.length - 1])}`} onClick={markdownBack}>
              <ArrowLeft size={15} />
            </IconButton>
          )}
          <FileText size={15} className="doc-bar-icon" />
          <span className="doc-bar-name" title={path}>
            {name}
          </span>
          <span className="doc-bar-folder" title={path}>
            {shortFolder(path, home)}
          </span>
          {gone ? <span className="doc-bar-state doc-bar-gone">The file is no longer there</span> : fresh ? <span className="doc-bar-state">Updated</span> : null}
          <span className="doc-bar-space" />
          <div className="doc-seg" role="radiogroup" aria-label="How the document is shown">
            <button type="button" role="radio" aria-checked={mode === 'preview'} className={`doc-seg-btn${mode === 'preview' ? ' doc-seg-on' : ''}`} onClick={() => setMode('preview')} title="The document as it reads">
              <Eye size={14} />
              <span>Preview</span>
            </button>
            <button type="button" role="radio" aria-checked={mode === 'source'} className={`doc-seg-btn${mode === 'source' ? ' doc-seg-on' : ''}`} onClick={() => setMode('source')} title="The Markdown as it is written">
              <Code size={14} />
              <span>Source</span>
            </button>
          </div>
          {hasOutline && mode === 'preview' && (
            <IconButton size="sm" label={outline ? 'Hide the outline' : 'Show the outline'} active={outline} onClick={toggleOutline}>
              <ListTree size={15} />
            </IconButton>
          )}
          <Button size="sm" variant="ghost" className="doc-bar-btn" icon={<SquarePen size={14} />} title="Edit it in Adar" onClick={() => void editMarkdown(path)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" className="doc-bar-btn" icon={<FolderOpen size={14} />} title={isMac ? 'Show it in the Finder' : 'Show it in its folder'} onClick={() => void api.showInFolder(path).catch(failed)}>
            {isMac ? 'Show in Finder' : 'Show in folder'}
          </Button>
          <IconButton label="Close (Esc)" onClick={close}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="doc-main">
          {parsed && hasOutline && outline && mode === 'preview' && <Outline headings={headings} onPick={(id) => scrollToAnchor(scroll.current, id)} />}
          <div className="doc-scroll" ref={scroll} tabIndex={-1}>
            {error ? (
              <EmptyState icon={<AlertTriangle size={36} />} title="Could not open this file">
                <p>{error}</p>
                <Button size="sm" onClick={close}>
                  Close
                </Button>
              </EmptyState>
            ) : !file || !parsed ? (
              <div className="doc-loading">
                <Spinner size="lg" />
              </div>
            ) : mode === 'source' ? (
              <pre className="doc-source selectable">{file.text}</pre>
            ) : (
              <div className="doc-page">
                <MarkdownView doc={parsed} host={host} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
