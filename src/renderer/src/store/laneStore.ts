// Lane colour of the commit each branch points at, per repository, as laid out by the commit graph.
// Other views (the left panel's branch dots) read it so a branch keeps one colour everywhere.

import { create } from 'zustand'

export interface LaneOf {
  sha: string
  color: number
}

interface LaneState {
  /** repo path → (commit sha → colour index of its lane, see lib/colors laneColor). */
  tips: Record<string, ReadonlyMap<string, number>>
  /** repo path → the selected commit and its lane colour (the commit details header uses it). */
  selected: Record<string, LaneOf | null>
  setTips(repo: string, tips: ReadonlyMap<string, number>): void
  setSelected(repo: string, sel: LaneOf | null): void
}

export const useLanes = create<LaneState>((set) => ({
  tips: {},
  selected: {},
  setTips: (repo, tips) => set((s) => (s.tips[repo] === tips ? s : { tips: { ...s.tips, [repo]: tips } })),
  setSelected: (repo, sel) =>
    set((s) => {
      const cur = s.selected[repo]
      if (cur === sel || (cur && sel && cur.sha === sel.sha && cur.color === sel.color)) return s
      return { selected: { ...s.selected, [repo]: sel } }
    })
}))

/** Lane colour of a commit when the graph knows it: the selected commit's, or a branch tip's. */
export function useCommitLane(repo: string, sha: string | null | undefined): number | undefined {
  return useLanes((s) => {
    if (!sha) return undefined
    const sel = s.selected[repo]
    if (sel && sel.sha === sha) return sel.color
    return s.tips[repo]?.get(sha)
  })
}
