// Module-level cache for immutable right-panel data (commit details, stash
// files, compare file lists — all keyed by sha) plus a hook that reads through
// it. Cached entries render synchronously, so re-selecting a commit never
// flashes a spinner.

import { useEffect, useReducer, useRef, useState } from 'react'
import { describeError } from '@shared/errors'

const MAX_ENTRIES = 300

const cache = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

function touch(key: string, value: unknown): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function cacheHas(key: string): boolean {
  return cache.has(key)
}

export function cacheGet<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined
}

export function cacheInvalidate(prefix: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k)
}

/** Load once per key; concurrent callers share the same promise. Failures are not cached. */
export function loadCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return Promise.resolve(cache.get(key) as T)
  let p = inflight.get(key) as Promise<T> | undefined
  if (!p) {
    p = loader().then(
      (value) => {
        inflight.delete(key)
        touch(key, value)
        return value
      },
      (err) => {
        inflight.delete(key)
        throw err
      }
    )
    inflight.set(key, p)
  }
  return p
}

export interface CachedState<T> {
  data: T | null
  error: string | null
  loading: boolean
  retry: () => void
}

/** Read `key` through the cache, loading it with `loader` when missing. `key = null` disables loading. */
export function useCached<T>(key: string | null, loader: () => Promise<T>): CachedState<T> {
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [attempt, bump] = useReducer((n: number) => n + 1, 0)
  const [result, setResult] = useState<{ key: string; attempt: number; data?: T; error?: string } | null>(null)

  const hit = key !== null && cache.has(key)

  useEffect(() => {
    if (key === null || cache.has(key)) return
    let alive = true
    loadCached(key, () => loaderRef.current()).then(
      (data) => {
        if (alive) setResult({ key, attempt, data })
      },
      (err) => {
        if (alive) setResult({ key, attempt, error: describeError(err) })
      }
    )
    return () => {
      alive = false
    }
  }, [key, attempt])

  if (key === null) return { data: null, error: null, loading: false, retry: bump }
  if (hit) {
    // Keep LRU order fresh without re-rendering.
    touch(key, cache.get(key))
    return { data: cache.get(key) as T, error: null, loading: false, retry: bump }
  }
  if (result && result.key === key && result.attempt === attempt) {
    return { data: result.data ?? null, error: result.error ?? null, loading: false, retry: bump }
  }
  return { data: null, error: null, loading: true, retry: bump }
}
