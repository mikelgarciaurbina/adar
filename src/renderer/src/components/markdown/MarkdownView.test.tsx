// The document drawn: what a document says becomes elements Adar chose, never HTML of its own.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownView, type MarkdownHost } from './MarkdownView'
import { parseMarkdown } from './parse'

const host: MarkdownHost = { openLink: () => undefined }
const draw = (src: string): string => renderToStaticMarkup(<MarkdownView doc={parseMarkdown(src)} host={host} />)

describe('MarkdownView', () => {
  it('draws a document', () => {
    const html = draw('# Plan\n\nSome **bold** text and `code`.\n\n- [x] done\n- [ ] todo\n\n| A | B |\n|---|:-:|\n| 1 | 2 |\n\n```ts\nconst a = 1\n```\n\n> [!TIP]\n> Read it.')
    expect(html).toContain('<h1 data-anchor="plan">Plan</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('<th style="text-align:center">B</th>')
    expect(html).toContain('const a = 1')
    expect(html).toContain('doc-alert-tip')
  })

  it('never gives the window an address to go to, nor a picture to fetch', () => {
    const html = draw('[site](https://example.com) [bad](javascript:alert(1)) ![remote](https://example.com/track.png) ![local](img/a.png) ![inline](data:image/png;base64,AAAA) ![odd](data:text/html;base64,AAAA)')
    expect(html).not.toContain('href=')
    // Only a picture carried in the document itself is drawn straight away; the others wait for the host or stay a name.
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).not.toContain('track.png"')
    expect(html).toContain('remote')
  })

  it('keeps no HTML of the document', () => {
    const html = draw('<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n<iframe src="https://example.com"></iframe>\n\n<b onclick="x()">bold</b> <style>p{}</style> &lt;script&gt;')
    expect(html).not.toMatch(/<script|<iframe|<style|onerror|onclick/)
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('says when there is nothing to read', () => {
    expect(draw('')).toContain('This document is empty')
  })
})
