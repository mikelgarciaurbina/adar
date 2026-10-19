// Context menus of the right panel file lists.

import {
  ArchiveRestore,
  Ban,
  CircleCheck,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FileDiff,
  FolderOpen,
  Minus,
  Plus,
  RotateCcwClock,
  ScanText,
  TriangleAlert,
  Undo2
} from 'lucide-react'
import * as actions from '@renderer/actions/git'
import type { MenuItem } from '@renderer/components/common/ContextMenu'
import { markResolvedAndAdvance } from '@renderer/components/conflicts/resolveFlow'
import type { DiffTarget, FileChange } from '@shared/types'
import { escapeGitignore, ignoreOptions } from './ignore'

const ICON = 14

/** Menu for files of a commit / stash / comparison. `rev` is the revision used for blame. */
export function readOnlyFileMenu(
  repo: string,
  file: FileChange,
  target: DiffTarget,
  siblings: DiffTarget[],
  rev: string | undefined
): MenuItem[] {
  return [
    { label: 'Open diff', icon: <FileDiff size={ICON} />, onClick: () => actions.openDiff(repo, target, siblings) },
    { type: 'separator' },
    { label: 'File history', icon: <RotateCcwClock size={ICON} />, onClick: () => actions.openFileHistory(repo, file.path) },
    { label: 'Blame', icon: <ScanText size={ICON} />, onClick: () => actions.openBlame(repo, file.path, rev) },
    { type: 'separator' },
    { label: 'Open file', icon: <ExternalLink size={ICON} />, onClick: () => actions.openInEditor(actions.absPath(repo, file.path)) },
    { label: 'Show in folder', icon: <FolderOpen size={ICON} />, onClick: () => actions.showInFolder(actions.absPath(repo, file.path)) },
    { type: 'separator' },
    { label: 'Copy path', icon: <Copy size={ICON} />, onClick: () => actions.copyText(file.path, 'Path copied') },
    {
      label: 'Copy full path',
      icon: <ClipboardCopy size={ICON} />,
      onClick: () => actions.copyText(actions.absPath(repo, file.path), 'Full path copied')
    }
  ]
}

export interface WipMenuContext {
  repo: string
  /** Section the file belongs to. */
  kind: 'unstaged' | 'staged'
  /** The right-clicked file. */
  file: FileChange
  /** Paths the bulk actions apply to (selection containing the file, or just the file). */
  paths: string[]
  openDiff: () => void
  stage: (paths: string[]) => void
  unstage: (paths: string[]) => void
}

function countLabel(n: number, one: string, many: string): string {
  return n === 1 ? one : many.replace('{n}', String(n))
}

/** Menu for a file of the staging area. */
export function wipFileMenu(ctx: WipMenuContext): MenuItem[] {
  const { repo, kind, file, paths } = ctx
  const n = paths.length
  const single = n === 1
  const tracked = file.status !== 'untracked' && file.status !== 'added'
  const items: MenuItem[] = [{ label: 'Open diff', icon: <FileDiff size={ICON} />, onClick: ctx.openDiff }, { type: 'separator' }]

  if (kind === 'unstaged') {
    items.push(
      { label: countLabel(n, 'Stage file', 'Stage {n} files'), icon: <Plus size={ICON} />, onClick: () => ctx.stage(paths) },
      {
        label: countLabel(n, 'Discard changes…', 'Discard changes to {n} files…'),
        icon: <Undo2 size={ICON} />,
        danger: true,
        onClick: () => actions.discardFiles(repo, paths)
      }
    )
  } else {
    items.push({ label: countLabel(n, 'Unstage file', 'Unstage {n} files'), icon: <Minus size={ICON} />, onClick: () => ctx.unstage(paths) })
  }
  items.push({
    label: countLabel(n, 'Stash this file', 'Stash {n} files'),
    icon: <ArchiveRestore size={ICON} />,
    onClick: () => actions.stash(repo, { paths, message: single ? `Stash of ${file.path}` : undefined })
  })

  if (kind === 'unstaged' && single) {
    const opts = ignoreOptions(file.path)
    if (opts.length) {
      items.push({ type: 'separator' }, {
        label: 'Ignore',
        icon: <Ban size={ICON} />,
        submenu: opts.map((o) => ({ label: o.label, onClick: () => actions.ignorePath(repo, o.pattern) }))
      })
    }
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Open file',
      icon: <ExternalLink size={ICON} />,
      disabled: file.status === 'deleted',
      onClick: () => actions.openInEditor(actions.absPath(repo, file.path))
    },
    { label: 'Show in folder', icon: <FolderOpen size={ICON} />, onClick: () => actions.showInFolder(actions.absPath(repo, file.path)) },
    { type: 'separator' },
    { label: 'File history', icon: <RotateCcwClock size={ICON} />, disabled: !tracked, onClick: () => actions.openFileHistory(repo, file.path) },
    { label: 'Blame', icon: <ScanText size={ICON} />, disabled: !tracked || file.status === 'deleted', onClick: () => actions.openBlame(repo, file.path) },
    { type: 'separator' },
    { label: 'Copy path', icon: <Copy size={ICON} />, onClick: () => actions.copyText(single ? file.path : paths.join('\n'), single ? 'Path copied' : 'Paths copied') },
    {
      label: 'Copy full path',
      icon: <ClipboardCopy size={ICON} />,
      onClick: () =>
        actions.copyText(single ? actions.absPath(repo, file.path) : paths.map((p) => actions.absPath(repo, p)).join('\n'), single ? 'Full path copied' : 'Full paths copied')
    }
  )
  return items
}

/** Menu for a folder row of the staging area tree view. */
export function wipDirMenu(opts: {
  repo: string
  kind: 'unstaged' | 'staged'
  dir: string
  paths: string[]
  stage: (paths: string[]) => void
  unstage: (paths: string[]) => void
}): MenuItem[] {
  const { repo, kind, dir, paths } = opts
  // No header row: menu headers are upper-cased, which misrepresents case-sensitive paths.
  const items: MenuItem[] = []
  if (kind === 'unstaged') {
    items.push(
      { label: `Stage folder (${paths.length})`, icon: <Plus size={ICON} />, onClick: () => opts.stage(paths) },
      { label: 'Discard folder changes…', icon: <Undo2 size={ICON} />, danger: true, onClick: () => actions.discardFiles(repo, paths) },
      { label: `Ignore folder ${dir}/`, icon: <Ban size={ICON} />, onClick: () => actions.ignorePath(repo, `/${escapeGitignore(dir)}/`) }
    )
  } else {
    items.push({ label: `Unstage folder (${paths.length})`, icon: <Minus size={ICON} />, onClick: () => opts.unstage(paths) })
  }
  items.push(
    { label: 'Stash folder changes', icon: <ArchiveRestore size={ICON} />, onClick: () => actions.stash(repo, { paths, message: `Stash of ${dir}/` }) },
    { type: 'separator' },
    { label: 'Show in folder', icon: <FolderOpen size={ICON} />, onClick: () => actions.showInFolder(actions.absPath(repo, dir)) },
    { label: 'Copy path', icon: <Copy size={ICON} />, onClick: () => actions.copyText(dir, 'Path copied') }
  )
  return items
}

/** Menu for a conflicted file. */
export function conflictMenu(repo: string, path: string): MenuItem[] {
  return [
    { label: 'Resolve conflict…', icon: <TriangleAlert size={ICON} />, onClick: () => actions.openConflict(repo, path) },
    { label: 'Mark as resolved', icon: <CircleCheck size={ICON} />, onClick: () => markResolvedAndAdvance(repo, path) },
    { type: 'separator' },
    { label: 'Open file', icon: <ExternalLink size={ICON} />, onClick: () => actions.openInEditor(actions.absPath(repo, path)) },
    { label: 'Show in folder', icon: <FolderOpen size={ICON} />, onClick: () => actions.showInFolder(actions.absPath(repo, path)) },
    { label: 'File history', icon: <RotateCcwClock size={ICON} />, onClick: () => actions.openFileHistory(repo, path) },
    { type: 'separator' },
    { label: 'Copy path', icon: <Copy size={ICON} />, onClick: () => actions.copyText(path, 'Path copied') }
  ]
}
