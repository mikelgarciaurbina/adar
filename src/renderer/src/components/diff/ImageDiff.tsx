// Changed images. An added or deleted image shows alone; a modified one gets the image bar: side by side,
// swipe (After over Before, cut by a line you drag), onion skin (one faded into the other) or difference
// (only what changed, in red), Fit or 1:1, and the changed areas that the diff toolbar's arrows and N / P
// go through (imageCompare.ts finds them).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { Check, ChevronsLeftRight, ImageOff } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Spinner } from '@renderer/components/common/Button'
import { describeError } from '@shared/errors'
import type { DiffTarget, FileContent, FileDiff, ImageDiffMode } from '@shared/types'
import type { ChangeNav, DiffRendererHandle } from './DiffRenderer'
import { MAX_COMPARE_PIXELS, compareImages, differenceImage, type Area, type Comparison, type Pixels } from './imageCompare'
import { setImageDiffIgnoreAntialiasing, setImageDiffMode, setImageView, useImageDiffPrefs, useImageView } from './prefs'
import { contentSources, formatBytes, imageMime, type ContentSource } from './targets'

interface LoadedImage {
  url: string | null
  size: number
  error?: string
}

async function loadImage(repo: string, src: ContentSource): Promise<LoadedImage> {
  let content: FileContent = await api.getFileContent(repo, src.path, src.rev)
  if (!content.exists && src.fallbackRev) content = await api.getFileContent(repo, src.path, src.fallbackRev)
  if (!content.exists) return { url: null, size: 0, error: 'File does not exist in this revision' }
  const mime = imageMime(src.path)
  if (content.base64) return { url: `data:${mime};base64,${content.base64}`, size: content.size }
  if (content.text !== undefined && mime === 'image/svg+xml') {
    return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content.text)}`, size: content.size }
  }
  return { url: null, size: content.size, error: content.size > 10 * 1024 * 1024 ? 'Image too large to preview' : 'Preview not available' }
}

export interface ImageDiffProps {
  repo: string
  diff: FileDiff
  target: DiffTarget
  /** Lets the diff toolbar (and N / P) go through the changed areas. */
  handle?: MutableRefObject<DiffRendererHandle | null>
  onChangeNav?: (nav: ChangeNav | null) => void
}

export function ImageDiff({ repo, diff, target, handle, onChangeNav }: ImageDiffProps) {
  const sources = contentSources(target, diff)
  const key = JSON.stringify(sources)
  const [state, setState] = useState<{ old: LoadedImage | null; new: LoadedImage | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setState(null)
    setError(null)
    const { old: o, new: n } = JSON.parse(key) as typeof sources
    Promise.all([o ? loadImage(repo, o) : null, n ? loadImage(repo, n) : null]).then(
      ([oldImg, newImg]) => alive && setState({ old: oldImg, new: newImg }),
      (err) => alive && setError(describeError(err))
    )
    return () => {
      alive = false
    }
  }, [repo, key])

  if (error) {
    return (
      <div className="diff-image-view">
        <div className="diff-image-error">{error}</div>
      </div>
    )
  }
  if (!state) {
    return (
      <div className="diff-image-view diff-center">
        <Spinner />
      </div>
    )
  }
  if (state.old?.url && state.new?.url) {
    return <ImageCompare key={key} before={state.old as Shown} after={state.new as Shown} handle={handle} onChangeNav={onChangeNav} />
  }
  return (
    <div className="diff-image-view">
      {state.old && <ImagePane label="Before" kind="del" img={state.old} />}
      {state.new && <ImagePane label={state.old ? 'After' : 'Added'} kind="add" img={state.new} />}
      {!state.new && state.old && <div className="diff-image-note">File deleted</div>}
    </div>
  )
}

function ImagePane({ label, kind, img }: { label: string; kind: 'add' | 'del'; img: LoadedImage }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [broken, setBroken] = useState(false)
  return (
    <div className={`diff-image-pane diff-image-${kind}`}>
      <div className="diff-image-label">
        <span className="diff-image-tag">{label}</span>
        <span className="diff-image-meta">
          {dims && `${dims.w} × ${dims.h} px · `}
          {formatBytes(img.size)}
        </span>
      </div>
      <div className="diff-image-frame">
        {img.url && !broken ? (
          <img
            src={img.url}
            alt={label}
            draggable={false}
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="diff-image-missing">
            <ImageOff size={28} />
            <span>{img.error ?? 'Cannot display this image'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Comparing two images ───────────────────────────────────────────────────

type Shown = LoadedImage & { url: string }

interface Decoded {
  img: HTMLImageElement
  width: number
  height: number
}

async function decode(url: string): Promise<Decoded> {
  const img = new Image()
  img.src = url
  await img.decode()
  // An SVG without a size of its own gets the size browsers give it.
  return { img, width: img.naturalWidth || 300, height: img.naturalHeight || 150 }
}

function pixelsOf(d: Decoded): Pixels {
  const canvas = document.createElement('canvas')
  canvas.width = d.width
  canvas.height = d.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No canvas')
  ctx.drawImage(d.img, 0, 0, d.width, d.height)
  return { width: d.width, height: d.height, data: ctx.getImageData(0, 0, d.width, d.height).data }
}

type CompareState =
  | { status: 'working' }
  | { status: 'done'; cmp: Comparison; before: Pixels; after: Pixels }
  | { status: 'unavailable'; reason: string }

const MODES: Array<{ value: ImageDiffMode; label: string; title: string }> = [
  { value: 'side', label: 'Side by side', title: 'Before and After next to each other' },
  { value: 'swipe', label: 'Swipe', title: 'After over Before, cut by a line you drag' },
  { value: 'onion', label: 'Onion skin', title: 'After over Before, faded one into the other' },
  { value: 'difference', label: 'Difference', title: 'Only what changed, in red' }
]

/** Padding around an image in its scrolling frame (both sides together). */
const FRAME_PAD = 24
/** How far Fit enlarges a small image (an icon). */
const MAX_FIT = 4

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

function percent(changed: number, total: number): string {
  const p = (changed / Math.max(1, total)) * 100
  return p < 0.1 ? 'under 0.1%' : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

function ImageCompare(props: { before: Shown; after: Shown; handle?: MutableRefObject<DiffRendererHandle | null>; onChangeNav?: (nav: ChangeNav | null) => void }) {
  const { before, after, handle, onChangeNav } = props
  const { mode, ignoreAntialiasing } = useImageDiffPrefs()
  const view = useImageView()
  const [decoded, setDecoded] = useState<{ before: Decoded; after: Decoded } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const [compare, setCompare] = useState<CompareState>({ status: 'working' })
  const [index, setIndex] = useState(-1)
  const [flash, setFlash] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const scrollers = useRef<Array<HTMLDivElement | null>>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useElementSize(stageRef)

  useEffect(() => {
    let alive = true
    Promise.all([decode(before.url), decode(after.url)]).then(
      ([b, a]) => alive && setDecoded({ before: b, after: a }),
      () => alive && setBroken('Cannot display these images')
    )
    return () => {
      alive = false
    }
  }, [before.url, after.url])

  useEffect(() => {
    if (!decoded) return
    let alive = true
    setCompare({ status: 'working' })
    const { before: b, after: a } = decoded
    if (b.width * b.height + a.width * a.height > MAX_COMPARE_PIXELS) {
      setCompare({ status: 'unavailable', reason: 'Too large to compare pixel by pixel' })
      return
    }
    let pixels: [Pixels, Pixels]
    try {
      pixels = [pixelsOf(b), pixelsOf(a)]
    } catch {
      setCompare({ status: 'unavailable', reason: 'Adar could not read the pixels of these images' })
      return
    }
    compareImages(pixels[0], pixels[1], { ignoreAntialiasing }, () => !alive).then(
      (cmp) => alive && cmp && setCompare({ status: 'done', cmp, before: pixels[0], after: pixels[1] }),
      () => alive && setCompare({ status: 'unavailable', reason: 'Adar could not compare these images' })
    )
    return () => {
      alive = false
    }
  }, [decoded, ignoreAntialiasing])

  const areas = compare.status === 'done' ? compare.cmp.areas : NO_AREAS
  useEffect(() => setIndex(-1), [compare])
  useEffect(() => {
    onChangeNav?.(compare.status === 'done' ? { index, count: areas.length } : null)
  }, [onChangeNav, compare, index, areas])
  useEffect(() => () => onChangeNav?.(null), [onChangeNav])

  // The Difference picture, drawn once per comparison.
  useEffect(() => {
    if (mode !== 'difference' || compare.status !== 'done') return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { cmp } = compare
    ctx.putImageData(new ImageData(differenceImage(compare.before, compare.after, cmp) as Uint8ClampedArray<ArrayBuffer>, cmp.width, cmp.height), 0, 0)
  }, [mode, compare])

  const bw = decoded?.before.width ?? 1
  const bh = decoded?.before.height ?? 1
  const aw = decoded?.after.width ?? 1
  const ah = decoded?.after.height ?? 1
  const W = Math.max(bw, aw)
  const H = Math.max(bh, ah)
  const side = mode === 'side'
  // Fit: the whole image in its frame (side by side: in half the width, under the labels); 1:1: real pixels.
  const availW = side ? (size.width - 32 - 16) / 2 - FRAME_PAD - 2 : size.width - FRAME_PAD
  const availH = side ? size.height - 32 - 33 - FRAME_PAD - 2 : size.height - FRAME_PAD - 28
  const fit = size.width ? clamp(Math.min(availW / W, availH / H), 0.02, MAX_FIT) : 1
  const scale = view.zoom === 'actual' ? 1 : fit
  const rendering = scale > 1 ? ('pixelated' as const) : undefined
  const current = index >= 0 ? areas[index] : undefined

  // ── Changed areas: N / P and the toolbar's arrows ─────────────────────────
  const live = useRef({ areas, index, scale })
  live.current = { areas, index, scale }
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (flashTimer.current && clearTimeout(flashTimer.current)), [])

  const jumpTo = useCallback((i: number) => {
    setIndex(i)
    setFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(false), 1600)
    requestAnimationFrame(() => {
      const { areas: list, scale: s } = live.current
      const area = list[i]
      if (!area) return
      for (const el of scrollers.current) {
        const box = el?.querySelector<HTMLElement>('.diff-image-box')
        if (!el || !box) continue
        el.scrollTo({
          left: box.offsetLeft + (area.x + area.width / 2) * s - el.clientWidth / 2,
          top: box.offsetTop + (area.y + area.height / 2) * s - el.clientHeight / 2,
          behavior: 'smooth'
        })
      }
    })
  }, [])

  useEffect(() => {
    if (!handle) return
    handle.current = {
      jumpChange(dir) {
        const { areas: list, index: from } = live.current
        if (!list.length) return
        const next = from < 0 && dir < 0 ? -1 : clamp(from + dir, 0, list.length - 1)
        if (next < 0 || next === from) return
        jumpTo(next)
      },
      focus() {
        stageRef.current?.focus({ preventScroll: true })
      }
    }
    return () => {
      if (handle.current) handle.current = null
    }
  }, [handle, jumpTo])

  // ── Side by side: both frames scroll together ─────────────────────────────
  const syncing = useRef(false)
  const onScroll = (i: number) => () => {
    if (!side || syncing.current) return
    const from = scrollers.current[i]
    const to = scrollers.current[1 - i]
    if (!from || !to) return
    syncing.current = true
    to.scrollLeft = from.scrollLeft
    to.scrollTop = from.scrollTop
    requestAnimationFrame(() => (syncing.current = false))
  }

  // ── Swipe and onion skin ──────────────────────────────────────────────────
  const swipeTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setImageView({ swipe: clamp((e.clientX - r.left) / r.width, 0, 1) })
  }
  const flip = () => setImageView({ onion: useImageView.getState().onion < 50 ? 100 : 0 })
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mode === 'swipe' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
      e.preventDefault()
      const step = (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowLeft' ? -1 : 1)
      setImageView({ swipe: e.key === 'Home' ? 0 : e.key === 'End' ? 1 : clamp(view.swipe + step, 0, 1) })
    } else if (mode === 'onion' && e.key === ' ' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      flip()
    }
  }

  const identical = compare.status === 'done' && compare.cmp.changed === 0
  const sizes = `${formatBytes(before.size)} → ${formatBytes(after.size)}`
  const dims = bw === aw && bh === ah ? `${aw} × ${ah} px both` : `${bw} × ${bh} → ${aw} × ${ah} px · lined up at the top left`
  const img = (which: 'before' | 'after', style?: CSSProperties) => (
    <img
      src={which === 'before' ? before.url : after.url}
      alt={which === 'before' ? 'Before' : 'After'}
      draggable={false}
      style={{ width: (which === 'before' ? bw : aw) * scale, height: (which === 'before' ? bh : ah) * scale, imageRendering: rendering, ...style }}
    />
  )

  let middle: ReactNode
  if (identical) {
    middle = (
      <span className="diff-image-same">
        <Check size={13} /> <b>No visible change</b> · {sizes}
      </span>
    )
  } else if (mode === 'side') {
    middle = <span className="diff-image-hint">Both sides scroll together</span>
  } else if (mode === 'swipe') {
    middle = (
      <span className="diff-image-hint">
        <b>Before</b> left of the line, <b>After</b> right of it · drag anywhere, or ← →
      </span>
    )
  } else if (mode === 'onion') {
    middle = (
      <>
        <label htmlFor="diff-image-onion" className="diff-image-before">
          Before
        </label>
        <input
          id="diff-image-onion"
          type="range"
          min={0}
          max={100}
          value={view.onion}
          aria-valuetext={`${view.onion}% After`}
          onChange={(e) => setImageView({ onion: Number(e.target.value) })}
        />
        <span className="diff-image-after">After</span>
        <span className="diff-image-pct">{view.onion}%</span>
        <span className="diff-image-hint" title="Space, or a click on the image, flips between Before and After">
          · Space flips
        </span>
      </>
    )
  } else {
    middle = (
      <>
        {compare.status === 'working' ? (
          <span className="diff-image-working">
            <Spinner size="sm" /> Comparing…
          </span>
        ) : compare.status === 'unavailable' ? (
          <span>{compare.reason}</span>
        ) : (
          <span>
            <b>
              {areas.length} changed {areas.length === 1 ? 'area' : 'areas'}
            </b>{' '}
            · {percent(compare.cmp.changed, compare.cmp.width * compare.cmp.height)} of the pixels
          </span>
        )}
        <label className="diff-image-check" title="Leave out the faint edge differences screenshots get from another machine or font smoothing">
          <input type="checkbox" checked={ignoreAntialiasing} onChange={(e) => setImageDiffIgnoreAntialiasing(e.target.checked)} /> Ignore anti-aliasing
        </label>
      </>
    )
  }

  let body: ReactNode
  if (broken) {
    body = (
      <div className="diff-image-missing diff-image-centered">
        <ImageOff size={28} />
        <span>{broken}</span>
      </div>
    )
  } else if (!decoded) {
    body = (
      <div className="diff-image-centered">
        <Spinner />
      </div>
    )
  } else if (side) {
    scrollers.current = [null, null]
    body = (
      <div className="diff-image-sides">
        {(['before', 'after'] as const).map((which, i) => (
          <div key={which} className={`diff-image-pane diff-image-${which === 'before' ? 'del' : 'add'}`}>
            <div className="diff-image-label">
              <span className="diff-image-tag">{which === 'before' ? 'Before' : 'After'}</span>
              <span className="diff-image-meta">
                {which === 'before' ? `${bw} × ${bh}` : `${aw} × ${ah}`} px · {formatBytes(which === 'before' ? before.size : after.size)}
              </span>
            </div>
            <div className="diff-image-scroll" ref={(el) => void (scrollers.current[i] = el)} onScroll={onScroll(i)}>
              <div className="diff-image-box" style={{ width: (which === 'before' ? bw : aw) * scale, height: (which === 'before' ? bh : ah) * scale }}>
                {img(which)}
                {flash && current && <AreaBox area={current} scale={scale} now />}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  } else {
    scrollers.current = [null]
    const x = view.swipe * W * scale
    body = (
      <div className="diff-image-overlay">
        {mode === 'swipe' && (
          <>
            <span className="diff-image-corner diff-image-corner-l">Before</span>
            <span className="diff-image-corner diff-image-corner-r">After</span>
          </>
        )}
        <div className="diff-image-scroll" ref={(el) => void (scrollers.current[0] = el)}>
          {mode === 'swipe' ? (
            <div
              className="diff-image-box diff-image-swipe"
              style={{ width: W * scale, height: H * scale }}
              role="slider"
              tabIndex={0}
              aria-label="Swipe between Before and After"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(view.swipe * 100)}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                swipeTo(e)
                try {
                  e.currentTarget.setPointerCapture(e.pointerId)
                } catch {
                  // A pointer that is already gone: the click still moved the line.
                }
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) swipeTo(e)
              }}
            >
              {img('before')}
              <div className="diff-image-clip" style={{ clipPath: `inset(0 0 0 ${x}px)` }}>
                {img('after')}
              </div>
              <span className="diff-image-line" style={{ left: x }} />
              <span className="diff-image-grip" style={{ left: x, top: Math.min(H * scale, Math.max(0, (stageRef.current?.clientHeight ?? 0) - 28)) / 2 }}>
                <ChevronsLeftRight size={14} />
              </span>
              {flash && current && <AreaBox area={current} scale={scale} now />}
            </div>
          ) : mode === 'onion' ? (
            <div className="diff-image-box diff-image-onion" style={{ width: W * scale, height: H * scale }} onClick={flip} title="Click or press Space to flip between Before and After">
              {img('before')}
              {img('after', { opacity: view.onion / 100 })}
              {flash && current && <AreaBox area={current} scale={scale} now />}
            </div>
          ) : (
            <div className="diff-image-box diff-image-difference" style={{ width: W * scale, height: H * scale }}>
              {compare.status === 'done' ? (
                <canvas ref={canvasRef} width={compare.cmp.width} height={compare.cmp.height} style={{ width: W * scale, height: H * scale, imageRendering: rendering }} />
              ) : (
                img('after', { opacity: 0.25, filter: 'grayscale(1)' })
              )}
              {areas.map((a, i) => (
                <AreaBox key={i} area={a} scale={scale} number={i + 1} now={i === index} />
              ))}
            </div>
          )}
        </div>
        <div className="diff-image-foot">
          {dims} · {sizes}
        </div>
      </div>
    )
  }

  return (
    <div className="diff-image-compare">
      <div className="diff-image-bar">
        <div className="diff-seg" role="radiogroup" aria-label="Compare images">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              className={`diff-seg-btn${mode === m.value ? ' diff-seg-on' : ''}`}
              title={m.title}
              onClick={() => setImageDiffMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="diff-image-mid">{middle}</div>
        <div className="diff-seg" role="radiogroup" aria-label="Zoom">
          <button
            type="button"
            role="radio"
            aria-checked={view.zoom === 'fit'}
            className={`diff-seg-btn${view.zoom === 'fit' ? ' diff-seg-on' : ''}`}
            title="The whole image"
            onClick={() => setImageView({ zoom: 'fit' })}
          >
            Fit
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view.zoom === 'actual'}
            className={`diff-seg-btn${view.zoom === 'actual' ? ' diff-seg-on' : ''}`}
            title="Real pixels: one image pixel per screen point"
            onClick={() => setImageView({ zoom: 'actual' })}
          >
            1:1
          </button>
        </div>
      </div>
      <div className="diff-image-stage" ref={stageRef} tabIndex={-1} onKeyDown={onKey}>
        {body}
      </div>
    </div>
  )
}

const NO_AREAS: Area[] = []

/** A changed area: numbered in Difference, outlined for a moment elsewhere after N / P. */
function AreaBox({ area, scale, number, now }: { area: Area; scale: number; number?: number; now?: boolean }) {
  const pad = 3
  return (
    <span
      className={`diff-image-area${now ? ' diff-image-area-now' : ''}`}
      aria-hidden="true"
      style={{ left: area.x * scale - pad, top: area.y * scale - pad, width: area.width * scale + pad * 2, height: area.height * scale + pad * 2 }}
    >
      {number !== undefined && <span className="diff-image-area-n">{number}</span>}
    </span>
  )
}
