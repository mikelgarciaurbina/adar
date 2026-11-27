// The files open to edit: one per repository's Files view, and one in the sheet over the window (a file that is in
// no open repository). For each, what the page shows of it (`EditorDoc`, in the store) and the editor itself (its
// CodeMirror state, kept here while the file is open whether or not it is on screen, so leaving the view loses
// neither the text typed nor its undo history).
//
// Text that was not saved lives in memory only: never in localStorage, never in a log. A .env is a file like another.

import { create } from 'zustand'
import { api } from '@renderer/api/client'
import { toast } from '@renderer/components/common/toast'
import { detectEol, restoreLineEndings } from '@renderer/components/conflicts/conflictParser'
import { useApp } from '@renderer/store/appStore'
import { AdarError, describeError } from '@shared/errors'
import { baseName, contentOf, hasLoneCarriageReturn, type FilePosition, type TextFile } from '@shared/files'
import type { EditorEvents, EditorState, EditorView } from './cm'
import { detectIndent, type Indent } from './model'

type CodeMirror = typeof import('./cm')

let codeMirror: CodeMirror | null = null
let loading: Promise<CodeMirror> | null = null

/** CodeMirror, loaded the first time a file is opened to edit. */
export function loadCodeMirror(): Promise<CodeMirror> {
  loading ??= import('./cm').then((m) => (codeMirror = m))
  return loading
}

/** CodeMirror when it is there already. */
export const loadedCodeMirror = (): CodeMirror | null => codeMirror

export interface EditorDoc {
  /** The file's full path, as it was asked for: what names it here. */
  key: string
  /** The repository whose Files view edits it; null for a file on its own, in the sheet. */
  repo: string | null
  name: string
  phase: 'loading' | 'ready' | 'failed'
  /** Why it could not be opened. */
  error?: string
  /** It could not be opened because there is no such file. */
  missing?: boolean
  /** The file itself, behind any link among its folders. */
  real?: string
  /** The version on disk the text started from, or was last saved as. */
  version?: string
  bom: boolean
  eol: '\n' | '\r\n'
  /** The text as it was on disk, kept only for a file with Windows line endings: a save gives each line its own back. */
  original?: string
  indent: Indent
  /** Why the text can be read here but not changed. */
  readOnly?: string
  dirty: boolean
  saving: boolean
  /** The file on disk is no longer what the text started from, and the text has changes of its own. */
  disk?: 'changed' | 'gone'
  /** When the text was last replaced with what something else wrote (told for a moment). */
  updated?: number
  /** The language its colours are for ('' while none is known). */
  language: string
}

interface Session {
  /** The editor's state while the file is not on screen (and what a view starts from). */
  state: EditorState | null
  view: EditorView | null
  /** The text on disk, as the editor holds it: what "changed" is measured against. */
  saved: EditorState['doc'] | null
  scroll: { top: number; left: number } | null
  /** Where to go when the view is in the page (a link named a line). */
  pending: FilePosition | null
}

const sessions = new Map<string, Session>()
const sessionOf = (key: string): Session => {
  let s = sessions.get(key)
  if (!s) sessions.set(key, (s = { state: null, view: null, saved: null, scroll: null, pending: null }))
  return s
}

interface EditorStore {
  docs: Record<string, EditorDoc>
  /** The file in the sheet over the window, and the terminal that opened it (the keyboard goes back there). */
  sheet: { key: string; terminal?: string } | null
  /** The file each repository's Files view was last on. */
  last: Record<string, string>
  /** Lines wrap instead of scrolling sideways. */
  wrap: boolean
}

const WRAP_KEY = 'adar.editor.wrap'
const readWrap = (): boolean => {
  try {
    return localStorage.getItem(WRAP_KEY) === '1'
  } catch {
    return false
  }
}

export const useEditor = create<EditorStore>(() => ({ docs: {}, sheet: null, last: {}, wrap: readWrap() }))

const get = (key: string): EditorDoc | undefined => useEditor.getState().docs[key]
function patch(key: string, change: Partial<EditorDoc>): void {
  useEditor.setState((s) => (s.docs[key] ? { docs: { ...s.docs, [key]: { ...s.docs[key], ...change } } } : s))
}

/** The text of a state with the file's own line endings and byte order mark: what is written. */
function textToSave(doc: EditorDoc, state: EditorState): string {
  let text = state.doc.toString()
  if (doc.original !== undefined) text = restoreLineEndings(text, doc.original, doc.eol)
  return doc.bom ? `﻿${text}` : text
}

/** What a file read from disk says of a document. */
function diskFacts(file: TextFile): Pick<EditorDoc, 'real' | 'version' | 'bom' | 'eol' | 'original'> {
  const crlf = file.text.includes('\r\n')
  return { real: file.real, version: file.version, bom: file.bom, eol: detectEol(file.text), original: crlf ? file.text : undefined }
}

const failure = (err: unknown): Pick<EditorDoc, 'phase' | 'error' | 'missing'> => ({
  phase: 'failed',
  error: describeError(err),
  missing: err instanceof AdarError && err.code === 'NOT_FOUND'
})

/**
 * Open a file to edit: read it, and CodeMirror with it the first time. A file that is open already keeps its text
 * (changes and all) and is only looked at again on disk. `at` is where to go in it.
 */
export async function openDoc(key: string, repo: string | null, at?: FilePosition): Promise<void> {
  const session = sessionOf(key)
  const known = get(key)
  if (known && known.phase !== 'failed') {
    if (at?.line) goTo(key, at)
    if (known.phase === 'ready') void checkDisk(key)
    return
  }
  if (at?.line) session.pending = at
  const name = baseName(key)
  useEditor.setState((s) => ({
    docs: { ...s.docs, [key]: { key, repo, name, phase: 'loading', bom: false, eol: '\n', indent: { tabs: false, size: 2 }, dirty: false, saving: false, language: '' } }
  }))
  try {
    const [cm, file] = await Promise.all([loadCodeMirror(), api.readTextFile(key, repo ? { root: repo } : undefined)])
    // Closed, or opened anew, while it was read.
    if (get(key)?.phase !== 'loading' || sessions.get(key) !== session) return
    if (!file) throw new Error(`${name} could not be read`)
    const indent = detectIndent(file.text)
    const readOnly = hasLoneCarriageReturn(file.text) ? 'It has line endings of the old Mac kind (a lone CR), which Adar would not keep. Edit it in your editor.' : undefined
    const state = cm.createState(file.text, { indent, readOnly: !!readOnly, wrap: useEditor.getState().wrap })
    session.state = state
    session.saved = state.doc
    patch(key, { phase: 'ready', ...diskFacts(file), indent, readOnly })
    void cm.languageOf(name).then((support) => {
      if (!support || sessions.get(key) !== session) return
      if (session.view) cm.setLanguage(session.view, support)
      else if (session.state) session.state = cm.withLanguage(session.state, support)
      patch(key, { language: languageName(name) })
    })
  } catch (err) {
    if (sessions.get(key) === session) patch(key, failure(err))
  }
}

/** What the status line calls a file's kind: its extension, as written. */
function languageName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : name.startsWith('.') ? name.slice(1).toLowerCase() : ''
}

/** Go to a line of an open file, now or when its view is in the page. */
export function goTo(key: string, at: FilePosition): void {
  const session = sessions.get(key)
  if (!session || !at.line) return
  const cm = codeMirror
  if (session.view && cm) {
    cm.goTo(session.view, at.line, at.column)
    session.view.focus()
  } else {
    session.pending = at
  }
}

/** Put an open file's editor in the page. Null until the file and CodeMirror are there. */
export function attach(key: string, parent: HTMLElement, on: Pick<EditorEvents, 'onFind' | 'onEscape'> & { onCursor(state: EditorState): void }): EditorView | null {
  const cm = codeMirror
  const session = sessions.get(key)
  if (!cm || !session?.state || session.view) return null
  const view = cm.mount(parent, session.state, {
    onUpdate(update) {
      if (update.docChanged) {
        const dirty = !!session.saved && !update.state.doc.eq(session.saved)
        if (get(key)?.dirty !== dirty) patch(key, { dirty })
      }
      if (update.docChanged || update.selectionSet) on.onCursor(update.state)
    },
    onSave: () => void saveDoc(key),
    onFind: on.onFind,
    onEscape: on.onEscape
  })
  session.view = view
  if (session.pending?.line) {
    // Asked for before the view was there: the line in the middle, shown for a moment.
    cm.goTo(view, session.pending.line, session.pending.column)
    session.pending = null
  } else if (session.scroll) {
    const { top, left } = session.scroll
    view.scrollDOM.scrollTop = top
    view.scrollDOM.scrollLeft = left
    // The view measures its content after it is put in the page: set it again once it has.
    requestAnimationFrame(() => {
      if (session.view !== view) return
      view.scrollDOM.scrollTop = top
      view.scrollDOM.scrollLeft = left
    })
  }
  on.onCursor(view.state)
  return view
}

/** Take a file's editor out of the page, keeping its state and where it was scrolled. */
export function detach(key: string): void {
  const session = sessions.get(key)
  const cm = codeMirror
  if (!session?.view || !cm) return
  session.scroll = { top: session.view.scrollDOM.scrollTop, left: session.view.scrollDOM.scrollLeft }
  session.state = cm.unmount(session.view)
  session.view = null
}

/** The view of a file, while it is in the page. */
export const viewOf = (key: string): EditorView | null => sessions.get(key)?.view ?? null

const stateOf = (key: string): EditorState | null => {
  const s = sessions.get(key)
  return s?.view?.state ?? s?.state ?? null
}

/** Replace a file's text with what is on disk: the text has no changes of its own any more. */
function takeDisk(key: string, file: TextFile, told: boolean): void {
  const session = sessions.get(key)
  const cm = codeMirror
  const state = stateOf(key)
  if (!session || !cm || !state) return
  const tr = cm.replaceText(state, file.text)
  if (session.view) session.view.dispatch(tr)
  else session.state = tr.state
  session.saved = tr.state.doc
  patch(key, { ...diskFacts(file), dirty: false, disk: undefined, updated: told ? Date.now() : undefined })
}

const checking = new Set<string>()

/**
 * Look at an open file on disk. Text without changes follows what something else wrote; text with changes of its own
 * is kept, and the document says the file changed (or is gone) under it.
 */
export async function checkDisk(key: string): Promise<void> {
  const doc = get(key)
  if (!doc || doc.phase !== 'ready' || doc.saving || checking.has(key)) return
  checking.add(key)
  try {
    const file = await api.readTextFile(key, { ...(doc.repo ? { root: doc.repo } : {}), unless: doc.version })
    const now = get(key)
    if (!file || !now || now.phase !== 'ready' || now.saving || now.version !== doc.version) return
    // The same text as here (it was only touched, or put back as it was): nothing to tell.
    if (contentOf(file.version) === contentOf(now.version)) return patch(key, { version: file.version, disk: undefined })
    if (!now.dirty) takeDisk(key, file, true)
    else if (now.disk !== 'changed') patch(key, { disk: 'changed' })
  } catch (err) {
    const now = get(key)
    if (!now || now.phase !== 'ready') return
    // No version: the file was known to be gone, and the user keeps the text to put it back.
    if (err instanceof AdarError && err.code === 'NOT_FOUND' && now.version !== undefined && now.disk !== 'gone') patch(key, { disk: 'gone' })
    // Anything else (it became a folder, it cannot be read just now): the text stays as it is; a save will say.
  } finally {
    checking.delete(key)
  }
}

/** Give up the changes and take the file as it is on disk. */
export async function reloadDoc(key: string): Promise<void> {
  const doc = get(key)
  if (!doc) return
  try {
    const file = await api.readTextFile(key, doc.repo ? { root: doc.repo } : undefined)
    if (file && get(key)) takeDisk(key, file, false)
  } catch (err) {
    toast.error(describeError(err))
  }
}

/**
 * Keep the text as it is here, whatever the file became. The next save writes over what is on disk now (and is
 * refused again only if the file changes once more), or puts back a file that is gone.
 */
export async function keepMine(key: string): Promise<void> {
  const doc = get(key)
  if (!doc?.disk) return
  if (doc.disk === 'gone') return patch(key, { disk: undefined, version: undefined })
  try {
    const file = await api.readTextFile(key, doc.repo ? { root: doc.repo } : undefined)
    if (file && get(key)) patch(key, { ...diskFacts(file), disk: undefined, dirty: true })
  } catch (err) {
    if (err instanceof AdarError && err.code === 'NOT_FOUND') patch(key, { disk: undefined, version: undefined })
    else toast.error(describeError(err))
  }
}

/**
 * Save a file. True when it is on disk as the editor has it. A file that changed under the text is not written over:
 * the document says so and the user chooses (`keepMine` or `reloadDoc`).
 */
export async function saveDoc(key: string): Promise<boolean> {
  const doc = get(key)
  const session = sessions.get(key)
  const state = stateOf(key)
  if (!doc || !session || !state || doc.phase !== 'ready' || doc.saving) return false
  if (doc.readOnly) return false
  if (doc.disk) return false
  if (!doc.dirty && doc.version !== undefined) return true
  const text = textToSave(doc, state)
  patch(key, { saving: true })
  try {
    // No version: the file is gone and the user keeps the text, so there must still be none there.
    const saved = await api.saveTextFile(key, { text, expected: doc.version ?? null, ...(doc.repo ? { root: doc.repo } : {}) })
    if (!get(key)) return true
    session.saved = state.doc
    const body = doc.bom ? text.slice(1) : text
    const now = stateOf(key)
    patch(key, {
      saving: false,
      version: saved.version,
      original: body.includes('\r\n') ? body : undefined,
      eol: detectEol(body),
      // Typed on while it was being written.
      dirty: !!now && !now.doc.eq(state.doc),
      disk: undefined
    })
    if (doc.repo) void useApp.getState().refresh(doc.repo, ['status'])
    return true
  } catch (err) {
    patch(key, { saving: false })
    if (err instanceof AdarError && err.code === 'CONFLICT') {
      patch(key, { disk: /no longer there/.test(err.message) ? 'gone' : 'changed' })
    } else {
      toast.error(describeError(err))
    }
    return false
  }
}

/** Forget a file: its text, its changes and its undo history. */
export function closeDoc(key: string): void {
  detach(key)
  sessions.delete(key)
  useEditor.setState((s) => {
    if (!s.docs[key]) return s
    const { [key]: _closed, ...docs } = s.docs
    const last = Object.fromEntries(Object.entries(s.last).filter(([, k]) => k !== key))
    return { docs, last, sheet: s.sheet?.key === key ? null : s.sheet }
  })
}

/** The files with text that was not saved (of one repository, or of all). */
export function unsavedDocs(repo?: string): EditorDoc[] {
  return Object.values(useEditor.getState().docs).filter((d) => d.dirty && (repo === undefined || d.repo === repo))
}

/** Forget every file of a repository (its tab was closed). */
export function closeRepoDocs(repo: string): void {
  for (const doc of Object.values(useEditor.getState().docs)) if (doc.repo === repo) closeDoc(doc.key)
}

export function setWrap(wrap: boolean): void {
  useEditor.setState({ wrap })
  try {
    localStorage.setItem(WRAP_KEY, wrap ? '1' : '0')
  } catch {
    // A convenience only.
  }
  const cm = codeMirror
  if (!cm) return
  for (const session of sessions.values()) if (session.view) cm.setWrap(session.view, wrap)
}

/** Whether an editor has the keyboard: some keys then mean the editor's own (see commands.ts). */
export function editorHasKeyboard(): boolean {
  return !!codeMirror?.focusedView()
}

/**
 * What a key of the git side means while an editor has the keyboard (macOS's menu may take it first): find in the
 * file, the next occurrence of the selection, indent. False when no editor has the keyboard.
 */
export function editorKey(what: 'find' | 'next-occurrence' | 'indent' | 'outdent'): boolean {
  const cm = codeMirror
  const view = cm?.focusedView()
  if (!cm || !view) return false
  if (what === 'find') cm.askFind(view, false)
  else if (what === 'next-occurrence') cm.selectNextOccurrence(view)
  else if (what === 'indent') cm.indentMore(view)
  else cm.indentLess(view)
  return true
}

/** For scripted runs: the text of an open file as the editor has it. */
export const textOf = (key: string): string | null => stateOf(key)?.doc.toString() ?? null
