// CodeMirror, and all of it that Adar uses. This module is loaded the first time a file is opened to edit (see
// `loadCodeMirror` in session.ts), so the window starts without it. What it gives: an editor's state made from a
// file's text, a view put in the page for it, and the few commands the rest of Adar calls (find, save, go to a line).
// No completion, no linting, no language server: Adar edits text, it does not understand code.

import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, indentWithTab, redo, undo } from '@codemirror/commands'
import { HighlightStyle, LanguageDescription, StreamLanguage, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, type StreamParser } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import {
  RegExpCursor,
  SearchCursor,
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  selectNextOccurrence,
  setSearchQuery
} from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { FindOptions, Indent } from './model'

/** What a view tells the component that shows it. Looked up when it happens: a state outlives the view it was in. */
export interface EditorEvents {
  /** The text or the selection changed. */
  onUpdate(update: ViewUpdate): void
  onSave(): void
  /** ⌘F (and ⌥⌘F, to replace as well). */
  onFind(replace: boolean): void
  /** Esc with nothing of the editor's own to dismiss; true when it was taken. */
  onEscape(): boolean
}

const events = new WeakMap<EditorView, EditorEvents>()
const views = new Set<EditorView>()

/** The editor with the keyboard, if one has it. */
export function focusedView(): EditorView | null {
  for (const view of views) if (view.hasFocus) return view
  return null
}

// ── Looks: Adar's tokens, so both themes work and follow a theme switch live ──────────────────────────────────────

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text-0)', backgroundColor: 'var(--bg-0)', fontSize: 'var(--ed-font-size, 12.5px)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  // Room under the last line, so it is never stuck to the bottom edge.
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0 72px' },
  '.cm-line': { padding: '0 18px 0 10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'var(--term-selection-inactive)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--term-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--ed-active-line)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-0)', color: 'var(--text-3)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 16px', minWidth: '2ch' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--ed-active-line)', color: 'var(--text-1)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--ed-same-word)' },
  '.cm-searchMatch': { backgroundColor: 'var(--term-match)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--term-match-active)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-line)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-soft)' },
  '.cm-specialChar': { color: 'var(--danger)' },
  // The search panel is Adar's own bar (FindBar.tsx); CodeMirror's stays in the page, unseen, so matches are marked.
  '.cm-panels': { display: 'none' },
  '.ed-flash': { animation: 'ed-flash 1.4s var(--ease) 1' }
})

/** The colours the diff gives each kind of token (highlight.js there, see diff.css), by CodeMirror's names. */
const colours = HighlightStyle.define([
  { tag: [t.comment, t.quote], color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: [t.keyword, t.modifier, t.self, t.operatorKeyword], color: 'var(--ref-stash)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.monospace], color: 'var(--c-added)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color], color: 'var(--c-conflict)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.propertyName, t.macroName], color: 'var(--link)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName), t.standard(t.tagName)], color: 'var(--c-modified)' },
  { tag: [t.tagName, t.attributeName, t.definition(t.propertyName), t.special(t.variableName), t.labelName], color: 'var(--c-deleted)' },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.escape, t.special(t.brace)], color: 'var(--accent)' },
  { tag: [t.operator, t.punctuation, t.separator], color: 'var(--text-1)' },
  { tag: t.heading, color: 'var(--link)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--link)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--danger)' }
])

// ── What changes while an editor lives ─────────────────────────────────────────────────────────────────────────────

const language = new Compartment()
const wrapping = new Compartment()
const writable = new Compartment()
const indentation = new Compartment()

const indentOf = (indent: Indent): Extension => [indentUnit.of(indent.tabs ? '\t' : ' '.repeat(indent.size)), EditorState.tabSize.of(indent.tabs ? indent.size : Math.max(2, indent.size))]

/** A line shown for a moment (the one a link or the diff sent the editor to). */
const flash = StateEffect.define<number | null>()
const flashed = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    marks = marks.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(flash)) continue
      marks = e.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: 'ed-flash' }).range(e.value)])
    }
    return marks
  },
  provide: (f) => EditorView.decorations.from(f)
})

const call = <K extends keyof EditorEvents>(view: EditorView, name: K): EditorEvents[K] | undefined => events.get(view)?.[name]

const keys = keymap.of([
  { key: 'Mod-s', preventDefault: true, run: (view) => (call(view, 'onSave')?.(), true) },
  { key: 'Mod-f', preventDefault: true, run: (view) => (call(view, 'onFind')?.(false), true) },
  { key: 'Mod-Alt-f', preventDefault: true, run: (view) => (call(view, 'onFind')?.(true), true) },
  { key: 'Mod-g', preventDefault: true, run: findNext },
  { key: 'Shift-Mod-g', preventDefault: true, run: findPrevious },
  { key: 'F3', run: findNext, shift: findPrevious },
  { key: 'Mod-d', preventDefault: true, run: selectNextOccurrence },
  {
    key: 'Escape',
    // Several cursors first become one (the default keys do that); then Esc is the view's.
    run: (view) => (view.state.selection.ranges.length > 1 ? false : (call(view, 'onEscape')?.() ?? false))
  }
])

/** An editor's state for a file's text. It is kept while the file is open, in or out of the page. */
export function createState(text: string, opts: { indent: Indent; readOnly: boolean; wrap: boolean }): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      keys,
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(colours),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches({ minSelectionLength: 2 }),
      search({ top: true, createPanel: () => ({ dom: document.createElement('div') }) }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      flashed,
      theme,
      language.of([]),
      wrapping.of(opts.wrap ? EditorView.lineWrapping : []),
      writable.of(EditorState.readOnly.of(opts.readOnly)),
      indentation.of(indentOf(opts.indent)),
      EditorView.contentAttributes.of({ 'aria-label': 'File text', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      EditorView.updateListener.of((update) => call(update.view, 'onUpdate')?.(update))
    ]
  })
}

/** Put a state in the page. The view tells `on` what happens in it until it is taken out with `unmount`. */
export function mount(parent: HTMLElement, state: EditorState, on: EditorEvents): EditorView {
  const view = new EditorView({ state, parent })
  events.set(view, on)
  views.add(view)
  return view
}

/** Take a view out of the page; its state is given back to be kept. */
export function unmount(view: EditorView): EditorState {
  const state = view.state
  views.delete(view)
  events.delete(view)
  view.destroy()
  return state
}

// ── Languages: colours and comment marks, by the file's name ───────────────────────────────────────────────────────

/**
 * Settings written as `KEY=value`, one a line (a .env, an .ini, an .npmrc): the name, then everything after the sign
 * as its value; `#` and `;` start a comment, `[section]` is a heading.
 */
const settings: StreamParser<{ value: boolean }> = {
  name: 'settings',
  startState: () => ({ value: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.value = false
      stream.eatSpace()
      const first = stream.peek()
      if (first === '#' || first === ';') {
        stream.skipToEnd()
        return 'comment'
      }
      if (first === '[') {
        stream.skipToEnd()
        return 'heading'
      }
      if (stream.eol()) return null
    }
    if (state.value) {
      stream.skipToEnd()
      return 'string'
    }
    if (stream.match(/^export\s+/)) return 'keyword'
    if (stream.eat(/[=:]/)) {
      state.value = true
      stream.eatSpace()
      return 'operator'
    }
    if (!stream.eatWhile(/[^=:\s]/)) stream.next()
    return 'propertyName'
  },
  languageData: { commentTokens: { line: '#' } }
}
const properties = (): Promise<Extension> => Promise.resolve(StreamLanguage.define(settings))
const shell = () => import('@codemirror/legacy-modes/mode/shell').then((m) => StreamLanguage.define(m.shell))

/** Files CodeMirror's own list does not know by name: settings written as `key=value`, and shell-like lists. */
const EXTRA: Array<{ test: RegExp; load: () => Promise<Extension> }> = [
  { test: /^\.env(?:\..+)?$|\.env$|^\.(?:npmrc|yarnrc|editorconfig|flake8|pylintrc)$|\.(?:ini|cfg|conf|properties|desktop)$/i, load: properties },
  { test: /^\.(?:gitignore|gitattributes|dockerignore|npmignore|eslintignore|prettierignore|zshrc|zprofile|zshenv|bashrc|bash_profile|profile)$|^(?:Brewfile|Procfile)$/i, load: shell }
]
/** Names CodeMirror knows under another extension. */
const AS: Array<[RegExp, string]> = [
  [/\.(?:jsonc|json5|webmanifest|code-workspace)$|^\.(?:babelrc|eslintrc|prettierrc)$|\.lock$/i, 'x.json'],
  [/\.(?:astro|svelte)$/i, 'x.html'],
  [/\.mdx$/i, 'x.md'],
  [/\.(?:mjs|cjs)$/i, 'x.js'],
  [/\.(?:mts|cts)$/i, 'x.ts'],
  [/\.plist$|\.(?:csproj|xaml|storyboard|xib)$/i, 'x.xml']
]

/** What colours a file, by its name: null when Adar knows none for it (it is then plain text). */
export async function languageOf(name: string): Promise<Extension | null> {
  for (const extra of EXTRA) if (extra.test.test(name)) return extra.load().catch(() => null)
  let as = name
  for (const [test, to] of AS) if (test.test(name)) as = to
  const found = LanguageDescription.matchFilename(languages, as)
  if (!found) return null
  return found.load().catch(() => null)
}

/** Colour the state's text as `name`'s language, once it is loaded. Returns the state that has it. */
export function withLanguage(state: EditorState, support: Extension): EditorState {
  return state.update({ effects: language.reconfigure(support) }).state
}

export const setLanguage = (view: EditorView, support: Extension): void => view.dispatch({ effects: language.reconfigure(support) })
export const setWrap = (view: EditorView, wrap: boolean): void => view.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })

// ── What the rest of Adar asks of an editor ────────────────────────────────────────────────────────────────────────

/** Where a line (from 1) and a column (from 1) are in the text, inside it whatever is asked. */
function offsetOf(state: EditorState, line: number, column?: number): number {
  const at = state.doc.line(Math.max(1, Math.min(state.doc.lines, Math.round(line))))
  return Math.min(at.to, at.from + Math.max(0, Math.round(column ?? 1) - 1))
}

/** Go to a line: the cursor there, the line in the middle of the view and shown for a moment. */
export function goTo(view: EditorView, line: number, column?: number): void {
  const pos = offsetOf(view.state, line, column)
  const start = view.state.doc.lineAt(pos).from
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: [EditorView.scrollIntoView(pos, { y: 'center' }), flash.of(start)]
  })
  window.setTimeout(() => {
    if (views.has(view)) view.dispatch({ effects: flash.of(null) })
  }, 1500)
}

/** The same in a state that is not in the page yet (the view scrolls to its cursor when it is put there). */
export function withCursor(state: EditorState, line: number, column?: number): EditorState {
  return state.update({ selection: EditorSelection.cursor(offsetOf(state, line, column)) }).state
}

/**
 * Replace the text with what is on disk now, changing only what differs, so the cursor and the view stay where they
 * were. It is not a step of the undo history: undoing must not bring back text the file no longer has.
 */
export function replaceText(state: EditorState, from: string): Transaction {
  // The editor holds every line ending as "\n".
  const text = from.replace(/\r\n?/g, '\n')
  const old = state.doc.toString()
  let start = 0
  const max = Math.min(old.length, text.length)
  while (start < max && old.charCodeAt(start) === text.charCodeAt(start)) start++
  let end = 0
  while (end < max - start && old.charCodeAt(old.length - 1 - end) === text.charCodeAt(text.length - 1 - end)) end++
  return state.update({
    changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
    annotations: Transaction.addToHistory.of(false)
  })
}

export const setReadOnly = (view: EditorView, readOnly: boolean): void => view.dispatch({ effects: writable.reconfigure(EditorState.readOnly.of(readOnly)) })

// ── Find and replace: Adar's bar drives CodeMirror's search ────────────────────────────────────────────────────────

const queryOf = (o: FindOptions): SearchQuery =>
  new SearchQuery({ search: o.text, caseSensitive: o.matchCase, regexp: o.regexp, wholeWord: o.wholeWord, replace: o.replace, literal: !o.regexp })

/** Mark what `options` finds (nothing when the text is empty). False when it is a regular expression that is not one. */
export function find(view: EditorView, options: FindOptions): boolean {
  const query = queryOf(options)
  openSearchPanel(view)
  view.dispatch({ effects: setSearchQuery.of(query) })
  return !options.text || query.valid
}

export function stopFinding(view: EditorView): void {
  closeSearchPanel(view)
}

export const findStep = (view: EditorView, dir: 1 | -1): boolean => (dir > 0 ? findNext(view) : findPrevious(view))
export const replaceOne = (view: EditorView): boolean => replaceNext(view)
export const replaceEvery = (view: EditorView): boolean => replaceAll(view)

/** How many places `options` finds, and which of them the selection is on (0 when on none). Counting stops at `limit`. */
export function countMatches(state: EditorState, options: FindOptions, limit = 9999): { total: number; current: number; more: boolean } {
  const query = queryOf(options)
  if (!options.text || !query.valid) return { total: 0, current: 0, more: false }
  const { from, to } = state.selection.main
  let total = 0
  let current = 0
  const see = (a: number, b: number): boolean => {
    total++
    if (a === from && b === to) current = total
    return total < limit
  }
  try {
    if (options.regexp) {
      const cursor = new RegExpCursor(state.doc, options.text, { ignoreCase: !options.matchCase })
      while (!cursor.next().done) if (cursor.value.to > cursor.value.from && !see(cursor.value.from, cursor.value.to)) return { total, current, more: true }
    } else {
      const fold = options.matchCase ? undefined : (s: string) => s.toLowerCase()
      const cursor = new SearchCursor(state.doc, options.text, 0, state.doc.length, fold)
      while (!cursor.next().done) {
        if (options.wholeWord && !wholeWord(state, cursor.value.from, cursor.value.to)) continue
        if (!see(cursor.value.from, cursor.value.to)) return { total, current, more: true }
      }
    }
  } catch {
    return { total: 0, current: 0, more: false }
  }
  return { total, current, more: false }
}

function wholeWord(state: EditorState, from: number, to: number): boolean {
  const word = /[\p{L}\p{N}_]/u
  const before = from > 0 ? state.doc.sliceString(from - 1, from) : ''
  const after = to < state.doc.length ? state.doc.sliceString(to, to + 1) : ''
  return !(before && word.test(before)) && !(after && word.test(after))
}

/** Open the find bar of the view's editor, as ⌘F there does. */
export const askFind = (view: EditorView, replace: boolean): void => void call(view, 'onFind')?.(replace)

/** The selected text when it is short and on one line: what the find bar starts with. */
export function selectedWord(state: EditorState): string {
  const { from, to } = state.selection.main
  if (from === to || to - from > 200) return ''
  const text = state.doc.sliceString(from, to)
  return text.includes('\n') ? '' : text
}

export { indentLess, indentMore, redo, selectNextOccurrence, undo }
export type { EditorState, EditorView, ViewUpdate }
