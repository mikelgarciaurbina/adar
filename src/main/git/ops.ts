// Split of the AdarApi between the two backend modules:
//  - write/ (createWriteOps): everything that mutates a repository, plus the
//    rebase/conflict reads that belong to those flows.
//  - read side + system (createReadOps, implemented next to backend.ts): history,
//    status, diffs, content, lifecycle, settings, system integration.

import type { AdarApi } from '@shared/api'

export const WRITE_METHODS = [
  'stageFiles',
  'stageAll',
  'unstageFiles',
  'unstageAll',
  'discardFiles',
  'discardAll',
  'applyPatch',
  'commit',
  'addToGitignore',
  'checkout',
  'createBranch',
  'deleteBranch',
  'renameBranch',
  'setUpstream',
  'fastForwardBranch',
  'merge',
  'rebase',
  'cherryPick',
  'revert',
  'reset',
  'continueOperation',
  'abortOperation',
  'skipOperation',
  'getRewordInfo',
  'rewordCommit',
  'getRebaseCommits',
  'getRebaseMergeCount',
  'interactiveRebase',
  'getConflictVersions',
  'resolveConflict',
  'markResolved',
  'createTag',
  'deleteTag',
  'pushTag',
  'deleteRemoteTag',
  'stashSave',
  'stashApply',
  'stashDrop',
  'fetch',
  'pull',
  'push',
  'deleteRemoteBranch',
  'addRemote',
  'removeRemote',
  'renameRemote',
  'setRemoteUrl',
  'setIdentity',
  'updateSubmodules'
] as const satisfies readonly (keyof AdarApi)[]

export type WriteMethod = (typeof WRITE_METHODS)[number]
export type WriteOps = Pick<AdarApi, WriteMethod>
export type ReadOps = Omit<AdarApi, WriteMethod>
