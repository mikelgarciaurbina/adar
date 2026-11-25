// What the links of the terminals show over the window: a picture (or where a web page or a PDF opens) while the
// pointer is over its link, and a picture large after ⌘-click, with its app and its folder a click away.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExternalLink, FolderOpen, X } from 'lucide-react'
import { api, isMac } from '@renderer/api/client'
import { toast } from '@renderer/components/common/toast'
import { formatBytes } from '@renderer/components/diff/targets'
import { describeError } from '@shared/errors'
import type { TerminalImage } from '@shared/terminal'
import { fileName, type LinkTarget } from './links'
import { focusTerminal, useTerminals } from './terminalStore'
import './terminal.css'

const CLICK = isMac ? '⌘-click' : 'Ctrl-click'

/** Pictures read lately: hovering again is quick, and a picture made again shows anew after a few seconds. */
const images = new Map<string, { at: number; image: Promise<TerminalImage | null> }>()
function loadImage(path: string): Promise<TerminalImage | null> {
  const kept = images.get(path)
  if (kept && Date.now() - kept.at < 5000) return kept.image
  const image = api.terminalImage(path).catch(() => null)
  images.delete(path)
  images.set(path, { at: Date.now(), image })
  if (images.size > 16) images.delete(images.keys().next().value!)
  return image
}

/** A picture of a link: undefined while it is read, null when there is none to show. */
function useImage(path: string | null): TerminalImage | null | undefined {
  const [image, setImage] = useState<TerminalImage | null | undefined>(undefined)
  useEffect(() => {
    setImage(undefined)
    if (!path) return
    let live = true
    void loadImage(path).then((img) => live && setImage(img))
    return () => {
      live = false
    }
  }, [path])
  return image
}

export function TerminalLinkLayer() {
  const link = useTerminals((s) => s.link)
  const viewer = useTerminals((s) => s.viewer)
  return (
    <>
      {link && link.target.kind !== 'web' && !viewer && <LinkCard target={link.target} x={link.x} y={link.y} />}
      {viewer && <ImageViewer id={viewer.id} path={viewer.path} />}
    </>
  )
}

/** Over a link: the picture, or what ⌘-click does with the file. Placed by the pointer, inside the window. */
function LinkCard({ target, x, y }: { target: Exclude<LinkTarget, { kind: 'web' }>; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const image = useImage(target.kind === 'image' ? target.path : null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  // A moment over the link before anything shows: passing over it on the way elsewhere shows nothing.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 250)
    return () => clearTimeout(t)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = x + 14 + w > window.innerWidth - 8 ? Math.max(8, x - 14 - w) : x + 14
    const top = y + 18 + h > window.innerHeight - 8 ? Math.max(8, y - 12 - h) : y + 18
    setAt({ left, top })
  }, [x, y, image, size, shown])
  // A link to a picture that is not there, or cannot be shown, says nothing.
  if (!shown || (target.kind === 'image' && !image)) return null
  const name = fileName(target.path)
  const what =
    target.kind === 'image'
      ? `${CLICK} to see it large`
      : target.kind === 'page'
        ? /\.html?$/i.test(name)
          ? `${CLICK} to open it in your browser`
          : `${CLICK} to open it`
        : `${CLICK} to show it in its folder`
  return (
    <div ref={ref} className="tm-link-card" role="tooltip" style={at ?? { visibility: 'hidden' }}>
      {target.kind === 'image' && image && <img src={image.url} alt="" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
      <div className="tm-link-name" title={target.path}>
        {name}
        {size && <span className="tm-link-meta"> · {size.w} × {size.h}</span>}
      </div>
      <div className="tm-link-what">{what}</div>
    </div>
  )
}

/** A picture large, over the window: Esc, a click beside it or × closes it. */
function ImageViewer({ id, path }: { id: string; path: string }) {
  const image = useImage(path)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const close = useRef<HTMLButtonElement>(null)
  const done = () => {
    useTerminals.setState({ viewer: null })
    focusTerminal(id)
  }
  useEffect(() => {
    close.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      useTerminals.setState({ viewer: null })
      focusTerminal(id)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [id])
  // There is nothing to show (gone, not a picture Adar can show, too large): its own app may.
  useEffect(() => {
    if (image !== null) return
    useTerminals.setState({ viewer: null })
    void api.terminalOpenFile(path).catch((err) => toast.error(describeError(err)))
  }, [image, path])
  const name = fileName(path)
  const failed = (err: unknown) => toast.error(describeError(err))
  return (
    <div className="ui-backdrop tm-viewer" role="dialog" aria-label={name} onMouseDown={(e) => e.target === e.currentTarget && done()}>
      <figure className="tm-viewer-frame">
        {image && <img src={image.url} alt={name} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
        <figcaption className="tm-viewer-bar">
          <span className="tm-viewer-name" title={path}>
            {name}
          </span>
          <span className="tm-viewer-meta">{[size && `${size.w} × ${size.h}`, image && formatBytes(image.size)].filter(Boolean).join(' · ')}</span>
          <button className="tm-viewer-button" onClick={() => void api.terminalOpenFile(path).catch(failed)} title="Open it with its app">
            <ExternalLink size={14} />
            Open
          </button>
          <button className="tm-viewer-button" onClick={() => void api.showInFolder(path).catch(failed)} title={isMac ? 'Show it in the Finder' : 'Show it in its folder'}>
            <FolderOpen size={14} />
            {isMac ? 'Show in Finder' : 'Show in folder'}
          </button>
          <button ref={close} className="tm-viewer-close" aria-label="Close" title="Close (Esc)" onClick={done}>
            <X size={15} />
          </button>
        </figcaption>
      </figure>
    </div>
  )
}
