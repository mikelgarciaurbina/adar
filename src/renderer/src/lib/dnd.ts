// Drag & drop of refs between the graph and the left panel (GitKraken style:
// drag a branch onto another to merge / rebase / fast-forward).

import type { Ref } from '@shared/types'

export const REF_DRAG_MIME = 'application/x-adar-ref'

export interface DraggedRef {
  name: string
  fullName: string
  type: Ref['type']
  sha: string
}

export function setRefDragData(e: React.DragEvent, ref: Ref | DraggedRef): void {
  const payload: DraggedRef = { name: ref.name, fullName: ref.fullName, type: ref.type, sha: ref.sha }
  e.dataTransfer.setData(REF_DRAG_MIME, JSON.stringify(payload))
  e.dataTransfer.setData('text/plain', ref.name)
  e.dataTransfer.effectAllowed = 'move'
}

export function hasRefDragData(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(REF_DRAG_MIME)
}

export function getRefDragData(e: React.DragEvent): DraggedRef | null {
  try {
    const raw = e.dataTransfer.getData(REF_DRAG_MIME)
    return raw ? (JSON.parse(raw) as DraggedRef) : null
  } catch {
    return null
  }
}
