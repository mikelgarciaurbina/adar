// A Markdown document drawn from its tree (`parse.ts`): React elements only, never HTML from the document. What a
// link does and where a picture comes from is the host's (`MarkdownHost`: the reader reads beside the file, the diff
// from the revision shown); a picture on the web is not fetched, only named, with a click to see it in the browser.

import { Fragment, memo, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Check, Copy, Image as ImageIcon, ImageOff, Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react'
import { highlightBlock, loadHighlighter, type Token } from '@renderer/components/diff/highlight'
import type { AlertKind, Align, Block, Inline, ListItem, MarkdownDoc } from './parse'
import './markdown.css'

export interface MarkdownHost {
  /** A picture by the address the document gives, as something an <img> can show; null when there is none. */
  image?(src: string): Promise<string | null>
  /** A click on a link that does not lead to a heading of this document. */
  openLink(href: string): void
}

/** Scroll to a heading by its id (as `#anchor` names it); false when the document has none. */
export function scrollToAnchor(root: HTMLElement | null, anchor: string): boolean {
  if (!root || !anchor) return false
  const wanted = anchor.toLowerCase()
  for (const el of root.querySelectorAll<HTMLElement>('[data-anchor]')) {
    if (el.dataset.anchor !== wanted) continue
    el.scrollIntoView({ block: 'start' })
    return true
  }
  return false
}

const alignStyle = (align: Align): CSSProperties | undefined => (align ? { textAlign: align } : undefined)

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)[;,]/i
const isWeb = (address: string): boolean => /^https?:\/\//i.test(address)

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'the web'
  }
}

function Picture({ node, host }: { node: Extract<Inline, { t: 'image' }>; host: MarkdownHost }) {
  const direct = DATA_IMAGE.test(node.src) ? node.src : null
  const remote = isWeb(node.src)
  // undefined while it is read, null when there is none to show.
  const [url, setUrl] = useState<string | null | undefined>(direct ?? (remote ? null : undefined))
  useEffect(() => {
    if (direct || remote) return void setUrl(direct)
    if (!host.image || !node.src) return void setUrl(null)
    let live = true
    setUrl(undefined)
    void host.image(node.src).then(
      (u) => live && setUrl(u),
      () => live && setUrl(null)
    )
    return () => {
      live = false
    }
  }, [node.src, host, direct, remote])
  if (url) {
    return <img className="doc-img" src={url} alt={node.alt} title={node.title || undefined} width={node.width ?? undefined} height={node.width ? undefined : (node.height ?? undefined)} draggable={false} />
  }
  if (url === undefined) return <span className="doc-img-note" aria-busy="true" />
  if (remote) {
    return (
      <span
        className="doc-img-note doc-img-remote"
        title={`${node.src}\nPictures on the web are not loaded. Click to see it in your browser.`}
        // Inside a link (a badge), the click is the link's.
        onClick={(e) => !(e.target as HTMLElement).closest('.doc-link') && host.openLink(node.src)}
      >
        <ImageIcon size={12} />
        {node.alt || `Picture on ${hostOf(node.src)}`}
      </span>
    )
  }
  return (
    <span className="doc-img-note doc-img-missing" title={`${node.src}: no picture to show`}>
      <ImageOff size={12} />
      {node.alt || node.src}
    </span>
  )
}

function Link({ href, title, host, children }: { href: string; title: string; host: MarkdownHost; children: ReactNode }) {
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (href.startsWith('#')) {
      let anchor = href.slice(1)
      try {
        anchor = decodeURIComponent(anchor)
      } catch {
        // Not percent-encoded.
      }
      scrollToAnchor((e.currentTarget as HTMLElement).closest<HTMLElement>('.doc-body'), anchor)
    } else host.openLink(href)
  }
  // No href: the window never goes anywhere itself, whatever a document says.
  return (
    <a className="doc-link" role="link" tabIndex={0} title={title ? `${title}\n${href}` : href} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open(e)}>
      {children}
    </a>
  )
}

function inlines(nodes: readonly Inline[], host: MarkdownHost): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.t) {
      case 'text':
        return node.text
      case 'code':
        return <code key={i}>{node.text}</code>
      case 'break':
        return <br key={i} />
      case 'image':
        return <Picture key={i} node={node} host={host} />
      case 'link':
        return (
          <Link key={i} href={node.href} title={node.title} host={host}>
            {inlines(node.children, host)}
          </Link>
        )
      case 'del':
        return <del key={i}>{inlines(node.children, host)}</del>
      default: {
        const Tag = node.t
        return <Tag key={i}>{inlines(node.children, host)}</Tag>
      }
    }
  })
}

/** Names documents give languages that highlight.js knows by another. */
const LANGUAGES: Readonly<Record<string, string>> = { shell: 'bash', zsh: 'bash', console: 'shell', terminal: 'bash', jsonc: 'json', json5: 'json', vue: 'xml', svelte: 'xml', tsx: 'typescript', jsx: 'javascript', env: 'bash', dotenv: 'bash', text: '', txt: '', plain: '', plaintext: '' }

/** Code longer than this is shown without colours. */
const MAX_HIGHLIGHT_CHARS = 200_000

const CodeBlock = memo(function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const lines = useMemo(() => text.split('\n'), [text])
  const [tokens, setTokens] = useState<Array<Token[] | null> | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setTokens(null)
    const name = LANGUAGES[lang] ?? lang
    if (!name || text.length > MAX_HIGHLIGHT_CHARS) return
    let live = true
    void loadHighlighter().then(
      (hljs) => {
        if (live && hljs.getLanguage(name)) setTokens(highlightBlock(hljs, lines, name))
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [lang, text, lines])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const copy = () => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined)
  return (
    <div className="doc-code">
      <div className="doc-code-bar">
        <span className="doc-code-lang">{lang}</span>
        <button className="doc-code-copy" onClick={copy} title="Copy the code" aria-label="Copy the code">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>
        <code>
          {lines.map((line, i) => {
            const row = tokens?.[i]
            return (
              <Fragment key={i}>
                {row ? row.map((tok, j) => (tok.cls ? <span key={j} className={tok.cls}>{tok.text}</span> : tok.text)) : line}
                {i < lines.length - 1 ? '\n' : null}
              </Fragment>
            )
          })}
        </code>
      </pre>
    </div>
  )
})

/** Front matter: its keys and values when it is that simple, as it is written otherwise. */
function FrontMatter({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim())
  const pairs = lines.map((l) => /^([\w.-]+):\s*(.*)$/.exec(l))
  if (!pairs.length || pairs.some((p) => !p)) return <pre className="doc-meta doc-meta-raw">{text}</pre>
  return (
    <dl className="doc-meta">
      {pairs.map((p, i) => (
        <Fragment key={i}>
          <dt>{p![1]}</dt>
          <dd>{p![2].replace(/^(["'])(.*)\1$/, '$2')}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

const ALERTS: Readonly<Record<AlertKind, { label: string; icon: ReactNode }>> = {
  note: { label: 'Note', icon: <Info size={14} /> },
  tip: { label: 'Tip', icon: <Lightbulb size={14} /> },
  important: { label: 'Important', icon: <MessageSquareWarning size={14} /> },
  warning: { label: 'Warning', icon: <TriangleAlert size={14} /> },
  caution: { label: 'Caution', icon: <OctagonAlert size={14} /> }
}

function item(it: ListItem, tight: boolean, host: MarkdownHost, key: number): ReactNode {
  const body = it.children.map((b, i) => (tight && b.t === 'paragraph' ? <Fragment key={i}>{inlines(b.children, host)}</Fragment> : block(b, host, i)))
  if (it.checked === null) return <li key={key}>{body}</li>
  return (
    <li key={key} className="doc-task">
      <span className={`doc-check${it.checked ? ' doc-checked' : ''}`} role="checkbox" aria-checked={it.checked} aria-disabled="true">
        {it.checked && <Check size={11} strokeWidth={3} />}
      </span>
      {body}
    </li>
  )
}

function block(b: Block, host: MarkdownHost, key: number): ReactNode {
  switch (b.t) {
    case 'heading': {
      const Tag = `h${Math.min(6, Math.max(1, b.level))}` as 'h1'
      return (
        <Tag key={key} data-anchor={b.id} style={alignStyle(b.align)}>
          {inlines(b.children, host)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p key={key} style={alignStyle(b.align)}>
          {inlines(b.children, host)}
        </p>
      )
    case 'code':
      return b.meta ? <FrontMatter key={key} text={b.text} /> : <CodeBlock key={key} lang={b.lang} text={b.text} />
    case 'rule':
      return <hr key={key} />
    case 'quote':
      if (b.alert) {
        return (
          <div key={key} className={`doc-alert doc-alert-${b.alert}`} role="note">
            <div className="doc-alert-title">
              {ALERTS[b.alert].icon}
              {ALERTS[b.alert].label}
            </div>
            {blocks(b.children, host)}
          </div>
        )
      }
      return <blockquote key={key}>{blocks(b.children, host)}</blockquote>
    case 'list': {
      const tasks = b.items.some((it) => it.checked !== null)
      const rows = b.items.map((it, i) => item(it, b.tight, host, i))
      return b.ordered ? (
        <ol key={key} start={b.start !== 1 ? b.start : undefined}>
          {rows}
        </ol>
      ) : (
        <ul key={key} className={tasks ? 'doc-tasks' : undefined}>
          {rows}
        </ul>
      )
    }
    case 'table':
      return (
        <div key={key} className="doc-table">
          <table>
            {b.head.length > 0 && (
              <thead>
                <tr>
                  {b.head.map((cell, c) => (
                    <th key={c} style={alignStyle(b.align[c] ?? null)}>
                      {inlines(cell, host)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={alignStyle(b.align[c] ?? null)}>
                      {inlines(cell, host)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'details':
      return (
        <details key={key} open={b.open || undefined}>
          <summary>{inlines(b.summary, host)}</summary>
          {blocks(b.children, host)}
        </details>
      )
  }
}

const blocks = (list: readonly Block[], host: MarkdownHost): ReactNode[] => list.map((b, i) => block(b, host, i))

/** A document, drawn. `host` should keep its identity while the document is the same one, so its pictures are read once. */
export const MarkdownView = memo(function MarkdownView({ doc, host }: { doc: MarkdownDoc; host: MarkdownHost }) {
  if (!doc.blocks.length) return <div className="doc-body doc-empty">This document is empty.</div>
  return <div className="doc-body selectable">{blocks(doc.blocks, host)}</div>
})
