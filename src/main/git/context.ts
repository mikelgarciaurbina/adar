// Shared context passed to the read-side and write-side git operation modules.

import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AdarError } from '@shared/errors'
import type { AdarEvent, RepoOperationState } from '@shared/types'
import type { PlatformAdapter } from '../platform'
import { commandDisplay, parseProgressPercent, runGit, type GitResult, type GitRunOptions } from './runner'

export interface GitContext {
  platform: PlatformAdapter
  emit(event: AdarEvent): void
  /**
   * Run git inside `repo` (worktree root). Throws AdarError on failure unless
   * opts.allowFailure / opts.okCodes say otherwise.
   */
  git(repo: string, args: string[], opts?: Omit<GitRunOptions, 'cwd'>): Promise<GitResult>
  /** Run git without a repository (clone, version, global config). */
  gitGlobal(args: string[], opts?: GitRunOptions): Promise<GitResult>
  /**
   * Run a network command (fetch/pull/push/clone/ls-remote...): adds askpass env,
   * disables the timeout and forwards progress lines as 'progress' events for opId.
   */
  gitNetwork(
    repo: string | null,
    args: string[],
    opts?: Omit<GitRunOptions, 'onProgress'> & {
      opId?: string
      cwd?: string
      /** Reject with CANCELLED when the user dismissed a credential prompt (default true; the git console passes false). */
      cancelAsError?: boolean
    }
  ): Promise<GitResult>
  /** Serialise mutating operations per repository (prevents index.lock races). */
  exclusive<T>(repo: string, fn: () => Promise<T>): Promise<T>
  /** Absolute .git directory for the repo (cached). */
  gitDir(repo: string): Promise<string>
  /** In-progress operation (merge/rebase/cherry-pick/...) from files in the git dir. */
  operationState(repo: string): Promise<RepoOperationState>
  /** Paths currently in conflict (unmerged index entries). */
  conflictedPaths(repo: string): Promise<string[]>
  /** Set extra environment for network commands (askpass helper). */
  setNetworkEnv(env: Record<string, string>): void
  /**
   * Tell network commands whether the user cancelled a credential prompt they raised
   * (the askpass helper reports ADAR_ASKPASS_OP); such failures become CANCELLED.
   */
  setCredentialProbe(probe: CredentialProbe | null): void
  /** Drop cached data for a repo (call on close). */
  forgetRepo(repo: string): void
  /** Private scratch directory for temp files (todo lists, messages...). Create it with ensureTmpDir(). */
  tmpDir: string
  /** Create tmpDir (owner-only permissions) and return it. */
  ensureTmpDir(): Promise<string>
}

export interface CredentialProbe {
  /** True (once) when a prompt raised by the network command `op` was cancelled by the user. */
  takeCancelled(op: string): boolean
}

/**
 * File (in the per-worktree git dir) marking a rebase started by Adar's interactive rebase.
 * Removed once no rebase is in progress any more.
 */
export const INTERACTIVE_REBASE_MARKER = 'adar-interactive-rebase'

/** Environment variable carrying the per-command id to the askpass helper. */
export const ASKPASS_OP_ENV = 'ADAR_ASKPASS_OP'

/**
 * Stable per-user scratch dir. A paused interactive rebase references message files in here,
 * so the name must not change between runs; the uid suffix keeps users of a shared /tmp apart.
 */
export function defaultTmpDir(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  return path.join(os.tmpdir(), uid === null ? 'adar' : `adar-${uid}`)
}

/**
 * mkdir -p `dir` with mode 0700 and refuse a directory that another user could tamper with
 * (wrong owner, group/world access, or a symlink planted in a shared tmp dir).
 */
export async function ensurePrivateDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') return dir
  const st = await fs.lstat(dir)
  const uid = typeof process.getuid === 'function' ? process.getuid() : st.uid
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid) {
    throw new AdarError({ message: `Unsafe temporary directory: ${dir}`, code: 'UNKNOWN' })
  }
  if ((st.mode & 0o077) !== 0) await fs.chmod(dir, 0o700)
  return dir
}

/** The error for a repository folder that does not exist (moved, deleted, unmounted volume). */
export function repoFolderNotFound(repo: string, command?: string): AdarError {
  return new AdarError({ message: `Repository folder not found: ${repo}`, code: 'NOT_FOUND', command })
}

export function createGitContext(platform: PlatformAdapter, emit: (e: AdarEvent) => void): GitContext {
  const locks = new Map<string, Promise<unknown>>()
  const gitDirs = new Map<string, string>()
  let networkEnv: Record<string, string> = {}
  let credentialProbe: CredentialProbe | null = null
  const tmpDir = defaultTmpDir()

  const ctx: GitContext = {
    platform,
    emit,
    tmpDir,

    git(repo, args, opts) {
      return runGit(args, { ...opts, cwd: repo })
    },

    gitGlobal(args, opts) {
      return runGit(args, opts)
    },

    async gitNetwork(repo, args, opts = {}) {
      const { opId, cwd, cancelAsError = true, ...rest } = opts
      const op = randomUUID()
      const cancelled = () =>
        new AdarError({ message: 'Authentication cancelled', code: 'CANCELLED', command: commandDisplay(args) })
      try {
        const res = await runGit(args, {
          timeoutMs: 0,
          ...rest,
          cwd: cwd ?? repo ?? undefined,
          env: { ...networkEnv, [ASKPASS_OP_ENV]: op, ...rest.env },
          onProgress: opId
            ? (line) => emit({ type: 'progress', opId, repoPath: repo ?? undefined, message: line, percent: parseProgressPercent(line) })
            : undefined
        })
        // allowFailure callers still get an exception when the user dismissed the credential prompt.
        if (res.code !== 0 && cancelAsError && credentialProbe?.takeCancelled(op)) throw cancelled()
        return res
      } catch (err) {
        if (err instanceof AdarError && err.code !== 'CANCELLED' && cancelAsError && credentialProbe?.takeCancelled(op)) throw cancelled()
        throw err
      } finally {
        credentialProbe?.takeCancelled(op)
        if (opId) emit({ type: 'progress', opId, repoPath: repo ?? undefined, message: '', done: true })
      }
    },

    exclusive<T>(repo: string, fn: () => Promise<T>): Promise<T> {
      const prev = locks.get(repo) ?? Promise.resolve()
      const next = prev.catch(() => undefined).then(fn)
      const tail = next.catch(() => undefined)
      locks.set(repo, tail)
      void tail.then(() => {
        if (locks.get(repo) === tail) locks.delete(repo)
      })
      return next
    },

    async gitDir(repo) {
      // A repository folder that was moved or deleted is NOT_FOUND, also once its git dir is cached
      // (operationState() would otherwise report "no operation in progress").
      if (!existsSync(repo)) throw repoFolderNotFound(repo)
      const cached = gitDirs.get(repo)
      if (cached) return cached
      const res = await runGit(['rev-parse', '--absolute-git-dir'], { cwd: repo, allowFailure: true })
      if (res.code !== 0) throw new AdarError({ message: `${repo} is not a Git repository`, code: 'NOT_A_REPO', stderr: res.stderr })
      const dir = res.stdout.trim()
      gitDirs.set(repo, dir)
      return dir
    },

    async operationState(repo) {
      const dir = await ctx.gitDir(repo)
      const has = (p: string) => existsSync(path.join(dir, p))
      // git writes rebase-merge/interactive for every merge-backend rebase (plain ones too), so
      // only rebases started by interactiveRebase() — which leaves a marker — are interactive.
      if (has('rebase-merge')) return has(INTERACTIVE_REBASE_MARKER) ? 'rebase-interactive' : 'rebase'
      // The rebase is over (possibly finished from a terminal): drop the stale marker, unless one
      // of our own operations is running for this repo (interactiveRebase() writes the marker
      // before git creates rebase-merge, and cleans up itself).
      if (!locks.has(repo) && has(INTERACTIVE_REBASE_MARKER)) {
        await fs.rm(path.join(dir, INTERACTIVE_REBASE_MARKER), { force: true }).catch(() => undefined)
      }
      if (has('rebase-apply')) return has('rebase-apply/applying') ? 'am' : 'rebase'
      if (has('MERGE_HEAD')) return 'merge'
      if (has('CHERRY_PICK_HEAD')) return 'cherry-pick'
      if (has('REVERT_HEAD')) return 'revert'
      if (has('BISECT_LOG')) return 'bisect'
      // A multi-commit cherry-pick/revert stopped without *_HEAD (e.g. after resolving) keeps a sequencer dir.
      if (has('sequencer/todo')) {
        try {
          const opts = await fs.readFile(path.join(dir, 'sequencer/opts'), 'utf8')
          if (/action\s*=\s*revert/.test(opts)) return 'revert'
        } catch {
          /* ignore */
        }
        return 'cherry-pick'
      }
      return 'none'
    },

    async conflictedPaths(repo) {
      // Unmerged index entries. (Not `git diff --diff-filter=U`: porcelain diff rewrites the index.)
      const res = await runGit(['ls-files', '-u', '-z'], { cwd: repo, allowFailure: true })
      const paths = new Set<string>()
      for (const rec of res.stdout.split('\0')) {
        const tab = rec.indexOf('\t')
        if (tab > 0) paths.add(rec.slice(tab + 1))
      }
      return [...paths]
    },

    setNetworkEnv(env) {
      networkEnv = { ...env }
    },

    setCredentialProbe(probe) {
      credentialProbe = probe
    },

    ensureTmpDir() {
      return ensurePrivateDir(tmpDir)
    },

    forgetRepo(repo) {
      gitDirs.delete(repo)
    }
  }
  return ctx
}
