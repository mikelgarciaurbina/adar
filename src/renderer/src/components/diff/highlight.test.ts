import { describe, expect, it } from 'vitest'
import { detectLanguage, highlightBlock, htmlToLines, loadHighlighter, MAX_HIGHLIGHT_LINE } from './highlight'

describe('htmlToLines', () => {
  it('flattens nested spans, decodes entities and splits lines keeping open spans', () => {
    const html =
      '<span class="hljs-comment">/* a &amp; b\nc &lt;d&gt; */</span> x <span class="hljs-string">&quot;q<span class="hljs-subst">${y}</span>&#x27;</span>'
    expect(htmlToLines(html)).toEqual([
      [{ text: '/* a & b', cls: 'hljs-comment' }],
      [
        { text: 'c <d> */', cls: 'hljs-comment' },
        { text: ' x ', cls: '' },
        { text: '"q', cls: 'hljs-string' },
        { text: '${y}', cls: 'hljs-string hljs-subst' },
        { text: "'", cls: 'hljs-string' }
      ]
    ])
  })

  it('keeps empty lines', () => {
    expect(htmlToLines('a\n\nb')).toEqual([[{ text: 'a', cls: '' }], [], [{ text: 'b', cls: '' }]])
  })
})

describe('highlight.js integration', () => {
  it('detects languages by name and extension', async () => {
    const hljs = await loadHighlighter()
    expect(detectLanguage('src/App.tsx', hljs)).toBe('typescript')
    expect(detectLanguage('a/b/script.PY', hljs)).toBe('python')
    expect(detectLanguage('Dockerfile', hljs)).toBe('dockerfile')
    expect(detectLanguage('Makefile', hljs)).toBe('makefile')
    expect(detectLanguage('config.yml', hljs)).toBe('yaml')
    expect(detectLanguage('notes.unknownext', hljs)).toBeNull()
    expect(detectLanguage('LICENSE', hljs)).toBeNull()
  })

  it('highlights a block and returns tokens per line matching the source text', async () => {
    const hljs = await loadHighlighter()
    const lines = ['/* multi', '   line */', 'const x = "s" // c', '', 'x'.repeat(MAX_HIGHLIGHT_LINE + 1)]
    const out = highlightBlock(hljs, lines, 'javascript')
    expect(out).toHaveLength(lines.length)
    out.slice(0, 4).forEach((tokens, i) => expect(tokens!.map((t) => t.text).join('')).toBe(lines[i]))
    // The second line is still inside the block comment.
    expect(out[1]![0].cls).toContain('hljs-comment')
    expect(out[2]!.some((t) => t.cls.includes('hljs-keyword') && t.text === 'const')).toBe(true)
    expect(out[3]).toEqual([])
    expect(out[4]).toBeNull()
    // Cached: same result object content on a second call.
    expect(highlightBlock(hljs, lines, 'javascript')).toEqual(out)
  })
})
