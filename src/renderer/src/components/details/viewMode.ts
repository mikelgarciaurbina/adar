// Path / Tree preference for the right panel file lists, shared by every list
// and persisted in localStorage.

import { create } from 'zustand'
import type { FileViewMode } from './fileTree'

const STORAGE_KEY = 'adar.details.fileView'

function readStored(): FileViewMode {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY)
    return v === 'tree' ? 'tree' : 'path'
  } catch {
    return 'path'
  }
}

interface ViewModeState {
  mode: FileViewMode
  setMode(mode: FileViewMode): void
}

export const useFileViewMode = create<ViewModeState>((set) => ({
  mode: readStored(),
  setMode(mode) {
    set({ mode })
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, mode)
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
  }
}))
