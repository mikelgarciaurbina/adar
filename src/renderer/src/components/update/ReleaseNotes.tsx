// Minimal, safe Markdown renderer for GitHub release notes: headings, bullet lists,
// paragraphs, **bold**, `code` and links (opened in the browser). Never injects HTML.

import { Fragment, type ReactNode } from 'react'
import { api } from '@renderer/api/client'

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+)/g

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0]
    if (m.index! > last) out.push(text.slice(last, m.index))
    if (tok.startsWith('**')) out.push(<strong key={out.length}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={out.length}>{tok.slice(1, -1)}</code>)
    else {
      const label = tok.startsWith('[') ? tok.slice(1, tok.indexOf('](')) : tok.replace(/^https?:\/\/(www\.)?github\.com\//, '')
      const href = tok.startsWith('[') ? m[2]! : tok
      out.push(
        <a key={out.length} href={href} onClick={(e) => (e.preventDefault(), void api.openExternal(href))}>
          {label}
        </a>
      )
    }
    last = m.index! + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>
      )
    para = []
    list = []
  }
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push(<h4 key={blocks.length}>{inline(heading[2])}</h4>)
    } else if (bullet) {
      if (para.length) flush()
      list.push(bullet[1])
    } else if (!line.trim()) flush()
    else {
      if (list.length) flush()
      para.push(line.trim())
    }
  }
  flush()
  return <div className="up-notes selectable">{blocks.length ? blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>) : 'No release notes.'}</div>
}
