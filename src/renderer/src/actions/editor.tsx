// Editing files in Adar: which view a file opens in, and what is asked before text that was not saved is left.
//
//  - A file of a repository that is open in a tab is edited in that tab's Files view (the tree on the left, the
//    changes panel on the right). One file at a time: going to another one settles the first.
//  - Any other file (opened with Adar from the Finder, a path in a terminal outside the repository) is edited in a
//    sheet over the window, as Markdown documents are read.
// Leaving the Files view keeps its text, saved or not: it is there when the view is opened again. Closing the tab,
// the sheet or Adar asks first.

import { api } from '@renderer/api/client'
import { choose } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { closeDoc, closeRepoDocs, keepMine, openDoc, saveDoc, unsavedDocs, useEditor } from '@renderer/components/editor/editorStore'
import { forgetFiles } from '@renderer/components/editor/fileList'
import { closeMarkdown, openMarkdown } from '@renderer/components/markdown/markdownStore'
import { focusTerminal, onTerminalFile } from '@renderer/components/terminal/terminalStore'
import { addCloseGuard, getActiveTab, useApp, type CenterView } from '@renderer/store/appStore'
import { baseName, type FilePosition, type PathKind } from '@shared/files'
import { isMarkdownPath } from '@shared/markdown'
import { absPath, openRepoAt } from './git'
import { viewOf } from './terminal'

const slashes = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** The open tab whose repository holds a file, and the file's path in it; null when none does. */
export function tabOf(file: string): { repo: string; rel: string } | null {
  const target = slashes(file)
  let best: { repo: string; rel: string; depth: number } | null = null
  for (const tab of useApp.getState().tabs) {
    const root = slashes(tab.path)
    if (!target.startsWith(`${root}/`)) continue
    // A worktree inside another repository's folder: the deepest one is the file's.
    if (!best || root.length > best.depth) best = { repo: tab.path, rel: target.slice(root.length + 1), depth: root.length }
  }
  return best ? { repo: best.repo, rel: best.rel } : null
}

/** A file's path inside its repository, from its full path. */
export function relOf(repo: string, key: string): string {
  const root = slashes(repo)
  const target = slashes(key)
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : target
}

/**
 * Settle the text of a file before it is left for good: nothing to do when it was saved; otherwise the user saves it,
 * gives it up or stays. False when they stay (or the save failed).
 */
export async function settle(key: string): Promise<boolean> {
  const doc = useEditor.getState().docs[key]
  if (!doc || !doc.dirty) return true
  const answer = await choose<'save' | 'discard'>({
    title: `Save the changes to ${doc.name}?`,
    message: doc.disk
      ? 'The file also changed on disk while you were editing it: saving writes your text over it.'
      : 'They are only in Adar until you save them.',
    options: [
      { value: 'save', label: 'Save' },
      { value: 'discard', label: 'Do not save', description: 'Your changes to this file are lost.', danger: true }
    ],
    cancelLabel: 'Keep editing'
  })
  if (answer === null) return false
  if (answer === 'discard') return true
  if (doc.disk) await keepMine(key)
  return saveDoc(key)
}

/** The file a repository's Files view is on, or was on when it was last shown. */
function fileOf(repo: string): string | undefined {
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  if (tab?.center.kind === 'files' && tab.center.path) return absPath(repo, tab.center.path)
  return useEditor.getState().last[repo]
}

/** The view to go back to from the Files view: where it was opened from, unless that was the graph. */
function backOf(center: CenterView): CenterView | undefined {
  if (center.kind === 'files') return center.back
  return center.kind === 'graph' ? undefined : center
}

function showFilesView(repo: string, rel: string | undefined): void {
  const s = useApp.getState()
  const tab = s.tabs.find((t) => t.path === repo)
  if (!tab) return
  // Opened from the terminal alone: the terminal stays, under the file.
  const terminalOnly = viewOf(repo) === 'terminal'
  s.setCenter(repo, { kind: 'files', ...(rel ? { path: rel } : {}), ...(backOf(tab.center) ? { back: backOf(tab.center) } : {}) })
  // Set as the setting it is, not through `setTerminalView`: that would hand the keyboard back to the terminal.
  if (terminalOnly) void s.updateSettings({ terminalViews: { ...useApp.getState().settings.terminalViews, [repo]: 'both' } })
  if (s.activePath !== repo || s.groupView) s.setActive(repo)
}

/**
 * Edit a file of an open repository in its tab's Files view, at a line when one is named. False when the user chose to
 * stay on a file with changes that were not saved.
 */
export async function editFile(repo: string, rel: string, at?: FilePosition): Promise<boolean> {
  if (!useApp.getState().tabs.some((t) => t.path === repo)) return false
  const key = absPath(repo, rel)
  const showing = fileOf(repo)
  if (showing && showing !== key) {
    if (!(await settle(showing))) return false
    // Given up, or saved and left: its text is not kept (a file it is opened again from disk).
    if (useEditor.getState().docs[showing]?.dirty) closeDoc(showing)
  }
  useEditor.setState((s) => ({ last: { ...s.last, [repo]: key } }))
  showFilesView(repo, rel)
  await openDoc(key, repo, at)
  trim(repo, key)
  return true
}

/** Files kept open without changes, so going back to one finds it where it was: only the last few. */
function trim(repo: string, current: string): void {
  const kept = Object.values(useEditor.getState().docs).filter((d) => d.repo === repo && !d.dirty && d.key !== current)
  for (const doc of kept.slice(0, Math.max(0, kept.length - 8))) closeDoc(doc.key)
}

/** Show a repository's Files view, on the file it was last on. */
export function showFiles(repo: string): void {
  const last = useEditor.getState().last[repo]
  showFilesView(repo, last ? relOf(repo, last) : undefined)
  if (last) void openDoc(last, repo)
}

/** Leave the Files view for where it was opened from. Its text stays, saved or not. */
export function closeFiles(repo: string): void {
  const s = useApp.getState()
  const tab = s.tabs.find((t) => t.path === repo)
  if (tab?.center.kind !== 'files') return
  s.setCenter(repo, tab.center.back ?? { kind: 'graph' })
}

export function toggleFiles(repo: string): void {
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  if (tab?.center.kind === 'files') closeFiles(repo)
  else showFiles(repo)
}

/**
 * Open any file to edit, by its full path: in its repository's tab when that is open, else in the sheet over the
 * window. `terminal` is the terminal it was opened from, which gets the keyboard back when the sheet closes.
 */
export async function openFile(path: string, at?: FilePosition, opts?: { terminal?: string }): Promise<boolean> {
  const inTab = tabOf(path)
  if (inTab) return editFile(inTab.repo, inTab.rel, at)
  const sheet = useEditor.getState().sheet
  if (sheet && sheet.key !== path) {
    if (!(await settle(sheet.key))) return false
    closeDoc(sheet.key)
  }
  useEditor.setState({ sheet: { key: path, ...(opts?.terminal ? { terminal: opts.terminal } : {}) } })
  await openDoc(path, null, at)
  return true
}

/** Close the sheet. False when the user chose to stay on text that was not saved. */
export async function closeSheet(): Promise<boolean> {
  const sheet = useEditor.getState().sheet
  if (!sheet) return true
  if (!(await settle(sheet.key))) return false
  closeDoc(sheet.key)
  useEditor.setState({ sheet: null })
  if (sheet.terminal) focusTerminal(sheet.terminal)
  return true
}

/** One line for each file with text that was not saved: what quitting or restarting Adar would lose. */
export function unsavedFileLines(): string[] {
  const docs = unsavedDocs()
  if (!docs.length) return []
  const names = docs.map((d) => d.name)
  return [names.length === 1 ? `Unsaved changes to ${names[0]}` : `Unsaved changes to ${names.length} files (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})`]
}

// A tab that closes takes its files with it, and asks first about text that was not saved.
addCloseGuard(async (repo) => {
  for (const doc of unsavedDocs(repo)) {
    if (!(await settle(doc.key))) return false
  }
  closeRepoDocs(repo)
  forgetFiles(repo)
  return true
})

/**
 * Open what Adar was handed from outside (the Finder, `adar <path>`, a launch argument, File → Open File…): a folder
 * as a repository's tab, a Markdown document's preview, any other file to edit.
 */
export async function openPath(path: string): Promise<void> {
  if (isMarkdownPath(path)) return openMarkdown(path)
  const kind = await api.pathKind(path).catch((): PathKind => 'folder')
  if (kind === 'markdown') return openMarkdown(path)
  if (kind === 'file') return void (await openFile(path))
  // A folder, or nothing at all: opening it as a repository is what says so.
  await openRepoAt(path)
}

/** File → Open File…: pick any file and open it in Adar. */
export async function openFileDialog(): Promise<void> {
  const tab = getActiveTab()
  const picked = await api.pickFile(tab ? { defaultPath: tab.path } : undefined)
  if (picked) await openPath(picked)
}

/** Edit the document a Markdown preview shows: the preview gives way to the editor. */
export async function editMarkdown(path: string): Promise<void> {
  closeMarkdown()
  await openFile(path)
}

/** Edit, from its diff, the file as it is in the working tree now, at a line of the diff. */
export async function editFromDiff(repo: string, rel: string, line?: number): Promise<void> {
  const kind = await api.pathKind(absPath(repo, rel)).catch((): PathKind => 'file')
  if (kind === 'missing' || kind === 'folder') return void toast.error(`${baseName(rel)} is not in the working tree any more`)
  await editFile(repo, rel, line ? { line } : undefined)
}

// ⌘-click on the path of a file of text or code in a terminal: it is opened to edit, when it is there.
onTerminalFile((path, at, terminal) => {
  void api
    .pathKind(path)
    .catch((): PathKind => 'file')
    .then((kind) => {
      if (kind === 'missing' || kind === 'folder') return void toast.error(`There is no file at ${path}`)
      return openFile(path, at, { terminal })
    })
})
