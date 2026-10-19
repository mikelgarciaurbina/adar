// Labels and capabilities of in-progress repository operations (shared by the
// operation banner and the conflict tool).

import type { RepoOperationState } from '@shared/types'

export type ActiveOperation = Exclude<RepoOperationState, 'none'>

export interface OperationInfo {
  /** Banner title, e.g. "Merge in progress". */
  title: string
  /** Lower-case noun for buttons/tooltips: "merge", "rebase"... */
  noun: string
  canSkip: boolean
  canContinue: boolean
}

export const OPERATION_INFO: Record<ActiveOperation, OperationInfo> = {
  merge: { title: 'Merge in progress', noun: 'merge', canSkip: false, canContinue: true },
  rebase: { title: 'Rebase in progress', noun: 'rebase', canSkip: true, canContinue: true },
  // The backend tells them apart by git's own marker (rebase-merge/interactive), not by the backend used.
  'rebase-interactive': { title: 'Interactive rebase in progress', noun: 'rebase', canSkip: true, canContinue: true },
  'cherry-pick': { title: 'Cherry-pick in progress', noun: 'cherry-pick', canSkip: true, canContinue: true },
  revert: { title: 'Revert in progress', noun: 'revert', canSkip: true, canContinue: true },
  bisect: { title: 'Bisect in progress', noun: 'bisect', canSkip: false, canContinue: false },
  am: { title: 'Applying patches in progress', noun: 'patch series', canSkip: true, canContinue: true }
}

export function operationInfo(state: RepoOperationState | undefined | null): OperationInfo | null {
  return state && state !== 'none' ? OPERATION_INFO[state] : null
}
