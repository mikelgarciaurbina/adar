// Narrow settings selectors for the diff views (so unrelated settings changes,
// e.g. panel resizing, do not re-render large diffs), plus the setters used by
// the diff toolbars, menus and shortcuts.

import { create } from 'zustand'
import { useApp } from '@renderer/store/appStore'
import type { DiffViewMode, ImageDiffMode } from '@shared/types'
import { FULL_FILE_CONTEXT } from './targets'

export interface DiffPrefs {
  /** Layout: one column or old / new side by side. */
  mode: DiffViewMode
  /** Show the whole file instead of only the changed hunks. */
  fullFile: boolean
  ignoreWhitespace: boolean
  /** Context lines setting (used when not showing the full file). */
  contextLines: number
  /** Context lines to request from git for the current options. */
  context: number
  dateFormat: 'relative' | 'absolute'
}

/** Context sizes offered in the diff "⋯" menu. */
export const CONTEXT_CHOICES = [3, 5, 10, 25] as const

export function sanitizeContext(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.round(n))) : 3
}

export function useDiffPrefs(): DiffPrefs {
  const rawMode = useApp((s) => s.settings.diffViewMode)
  const fullFile = useApp((s) => !!s.settings.diffFullFile)
  const ignoreWhitespace = useApp((s) => s.settings.diffIgnoreWhitespace)
  const contextLines = sanitizeContext(useApp((s) => s.settings.diffContextLines))
  const dateFormat = useApp((s) => s.settings.dateFormat)
  const mode: DiffViewMode = rawMode === 'split' ? 'split' : 'unified'
  const context = fullFile ? FULL_FILE_CONTEXT : contextLines
  return { mode, fullFile, ignoreWhitespace, contextLines, context, dateFormat }
}

export function setDiffMode(mode: DiffViewMode): void {
  void useApp.getState().updateSettings({ diffViewMode: mode })
}

export function setFullFile(on: boolean): void {
  void useApp.getState().updateSettings({ diffFullFile: on })
}

export function toggleFullFile(): void {
  setFullFile(!useApp.getState().settings.diffFullFile)
}

export function setIgnoreWhitespace(on: boolean): void {
  void useApp.getState().updateSettings({ diffIgnoreWhitespace: on })
}

export function setContextLines(n: number): void {
  void useApp.getState().updateSettings({ diffContextLines: sanitizeContext(n) })
}

const IMAGE_MODES: readonly ImageDiffMode[] = ['side', 'swipe', 'onion', 'difference']

/** How changed images open (the way used last) and whether anti-aliased edges count. */
export function useImageDiffPrefs(): { mode: ImageDiffMode; ignoreAntialiasing: boolean } {
  const raw = useApp((s) => s.settings.imageDiffMode)
  const ignoreAntialiasing = useApp((s) => s.settings.imageDiffIgnoreAntialiasing !== false)
  return { mode: IMAGE_MODES.includes(raw) ? raw : 'side', ignoreAntialiasing }
}

export function setImageDiffMode(mode: ImageDiffMode): void {
  void useApp.getState().updateSettings({ imageDiffMode: mode })
}

export function setImageDiffIgnoreAntialiasing(on: boolean): void {
  void useApp.getState().updateSettings({ imageDiffIgnoreAntialiasing: on })
}

export interface ImageView {
  zoom: 'fit' | 'actual'
  /** Swipe: where the line is, 0–1 of the width. */
  swipe: number
  /** Onion skin: After's opacity, 0–100. */
  onion: number
}

/** Where the zoom, Swipe's line and Onion skin's slider were left, so the next image opens the same way (this session). */
export const useImageView = create<ImageView>()(() => ({ zoom: 'fit', swipe: 0.5, onion: 50 }))

export function setImageView(patch: Partial<ImageView>): void {
  useImageView.setState(patch)
}
