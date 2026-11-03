// What the reflog view shows, per repository: the lost commits (grouped), the moves of HEAD or a branch,
// and what looking deeper found. Loaded when the view opens and again when the repository's refs change.

import { create } from 'zustand'
import { api } from '@renderer/api/client'
import { describeError } from '@shared/errors'
import type { DanglingCommit, LostCommits, ReflogEntry } from '@shared/types'

export interface Loadable<T> {
  data: T | null
  loading: boolean
  error: string | null
}

interface ReflogState {
  lost: Record<string, Loadable<LostCommits>>
  /** By "<repo>\0<branch or empty for HEAD>". */
  moves: Record<string, Loadable<ReflogEntry[]>>
  dangling: Record<string, Loadable<DanglingCommit[]>>
}

export const useReflog = create<ReflogState>()(() => ({ lost: {}, moves: {}, dangling: {} }))

export const movesKey = (repo: string, ref: string | null) => `${repo}\0${ref ?? ''}`

type Section = 'lost' | 'moves' | 'dangling'

function setEntry<T>(section: Section, key: string, patch: Partial<Loadable<T>>): void {
  useReflog.setState((s) => {
    const prev = (s[section][key] as Loadable<T> | undefined) ?? { data: null, loading: false, error: null }
    return { [section]: { ...s[section], [key]: { ...prev, ...patch } } } as Partial<ReflogState>
  })
}

/** Load into `section`, keeping what was shown until the new answer arrives. */
async function load<T>(section: Section, key: string, fetch: () => Promise<T>): Promise<void> {
  setEntry<T>(section, key, { loading: true, error: null })
  try {
    setEntry<T>(section, key, { data: await fetch(), loading: false })
  } catch (err) {
    setEntry<T>(section, key, { loading: false, error: describeError(err) })
  }
}

export const loadLostCommits = (repo: string) => load('lost', repo, () => api.getLostCommits(repo))
export const loadMoves = (repo: string, ref: string | null) => load('moves', movesKey(repo, ref), () => api.getReflog(repo, ref))
export const lookDeeper = (repo: string) => load('dangling', repo, () => api.findDanglingCommits(repo))

/** Drop what looking deeper found (branches moved since: some of it may be on one now). */
export function forgetDeeper(repo: string): void {
  if (useReflog.getState().dangling[repo]?.data) setEntry('dangling', repo, { data: null })
}
