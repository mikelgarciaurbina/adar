// Markdown → a tree, pure: the blocks and inline pieces the preview draws (`MarkdownView.tsx`). GitHub's flavour as
// documents use it: headings, lists (nested, numbered, tasks), tables, fenced code, quotes and their alerts
// (> [!NOTE]), links and their references, pictures, footnote marks, front matter, and the bits of HTML READMEs are
// written with (<details>, <p align="center">, <img>, <br>, <kbd>, <table>…), read into the same tree. HTML is never
// kept as HTML: a tag this file does not know leaves only its text, and <script> and <style> leave nothing.

export type Align = 'left' | 'center' | 'right' | null

export type InlineWrap = 'em' | 'strong' | 'del' | 'kbd' | 'sub' | 'sup' | 'mark' | 'u'

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: InlineWrap; children: Inline[] }
  | { t: 'link'; href: string; title: string; children: Inline[] }
  | { t: 'image'; src: string; alt: string; title: string; width: number | null; height: number | null }
  | { t: 'break' }

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export interface ListItem {
  /** A task's box: ticked, empty, or null when the item is no task. */
  checked: boolean | null
  children: Block[]
}

export type Block =
  | { t: 'heading'; level: number; id: string; align: Align; children: Inline[] }
  | { t: 'paragraph'; align: Align; children: Inline[] }
  /** `meta`: the document's front matter. */
  | { t: 'code'; lang: string; text: string; meta?: boolean }
  | { t: 'quote'; alert: AlertKind | null; children: Block[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'rule' }
  | { t: 'details'; open: boolean; summary: Inline[]; children: Block[] }

export interface Heading {
  level: number
  id: string
  text: string
}

export interface MarkdownDoc {
  blocks: Block[]
  /** The headings in order, for the outline and the links to them. */
  headings: Heading[]
}

interface State {
  refs: Map<string, { href: string; title: string }>
  slugs: Map<string, number>
  headings: Heading[]
}

// ── Lines ─────────────────────────────────────────────────────────────

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const QUOTE = /^ {0,3}>/
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const REF_DEF = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(<[^>]*>|\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/
const HTML_CONTAINER = /^ {0,3}<(p|div|center|h[1-6]|section|article|header|footer|figure)\b([^>]*)>/i
const HTML_DROPPED = /^ {0,3}<(script|style)\b/i

const isBlank = (line: string): boolean => !line.trim()
const indentOf = (line: string): number => line.length - line.trimStart().length

/** A fence's opening: a backtick fence cannot have backticks in what follows it. */
function fenceOf(line: string): { indent: number; mark: string; info: string } | null {
  const m = FENCE.exec(line)
  if (!m || (m[2][0] === '`' && m[3].includes('`'))) return null
  return { indent: m[1].length, mark: m[2], info: m[3].trim() }
}

const closesFence = (line: string, mark: string): boolean => new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}[ \\t]*$`).test(line)

/** A list item's line; "1986. A year" in the middle of a paragraph is none (`interrupts`). */
function itemOf(line: string, interrupts = false): RegExpExecArray | null {
  const m = ITEM.exec(line)
  if (!m || RULE.test(line)) return null
  if (interrupts && (!(m[4] ?? '').trim() || (/\d/.test(m[2]) && parseInt(m[2], 10) !== 1))) return null
  return m
}

const htmlStarts = (line: string): boolean => /^ {0,3}<(?:!--|details\b|table\b|pre\b|hr\b)/i.test(line) || HTML_CONTAINER.test(line) || HTML_DROPPED.test(line)

/** Whether a line ends the paragraph before it by starting something else. */
function startsBlock(line: string): boolean {
  return !!fenceOf(line) || ATX.test(line) || RULE.test(line) || QUOTE.test(line) || !!itemOf(line, true) || htmlStarts(line)
}

/** The cells of a table's row. */
function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (/(?:^|[^\\])\|$/.test(row)) row = row.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '|'
      i++
    } else if (row[i] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += row[i]
  }
  cells.push(cell.trim())
  return cells
}

function tableStarts(lines: string[], i: number): { head: string[]; align: Align[] } | null {
  if (i + 1 >= lines.length || !lines[i].includes('|') || !TABLE_DELIM.test(lines[i + 1]) || !lines[i + 1].includes('-')) return null
  const head = splitRow(lines[i])
  const delim = splitRow(lines[i + 1])
  if (head.length !== delim.length) return null
  const align = delim.map((d): Align => (d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : null))
  return { head, align }
}

const attrOf = (attrs: string, name: string): string => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(attrs)
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : ''
}

const alignOf = (tag: string, attrs: string): Align => {
  if (tag.toLowerCase() === 'center') return 'center'
  const a = (attrOf(attrs, 'align') || (/text-align\s*:\s*(left|center|right)/i.exec(attrOf(attrs, 'style'))?.[1] ?? '')).toLowerCase()
  return a === 'center' || a === 'right' || a === 'left' ? a : null
}

/** Lines without the indentation they share. */
function dedent(lines: string[]): string[] {
  const min = Math.min(...lines.filter((l) => !isBlank(l)).map(indentOf))
  return Number.isFinite(min) && min > 0 ? lines.map((l) => l.slice(Math.min(min, indentOf(l)))) : lines
}

/**
 * From `<tag …>` at the start of `lines[start]` to its closing tag: what is between them and the line to go on at.
 * Tags of the same name inside are counted; without a closing tag it ends at the next blank line.
 */
function htmlRegion(lines: string[], start: number, tag: string): { open: string; inner: string[]; next: number } {
  const open = new RegExp(`^ {0,3}<${tag}\\b[^>]*>`, 'i').exec(lines[start])?.[0] ?? ''
  const marks = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    marks.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = marks.exec(line))) {
      depth += m[1] ? -1 : 1
      if (depth > 0) continue
      const inner = lines.slice(start, i + 1)
      inner[inner.length - 1] = line.slice(0, m.index)
      inner[0] = inner[0].slice(open.length)
      const rest = line.slice(m.index + m[0].length)
      // What follows the closing tag on its line stays in the document.
      const next = isBlank(rest) ? i + 1 : i
      if (!isBlank(rest)) lines[i] = rest
      return { open, inner, next }
    }
  }
  let end = start + 1
  while (end < lines.length && !isBlank(lines[end])) end++
  const inner = lines.slice(start, end)
  inner[0] = inner[0].slice(open.length)
  return { open, inner, next: end }
}

// ── Blocks ────────────────────────────────────────────────────────────

function slug(text: string, st: State): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
    .replace(/ /g, '-')
  const seen = st.slugs.get(base) ?? 0
  st.slugs.set(base, seen + 1)
  return seen ? `${base}-${seen}` : base
}

function heading(level: number, children: Inline[], align: Align, st: State): Block {
  const text = plainText(children).trim()
  const id = slug(text, st)
  st.headings.push({ level, id, text })
  return { t: 'heading', level, id, align, children }
}

const paragraphText = (lines: string[]): string => lines.map((l) => l.trimStart()).join('\n').replace(/[ \t]+$/, '')

function withAlign(blocks: Block[], align: Align): Block[] {
  if (!align) return blocks
  return blocks.map((b) => (b.t === 'paragraph' || b.t === 'heading' ? { ...b, align: b.align ?? align } : b))
}

function parseBlocks(lines: string[], st: State): Block[] {
  const out: Block[] = []
  const n = lines.length
  let i = 0
  while (i < n) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }

    const fence = fenceOf(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < n && !closesFence(lines[i], fence.mark)) {
        body.push(lines[i].slice(Math.min(fence.indent, indentOf(lines[i]))))
        i++
      }
      i++
      const lang = (/^\{?\.?([\w+#-]+)/.exec(fence.info)?.[1] ?? '').toLowerCase()
      out.push({ t: 'code', lang, text: body.join('\n') })
      continue
    }

    if (/^ {4}/.test(line)) {
      const body: string[] = []
      while (i < n && (/^ {4}/.test(lines[i]) || isBlank(lines[i]))) {
        body.push(lines[i].slice(4))
        i++
      }
      while (body.length && isBlank(body[body.length - 1])) body.pop()
      out.push({ t: 'code', lang: '', text: body.join('\n') })
      continue
    }

    const atx = ATX.exec(line)
    if (atx) {
      const text = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '')
      out.push(heading(atx[1].length, parseInline(text, st), null, st))
      i++
      continue
    }

    if (RULE.test(line)) {
      out.push({ t: 'rule' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      let fenced: string | null = null
      let lazy = false
      while (i < n) {
        const l = lines[i]
        const q = /^ {0,3}> ?(.*)$/.exec(l)
        if (q) {
          const f = fenceOf(q[1])
          if (fenced) {
            if (closesFence(q[1], fenced)) fenced = null
          } else if (f) fenced = f.mark
          lazy = !fenced && !f && !isBlank(q[1]) && !ATX.test(q[1]) && !RULE.test(q[1])
          body.push(q[1])
        } else if (!isBlank(l) && lazy && !startsBlock(l)) body.push(l)
        else break
        i++
      }
      const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i.exec(body[0] ?? '')
      out.push({ t: 'quote', alert: alert ? (alert[1].toLowerCase() as AlertKind) : null, children: parseBlocks(alert ? body.slice(1) : body, st) })
      continue
    }

    if (itemOf(line)) {
      const [list, next] = parseList(lines, i, st)
      out.push(list)
      i = next
      continue
    }

    if (/^ {0,3}<!--/.test(line)) {
      // A comment says nothing in the preview; what follows it on its last line stays.
      let j = i
      let from = line.indexOf('<!--') + 4
      let end = -1
      while (j < n && (end = lines[j].indexOf('-->', from)) < 0) {
        j++
        from = 0
      }
      if (j >= n) break
      const rest = lines[j].slice(end + 3)
      if (isBlank(rest)) i = j + 1
      else {
        lines[j] = rest
        i = j
      }
      continue
    }

    const dropped = HTML_DROPPED.exec(line)
    if (dropped) {
      i = htmlRegion(lines, i, dropped[1]).next
      continue
    }

    if (/^ {0,3}<hr\b[^>]*>[ \t]*$/i.test(line)) {
      out.push({ t: 'rule' })
      i++
      continue
    }

    if (/^ {0,3}<pre\b/i.test(line)) {
      const region = htmlRegion(lines, i, 'pre')
      const code = /^\s*<code\b([^>]*)>([\s\S]*?)(?:<\/code>)?\s*$/i.exec(region.inner.join('\n'))
      const text = (code ? code[2] : region.inner.join('\n')).replace(/<[^>]+>/g, '').replace(/^\n|\n$/g, '')
      const lang = /(?:language|lang)-([\w+#-]+)/i.exec(code?.[1] ?? region.open)?.[1] ?? attrOf(region.open, 'lang')
      out.push({ t: 'code', lang: lang.toLowerCase(), text: decodeEntities(text) })
      i = region.next
      continue
    }

    if (/^ {0,3}<details\b/i.test(line)) {
      const region = htmlRegion(lines, i, 'details')
      const inner = region.inner.join('\n')
      const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner)
      const body = summary ? inner.slice(0, summary.index) + inner.slice(summary.index + summary[0].length) : inner
      out.push({
        t: 'details',
        open: /\sopen\b/i.test(region.open),
        summary: parseInline((summary?.[1] ?? 'Details').replace(/\s*\n\s*/g, ' ').trim(), st),
        children: parseBlocks(dedent(body.split('\n')), st)
      })
      i = region.next
      continue
    }

    if (/^ {0,3}<table\b/i.test(line)) {
      const region = htmlRegion(lines, i, 'table')
      const table = htmlTable(region.inner.join('\n'), st)
      if (table) out.push(table)
      i = region.next
      continue
    }

    const container = HTML_CONTAINER.exec(line)
    if (container) {
      const tag = container[1].toLowerCase()
      const region = htmlRegion(lines, i, tag)
      const align = alignOf(tag, container[2])
      if (/^h[1-6]$/.test(tag)) out.push(heading(Number(tag[1]), parseInline(region.inner.join(' ').replace(/\s+/g, ' ').trim(), st), align, st))
      else out.push(...withAlign(parseBlocks(dedent(region.inner), st), align))
      i = region.next
      continue
    }

    const table = tableStarts(lines, i)
    if (table) {
      const rows: Inline[][][] = []
      i += 2
      while (i < n && !isBlank(lines[i]) && !startsBlock(lines[i])) {
        const cells = splitRow(lines[i])
        rows.push(table.head.map((_, c) => parseInline(cells[c] ?? '', st)))
        i++
      }
      out.push({ t: 'table', align: table.align, head: table.head.map((c) => parseInline(c, st)), rows })
      continue
    }

    // A paragraph, up to a blank line or the start of something else; underlined, it is a heading.
    const para = [line]
    let underline = 0
    i++
    while (i < n) {
      const l = lines[i]
      if (isBlank(l)) break
      const sx = SETEXT.exec(l)
      if (sx) {
        underline = sx[1][0] === '=' ? 1 : 2
        i++
        break
      }
      if (startsBlock(l) || tableStarts(lines, i)) break
      para.push(l)
      i++
    }
    const children = parseInline(paragraphText(para), st)
    if (underline) out.push(heading(underline, children, null, st))
    else if (children.length) out.push({ t: 'paragraph', align: null, children })
  }
  return out
}

function parseList(lines: string[], start: number, st: State): [Block, number] {
  const first = itemOf(lines[start])!
  const ordered = /\d/.test(first[2])
  const kind = ordered ? first[2].slice(-1) : first[2]
  const sameList = (m: RegExpExecArray | null): m is RegExpExecArray => !!m && /\d/.test(m[2]) === ordered && (ordered ? m[2].slice(-1) : m[2]) === kind
  const items: ListItem[] = []
  const n = lines.length
  let loose = false
  let i = start
  while (i < n) {
    const m = itemOf(lines[i])
    if (!sameList(m)) break
    const markerIndent = m[1].length
    const spaces = m[3] ?? ''
    const rest = m[4] ?? ''
    const pad = isBlank(rest) ? 1 : spaces.length > 4 ? 1 : spaces.length
    const contentIndent = markerIndent + m[2].length + pad
    const body: string[] = [isBlank(rest) ? '' : ' '.repeat(spaces.length - pad) + rest]
    let fenced: string | null = null
    i++
    while (i < n) {
      const l = lines[i]
      if (isBlank(l)) {
        let k = i + 1
        while (k < n && isBlank(lines[k])) k++
        if (k >= n) break
        const ind = indentOf(lines[k])
        // What follows the blank lines still belongs to this item when it is indented under it.
        if (ind >= contentIndent || (fenced === null && ind > markerIndent && itemOf(lines[k]))) {
          for (; i < k; i++) body.push('')
          continue
        }
        break
      }
      const ind = indentOf(l)
      if (fenced !== null) {
        body.push(l.slice(Math.min(ind, contentIndent)))
        if (closesFence(l.slice(Math.min(ind, contentIndent)), fenced)) fenced = null
        i++
        continue
      }
      if (ind >= contentIndent) {
        const text = l.slice(contentIndent)
        const f = fenceOf(text)
        if (f) fenced = f.mark
        body.push(text)
        i++
        continue
      }
      const other = itemOf(l)
      if (other) {
        // Indented a little under a numbered item ("1. a" then "  - b"): meant as its child, and shown so.
        if (other[1].length > markerIndent) {
          body.push(l.slice(ind))
          i++
          continue
        }
        break
      }
      // A paragraph's next line, written without its indentation.
      const last = body[body.length - 1]
      if (!isBlank(last) && !startsBlock(l) && !ATX.test(last) && !RULE.test(last)) {
        body.push(l.trimStart())
        i++
        continue
      }
      break
    }
    const task = /^\[([ xX])\][ \t]+/.exec(body[0])
    if (task) body[0] = body[0].slice(task[0].length)
    items.push({ checked: task ? task[1] !== ' ' : null, children: parseBlocks(body, st) })
    // Blank lines, then another item of this list: the list goes on, loosely.
    let k = i
    while (k < n && isBlank(lines[k])) k++
    if (k > i && k < n && sameList(itemOf(lines[k])) && indentOf(lines[k]) <= markerIndent + 1) {
      loose = true
      i = k
    }
  }
  const spread = items.some((it) => it.children.filter((b) => b.t === 'paragraph').length > 1)
  const startAt = ordered ? parseInt(first[2], 10) : 1
  return [{ t: 'list', ordered, start: startAt, tight: !loose && !spread, items }, i]
}

/** A table written in HTML, read into the same rows as a Markdown one. */
function htmlTable(html: string, st: State): Block | null {
  const rows: { head: boolean; cells: Inline[][]; align: Align[] }[] = []
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tr>|<\/tbody>|<\/thead>|$)/gi)) {
    const cells: Inline[][] = []
    const align: Align[] = []
    let head = false
    for (const cell of tr[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)(?=<th\b|<td\b|<\/th>|<\/td>|$)/gi)) {
      if (cell[1].toLowerCase() === 'th') head = true
      align.push(alignOf(cell[1], cell[2]))
      cells.push(parseInline(cell[3].replace(/\s*\n\s*/g, ' ').trim(), st))
    }
    if (cells.length) rows.push({ head, cells, align })
  }
  if (!rows.length) return null
  const cols = Math.max(...rows.map((r) => r.cells.length))
  const fill = (cells: Inline[][]): Inline[][] => Array.from({ length: cols }, (_, c) => cells[c] ?? [])
  const head = rows[0].head ? rows[0] : null
  const body = head ? rows.slice(1) : rows
  return {
    t: 'table',
    align: Array.from({ length: cols }, (_, c) => rows[0].align[c] ?? null),
    head: head ? fill(head.cells) : [],
    rows: body.map((r) => fill(r.cells))
  }
}

// ── Inline ────────────────────────────────────────────────────────────

interface Delim {
  t: 'delim'
  ch: string
  count: number
  orig: number
  canOpen: boolean
  canClose: boolean
}
interface Bracket {
  t: 'bracket'
  image: boolean
  /** Where its text starts in the source. */
  pos: number
  dead: boolean
}
interface HtmlOpen {
  t: 'html'
  tag: string
  attrs: string
}
type Node = Inline | Delim | Bracket | HtmlOpen

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  hellip: '…', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', middot: '·', bull: '•', laquo: '«', raquo: '»',
  times: '×', divide: '÷', check: '✓', cross: '✗', deg: '°', plusmn: '±', le: '≤', ge: '≥', ne: '≠', infin: '∞',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sect: '§', para: '¶', euro: '€', pound: '£', yen: '¥', cent: '¢',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwj: '‍', zwnj: '‌', shy: '­'
}

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g
const ENTITY_AT = new RegExp(ENTITY.source, 'y')

function entityText(m: RegExpExecArray | string[]): string | null {
  if (m[1] || m[2]) {
    const code = m[1] ? parseInt(m[1], 10) : parseInt(m[2], 16)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�'
  }
  return ENTITIES[m[3]] ?? null
}

export function decodeEntities(text: string): string {
  return text.includes('&') ? text.replace(ENTITY, (all, ...g: string[]) => entityText([all, ...g]) ?? all) : text
}

/** The emoji the documents of a repository name most often. */
const EMOJI: Readonly<Record<string, string>> = {
  white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌', warning: '⚠️', rocket: '🚀', tada: '🎉', sparkles: '✨', bug: '🐛',
  fire: '🔥', bulb: '💡', memo: '📝', books: '📚', book: '📖', construction: '🚧', lock: '🔒', key: '🔑', zap: '⚡', star: '⭐',
  eyes: '👀', thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', heart: '❤️', information_source: 'ℹ️', question: '❓',
  exclamation: '❗', wrench: '🔧', hammer: '🔨', gear: '⚙️', package: '📦', point_right: '👉', arrow_right: '➡️', bell: '🔔',
  mag: '🔍', link: '🔗', pushpin: '📌', calendar: '📅', computer: '💻', robot: '🤖', test_tube: '🧪', art: '🎨', recycle: '♻️',
  boom: '💥', wave: '👋', pray: '🙏', clap: '👏', thinking: '🤔', smile: '😄', no_entry: '⛔', stop_sign: '🛑', hourglass: '⌛',
  white_circle: '⚪', red_circle: '🔴', green_circle: '🟢', yellow_circle: '🟡', large_blue_circle: '🔵', checkered_flag: '🏁',
  chart_with_upwards_trend: '📈', bar_chart: '📊', dart: '🎯', seedling: '🌱', globe_with_meridians: '🌐', octocat: '🐙'
}

const PUNCT = /[\p{P}\p{S}]/u
const isSpace = (c: string): boolean => !c || /\s/.test(c)
const isPunct = (c: string): boolean => !!c && PUNCT.test(c)
const ESCAPABLE = /[!-/:-@[-`{-~]/

const WRAP_TAGS: Readonly<Record<string, InlineWrap | 'a' | 'code'>> = {
  b: 'strong', strong: 'strong', i: 'em', em: 'em', del: 'del', s: 'del', strike: 'del', kbd: 'kbd', sub: 'sub', sup: 'sup',
  mark: 'mark', u: 'u', ins: 'u', a: 'a', code: 'code', samp: 'code', tt: 'code', var: 'em', cite: 'em'
}

const HTML_TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:@][\w:.@-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/

const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase()

/** What a tree of inline pieces says, as plain text. */
export function plainText(nodes: readonly Inline[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.t === 'text' || node.t === 'code') out += node.text
    else if (node.t === 'image') out += node.alt
    else if (node.t === 'break') out += ' '
    else out += plainText(node.children)
  }
  return out
}

/** Marks left without their pair become the text they were, and neighbouring texts one. */
function toInlines(nodes: Node[]): Inline[] {
  const out: Inline[] = []
  const text = (s: string) => {
    if (!s) return
    const last = out[out.length - 1]
    if (last && last.t === 'text') last.text += s
    else out.push({ t: 'text', text: s })
  }
  for (const node of nodes) {
    if (node.t === 'delim') text(node.ch.repeat(node.count))
    else if (node.t === 'bracket') text(node.image ? '![' : '[')
    else if (node.t === 'html') continue
    else if (node.t === 'text') text(node.text)
    else out.push(node)
  }
  return out
}

/** Pair the emphasis marks of `nodes` from `from` on (CommonMark's way: the closest opener, the rule of three). */
function pairEmphasis(nodes: Node[], from: number): void {
  let ci = from
  while (ci < nodes.length) {
    const closer = nodes[ci]
    if (closer.t !== 'delim' || !closer.canClose) {
      ci++
      continue
    }
    let oi = ci - 1
    let found = -1
    for (; oi >= from; oi--) {
      const o = nodes[oi]
      if (o.t !== 'delim' || o.ch !== closer.ch || !o.canOpen) continue
      const odd = (o.canClose || closer.canOpen) && (o.orig + closer.orig) % 3 === 0 && !(o.orig % 3 === 0 && closer.orig % 3 === 0)
      if (!odd) {
        found = oi
        break
      }
    }
    if (found < 0) {
      ci++
      continue
    }
    const opener = nodes[found] as Delim
    const use = closer.ch === '~' ? 2 : opener.count >= 2 && closer.count >= 2 ? 2 : 1
    const kind: InlineWrap = closer.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em'
    const inner = toInlines(nodes.slice(found + 1, ci))
    opener.count -= use
    closer.count -= use
    nodes.splice(found + 1, ci - found - 1, { t: kind, children: inner })
    ci = found + 2
    if (!opener.count) {
      nodes.splice(found, 1)
      ci--
    }
    if (!closer.count) nodes.splice(ci, 1)
  }
}

/** `(address "title")` after a link's text: what it says and where it ends, or null. */
function linkTail(src: string, at: number): { href: string; title: string; end: number } | null {
  if (src[at] !== '(') return null
  let p = at + 1
  const skip = () => {
    while (p < src.length && /\s/.test(src[p])) p++
  }
  skip()
  let href = ''
  if (src[p] === '<') {
    const close = src.indexOf('>', p)
    if (close < 0 || src.slice(p, close).includes('\n')) return null
    href = src.slice(p + 1, close)
    p = close + 1
  } else {
    let depth = 0
    const from = p
    for (; p < src.length; p++) {
      const c = src[p]
      if (c === '\\' && p + 1 < src.length) p++
      else if (/\s/.test(c)) break
      else if (c === '(') depth++
      else if (c === ')') {
        if (!depth) break
        depth--
      }
    }
    href = src.slice(from, p)
  }
  skip()
  let title = ''
  const quote = src[p]
  if (quote === '"' || quote === "'" || quote === '(') {
    const close = src.indexOf(quote === '(' ? ')' : quote, p + 1)
    if (close < 0) return null
    title = src.slice(p + 1, close)
    p = close + 1
    skip()
  }
  if (src[p] !== ')') return null
  return { href: unescape(href), title: unescape(title), end: p + 1 }
}

const unescape = (s: string): string => decodeEntities(s.replace(/\\([!-/:-@[-`{-~])/g, '$1'))

/** The inline pieces of a block's text. */
function parseInline(src: string, st: State): Inline[] {
  const nodes: Node[] = []
  let buf = ''
  const flush = () => {
    if (buf) nodes.push({ t: 'text', text: buf })
    buf = ''
  }
  const n = src.length
  let p = 0
  while (p < n) {
    const c = src[p]

    if (c === '\\') {
      const next = src[p + 1] ?? ''
      if (next === '\n') {
        flush()
        nodes.push({ t: 'break' })
        p += 2
        while (src[p] === ' ') p++
      } else if (next && ESCAPABLE.test(next)) {
        buf += next
        p += 2
      } else {
        buf += c
        p++
      }
      continue
    }

    if (c === '`') {
      let run = 1
      while (src[p + run] === '`') run++
      let close = -1
      for (let q = p + run; q < n; q++) {
        if (src[q] !== '`') continue
        let len = 1
        while (src[q + len] === '`') len++
        if (len === run) {
          close = q
          break
        }
        q += len - 1
      }
      if (close < 0) {
        buf += src.slice(p, p + run)
        p += run
        continue
      }
      let code = src.slice(p + run, close).replace(/\n/g, ' ')
      if (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
      flush()
      nodes.push({ t: 'code', text: code })
      p = close + run
      continue
    }

    if (c === '<') {
      const rest = src.slice(p)
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/.exec(rest)
      if (auto) {
        flush()
        const href = /^[\w.+-]+@/.test(auto[1]) ? `mailto:${auto[1]}` : auto[1]
        nodes.push({ t: 'link', href, title: '', children: [{ t: 'text', text: auto[1] }] })
        p += auto[0].length
        continue
      }
      if (rest.startsWith('<!--')) {
        const end = rest.indexOf('-->', 4)
        p += end < 0 ? rest.length : end + 3
        continue
      }
      const tag = HTML_TAG.exec(rest)
      if (tag) {
        const name = tag[2].toLowerCase()
        p += tag[0].length
        if (name === 'script' || name === 'style') {
          if (!tag[1]) {
            const end = src.slice(p).search(new RegExp(`</${name}\\s*>`, 'i'))
            p = end < 0 ? n : p + end
          }
          continue
        }
        if (name === 'br') {
          flush()
          nodes.push({ t: 'break' })
          if (src[p] === '\n') p++
          continue
        }
        if (name === 'img') {
          const size = (v: string): number | null => (/^\d{1,5}(?:px)?$/.test(v) ? parseInt(v, 10) : null)
          flush()
          nodes.push({ t: 'image', src: attrOf(tag[3], 'src'), alt: attrOf(tag[3], 'alt'), title: attrOf(tag[3], 'title'), width: size(attrOf(tag[3], 'width')), height: size(attrOf(tag[3], 'height')) })
          continue
        }
        const wrap = WRAP_TAGS[name]
        if (!wrap) continue
        flush()
        if (!tag[1]) {
          nodes.push({ t: 'html', tag: name, attrs: tag[3] })
          continue
        }
        let open = nodes.length - 1
        while (open >= 0 && !(nodes[open].t === 'html' && (nodes[open] as HtmlOpen).tag === name)) open--
        if (open < 0) continue
        const mark = nodes[open] as HtmlOpen
        const inner = nodes.splice(open + 1)
        pairEmphasis(inner, 0)
        const children = toInlines(inner)
        if (wrap === 'a') {
          const href = attrOf(mark.attrs, 'href')
          if (href) nodes[open] = { t: 'link', href, title: attrOf(mark.attrs, 'title'), children }
          else nodes.splice(open, 1, ...children)
        } else if (wrap === 'code') nodes[open] = { t: 'code', text: plainText(children) }
        else nodes[open] = { t: wrap, children }
        continue
      }
      buf += c
      p++
      continue
    }

    if (c === '&') {
      ENTITY_AT.lastIndex = p
      const m = ENTITY_AT.exec(src)
      const text = m ? entityText(m) : null
      if (m && text !== null) {
        buf += text
        p += m[0].length
      } else {
        buf += c
        p++
      }
      continue
    }

    if (c === '!' && src[p + 1] === '[') {
      flush()
      nodes.push({ t: 'bracket', image: true, pos: p + 2, dead: false })
      p += 2
      continue
    }

    if (c === '[') {
      flush()
      nodes.push({ t: 'bracket', image: false, pos: p + 1, dead: false })
      p++
      continue
    }

    if (c === ']') {
      flush()
      let bi = nodes.length - 1
      while (bi >= 0 && nodes[bi].t !== 'bracket') bi--
      if (bi < 0) {
        buf += c
        p++
        continue
      }
      const mark = nodes[bi] as Bracket
      const label = src.slice(mark.pos, p)
      let hit: { href: string; title: string; end: number } | null = mark.dead ? null : linkTail(src, p + 1)
      if (!hit && !mark.dead) {
        const full = /^\[([^\]]*)\]/.exec(src.slice(p + 1))
        const ref = st.refs.get(normalizeLabel(full && full[1] ? full[1] : label))
        if (ref) hit = { ...ref, end: p + 1 + (full ? full[0].length : 0) }
      }
      if (!hit) {
        // A footnote's mark, or just a bracket.
        if (!mark.image && /^\^[^\s\]]+$/.test(label)) nodes.splice(bi, nodes.length - bi, { t: 'sup', children: [{ t: 'text', text: label.slice(1) }] })
        else {
          nodes[bi] = { t: 'text', text: mark.image ? '![' : '[' }
          buf += c
        }
        p++
        continue
      }
      const inner = nodes.splice(bi + 1)
      pairEmphasis(inner, 0)
      const children = toInlines(inner)
      if (mark.image) nodes[bi] = { t: 'image', src: hit.href, alt: plainText(children), title: hit.title, width: null, height: null }
      else {
        nodes[bi] = { t: 'link', href: hit.href, title: hit.title, children }
        // A link holds no other link: the brackets opened before it are only text.
        for (const node of nodes) if (node.t === 'bracket' && !node.image) node.dead = true
      }
      p = hit.end
      continue
    }

    if (c === '*' || c === '_' || c === '~') {
      let run = 1
      while (src[p + run] === c) run++
      if (c === '~' && run !== 2) {
        buf += src.slice(p, p + run)
        p += run
        continue
      }
      const before = p ? src[p - 1] : ''
      const after = src[p + run] ?? ''
      const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before))
      const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after))
      const canOpen = c === '_' ? left && (!right || isPunct(before)) : left
      const canClose = c === '_' ? right && (!left || isPunct(after)) : right
      flush()
      nodes.push({ t: 'delim', ch: c, count: run, orig: run, canOpen, canClose })
      p += run
      continue
    }

    if (c === '\n') {
      const hard = / {2,}$/.test(buf)
      buf = buf.replace(/[ \t]+$/, '')
      if (hard) {
        flush()
        nodes.push({ t: 'break' })
      } else buf += '\n'
      p++
      while (src[p] === ' ' || src[p] === '\t') p++
      continue
    }

    if (c === ':') {
      const m = /^:([a-z0-9_+-]{1,40}):/.exec(src.slice(p, p + 44))
      const emoji = m ? EMOJI[m[1]] : undefined
      if (m && emoji) {
        buf += emoji
        p += m[0].length
        continue
      }
    }

    // A web address written as it is.
    if ((c === 'h' || c === 'w') && (!p || !/[\p{L}\p{N}_/.:@-]/u.test(src[p - 1]))) {
      const m = /^(?:https?:\/\/|www\.)[^\s<]+/.exec(src.slice(p))
      if (m && (c === 'h' || /^www\.[^\s<.]+\.[^\s<]/.test(m[0]))) {
        let url = m[0].replace(/[?!.,:;*_~'"]+$/, '')
        while (url.endsWith(')') && url.split(')').length > url.split('(').length) url = url.slice(0, -1)
        if (url.length > (c === 'h' ? url.indexOf('//') + 2 : 4)) {
          flush()
          nodes.push({ t: 'link', href: c === 'w' ? `https://${url}` : url, title: '', children: [{ t: 'text', text: url }] })
          p += url.length
          continue
        }
      }
    }

    buf += c
    p++
  }
  flush()
  pairEmphasis(nodes, 0)
  return toInlines(nodes)
}

// ── Document ──────────────────────────────────────────────────────────

/** The lines of a document: line ends made one, leading tabs made spaces. */
function linesOf(source: string): string[] {
  return source
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.includes('\t')) return line
      const lead = /^[ \t]*/.exec(line)![0]
      let width = ''
      for (const ch of lead) width += ch === '\t' ? ' '.repeat(4 - (width.length % 4)) : ' '
      return width + line.slice(lead.length)
    })
}

/** Read a Markdown document into the tree the preview draws. */
export function parseMarkdown(source: string): MarkdownDoc {
  const st: State = { refs: new Map(), slugs: new Map(), headings: [] }
  const lines = linesOf(source)
  const blocks: Block[] = []

  // Front matter: the lines between two `---` at the very top.
  let from = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(l))
    if (end > 1 && lines.slice(1, end).some((l) => /^[\w"'-][^:]*:/.test(l))) {
      blocks.push({ t: 'code', lang: 'yaml', text: lines.slice(1, end).join('\n'), meta: true })
      from = end + 1
    }
  }

  // Link references ("[name]: address") can be anywhere outside code; they say nothing themselves.
  const body = lines.slice(from)
  let fenced: string | null = null
  for (let i = 0; i < body.length; i++) {
    const line = body[i]
    if (fenced) {
      if (closesFence(line, fenced)) fenced = null
      continue
    }
    const fence = fenceOf(line)
    if (fence) {
      fenced = fence.mark
      continue
    }
    const def = REF_DEF.exec(line)
    if (!def) continue
    const label = normalizeLabel(def[1])
    if (!st.refs.has(label)) st.refs.set(label, { href: unescape(def[2].replace(/^<|>$/g, '')), title: unescape(def[3] ?? def[4] ?? def[5] ?? '') })
    body[i] = ''
  }

  blocks.push(...parseBlocks(body, st))
  return { blocks, headings: st.headings }
}
