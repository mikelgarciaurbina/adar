// Pull request state for the UI: the GitHub sign-in and each repository's pull requests,
// refreshed when a repository is shown, after every fetch and when the window comes back
// (at most once a minute unless forced). Nothing is asked while pull requests are off.

import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '@renderer/api/client'
import { indexPulls, pullForRef, type PullIndex } from '@renderer/lib/pulls'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import { describeError } from '@shared/errors'
import type { GithubConnection, PullRequest, RepoPullRequests } from '@shared/hosting'
import { githubRepoOf } from '@shared/remoteUrl'
import type { Ref, RefsResult } from '@shared/types'

/** Pull requests are asked for again after this long when nothing forces it. */
const STALE_MS = 60_000

export interface RepoPulls {
  data: RepoPullRequests | null
  error: string | null
  loading: boolean
  /** When the last answer arrived (ms). */
  at: number
}

interface PullsState {
  connection: GithubConnection | null
  repos: Record<string, RepoPulls>
  /** detectGh: also ask whether the GitHub CLI is signed in (only the sign-in dialog needs it). */
  loadConnection(detectGh?: boolean): Promise<GithubConnection | null>
  setConnection(connection: GithubConnection): void
  load(repo: string, opts?: { force?: boolean }): Promise<RepoPullRequests | null>
}

const inFlight = new Map<string, Promise<RepoPullRequests | null>>()

export const usePulls = create<PullsState>()((set, get) => ({
  connection: null,
  repos: {},

  async loadConnection(detectGh = false) {
    try {
      const connection = await api.getGithubConnection({ detectGh })
      set({ connection })
      return connection
    } catch {
      return null
    }
  },

  setConnection(connection) {
    // Signing out (or in as someone else) invalidates every list.
    set((s) => ({ connection, repos: connection.method === s.connection?.method && connection.login === s.connection?.login ? s.repos : {} }))
  },

  load(repo, opts = {}) {
    const running = inFlight.get(repo)
    if (running) return running
    const prev = get().repos[repo]
    if (!get().connection?.method) return Promise.resolve(null)
    if (!opts.force && prev && !prev.error && Date.now() - prev.at < STALE_MS) return Promise.resolve(prev.data)
    const EMPTY: RepoPulls = { data: null, error: null, loading: false, at: 0 }
    const patch = (p: Partial<RepoPulls>) => set((s) => ({ repos: { ...s.repos, [repo]: { ...(s.repos[repo] ?? EMPTY), ...p } } }))
    patch({ loading: true })
    const run = api
      .getPullRequests(repo)
      .then((data) => {
        patch({ data, error: null, loading: false, at: Date.now() })
        return data
      })
      .catch((err) => {
        // Keep the last list; the panel shows why it is not fresh.
        patch({ error: describeError(err), loading: false, at: Date.now() })
        if ((err as { code?: string }).code === 'AUTH_FAILED') void get().loadConnection()
        return get().repos[repo]?.data ?? null
      })
      .finally(() => inFlight.delete(repo))
    inFlight.set(repo, run)
    return run
  }
}))

/** True when one of the repository's remotes is on github.com. */
export function isGithubRepo(tab: Pick<RepoTab, 'info'> | undefined | null): boolean {
  return !!tab?.info?.remotes.some((r) => githubRepoOf(r.fetchUrl || r.pushUrl || ''))
}

// Index per (pull requests, refs) pair: every graph row looks its branch up in the same one.
const indexCache = new WeakMap<object, WeakMap<object, PullIndex>>()
const EMPTY_REFS = {}

export function pullIndexOf(data: RepoPullRequests | null | undefined, refs: RefsResult | null): PullIndex {
  if (!data) return indexPulls(null, refs)
  let byRefs = indexCache.get(data)
  if (!byRefs) indexCache.set(data, (byRefs = new WeakMap()))
  const key = refs ?? EMPTY_REFS
  let index = byRefs.get(key)
  if (!index) byRefs.set(key, (index = indexPulls(data, refs)))
  return index
}

/** Pull requests of a repository tab, indexed by branch (re-renders when either changes). */
export function usePullIndex(tab: Pick<RepoTab, 'path' | 'refs'> | null): { index: PullIndex; data: RepoPullRequests | null; state: RepoPulls | null } {
  const state = usePulls((s) => (tab ? (s.repos[tab.path] ?? null) : null))
  const data = state?.data ?? null
  return { index: pullIndexOf(data, tab?.refs ?? null), data, state }
}

/** The first pull request among some branch labels of the active repository (local branches, then remote ones). */
export function usePullForRefs(refs: readonly Pick<Ref, 'name' | 'type'>[]): PullRequest | undefined {
  const repo = useApp((s) => s.activePath)
  const all = useApp((s) => s.tabs.find((t) => t.path === s.activePath)?.refs ?? null)
  const data = usePulls((s) => (repo ? (s.repos[repo]?.data ?? null) : null))
  if (!refs.length || !data) return undefined
  const index = pullIndexOf(data, all)
  for (const r of refs) {
    const pr = pullForRef(index, r)
    if (pr) return pr
  }
  return undefined
}

/** Keeps the active repository's pull requests fresh (App mounts it once). */
export function usePullRequestSync(): void {
  const activePath = useApp((s) => s.activePath)
  const lastFetch = useApp((s) => s.tabs.find((t) => t.path === s.activePath)?.lastFetch ?? null)
  const github = useApp((s) => isGithubRepo(s.tabs.find((t) => t.path === s.activePath)))
  const on = usePulls((s) => !!s.connection?.method)

  useEffect(() => {
    void usePulls.getState().loadConnection()
  }, [])
  useEffect(() => {
    if (on && github && activePath) void usePulls.getState().load(activePath)
  }, [on, github, activePath])
  useEffect(() => {
    if (on && github && activePath && lastFetch) void usePulls.getState().load(activePath, { force: true })
    // Only a new fetch forces a reload; switching tabs goes through the effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastFetch])
  useEffect(() => {
    const onFocus = () => {
      const s = useApp.getState()
      const tab = s.tabs.find((t) => t.path === s.activePath)
      if (tab && usePulls.getState().connection?.method && isGithubRepo(tab)) void usePulls.getState().load(tab.path)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}

/** Whether pushing `branch` should offer to create a pull request (GitHub, signed in, none open for it yet). */
export function shouldOfferPullRequest(repo: string, branch: string): boolean {
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  const data = usePulls.getState().repos[repo]?.data ?? null
  if (!usePulls.getState().connection?.method || !isGithubRepo(tab) || !data || branch === data.defaultBranch) return false
  const pr = pullIndexOf(data, tab?.refs ?? null).byLocal.get(branch)
  return !pr || (pr.state !== 'open' && pr.state !== 'draft')
}

/** A pull request for dropping branch `source` on `target`: head and base on the GitHub remote, or null. */
export function pullRequestForDrop(repo: string, source: Pick<Ref, 'name' | 'type'>, target: Pick<Ref, 'name' | 'type'>): { head: string; base: string } | null {
  const tab = useApp.getState().tabs.find((t) => t.path === repo)
  if (source.type !== 'branch' || !isGithubRepo(tab)) return null
  const remote = usePulls.getState().repos[repo]?.data?.remote ?? 'origin'
  const refs = tab?.refs ?? null
  let base: string | null = null
  if (target.type === 'remote') base = target.name.startsWith(remote + '/') ? target.name.slice(remote.length + 1) : null
  else if (target.type === 'branch') {
    const up = refs?.branches.find((b) => b.name === target.name)?.upstream
    base = up?.startsWith(remote + '/') ? up.slice(remote.length + 1) : null
  }
  if (!base || base === source.name || !refs?.remotes.some((r) => r.name === `${remote}/${base}`)) return null
  return { head: source.name, base }
}
