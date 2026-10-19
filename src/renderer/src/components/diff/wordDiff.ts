// Intra-line (word level) diff for paired deleted/added lines: a token LCS with
// common prefix/suffix trimming, capped so very long lines never stall rendering.

/** Half-open character range [start, end). */
export type Range = [number, number]

export interface WordDiff {
  /** Changed ranges in the old line. */
  a: Range[]
  /** Changed ranges in the new line. */
  b: Range[]
}

const TOKEN_RE = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu
const MAX_LINE = 2000
const MAX_CELLS = 60_000
/** Below this share of unchanged (non-blank) characters the lines are considered unrelated. */
const MIN_SIMILARITY = 0.4

export function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? []
}

const isBlank = (t: string) => /^\s+$/.test(t)

/**
 * Word-level changes between two lines, or null when the lines are too long or too
 * different for a word highlight to help (the whole line is highlighted anyway).
 */
export function wordDiff(a: string, b: string): WordDiff | null {
  if (a === b) return { a: [], b: [] }
  if (a.length > MAX_LINE || b.length > MAX_LINE) return null
  const ta = tokenize(a)
  const tb = tokenize(b)

  let pre = 0
  while (pre < ta.length && pre < tb.length && ta[pre] === tb[pre]) pre++
  let suf = 0
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf] === tb[tb.length - 1 - suf]) suf++

  const ma = ta.slice(pre, ta.length - suf)
  const mb = tb.slice(pre, tb.length - suf)
  const commonA = new Uint8Array(ta.length)
  const commonB = new Uint8Array(tb.length)
  for (let i = 0; i < pre; i++) commonA[i] = commonB[i] = 1
  for (let i = 0; i < suf; i++) {
    commonA[ta.length - 1 - i] = 1
    commonB[tb.length - 1 - i] = 1
  }

  const n = ma.length
  const m = mb.length
  if (n && m && n * m <= MAX_CELLS) {
    // LCS table, (n+1)*(m+1), filled from the end so backtracking walks forward.
    const w = m + 1
    const dp = new Uint16Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = ma[i] === mb[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        commonA[pre + i] = 1
        commonB[pre + j] = 1
        i++
        j++
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
      else j++
    }
  }

  // Similarity: unchanged non-blank characters relative to the longer line.
  const solid = (tokens: string[], common: Uint8Array | null) =>
    tokens.reduce((sum, t, i) => (isBlank(t) || (common && !common[i]) ? sum : sum + t.length), 0)
  const sharedA = solid(ta, commonA)
  const totalA = solid(ta, null)
  const totalB = solid(tb, null)
  const longest = Math.max(totalA, totalB)
  if (longest > 0 && sharedA / longest < MIN_SIMILARITY) return null

  return { a: toRanges(ta, commonA), b: toRanges(tb, commonB) }
}

/** Changed-token ranges; ranges separated only by blanks are merged. */
function toRanges(tokens: string[], common: Uint8Array): Range[] {
  const out: Range[] = []
  let pos = 0
  let pendingGap: Range | null = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const start = pos
    pos += t.length
    if (!common[i]) {
      const last = out[out.length - 1]
      if (last && (last[1] === start || (pendingGap && pendingGap[0] === last[1] && pendingGap[1] === start))) last[1] = pos
      else out.push([start, pos])
      pendingGap = null
    } else if (isBlank(t) && out.length && out[out.length - 1][1] === start) {
      pendingGap = [start, pos]
    } else {
      pendingGap = null
    }
  }
  return out
}
