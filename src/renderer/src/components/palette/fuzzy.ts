// Fuzzy matcher used by the command palette (and the branch picker).
//
// A query matches a text when its characters (case-insensitive, whitespace in the
// query ignored) appear in order in the text. Among all possible alignments the
// scorer picks the one that maximises:
//   - word-start bonuses (start of text, after a separator, camelCase humps),
//   - contiguous-run bonuses (consecutive matched characters),
// minus small penalties for gaps. Scores are integers so the backtracking step can
// compare them exactly. No dependencies: safe to unit-test in node.

export interface FuzzyMatch {
  score: number
  /** Indexes into the original text of each matched query character (ascending). */
  indexes: number[]
}

const NEG = -1_000_000_000

const GAP_LEADING = -3
const GAP_TRAILING = -1
const GAP_INNER = -10
const BONUS_CONSECUTIVE = 1000
const BONUS_START = 1000
const BONUS_SEPARATOR = 900
const BONUS_WORD = 800
const BONUS_CAMEL = 700
const BONUS_DOT = 500
const BONUS_PREFIX = 3000
const BONUS_EXACT = 6000
const BONUS_CASE = 2

/** Texts longer than this use a cheaper greedy alignment. */
const MAX_DP_LENGTH = 512

function isSeparator(ch: string): boolean {
  return ch === '/' || ch === '\\'
}
function isWordBreak(ch: string): boolean {
  return ch === ' ' || ch === '-' || ch === '_' || ch === ':' || ch === '(' || ch === '[' || ch === '@' || ch === '\t'
}
function isLower(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase()
}
function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase()
}

/** Bonus for matching the character at position `i` of `text`. */
function positionBonus(text: string, i: number): number {
  if (i === 0) return BONUS_START
  const prev = text[i - 1]
  if (isSeparator(prev)) return BONUS_SEPARATOR
  if (isWordBreak(prev)) return BONUS_WORD
  if (prev === '.') return BONUS_DOT
  if (isLower(prev) && isUpper(text[i])) return BONUS_CAMEL
  return 0
}

function normaliseQuery(query: string): string {
  return query.replace(/\s+/g, '')
}

/** Quick rejection: is `q` (lower-case) a subsequence of `t` (lower-case)? */
function isSubsequence(q: string, t: string): boolean {
  let j = 0
  for (let i = 0; i < q.length; i++) {
    j = t.indexOf(q[i], j)
    if (j < 0) return false
    j++
  }
  return true
}

/**
 * Score `text` against `query`. Returns null when it does not match.
 * An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const qRaw = normaliseQuery(query)
  if (!qRaw) return { score: 0, indexes: [] }
  const q = qRaw.toLowerCase()
  const t = text.toLowerCase()
  const n = q.length
  const m = t.length
  if (n > m || !isSubsequence(q, t)) return null

  const indexes = m > MAX_DP_LENGTH ? greedyAlign(q, t) : dpAlign(q, t, text)
  if (!indexes) return null

  let score = 0
  for (let i = 0; i < indexes.length; i++) {
    const j = indexes[i]
    if (i > 0 && indexes[i - 1] === j - 1) score += BONUS_CONSECUTIVE
    else score += positionBonus(text, j)
    if (i === 0) score += j * GAP_LEADING
    else score += (j - indexes[i - 1] - 1) * GAP_INNER
    if (text[j] === qRaw[i]) score += BONUS_CASE
  }
  score += (m - 1 - indexes[indexes.length - 1]) * GAP_TRAILING
  if (t.startsWith(q)) score += BONUS_PREFIX
  if (t === q) score += BONUS_EXACT
  return { score, indexes }
}

/** Optimal alignment via dynamic programming (O(n·m)). */
function dpAlign(q: string, t: string, original: string): number[] | null {
  const n = q.length
  const m = t.length
  // D[i][j]: best score with q[i] matched exactly at t[j].
  // M[i][j]: best score with q[0..i] matched somewhere within t[0..j].
  const D = new Array<Int32Array>(n)
  const M = new Array<Int32Array>(n)
  const bonus = new Int32Array(m)
  for (let j = 0; j < m; j++) bonus[j] = positionBonus(original, j)

  for (let i = 0; i < n; i++) {
    const Di = new Int32Array(m).fill(NEG)
    const Mi = new Int32Array(m).fill(NEG)
    const gap = i === n - 1 ? GAP_TRAILING : GAP_INNER
    let prev = NEG
    const qc = q[i]
    for (let j = 0; j < m; j++) {
      if (qc === t[j]) {
        let s = NEG
        if (i === 0) s = j * GAP_LEADING + bonus[j]
        else if (j > 0) {
          const fromGap = M[i - 1][j - 1] > NEG ? M[i - 1][j - 1] + bonus[j] : NEG
          const fromRun = D[i - 1][j - 1] > NEG ? D[i - 1][j - 1] + BONUS_CONSECUTIVE : NEG
          s = Math.max(fromGap, fromRun)
        }
        Di[j] = s
        prev = Math.max(s, prev > NEG ? prev + gap : NEG)
        Mi[j] = prev
      } else {
        prev = prev > NEG ? prev + gap : NEG
        Mi[j] = prev
      }
    }
    D[i] = Di
    M[i] = Mi
  }

  if (M[n - 1][m - 1] <= NEG) return null

  // Backtrack.
  const out = new Array<number>(n)
  let matchRequired = false
  let j = m - 1
  for (let i = n - 1; i >= 0; i--) {
    for (; j >= 0; j--) {
      const d = D[i][j]
      if (d > NEG && (matchRequired || d === M[i][j])) {
        matchRequired = i > 0 && j > 0 && d === D[i - 1][j - 1] + BONUS_CONSECUTIVE && D[i - 1][j - 1] > NEG
        out[i] = j
        j--
        break
      }
    }
  }
  for (let i = 0; i < n; i++) if (out[i] === undefined) return null
  return out
}

/** Greedy left-to-right alignment for very long texts. */
function greedyAlign(q: string, t: string): number[] | null {
  const out: number[] = []
  let j = 0
  for (let i = 0; i < q.length; i++) {
    j = t.indexOf(q[i], j)
    if (j < 0) return null
    out.push(j)
    j++
  }
  return out
}

export interface FuzzyResult<T> {
  item: T
  score: number
  indexes: number[]
}

/**
 * Filter and sort items by fuzzy score (best first). Ties keep the original order,
 * so callers control priority by ordering their input.
 */
export function fuzzyFilter<T>(items: readonly T[], query: string, getText: (item: T) => string, limit = Infinity): FuzzyResult<T>[] {
  const q = normaliseQuery(query)
  if (!q) {
    const out: FuzzyResult<T>[] = []
    for (let i = 0; i < items.length && out.length < limit; i++) out.push({ item: items[i], score: 0, indexes: [] })
    return out
  }
  const scored: Array<FuzzyResult<T> & { order: number }> = []
  for (let i = 0; i < items.length; i++) {
    const m = fuzzyMatch(q, getText(items[i]))
    if (m) scored.push({ item: items[i], score: m.score, indexes: m.indexes, order: i })
  }
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  const top = scored.length > limit ? scored.slice(0, limit) : scored
  return top.map(({ item, score, indexes }) => ({ item, score, indexes }))
}

export interface HighlightSegment {
  text: string
  match: boolean
}

/** Split text into alternating matched / unmatched segments for rendering. */
export function highlightSegments(text: string, indexes: readonly number[]): HighlightSegment[] {
  if (!indexes.length) return text ? [{ text, match: false }] : []
  const set = new Set(indexes)
  const out: HighlightSegment[] = []
  let cur = ''
  let curMatch = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i)
    if (isMatch !== curMatch && cur) {
      out.push({ text: cur, match: curMatch })
      cur = ''
    }
    curMatch = isMatch
    cur += text[i]
  }
  if (cur) out.push({ text: cur, match: curMatch })
  return out
}
