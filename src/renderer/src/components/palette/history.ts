// Persistent input history for the Git console (and small storage helpers shared
// by the palette module). Pure functions + guarded localStorage access.

export const HISTORY_LIMIT = 100

/** Append `entry` to `list`, removing an earlier identical entry, keeping the last `max`. */
export function pushHistory(list: readonly string[], entry: string, max = HISTORY_LIMIT): string[] {
  const value = entry.trim()
  if (!value) return [...list]
  const next = list.filter((e) => e !== value)
  next.push(value)
  return next.length > max ? next.slice(next.length - max) : next
}

export interface HistoryCursor {
  /** Index into history; history.length means "the current draft". */
  index: number
  /** What the user typed before navigating. */
  draft: string
}

/**
 * Move through history like a shell. `dir` -1 = older (↑), +1 = newer (↓).
 * Returns the new cursor and the text to show in the input.
 */
export function navigateHistory(
  history: readonly string[],
  cursor: HistoryCursor,
  dir: -1 | 1,
  currentText: string
): { cursor: HistoryCursor; text: string } {
  const atDraft = cursor.index >= history.length
  const draft = atDraft ? currentText : cursor.draft
  const index = Math.max(0, Math.min(history.length, cursor.index + dir))
  const text = index >= history.length ? draft : history[index]
  return { cursor: { index, draft }, text }
}

// ── Redaction ──────────────────────────────────────────────────────────────
// Console lines are persisted, so credentials typed into them must not be:
// `remote set-url origin https://me:ghp_…@github.com/…`, `clone https://oauth2:glpat-…@…`,
// `-c http.extraHeader="Authorization: Bearer …" fetch`. The raw line stays in memory for
// the current session only.

/** Config keys whose values carry credentials: http[.<url>].extraHeader, credential[.<url>].<key>. */
const SECRET_NAME = String.raw`(?:http\.(?:[^\s=]*\.)?extraheader|credential\.[^\s=]*)`
const SECRET_KEY = String.raw`${SECRET_NAME}\s*=`
/** The whole `-c` argument is quoted: "http.extraHeader=Authorization: Bearer …" → up to the closing quote. */
const QUOTED_SECRET_ARG = new RegExp(String.raw`(["'])(${SECRET_KEY})[\s\S]*?(?=\1|$)`, 'gi')
/** key=value / key="value" / key='value' (the key itself unquoted). */
const SECRET_ASSIGNMENT = new RegExp(String.raw`(^|[\s=])(${SECRET_KEY})(?:"[^"]*"?|'[^']*'?|\S*)`, 'gi')
/** `git config [--global] <key> <value>`: the value is the next argument. */
const SECRET_CONFIG_VALUE = new RegExp(String.raw`(^|\s)(["']?)(${SECRET_NAME})\2(\s+)(?!-)(?:"[^"]*"?|'[^']*'?|\S+)`, 'gi')
/** scheme://userinfo@ — any userinfo of http(s) URLs (a token can be the user name), user:password elsewhere. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@'"]+)@/gi

/** A console line with credentials replaced by "***" (safe to persist). */
export function redactHistoryEntry(line: string): string {
  return line
    .replace(QUOTED_SECRET_ARG, '$1$2***')
    .replace(SECRET_ASSIGNMENT, '$1$2***')
    .replace(SECRET_CONFIG_VALUE, '$1$2$3$2$4***')
    .replace(URL_USERINFO, (all, scheme: string, userinfo: string) => {
      if (/^https?:\/\/$/i.test(scheme)) return `${scheme}***@`
      const colon = userinfo.indexOf(':')
      return colon >= 0 ? `${scheme}${userinfo.slice(0, colon)}:***@` : all
    })
}

/** Redacted copy of a history list; entries that become identical keep only the latest. */
export function redactHistory(list: readonly string[]): string[] {
  const out: string[] = []
  for (const entry of list) {
    const r = redactHistoryEntry(entry)
    const i = out.indexOf(r)
    if (i >= 0) out.splice(i, 1)
    out.push(r)
  }
  return out
}

/** Persist the console history, redacted. */
export function saveHistory(key: string, list: readonly string[]): void {
  writeJson(key, redactHistory(list))
}

/**
 * Load the console history (redacted, at most `max` entries). Entries saved unredacted by
 * earlier versions are scrubbed from storage on the way.
 */
export function loadHistory(key: string, max = HISTORY_LIMIT): string[] {
  const stored = loadStringList(key)
  const clean = redactHistory(stored).slice(-max)
  if (clean.length !== stored.length || clean.some((e, i) => e !== stored[i])) writeJson(key, clean)
  return clean
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or unavailable */
  }
}

export function loadStringList(key: string): string[] {
  const v = readJson<unknown>(key, [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
