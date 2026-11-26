import { describe, expect, it } from 'vitest'
import { parseMarkdown, plainText, type Block, type Inline } from './parse'

const blocks = (src: string): Block[] => parseMarkdown(src).blocks

/** A compact way to read inline pieces back: **strong**, *em*, `code`, [text](href), ![alt](src), ⏎ for a break. */
function show(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return n.text
        case 'code':
          return `\`${n.text}\``
        case 'break':
          return '⏎'
        case 'link':
          return `[${show(n.children)}](${n.href})`
        case 'image':
          return `![${n.alt}](${n.src})`
        default:
          return `<${n.t}>${show(n.children)}</${n.t}>`
      }
    })
    .join('')
}

const inline = (src: string): string => {
  const b = blocks(src)[0]
  return b && b.t === 'paragraph' ? show(b.children) : `(${b?.t})`
}

/** The shape of a tree: block kinds, with their children. */
function shape(list: Block[]): unknown[] {
  return list.map((b) => {
    switch (b.t) {
      case 'heading':
        return `h${b.level}:${plainText(b.children)}`
      case 'paragraph':
        return `p:${show(b.children)}`
      case 'code':
        return `code(${b.lang}):${b.text}`
      case 'quote':
        return { [b.alert ? `quote!${b.alert}` : 'quote']: shape(b.children) }
      case 'list':
        return { [`${b.ordered ? 'ol' : 'ul'}${b.tight ? '' : '~'}`]: b.items.map((it) => (it.checked === null ? shape(it.children) : [it.checked ? '[x]' : '[ ]', ...shape(it.children)])) }
      case 'table':
        return { table: [b.head.map(show), ...b.rows.map((r) => r.map(show))] }
      case 'details':
        return { [`details:${show(b.summary)}`]: shape(b.children) }
      default:
        return b.t
    }
  })
}

describe('parseMarkdown: blocks', () => {
  it('reads headings, their ids and the outline', () => {
    const doc = parseMarkdown('# Plan\n\n## Step one\n\nSetext\n------\n\n## Step one\n\n#not a heading\n\n### With `code` and *more* ###')
    expect(shape(doc.blocks)).toEqual(['h1:Plan', 'h2:Step one', 'h2:Setext', 'h2:Step one', 'p:#not a heading', 'h3:With code and more'])
    expect(doc.headings.map((h) => h.id)).toEqual(['plan', 'step-one', 'setext', 'step-one-1', 'with-code-and-more'])
  })

  it('keeps paragraphs together and breaks them at blank lines', () => {
    expect(shape(blocks('one\ntwo\n\nthree'))).toEqual(['p:one\ntwo', 'p:three'])
    expect(inline('a line  \nand a break\\\nanother')).toBe('a line⏎and a break⏎another')
  })

  it('reads fenced and indented code as it is written', () => {
    expect(shape(blocks('```ts title="a.ts"\nconst a = 1\n\n# not a heading\n```\nafter'))).toEqual(['code(ts):const a = 1\n\n# not a heading', 'p:after'])
    expect(shape(blocks('~~~\n```\n~~~'))).toEqual(['code():```'])
    expect(shape(blocks('text\n\n    indented\n      more\n\ntext'))).toEqual(['p:text', 'code():indented\n  more', 'p:text'])
    // A fence left open runs to the end.
    expect(shape(blocks('```\nopen'))).toEqual(['code():open'])
  })

  it('reads lists: nested, numbered, loose, with tasks', () => {
    expect(shape(blocks('- a\n- b\n  - b1\n  - b2\n- c'))).toEqual([{ ul: [['p:a'], ['p:b', { ul: [['p:b1'], ['p:b2']] }], ['p:c']] }])
    expect(shape(blocks('3. three\n4. four'))).toEqual([{ ol: [['p:three'], ['p:four']] }])
    expect((blocks('3. three')[0] as { start: number }).start).toBe(3)
    expect(shape(blocks('- a\n\n- b'))).toEqual([{ 'ul~': [['p:a'], ['p:b']] }])
    expect(shape(blocks('- [ ] todo\n- [x] done\n- plain'))).toEqual([{ ul: [['[ ]', 'p:todo'], ['[x]', 'p:done'], ['p:plain']] }])
    // Another marker starts another list.
    expect(shape(blocks('- a\n* b'))).toEqual([{ ul: [['p:a']] }, { ul: [['p:b']] }])
  })

  it('takes bullets indented a little under a numbered item as its children', () => {
    expect(shape(blocks('1. first\n  - detail\n  - more\n2. second'))).toEqual([{ ol: [['p:first', { ul: [['p:detail'], ['p:more']] }], ['p:second']] }])
  })

  it('keeps code and paragraphs inside the item they are indented under', () => {
    expect(shape(blocks('1. run\n\n   ```sh\n   npm test\n\n   npm run build\n   ```\n\n   then wait\n2. done'))).toEqual([
      { 'ol~': [['p:run', 'code(sh):npm test\n\nnpm run build', 'p:then wait'], ['p:done']] }
    ])
    expect(shape(blocks('- a\ncontinued\n\nafter'))).toEqual([{ ul: [['p:a\ncontinued']] }, 'p:after'])
  })

  it('reads quotes, nested ones and alerts', () => {
    expect(shape(blocks('> a\n> b\nlazy\n\n> > deep'))).toEqual([{ quote: ['p:a\nb\nlazy'] }, { quote: [{ quote: ['p:deep'] }] }])
    expect(shape(blocks('> [!WARNING]\n> Careful\n> - one'))).toEqual([{ 'quote!warning': ['p:Careful', { ul: [['p:one']] }] }])
  })

  it('reads tables with their alignment', () => {
    const src = 'Before\n| Name | Count |\n|:-----|------:|\n| a \\| b | `1` |\n| c |\n\nafter'
    expect(shape(blocks(src))).toEqual(['p:Before', { table: [['Name', 'Count'], ['a | b', '`1`'], ['c', '']] }, 'p:after'])
    expect((blocks(src)[1] as { align: unknown }).align).toEqual(['left', 'right'])
    // No delimiter row, or one of another width: only text.
    expect(shape(blocks('a | b\n---'))).toEqual(['h2:a | b'])
  })

  it('reads rules and front matter', () => {
    expect(shape(blocks('a\n\n---\n\n* * *\n___'))).toEqual(['p:a', 'rule', 'rule', 'rule'])
    const doc = blocks('---\nname: review\ndescription: Reviews a diff\n---\n# Skill')
    expect(doc[0]).toEqual({ t: 'code', lang: 'yaml', text: 'name: review\ndescription: Reviews a diff', meta: true })
    expect(shape(doc.slice(1))).toEqual(['h1:Skill'])
    // A rule at the top with no keys under it is a rule.
    expect(shape(blocks('---\n\ntext'))).toEqual(['rule', 'p:text'])
  })

  it('expands tabs that indent', () => {
    expect(shape(blocks('- a\n\t- b'))).toEqual([{ ul: [['p:a', { ul: [['p:b']] }]] }])
  })
})

describe('parseMarkdown: inline', () => {
  it('reads emphasis the way CommonMark pairs it', () => {
    expect(inline('**bold** *em* _em_ __bold__ ~~gone~~')).toBe('<strong>bold</strong> <em>em</em> <em>em</em> <strong>bold</strong> <del>gone</del>')
    expect(inline('***both***')).toBe('<em><strong>both</strong></em>')
    expect(inline('snake_case_name and 2 * 3 * 4 and ~5 min')).toBe('snake_case_name and 2 * 3 * 4 and ~5 min')
    expect(inline('**bold with `code*` inside**')).toBe('<strong>bold with `code*` inside</strong>')
    expect(inline('*open only')).toBe('*open only')
  })

  it('reads code spans, escapes and entities', () => {
    expect(inline('`a` ``b ` c`` `unclosed')).toBe('`a` `b ` c` `unclosed')
    expect(inline('\\*not em\\* \\# and a\\b')).toBe('*not em* # and a\\b')
    expect(inline('&lt;div&gt; &amp; &#169; &#x1F680; &unknown; R&D')).toBe('<div> & © 🚀 &unknown; R&D')
    expect(inline('done :white_check_mark: at 10:30:15')).toBe('done ✅ at 10:30:15')
  })

  it('reads links, references, pictures and bare addresses', () => {
    expect(inline('[docs](docs/guide.md "Guide") and [ref][r] and [r]\n\n[r]: https://example.com/a')).toBe('[docs](docs/guide.md) and [ref](https://example.com/a) and [r](https://example.com/a)')
    expect(blocks('![shot](<img/a b.png>) [![badge](b.svg)](https://ci)')[0]).toMatchObject({
      children: [{ t: 'image', src: 'img/a b.png', alt: 'shot' }, { t: 'text', text: ' ' }, { t: 'link', href: 'https://ci', children: [{ t: 'image', src: 'b.svg', alt: 'badge' }] }]
    })
    expect(inline('see https://example.com/a_(b). And www.example.com, <https://x.y/z> <me@example.com>')).toBe(
      'see [https://example.com/a_(b)](https://example.com/a_(b)). And [www.example.com](https://www.example.com), [https://x.y/z](https://x.y/z) [me@example.com](mailto:me@example.com)'
    )
    expect(inline('[brackets] and [x] stay, [^1] is a note')).toBe('[brackets] and [x] stay, <sup>1</sup> is a note')
    expect(inline('[a *b*](c(d).md)')).toBe('[a <em>b</em>](c(d).md)')
  })
})

describe('parseMarkdown: HTML', () => {
  it('reads the HTML documents are written with into the same tree', () => {
    expect(inline('Press <kbd>⌘</kbd>+<kbd>K</kbd>, H<sub>2</sub>O<br>next <b>bold</b> <a href="https://a.b">link</a>')).toBe(
      'Press <kbd>⌘</kbd>+<kbd>K</kbd>, H<sub>2</sub>O⏎next <strong>bold</strong> [link](https://a.b)'
    )
    const centred = blocks('<p align="center">\n    <img src="logo.png" alt="Logo" width="120">\n</p>\n\n<h1 align="center">Adar</h1>')
    expect(centred[0]).toEqual({ t: 'paragraph', align: 'center', children: [{ t: 'image', src: 'logo.png', alt: 'Logo', title: '', width: 120, height: null }] })
    expect(centred[1]).toMatchObject({ t: 'heading', level: 1, align: 'center', id: 'adar' })
  })

  it('reads <details> with Markdown inside', () => {
    expect(shape(blocks('<details>\n<summary>More <b>info</b></summary>\n\n- one\n- two\n\n</details>\n\nafter'))).toEqual([
      { 'details:More <strong>info</strong>': [{ ul: [['p:one'], ['p:two']] }] },
      'p:after'
    ])
  })

  it('reads an HTML table and <pre>', () => {
    expect(shape(blocks('<table>\n<tr><th>A</th><th>B</th></tr>\n<tr><td>1</td><td><code>2</code></td></tr>\n</table>'))).toEqual([{ table: [['A', 'B'], ['1', '`2`']] }])
    expect(shape(blocks('<pre><code class="language-js">if (a &lt; b) {}\n</code></pre>'))).toEqual(['code(js):if (a < b) {}'])
  })

  it('never keeps HTML as HTML', () => {
    expect(shape(blocks('<!-- hidden -->\ntext <!-- too --> here\n\n<script>alert(1)</script>\n\n<style>\n\nbody { display: none }\n</style>\n\nend'))).toEqual(['p:text  here', 'p:end'])
    expect(inline('a <span onclick="x()">b</span> <iframe src="https://x"></iframe> <script>alert(1)</script>c')).toBe('a b  c')
    expect(inline('<a href="javascript:alert(1)">x</a>')).toBe('[x](javascript:alert(1))')
    expect(inline('1 < 2 and a<b')).toBe('1 < 2 and a<b')
  })
})

describe('parseMarkdown: whole documents', () => {
  it('reads a plan as an agent writes it', () => {
    const src = [
      '# Plan: Markdown preview',
      '',
      '## Context',
      'The user wants a **preview**. See `src/app.ts`.',
      '',
      '## Steps',
      '1. **Parser**',
      '   - blocks',
      '   - inline',
      '2. **View**',
      '',
      '| File | Change |',
      '|------|--------|',
      '| `a.ts` | new |',
      '',
      '```bash',
      'npm test',
      '```'
    ].join('\n')
    expect(shape(blocks(src))).toEqual([
      'h1:Plan: Markdown preview',
      'h2:Context',
      'p:The user wants a <strong>preview</strong>. See `src/app.ts`.',
      'h2:Steps',
      { ol: [['p:<strong>Parser</strong>', { ul: [['p:blocks'], ['p:inline']] }], ['p:<strong>View</strong>']] },
      { table: [['File', 'Change'], ['`a.ts`', 'new']] },
      'code(bash):npm test'
    ])
  })

  it('reads anything without failing', () => {
    for (const src of ['', '\n\n', '[', '![', '](', '<', '<details>', '> ', '- ', '1.', '|', '|-|', '```', '<!--', '<p', '**', '[a](', '﻿# bom\r\nline\r\n', '<table><tr><td>']) {
      expect(() => parseMarkdown(src)).not.toThrow()
    }
    expect(shape(blocks('﻿# bom\r\nline\r\n'))).toEqual(['h1:bom', 'p:line'])
  })
})
