// Syntax highlighting with highlight.js, turned into per-line token lists so the
// diff renderer can combine syntax colours with word-diff ranges and render only
// visible rows. highlight.js is loaded lazily on first use; results are cached.

import type { HLJSApi } from 'highlight.js'

export interface Token {
  text: string
  /** Space-separated hljs classes ("hljs-string", "hljs-title function_"), '' for plain text. */
  cls: string
}

let hljsPromise: Promise<HLJSApi> | null = null
let hljsLoaded: HLJSApi | null = null

/** Lazily import highlight.js (all languages). */
export function loadHighlighter(): Promise<HLJSApi> {
  if (!hljsPromise) {
    hljsPromise = import('highlight.js').then((m) => {
      const api = ((m as unknown as { default?: HLJSApi }).default ?? m) as HLJSApi
      hljsLoaded = api
      return api
    })
    hljsPromise.catch(() => {
      hljsPromise = null
    })
  }
  return hljsPromise
}

/** The highlighter when already loaded (sync access for render paths). */
export function loadedHighlighter(): HLJSApi | null {
  return hljsLoaded
}

const BY_FILENAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'cmakelists.txt': 'cmake',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  vagrantfile: 'ruby',
  brewfile: 'ruby',
  'build.gradle': 'gradle',
  jenkinsfile: 'groovy',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.bash_profile': 'bash',
  '.profile': 'bash',
  '.gitconfig': 'ini',
  '.gitmodules': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.env': 'bash',
  'nginx.conf': 'nginx'
}

const BY_EXT: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'xml',
  svelte: 'xml',
  html: 'xml',
  htm: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  plist: 'xml',
  csproj: 'xml',
  storyboard: 'xml',
  xib: 'xml',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  webmanifest: 'json',
  lock: 'json',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'properties',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rb: 'ruby',
  erb: 'erb',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  sc: 'scala',
  groovy: 'groovy',
  gradle: 'gradle',
  swift: 'swift',
  m: 'objectivec',
  mm: 'objectivec',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  ino: 'arduino',
  cs: 'csharp',
  fs: 'fsharp',
  fsx: 'fsharp',
  vb: 'vbnet',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  hs: 'haskell',
  clj: 'clojure',
  cljs: 'clojure',
  edn: 'clojure',
  ml: 'ocaml',
  mli: 'ocaml',
  jl: 'julia',
  zig: 'zig',
  nim: 'nim',
  nix: 'nix',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  styl: 'stylus',
  tex: 'latex',
  vim: 'vim',
  diff: 'diff',
  patch: 'diff',
  cmake: 'cmake',
  mk: 'makefile',
  tf: 'hcl',
  hcl: 'hcl',
  hbs: 'handlebars',
  handlebars: 'handlebars',
  twig: 'twig',
  bat: 'dos',
  cmd: 'dos',
  asm: 'x86asm',
  s: 'armasm',
  wasm: 'wasm',
  wat: 'wasm',
  sol: 'solidity',
  dockerfile: 'dockerfile'
}

/** highlight.js language id for a path, or null when unknown / not registered. */
export function detectLanguage(path: string, hljs: HLJSApi | null = hljsLoaded): string | null {
  const name = (path.split('/').pop() ?? path).toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  const candidates = [BY_FILENAME[name], name.startsWith('dockerfile') ? 'dockerfile' : undefined, BY_EXT[ext], ext || undefined]
  for (const c of candidates) {
    if (!c) continue
    if (!hljs) return c
    const lang = hljs.getLanguage(c)
    if (lang) return c
  }
  return null
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }

function decode(s: string): string {
  return s.indexOf('&') < 0 ? s : s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITIES[e] ?? e)
}

/**
 * Convert highlight.js HTML into per-line token lists. Nested spans are flattened
 * (classes concatenated) and spans crossing line breaks continue on the next line.
 */
export function htmlToLines(html: string): Token[][] {
  const lines: Token[][] = [[]]
  const stack: string[] = []
  const re = /<span class="([^"]*)">|<\/span>|[^<]+|</g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const piece = m[0]
    if (m[1] !== undefined) {
      stack.push(m[1])
    } else if (piece === '</span>') {
      stack.pop()
    } else {
      const text = decode(piece)
      const cls = stack.join(' ')
      const parts = text.split('\n')
      parts.forEach((part, i) => {
        if (i > 0) lines.push([])
        if (!part) return
        const line = lines[lines.length - 1]
        const last = line[line.length - 1]
        if (last && last.cls === cls) last.text += part
        else line.push({ text: part, cls })
      })
    }
  }
  return lines
}

// ── Cache ──────────────────────────────────────────────────────────────────

/** Budget in source characters; token arrays cost a few times their source, hence the factor below. */
const CACHE_MAX_CHARS = 6_000_000
const COST_FACTOR = 3
const cache = new Map<string, Token[][]>()
let cacheChars = 0

function cacheGet(key: string): Token[][] | undefined {
  const v = cache.get(key)
  if (v) {
    cache.delete(key)
    cache.set(key, v)
  }
  return v
}

function cacheSet(key: string, value: Token[][]): void {
  cache.set(key, value)
  cacheChars += key.length * COST_FACTOR
  while (cacheChars > CACHE_MAX_CHARS && cache.size > 1) {
    const oldest = cache.keys().next().value as string
    cache.delete(oldest)
    cacheChars -= oldest.length * COST_FACTOR
  }
}

/** Lines longer than this are never highlighted (highlight.js gets slow / unreadable). */
export const MAX_HIGHLIGHT_LINE = 1000

/**
 * Highlight a block of lines (kept together so multi-line constructs such as block
 * comments or template strings are coloured correctly). Returns one token list per
 * input line; overly long lines come back as null (render as plain text).
 */
export function highlightBlock(hljs: HLJSApi, lines: string[], lang: string): Array<Token[] | null> {
  const long = lines.map((l) => l.length > MAX_HIGHLIGHT_LINE)
  const code = lines.map((l, i) => (long[i] ? '' : l)).join('\n')
  const key = `${lang}\u0000${code}`
  let result = cacheGet(key)
  if (!result) {
    try {
      result = htmlToLines(hljs.highlight(code, { language: lang, ignoreIllegals: true }).value)
    } catch {
      result = lines.map((l) => [{ text: l, cls: '' }])
    }
    cacheSet(key, result)
  }
  return lines.map((l, i) => (long[i] ? null : (result[i] ?? (l ? [{ text: l, cls: '' }] : []))))
}
