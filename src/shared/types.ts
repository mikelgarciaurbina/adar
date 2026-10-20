// Domain types shared by the main process (git backend), the dev HTTP bridge
// and the renderer. Everything here must be JSON-serialisable.

/** Unix timestamp in seconds (as git reports it). */
export type UnixSeconds = number

export type RepoOperationState =
  | 'none'
  | 'merge'
  | 'rebase'
  | 'rebase-interactive'
  | 'cherry-pick'
  | 'revert'
  | 'bisect'
  | 'am'

export interface HeadInfo {
  /** Commit HEAD points at; null on an unborn branch (fresh repo). */
  sha: string | null
  /** Short branch name ("main") or null when detached. */
  branch: string | null
  detached: boolean
  /** True when the current branch has no commits yet. */
  unborn: boolean
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface RepoInfo {
  /** Absolute path of the worktree root (git rev-parse --show-toplevel). */
  path: string
  /** basename(path) */
  name: string
  /** Absolute path of the .git directory. */
  gitDir: string
  isBare: boolean
  head: HeadInfo
  state: RepoOperationState
  remotes: RemoteInfo[]
}

export interface Ref {
  /** Short name: "main", "origin/main", "v1.0.0". */
  name: string
  /** Full name: "refs/heads/main", "refs/remotes/origin/main", "refs/tags/v1.0.0". */
  fullName: string
  type: 'branch' | 'remote' | 'tag'
  /** Commit the ref points at (annotated tags are peeled to their commit). */
  sha: string
  /** Local branches: true when it is the checked-out branch. */
  isHead?: boolean
  /** Local branches: short upstream name, e.g. "origin/main". */
  upstream?: string
  /** Local branches: upstream configured but the remote branch no longer exists. */
  upstreamGone?: boolean
  /** Local branches: commits ahead of / behind upstream. */
  ahead?: number
  behind?: number
  /** Remote branches: remote name ("origin"). */
  remote?: string
  /** Remote branches: true for "origin/HEAD" style symbolic refs. */
  isSymbolic?: boolean
  /** Tags */
  annotated?: boolean
  tagMessage?: string
}

export interface Stash {
  /** 0 for stash@{0} */
  index: number
  /** "stash@{0}" */
  ref: string
  sha: string
  /** Commit the stash was created on top of (first parent). */
  baseSha: string
  message: string
  /** Branch name parsed from "WIP on <branch>:" / "On <branch>:" when available. */
  branch?: string
  date: UnixSeconds
}

export interface Submodule {
  path: string
  url: string
  sha: string | null
  status: 'initialized' | 'uninitialized' | 'modified' | 'conflict'
}

export interface RefsResult {
  head: HeadInfo
  branches: Ref[]
  remotes: Ref[]
  tags: Ref[]
  stashes: Stash[]
  submodules: Submodule[]
}

export interface Commit {
  sha: string
  shortSha: string
  parents: string[]
  authorName: string
  authorEmail: string
  authorDate: UnixSeconds
  committerName: string
  committerEmail: string
  committerDate: UnixSeconds
  /** First line of the message. */
  subject: string
  /** Remainder of the message (may be empty). */
  body: string
}

export interface LogOptions {
  /** Default 2000. */
  maxCount?: number
  skip?: number
  /** Restrict to these revisions instead of --all. */
  revisions?: string[]
  /** Only commits touching this path (follows renames when a single file). */
  path?: string
  /** Search filter. */
  search?: CommitSearch
}

export interface CommitSearch {
  text: string
  /** message: --grep, author: --author, sha: prefix match, content: -G (pickaxe regex), path: -- <path> */
  mode: 'message' | 'author' | 'sha' | 'content' | 'path'
}

export interface CommitPage {
  commits: Commit[]
  /** True when more commits are available past this page. */
  hasMore: boolean
}

export type FileStatusCode =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'typechange'
  | 'conflicted'

export interface FileChange {
  /** Path relative to repo root (new path for renames). */
  path: string
  /** Previous path for renames/copies. */
  oldPath?: string
  status: FileStatusCode
  additions?: number
  deletions?: number
  binary?: boolean
}

export type ConflictKind =
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'added-by-us'
  | 'added-by-them'
  | 'deleted-by-us'
  | 'deleted-by-them'

export interface ConflictFile {
  path: string
  kind: ConflictKind
}

export interface WorkingStatus {
  staged: FileChange[]
  /** Unstaged modifications AND untracked files (status 'untracked'). */
  unstaged: FileChange[]
  conflicted: ConflictFile[]
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export interface CommitDetails {
  commit: Commit
  files: FileChange[]
  additions: number
  deletions: number
}

export type DiffLineType = 'context' | 'add' | 'del'

export interface DiffLine {
  type: DiffLineType
  /** Line text WITHOUT the leading +/-/space marker and without trailing newline. */
  content: string
  oldLine: number | null
  newLine: number | null
  /** True when git printed "\ No newline at end of file" right after this line. */
  noNewline?: boolean
  /** The original line ended with "\r\n"; `content` excludes the "\r" (patch builders must re-add it). */
  crlf?: boolean
}

export interface DiffHunk {
  /** Full "@@ -a,b +c,d @@ section" header line. */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  status: FileStatusCode
  binary: boolean
  /** Set for common image extensions so the UI can render an image diff via getFileContent. */
  isImage: boolean
  hunks: DiffHunk[]
  oldMode?: string
  newMode?: string
  /** True when the diff was too large and hunks were omitted. */
  tooLarge?: boolean
  /** The diff text was not valid UTF-8 (legacy encodings): line-level staging is disabled to avoid corrupting bytes. */
  encodingLossy?: boolean
  additions: number
  deletions: number
}

export type DiffTarget =
  /** Working tree vs index. */
  | { kind: 'unstaged'; path: string }
  /** Index vs HEAD. */
  | { kind: 'staged'; path: string }
  /** Commit vs its first parent (or empty tree for root commits). */
  | { kind: 'commit'; sha: string; path: string; oldPath?: string }
  /** Arbitrary comparison between two revisions. */
  | { kind: 'compare'; from: string; to: string; path: string; oldPath?: string }
  /** Stash vs its base commit (untracked files included). */
  | { kind: 'stash'; index: number; path: string }

export interface DiffOptions {
  /** Lines of context (default 3). */
  context?: number
  ignoreWhitespace?: boolean
}

/** Revision selector for getFileContent: a commit-ish, the index, or the working tree. */
export type ContentRev = string | 'INDEX' | 'WORKTREE'

export interface FileContent {
  path: string
  rev: ContentRev
  exists: boolean
  binary: boolean
  /** UTF-8 text when !binary. */
  text?: string
  /** Base64 data for binary files up to 10 MB (images). */
  base64?: string
  size: number
}

export interface BlameLine {
  lineNo: number
  content: string
  sha: string
  authorName: string
  authorEmail: string
  authorDate: UnixSeconds
  summary: string
  /** Line number in the commit that introduced it. */
  origLineNo: number
}

/** For binary conflicts (binary: true) base/ours/theirs/merged are '' when that version exists and null when absent. */
export interface ConflictVersions {
  path: string
  kind: ConflictKind
  /** Stage 1 (common ancestor); null when absent. */
  base: string | null
  /** Stage 2 (current branch / HEAD). */
  ours: string | null
  /** Stage 3 (incoming). */
  theirs: string | null
  /** Current working-tree content (with conflict markers). */
  merged: string | null
  /** Human labels, e.g. "main" and "feature/x". */
  oursLabel: string
  theirsLabel: string
  binary: boolean
  /** Text that is not valid UTF-8 (binary is also true): only whole-side resolutions are safe. */
  nonUtf8?: boolean
  /** A side is a symbolic link (binary is also true): only whole-side resolutions are safe. */
  symlink?: boolean
}

export type ConflictResolution =
  | { kind: 'ours' }
  | { kind: 'theirs' }
  /** expected = the working-tree text the editor started from; the backend refuses if the file changed since. */
  | { kind: 'content'; content: string; expected?: string | null }
  | { kind: 'delete' }

/** Result of operations that may stop on conflicts instead of failing. */
export interface OperationResult {
  ok: boolean
  /** Paths left in conflict (empty when ok). */
  conflicts: string[]
  /** Combined git output, useful for toasts. */
  message: string
  /** Repo operation state after the command ran. */
  state: RepoOperationState
}

export type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop'

export interface RebaseTodoItem {
  action: RebaseAction
  sha: string
  subject: string
  /**
   * reword: the new full message. squash: the final message of the combined commit (when several
   * squash items of one run carry a message the last one wins; when none does, messages are combined
   * automatically). Ignored for pick/edit/fixup/drop. The todo must list EVERY commit returned by
   * getRebaseCommits (use 'drop' to remove one).
   */
  message?: string
}

/** Whether (and how) a commit's message can be edited in place (see AdarApi.rewordCommit). */
export interface RewordInfo {
  editable: boolean
  /** Why it cannot be edited (when editable is false). */
  reason: string | null
  /** The commit is HEAD. */
  isHead: boolean
  /** The full current message. */
  message: string
  /** Commits that get recreated: the edited one and every commit after it up to HEAD. */
  rewritten: number
  /** The checked-out branch (null when HEAD is detached). */
  branch: string | null
  /** The checked-out branch's upstream (e.g. origin/main) when it already contains the commit: a force push is needed. */
  upstream: string | null
  /** Other local branches containing the commit: they keep the original commits. */
  localBranches: string[]
  /** Other remote-tracking branches containing the commit (besides `upstream`): they keep the original commits. */
  remoteBranches: string[]
  /** Tags containing the commit: they keep pointing at the original commits. */
  tags: string[]
}

/** Result of rewordCommit. */
export interface RewordResult extends OperationResult {
  /** New sha of the edited commit (when ok). */
  newSha: string | null
  /** HEAD before the change (for undo). */
  previousHead: string | null
}

export type PullMode = 'ff-only' | 'merge' | 'rebase'
export type ResetMode = 'soft' | 'mixed' | 'hard'
export type ForcePushMode = false | 'with-lease' | 'force'

export interface Identity {
  name: string
  email: string
  /** Where the effective value comes from. */
  scope: 'local' | 'global' | 'system' | 'none'
}

export interface RecentRepo {
  path: string
  name: string
  /** Milliseconds since epoch. */
  lastOpened: number
}

export type ThemeSetting = 'dark' | 'light' | 'system'
/** unified = one column with +/- lines; split = old and new side by side. */
export type DiffViewMode = 'unified' | 'split'

export interface AppSettings {
  theme: ThemeSetting
  /** Auto-fetch interval in minutes; 0 disables. */
  autoFetchMinutes: number
  defaultPullMode: PullMode
  /** Load Gravatar avatars (needs network). Initials are used otherwise. */
  gravatar: boolean
  dateFormat: 'relative' | 'absolute'
  diffViewMode: DiffViewMode
  /** Show the whole file instead of only the changed hunks (applies to both layouts). */
  diffFullFile: boolean
  diffIgnoreWhitespace: boolean
  diffContextLines: number
  /** Commits loaded per page in the graph. */
  graphPageSize: number
  /** UI zoom factor (1 = 100%). */
  zoom: number
  /** Shell command used for "Open in editor", e.g. "code" or "cursor". Empty = system default. */
  editorCommand: string
  /** "Terminal", "iTerm", "Warp"... */
  terminalApp: string
  /** Repos open as tabs, restored on launch. */
  openTabs: string[]
  activeTab: string | null
  leftPanelWidth: number
  rightPanelWidth: number
  /** Show remote branches in the graph. */
  graphShowRemotes: boolean
  graphShowTags: boolean
  graphShowStashes: boolean
  /** Column visibility in the graph. */
  graphColumns: { author: boolean; date: boolean; sha: boolean }
  /** Prompt for confirmation before force push / hard reset / discard. */
  confirmDangerous: boolean
  /** Check GitHub Releases for new Adar versions in the background. */
  checkForUpdates: boolean
  /** Version the user chose to skip ('' = none). */
  skippedUpdateVersion: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  autoFetchMinutes: 5,
  defaultPullMode: 'ff-only',
  gravatar: false,
  dateFormat: 'relative',
  diffViewMode: 'unified',
  diffFullFile: false,
  diffIgnoreWhitespace: false,
  diffContextLines: 3,
  graphPageSize: 2000,
  zoom: 1,
  editorCommand: '',
  terminalApp: 'Terminal',
  openTabs: [],
  activeTab: null,
  leftPanelWidth: 260,
  rightPanelWidth: 380,
  graphShowRemotes: true,
  graphShowTags: true,
  graphShowStashes: true,
  graphColumns: { author: true, date: true, sha: true },
  confirmDangerous: true,
  checkForUpdates: true,
  skippedUpdateVersion: ''
}

export interface AppInfo {
  version: string
  platform: NodeJSPlatform
  gitVersion: string
  homeDir: string
  /** false when running in the browser dev bridge. */
  isElectron: boolean
}

export type NodeJSPlatform = 'darwin' | 'win32' | 'linux' | string

export interface GitCommandResult {
  stdout: string
  stderr: string
  code: number
}

/** Serialised error crossing the IPC / HTTP boundary. */
export interface AdarErrorPayload {
  message: string
  /** Machine-readable code, see AdarErrorCode. */
  code: AdarErrorCode
  /** The git command that failed (without credentials). */
  command?: string
  stderr?: string
  exitCode?: number
  /** Extra structured information, e.g. the command-running config keys for UNTRUSTED_REPO. */
  details?: string[]
}

export type AdarErrorCode =
  | 'GIT_FAILED'
  | 'NOT_A_REPO'
  | 'AUTH_FAILED'
  | 'NETWORK'
  | 'CONFLICT'
  | 'DIRTY_WORKTREE'
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'CANCELLED'
  | 'GIT_NOT_INSTALLED'
  | 'UNTRUSTED_REPO'
  | 'UNKNOWN'

/** Events pushed from the backend to the renderer. */
export type AdarEvent =
  | {
      type: 'repo-changed'
      repoPath: string
      /** worktree: files changed; index: staging changed; refs: branches/tags/HEAD/stash changed. */
      scopes: Array<'worktree' | 'index' | 'refs'>
    }
  | {
      type: 'progress'
      opId: string
      repoPath?: string
      /** Latest progress line from git (e.g. "Receiving objects: 45% (450/1000)"). */
      message: string
      percent?: number
      done?: boolean
    }
  | {
      type: 'credential-request'
      id: string
      /** The prompt git/ssh printed, e.g. "Password for 'https://user@github.com':". */
      prompt: string
      kind: 'username' | 'password' | 'passphrase' | 'yesno' | 'other'
      secret: boolean
    }
  | {
      /** Native menu item clicked; command ids are listed in MENU_COMMANDS. */
      type: 'menu'
      command: MenuCommand
    }
  | {
      /** In-app updater state changed (see src/shared/update.ts). */
      type: 'update-status'
      status: import('./update').UpdateStatus
    }
  | {
      /** Open this folder in a tab (from the `adar` CLI, the Dock or a second instance). */
      type: 'open-repo-request'
      path: string
    }

export const MENU_COMMANDS = [
  'open-repo',
  'clone-repo',
  'init-repo',
  'close-tab',
  'next-tab',
  'prev-tab',
  'settings',
  'command-palette',
  'search-commits',
  'fetch',
  'pull',
  'push',
  'create-branch',
  'stash',
  'pop-stash',
  'undo',
  'redo',
  'refresh',
  'toggle-left-panel',
  'toggle-right-panel',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'open-in-terminal',
  'open-in-finder',
  'git-console',
  'check-for-updates',
  'install-cli',
  'uninstall-cli',
  'focus-branch-filter',
  'open-repo-path',
  'stage-all',
  'commit',
  'about'
] as const

export type MenuCommand = (typeof MENU_COMMANDS)[number]
