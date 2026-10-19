// Cached author identity per repo for the "Committing as …" line. The cache is
// invalidated when the identity modal closes (the user may have changed it).

import { useEffect, useReducer, useRef, useState } from 'react'
import { api } from '@renderer/api/client'
import { useApp } from '@renderer/store/appStore'
import type { Identity } from '@shared/types'

const identityCache = new Map<string, Promise<Identity>>()

function loadIdentity(repo: string): Promise<Identity> {
  let p = identityCache.get(repo)
  if (!p) {
    p = api.getIdentity(repo)
    identityCache.set(repo, p)
    p.catch(() => identityCache.delete(repo))
  }
  return p
}

export function invalidateIdentity(repo?: string): void {
  if (repo) identityCache.delete(repo)
  else identityCache.clear()
}

export interface IdentityState {
  identity: Identity | null
  error: boolean
}

export function useIdentity(repo: string): IdentityState | null {
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const [state, setState] = useState<{ repo: string; version: number; value: IdentityState } | null>(null)
  const modalOpen = useApp((s) => s.modal?.kind === 'identity')
  const wasOpen = useRef(modalOpen)

  useEffect(() => {
    if (wasOpen.current && !modalOpen) {
      invalidateIdentity()
      bump()
    }
    wasOpen.current = modalOpen
  }, [modalOpen])

  useEffect(() => {
    let alive = true
    loadIdentity(repo).then(
      (identity) => alive && setState({ repo, version, value: { identity, error: false } }),
      () => alive && setState({ repo, version, value: { identity: null, error: true } })
    )
    return () => {
      alive = false
    }
  }, [repo, version])

  return state && state.repo === repo ? state.value : null
}
