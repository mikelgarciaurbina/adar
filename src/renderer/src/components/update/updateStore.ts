import { create } from 'zustand'
import type { UpdateStatus } from '@shared/update'

interface UpdateUiState {
  status: UpdateStatus | null
  /** Version whose notice the user dismissed with "Later" (this session only). */
  dismissed: string | null
  notesOpen: boolean
  setStatus(status: UpdateStatus): void
  dismiss(version: string): void
  setNotesOpen(open: boolean): void
}

export const useUpdates = create<UpdateUiState>((set) => ({
  status: null,
  dismissed: null,
  notesOpen: false,
  setStatus: (status) => set({ status }),
  dismiss: (version) => set({ dismissed: version, notesOpen: false }),
  setNotesOpen: (notesOpen) => set({ notesOpen })
}))
