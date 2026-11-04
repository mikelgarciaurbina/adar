import type { DraggedRef } from '@renderer/lib/dnd'
import type { DisplayRow, Pill, WipCounts } from './model'

/**
 * Event handlers shared by every graph row. CommitGraph passes one stable object
 * (its methods read the latest state through a ref) so memoised rows never
 * re-render just because a handler closure changed.
 */
export interface GraphCtx {
  onRowClick(e: React.MouseEvent, row: DisplayRow): void
  onRowDoubleClick(e: React.MouseEvent, row: DisplayRow): void
  onRowContextMenu(e: React.MouseEvent, row: DisplayRow): void
  onPillDoubleClick(pill: Pill): void
  onPillContextMenu(e: React.MouseEvent, pill: Pill): void
  onRefDrop(source: DraggedRef, target: Pill, at: { clientX: number; clientY: number }): void
  /** A pull request chip next to a branch label. */
  onPullClick(number: number): void
}

/** What another worktree's dashed row says (Agents at work). */
export interface AgentRowInfo {
  name: string
  state: 'working' | 'quiet' | 'idle'
  files: number
  added: number
  removed: number
  /** The agent working there, when Adar can tell. */
  agent: string | null
  /** "now", "6 min". */
  ago: string
  title: string
}

export interface WipInfo {
  counts: WipCounts
  /** Draft commit summary shown instead of "// WIP" when typed. */
  summary: string
}
