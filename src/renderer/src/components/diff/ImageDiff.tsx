// Side-by-side image comparison (before / after) with dimensions and sizes.

import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Spinner } from '@renderer/components/common/Button'
import { describeError } from '@shared/errors'
import type { DiffTarget, FileContent, FileDiff } from '@shared/types'
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

export function ImageDiff({ repo, diff, target }: { repo: string; diff: FileDiff; target: DiffTarget }) {
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
