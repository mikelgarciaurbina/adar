// Backend composition: the GitContext, startup/system services, the read side
// (./git/read) and the write side (./git/write) assembled into one AdarApi.
// Used by Electron IPC (main/index.ts) and the HTTP dev bridge (server/devServer.ts).

import { existsSync } from 'node:fs'
import path from 'node:path'
import { API_METHODS, type AdarApi } from '@shared/api'
import { AdarError } from '@shared/errors'
import type { AdarEvent } from '@shared/types'
import { createGitContext, repoFolderNotFound, type GitContext } from './git/context'
import { WRITE_METHODS, type ReadOps, type WriteMethod } from './git/ops'
import { createReadOps } from './git/read'
import { createWriteOps } from './git/write'
import type { PlatformAdapter } from './platform'
import { createSystemServices, type SystemOptions } from './system'

export interface BackendDeps {
  platform: PlatformAdapter
  emit: (event: AdarEvent) => void
  /** Optional startup overrides (tests disable the login-shell PATH lookup, for example). */
  system?: Partial<SystemOptions>
}

export type Backend = AdarApi & { dispose(): Promise<void> }

type ReadMethod = Exclude<keyof AdarApi, WriteMethod>

const WRITE_SET: ReadonlySet<string> = new Set(WRITE_METHODS)
const READ_METHODS = API_METHODS.filter((m) => !WRITE_SET.has(m)) as ReadMethod[]

/**
 * Wait for the startup services (PATH fix, askpass) before spawning git, so the very first
 * commands already see the user's PATH and credential prompts. Bounded by ~3 s.
 */
function gateContext(ctx: GitContext, ready: Promise<void>): GitContext {
  return {
    ...ctx,
    git: (repo, args, opts) => ready.then(() => ctx.git(repo, args, opts)),
    gitGlobal: (args, opts) => ready.then(() => ctx.gitGlobal(args, opts)),
    gitNetwork: (repo, args, opts) => ready.then(() => ctx.gitNetwork(repo, args, opts))
  }
}

/** Copy methods bound to their owner (works for object literals and class instances alike). */
function bindMethods<T extends object, K extends keyof T & string>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const k of keys) {
    const v = obj[k]
    out[k] = (typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(obj) : v) as T[K]
  }
  return out
}

/** Methods whose first argument is not the root of an open repository. */
const NON_REPO_METHODS: ReadonlySet<string> = new Set([
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
  'findRepositories',
  'answerCredentialRequest',
  'openRepo',
  'trustRepo',
  'closeRepo',
  'initRepo',
  'cloneRepo'
])

/**
 * Failures caused by the repository folder having vanished (moved, deleted, unmounted) are
 * NOT_FOUND whatever step noticed it first — a raw ENOENT from a file read, NOT_A_REPO from
 * `git rev-parse`... — so the UI can offer to remove the tab instead of e.g. "initialise here".
 */
export function missingRepoError(err: unknown, repo: unknown): unknown {
  if (err instanceof AdarError && (err.code === 'NOT_FOUND' || err.code === 'INVALID_ARGUMENT' || err.code === 'CANCELLED')) return err
  if (typeof repo !== 'string' || !path.isAbsolute(repo) || existsSync(repo)) return err
  return repoFolderNotFound(repo, err instanceof AdarError ? err.command : undefined)
}

/** Wrap the repository methods so missingRepoError() applies to every one of them. */
function guardRepoMethods(api: AdarApi): void {
  const target = api as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
  for (const m of API_METHODS) {
    if (NON_REPO_METHODS.has(m)) continue
    const fn = target[m]
    target[m] = async (...args: unknown[]) => {
      try {
        return await fn(...args)
      } catch (err) {
        throw missingRepoError(err, args[0])
      }
    }
  }
}

export function createBackend(deps: BackendDeps): Backend {
  const base = createGitContext(deps.platform, deps.emit)
  const services = createSystemServices(base, deps.platform, deps.emit, deps.system)
  const ctx = gateContext(base, services.ready)

  const read: ReadOps = createReadOps(ctx, services)
  const write = createWriteOps(ctx)

  let disposed: Promise<void> | null = null
  const backend: Backend = {
    ...bindMethods(read, READ_METHODS),
    ...bindMethods(write, WRITE_METHODS),
    dispose() {
      if (!disposed) disposed = services.dispose()
      return disposed
    }
  }
  guardRepoMethods(backend)
  return backend
}
