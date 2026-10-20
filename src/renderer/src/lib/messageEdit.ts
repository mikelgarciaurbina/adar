// State of the inline "edit commit message" editor in the right panel. Requests come from the graph's
// context menu or the panel's pencil button; the open editor's text lives here (per repository) so it
// survives the right panel being hidden or the repository tab being switched.
import { create } from 'zustand'
import type { RewordInfo } from '@shared/types'

export interface OpenMessageEdit {
  sha: string
  info: RewordInfo
  summary: string
  description: string
}

interface MessageEditState {
  request: { repo: string; sha: string } | null
  open: Record<string, OpenMessageEdit | undefined>
  start(repo: string, sha: string): void
  clear(): void
  setOpen(repo: string, edit: OpenMessageEdit | null): void
  patchOpen(repo: string, patch: Partial<Pick<OpenMessageEdit, 'summary' | 'description'>>): void
}

export const useMessageEdit = create<MessageEditState>((set) => ({
  request: null,
  open: {},
  start: (repo, sha) => set({ request: { repo, sha } }),
  clear: () => set({ request: null }),
  setOpen: (repo, edit) => set((s) => ({ open: { ...s.open, [repo]: edit ?? undefined } })),
  patchOpen: (repo, patch) =>
    set((s) => {
      const cur = s.open[repo]
      return cur ? { open: { ...s.open, [repo]: { ...cur, ...patch } } } : {}
    })
}))
