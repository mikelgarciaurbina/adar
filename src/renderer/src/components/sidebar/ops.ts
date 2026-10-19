// Left-panel glue on top of the user-level actions in actions/git.tsx: prompts
// that belong to the sidebar (edit URL / rename remote), the per-remote fetch
// spinner, opening submodules / remotes and the graph selection helpers.

import { create } from 'zustand'
import { api } from '@renderer/api/client'
import * as git from '@renderer/actions/git'
import { prompt, validateRefName } from '@renderer/components/common/dialogs'
import { toast } from '@renderer/components/common/toast'
import { useApp, type RepoTab } from '@renderer/store/appStore'
import type { Ref, Stash } from '@shared/types'
import { remoteWebUrl } from './remoteUrl'

const store = () => useApp.getState()
const tabOf = (repo: string): RepoTab | undefined => store().tabs.find((t) => t.path === repo)

// ── Busy state owned by the sidebar (which remote a fetch belongs to) ─────

interface SidebarBusy {
  /** `${repo}\0${remote}` → true while a single-remote fetch runs. */
  fetching: Record<string, true>
}

export const useSidebarBusy = create<SidebarBusy>(() => ({ fetching: {} }))

export const remoteFetchKey = (repo: string, remote: string): string => `${repo}\u0000${remote}`

function setFetching(key: string, on: boolean): void {
  useSidebarBusy.setState((s) => {
    const fetching = { ...s.fetching }
    if (on) fetching[key] = true
    else delete fetching[key]
    return { fetching }
  })
}

// ── Remotes ────────────────────────────────────────────────────────────────

/** Fetch one remote (git.fetchRemote) while showing a spinner on that remote's row. */
export async function fetchRemote(repo: string, remote: string): Promise<boolean> {
  if (store().busy[`fetch:${repo}`]) {
    toast.info('A fetch is already in progress')
    return false
  }
  const key = remoteFetchKey(repo, remote)
  setFetching(key, true)
  try {
    const ok = await git.fetchRemote(repo, remote)
    // A single-remote fetch also counts for the status bar's "fetched … ago".
    if (ok) store().markFetched(repo)
    return ok
  } finally {
    setFetching(key, false)
  }
}

export async function editRemoteUrl(repo: string, name: string, current: string | null): Promise<boolean> {
  const next = await prompt({
    title: `Edit URL of ${name}`,
    label: 'Remote URL',
    defaultValue: current ?? '',
    placeholder: 'git@github.com:org/repo.git',
    monospace: true,
    confirmLabel: 'Save',
    validate: (v) => (v.trim() ? null : 'URL is required')
  })
  if (next === null) return false
  const url = next.trim()
  if (!url || url === current) return false
  return git.setRemoteUrl(repo, name, url)
}

/** Validation for the rename-remote prompt (exported for tests). */
export function validateRemoteName(value: string, current: string, existing: ReadonlySet<string>): string | null {
  const v = value.trim()
  if (v.includes('/')) return 'Remote names cannot contain “/”'
  const refError = validateRefName(v)
  if (refError) return refError
  return v !== current && existing.has(v) ? 'A remote with this name already exists' : null
}

export async function renameRemote(repo: string, name: string): Promise<boolean> {
  const existing = new Set((tabOf(repo)?.info?.remotes ?? []).map((r) => r.name))
  const next = await prompt({
    title: `Rename remote ${name}`,
    label: 'New name',
    defaultValue: name,
    monospace: true,
    confirmLabel: 'Rename',
    validate: (v) => validateRemoteName(v, name, existing)
  })
  if (next === null || next.trim() === name) return false
  // git.renameRemote keeps hidden / soloed remote branches under their new names.
  return git.renameRemote(repo, name, next.trim())
}

export function removeRemote(repo: string, name: string): Promise<boolean> {
  return git.removeRemote(repo, name)
}

export async function openRemoteInBrowser(url: string | null): Promise<void> {
  const web = url ? remoteWebUrl(url) : null
  if (!web) {
    toast.error('This remote has no web address')
    return
  }
  try {
    await api.openExternal(web)
  } catch (err) {
    toast.error(err)
  }
}

// ── Submodules ─────────────────────────────────────────────────────────────

export function updateSubmodules(repo: string): Promise<boolean> {
  if (store().busy[`submodules:${repo}`]) return Promise.resolve(false)
  return git.updateSubmodules(repo)
}

export async function openSubmodule(repo: string, path: string): Promise<boolean> {
  try {
    return await store().openRepo(git.absPath(repo, path))
  } catch (err) {
    toast.error(err)
    return false
  }
}

// ── Graph visibility ──────────────────────────────────────────────────────

/** Hide/show many refs with a single graph reload. */
export function setRefsHidden(repo: string, fullNames: readonly string[], hidden: boolean): void {
  if (!fullNames.length) return
  store().setRefsHidden(repo, [...fullNames], hidden)
}

export function toggleSolo(repo: string, fullName: string): void {
  const tab = tabOf(repo)
  store().setSoloRef(repo, tab?.soloRef === fullName ? null : fullName)
}

// ── Selection ──────────────────────────────────────────────────────────────

/**
 * Select a commit in the graph. The graph itself pages the log in until the commit is
 * loaded (and scrolls to it), so this must not call ensureCommitLoaded concurrently.
 */
export function selectCommit(repo: string, sha: string): void {
  const s = store()
  s.select(repo, { kind: 'commit', sha })
  s.setCenter(repo, { kind: 'graph' })
}

export function selectRef(repo: string, ref: Ref): void {
  selectCommit(repo, ref.sha)
}

export function selectStash(repo: string, stash: Stash): void {
  const s = store()
  s.select(repo, { kind: 'stash', index: stash.index, sha: stash.sha })
  s.setCenter(repo, { kind: 'graph' })
}
