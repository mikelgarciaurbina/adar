// Split commit message text into plain text and URL segments so URLs can be
// rendered as clickable links (opened in the system browser).

export type TextSegment = { kind: 'text'; text: string } | { kind: 'url'; text: string; href: string }

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const TRAILING_PUNCT = /[.,;:!?'"*_~]+$/

/** Remove trailing punctuation and unbalanced closing brackets from a matched URL. */
function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING_PUNCT, '')
  const pairs: Array<[string, string]> = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}']
  ]
  let changed = true
  while (changed && url) {
    changed = false
    for (const [open, close] of pairs) {
      if (url.endsWith(close)) {
        const opens = url.split(open).length - 1
        const closes = url.split(close).length - 1
        if (closes > opens) {
          url = url.slice(0, -1).replace(TRAILING_PUNCT, '')
          changed = true
        }
      }
    }
  }
  return url
}

export function linkify(text: string): TextSegment[] {
  const out: TextSegment[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    const url = trimUrl(m[0])
    if (!url || /^www\.?$/i.test(url)) continue
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) })
    const href = /^www\./i.test(url) ? `https://${url}` : url
    out.push({ kind: 'url', text: url, href })
    last = start + url.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  // Merge adjacent text segments (can happen when a match is skipped).
  const merged: TextSegment[] = []
  for (const seg of out) {
    const prev = merged[merged.length - 1]
    if (seg.kind === 'text' && prev?.kind === 'text') prev.text += seg.text
    else merged.push({ ...seg })
  }
  return merged
}
