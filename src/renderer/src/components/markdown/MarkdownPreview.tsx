// A changed Markdown file as it reads, in the diff view: the version the diff shows (the commit's, the staged one,
// the working tree's), with its pictures read from that same version of the repository.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { EmptyState, Spinner } from '@renderer/components/common/Button'
import { toast } from '@renderer/components/common/toast'
import { contentSources, imageMime, type ContentSource } from '@renderer/components/diff/targets'
import { describeError } from '@shared/errors'
import { isMarkdownPath } from '@shared/markdown'
import type { DiffTarget, FileContent, FileDiff } from '@shared/types'
import { MarkdownView, type MarkdownHost } from './MarkdownView'
import { openMarkdown } from './markdownStore'
import { parseMarkdown } from './parse'
import { repoReference } from './paths'
import './markdown.css'

async function contentOf(repo: string, src: ContentSource): Promise<FileContent> {
  const content = await api.getFileContent(repo, src.path, src.rev)
  return !content.exists && src.fallbackRev ? api.getFileContent(repo, src.path, src.fallbackRev) : content
}

export function MarkdownPreview({ repo, target, diff }: { repo: string; target: DiffTarget; diff: FileDiff }) {
  const sources = contentSources(target, diff)
  // A deleted file is read as it was.
  const src = sources.new ?? sources.old
  const deleted = !sources.new
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { path, rev, fallbackRev } = src ?? { path: target.path, rev: 'WORKTREE' as const, fallbackRev: undefined }

  useEffect(() => {
    let live = true
    void contentOf(repo, { path, rev, fallbackRev }).then(
      (content) => {
        if (!live) return
        if (!content.exists) setError('The file does not exist in this version')
        else if (content.text === undefined) setError('This file is not text')
        else {
          setText(content.text)
          setError(null)
        }
      },
      (err) => live && setError(describeError(err))
    )
    return () => {
      live = false
    }
    // `diff` is a new object each time the file changed: read it again.
  }, [repo, path, rev, fallbackRev, diff])

  const host = useMemo<MarkdownHost>(
    () => ({
      async image(ref) {
        const at = repoReference(path, ref)
        if (!at) return null
        const content = await contentOf(repo, { path: at.path, rev, fallbackRev })
        if (!content.exists) return null
        const mime = imageMime(at.path)
        if (!mime.startsWith('image/')) return null
        if (content.base64) return `data:${mime};base64,${content.base64}`
        return content.text !== undefined && mime === 'image/svg+xml' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content.text)}` : null
      },
      openLink(href) {
        const failed = (err: unknown) => toast.error(describeError(err))
        if (/^(?:https?|mailto):/i.test(href)) return void api.openExternal(href).catch(failed)
        const at = repoReference(path, href)
        if (!at) return void toast.info(`Nothing to open at ${href}`)
        // Another document opens as the file it is now; any other file is only shown in its folder.
        if (isMarkdownPath(at.path)) openMarkdown(git.absPath(repo, at.path), { anchor: at.anchor })
        else void api.showInFolder(git.absPath(repo, at.path)).catch(failed)
      }
    }),
    [repo, path, rev, fallbackRev]
  )

  const doc = useMemo(() => (text === null ? null : parseMarkdown(text)), [text])

  if (error && !doc) {
    return (
      <EmptyState icon={<AlertTriangle size={36} />} title="Could not preview this file">
        <p>{error}</p>
      </EmptyState>
    )
  }
  if (!doc) {
    return (
      <div className="doc-loading">
        <Spinner size="lg" />
      </div>
    )
  }
  return (
    <div className="doc-in-diff">
      {deleted && <div className="doc-note">This file was deleted: the preview shows it as it was.</div>}
      <div className="doc-page">
        <MarkdownView doc={doc} host={host} />
      </div>
    </div>
  )
}
