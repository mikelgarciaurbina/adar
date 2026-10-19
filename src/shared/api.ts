// The single contract between the renderer and the backend.
// Implemented in src/main/backend.ts, exposed via Electron IPC (src/main/index.ts)
// or HTTP (src/server/devServer.ts), and consumed via src/renderer/src/api/client.ts.
//
// Conventions:
//  - `repo` is always the absolute worktree root returned by openRepo().
//  - Methods reject with a AdarError (see errors.ts) on failure.
//  - Operations that may stop on conflicts (merge, rebase, cherry-pick, revert,
//    pull, stash apply, continue) resolve with an OperationResult instead of
//    rejecting when the only problem is conflicts.
//  - `opId` (optional) lets the renderer correlate 'progress' events.

import type {
  AppInfo,
  AppSettings,
  BlameLine,
  Commit,
  CommitDetails,
  CommitPage,
  ConflictResolution,
  ConflictVersions,
  ContentRev,
  DiffOptions,
  DiffTarget,
  FileContent,
  FileDiff,
  ForcePushMode,
  GitCommandResult,
  Identity,
  LogOptions,
  OperationResult,
  PullMode,
  RebaseTodoItem,
  RecentRepo,
  RefsResult,
  RepoInfo,
  ResetMode,
  WorkingStatus
} from './types'

export interface AdarApi {
  // ── App / system ────────────────────────────────────────────────────────
  getAppInfo(): Promise<AppInfo>
  /** Native folder picker. Resolves null when cancelled. */
  pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
  openExternal(url: string): Promise<void>
  /** Reveal a path in Finder / Explorer. */
  showInFolder(path: string): Promise<void>
  openInTerminal(path: string): Promise<void>
  /** Open a file or folder with settings.editorCommand (or the OS default app). */
  openInEditor(path: string): Promise<void>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getRecentRepos(): Promise<RecentRepo[]>
  removeRecentRepo(path: string): Promise<void>
  /** Reply to a 'credential-request' event. null cancels the git command. */
  answerCredentialRequest(id: string, value: string | null): Promise<void>

  // ── Repository lifecycle ────────────────────────────────────────────────
  /** Resolve the worktree root for any path inside a repo, start watching it, add to recents. */
  openRepo(path: string): Promise<RepoInfo>
  /** Stop watching. */
  closeRepo(repo: string): Promise<void>
  initRepo(path: string, opts?: { initialBranch?: string }): Promise<RepoInfo>
  /** Clone into parentDir/dirName (dirName defaults to the repo name from the URL). */
  cloneRepo(
    url: string,
    parentDir: string,
    opts?: { dirName?: string; depth?: number; opId?: string }
  ): Promise<RepoInfo>
  getRepoInfo(repo: string): Promise<RepoInfo>

  // ── History ─────────────────────────────────────────────────────────────
  /** Commits of all refs (excluding refs/stash) in --date-order, paginated. */
  getLog(repo: string, opts?: LogOptions): Promise<CommitPage>
  getRefs(repo: string): Promise<RefsResult>
  getCommitDetails(repo: string, sha: string): Promise<CommitDetails>
  /** Files changed between two revisions (from..to). */
  getCompareFiles(repo: string, from: string, to: string): Promise<CommitDetails['files']>
  /** History of one file, following renames. */
  getFileHistory(repo: string, path: string, opts?: { maxCount?: number }): Promise<Commit[]>
  getBlame(repo: string, path: string, rev?: string): Promise<BlameLine[]>
  getFileContent(repo: string, path: string, rev: ContentRev): Promise<FileContent>

  // ── Working tree & index ────────────────────────────────────────────────
  getStatus(repo: string): Promise<WorkingStatus>
  getDiff(repo: string, target: DiffTarget, opts?: DiffOptions): Promise<FileDiff>
  stageFiles(repo: string, paths: string[]): Promise<void>
  stageAll(repo: string): Promise<void>
  unstageFiles(repo: string, paths: string[]): Promise<void>
  unstageAll(repo: string): Promise<void>
  /** Revert working-tree changes for these paths; untracked files are deleted. */
  discardFiles(repo: string, paths: string[]): Promise<void>
  /** Revert ALL unstaged changes and delete untracked files (index is kept). */
  discardAll(repo: string): Promise<void>
  /** git apply [--cached] [--reverse] with the given unified-diff patch (stdin). */
  applyPatch(repo: string, patch: string, opts?: { cached?: boolean; reverse?: boolean }): Promise<void>
  /** Returns the new commit sha. */
  commit(
    repo: string,
    opts: { message: string; amend?: boolean; allowEmpty?: boolean; noVerify?: boolean; signoff?: boolean }
  ): Promise<string>
  /** Full message of HEAD (for amend prefill); '' on unborn branch. */
  getHeadMessage(repo: string): Promise<string>
  /** Prepared message of an in-progress merge/cherry-pick/revert (.git/MERGE_MSG, comments stripped); '' when none. */
  getMergeMessage(repo: string): Promise<string>
  /** Append a pattern to .gitignore (creating it if needed). */
  addToGitignore(repo: string, pattern: string): Promise<void>

  // ── Branches & HEAD ─────────────────────────────────────────────────────
  /**
   * Checkout a branch, tag, or sha. When `ref` is a remote branch ("origin/x") and no
   * local branch exists, a local tracking branch is created automatically.
   */
  checkout(repo: string, ref: string, opts?: { force?: boolean }): Promise<void>
  createBranch(repo: string, name: string, startPoint?: string, opts?: { checkout?: boolean }): Promise<void>
  deleteBranch(repo: string, name: string, opts?: { force?: boolean }): Promise<void>
  renameBranch(repo: string, oldName: string, newName: string): Promise<void>
  /** upstream like "origin/main"; null unsets. */
  setUpstream(repo: string, branch: string, upstream: string | null): Promise<void>
  /** Fast-forward a local branch that is NOT checked out to `to` (fails if not a fast-forward). */
  fastForwardBranch(repo: string, branch: string, to: string): Promise<void>
  merge(
    repo: string,
    ref: string,
    opts?: { noFf?: boolean; ffOnly?: boolean; squash?: boolean; message?: string }
  ): Promise<OperationResult>
  rebase(repo: string, onto: string): Promise<OperationResult>
  cherryPick(repo: string, shas: string[], opts?: { noCommit?: boolean }): Promise<OperationResult>
  revert(repo: string, sha: string, opts?: { noCommit?: boolean; mainline?: number }): Promise<OperationResult>
  reset(repo: string, target: string, mode: ResetMode): Promise<void>
  /** Continue the in-progress merge/rebase/cherry-pick/revert. */
  continueOperation(repo: string, opts?: { message?: string }): Promise<OperationResult>
  abortOperation(repo: string): Promise<void>
  skipOperation(repo: string): Promise<OperationResult>

  // ── Interactive rebase ──────────────────────────────────────────────────
  /** Commits in base..HEAD, OLDEST first (the order of a rebase todo list). */
  getRebaseCommits(repo: string, base: string): Promise<Commit[]>
  /** Runs `git rebase -i base` non-interactively with the given todo list. */
  interactiveRebase(repo: string, base: string, todo: RebaseTodoItem[]): Promise<OperationResult>

  // ── Conflicts ───────────────────────────────────────────────────────────
  getConflictVersions(repo: string, path: string): Promise<ConflictVersions>
  /** Write the resolution and stage the file. */
  resolveConflict(repo: string, path: string, resolution: ConflictResolution): Promise<void>
  /** Stage files as resolved as-is. */
  markResolved(repo: string, paths: string[]): Promise<void>

  // ── Tags ────────────────────────────────────────────────────────────────
  /** Lightweight tag unless message is given (annotated). */
  createTag(repo: string, name: string, sha: string, opts?: { message?: string }): Promise<void>
  deleteTag(repo: string, name: string): Promise<void>
  pushTag(repo: string, remote: string, name: string): Promise<void>
  deleteRemoteTag(repo: string, remote: string, name: string): Promise<void>

  // ── Stash ───────────────────────────────────────────────────────────────
  stashSave(
    repo: string,
    opts?: { message?: string; includeUntracked?: boolean; keepIndex?: boolean; paths?: string[] }
  ): Promise<void>
  /** Apply (or pop) stash@{index}. */
  stashApply(repo: string, index: number, opts?: { pop?: boolean; restoreIndex?: boolean }): Promise<OperationResult>
  stashDrop(repo: string, index: number): Promise<void>
  /** Files of a stash, including untracked files stored in its third parent. */
  getStashDetails(repo: string, index: number): Promise<CommitDetails>

  // ── Remotes ─────────────────────────────────────────────────────────────
  fetch(repo: string, opts?: { remote?: string; all?: boolean; prune?: boolean; opId?: string }): Promise<void>
  /** Pull the current branch from its upstream. */
  pull(repo: string, opts?: { mode?: PullMode; opId?: string }): Promise<OperationResult>
  /**
   * Push `branch` (default: current) to `remote` (default: upstream remote or "origin").
   * setUpstream adds -u. Rejects with code 'GIT_FAILED' and a "rejected" stderr when non-fast-forward.
   */
  push(
    repo: string,
    opts?: {
      remote?: string
      branch?: string
      remoteBranch?: string
      setUpstream?: boolean
      force?: ForcePushMode
      tags?: boolean
      opId?: string
    }
  ): Promise<void>
  deleteRemoteBranch(repo: string, remote: string, branch: string): Promise<void>
  addRemote(repo: string, name: string, url: string): Promise<void>
  removeRemote(repo: string, name: string): Promise<void>
  renameRemote(repo: string, oldName: string, newName: string): Promise<void>
  setRemoteUrl(repo: string, name: string, url: string): Promise<void>

  // ── Config / identity ───────────────────────────────────────────────────
  /** Effective user.name/email for repo (or global when repo is null). */
  getIdentity(repo: string | null): Promise<Identity>
  /** Set user.name/email locally for repo, or globally when repo is null. */
  setIdentity(repo: string | null, name: string, email: string): Promise<void>

  // ── Submodules ──────────────────────────────────────────────────────────
  updateSubmodules(repo: string, opts?: { init?: boolean; recursive?: boolean }): Promise<void>

  // ── Escape hatch ────────────────────────────────────────────────────────
  /** Run an arbitrary git command (used by the Git console). args exclude the leading "git". */
  runGit(repo: string, args: string[]): Promise<GitCommandResult>
}

export type AdarApiMethod = keyof AdarApi

/** Runtime list of callable methods — the IPC/HTTP layers reject anything else. */
export const API_METHODS = [
  'getAppInfo',
  'pickDirectory',
  'openExternal',
  'showInFolder',
  'openInTerminal',
  'openInEditor',
  'getSettings',
  'updateSettings',
  'getRecentRepos',
  'removeRecentRepo',
  'answerCredentialRequest',
  'openRepo',
  'closeRepo',
  'initRepo',
  'cloneRepo',
  'getRepoInfo',
  'getLog',
  'getRefs',
  'getCommitDetails',
  'getCompareFiles',
  'getFileHistory',
  'getBlame',
  'getFileContent',
  'getStatus',
  'getDiff',
  'stageFiles',
  'stageAll',
  'unstageFiles',
  'unstageAll',
  'discardFiles',
  'discardAll',
  'applyPatch',
  'commit',
  'getHeadMessage',
  'getMergeMessage',
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
  'getRebaseCommits',
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
  'getStashDetails',
  'fetch',
  'pull',
  'push',
  'deleteRemoteBranch',
  'addRemote',
  'removeRemote',
  'renameRemote',
  'setRemoteUrl',
  'getIdentity',
  'setIdentity',
  'updateSubmodules',
  'runGit'
] as const satisfies readonly AdarApiMethod[]

// Compile-time check that API_METHODS lists every AdarApi method.
type _Missing = Exclude<AdarApiMethod, (typeof API_METHODS)[number]>
const _exhaustive: _Missing extends never ? true : _Missing = true
void _exhaustive

export const IPC_INVOKE_CHANNEL = 'adar:invoke'
export const IPC_EVENT_CHANNEL = 'adar:event'

/** Envelope used over IPC/HTTP so structured errors survive serialisation. */
export type InvokeResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: import('./types').AdarErrorPayload }
