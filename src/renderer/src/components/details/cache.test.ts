import { describe, expect, it, vi } from 'vitest'
import { cacheGet, cacheHas, cacheInvalidate, loadCached } from './cache'

describe('loadCached', () => {
  it('loads once and serves later calls from the cache', async () => {
    const loader = vi.fn(async () => 42)
    expect(await loadCached('t1', loader)).toBe(42)
    expect(await loadCached('t1', loader)).toBe(42)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(cacheHas('t1')).toBe(true)
    expect(cacheGet<number>('t1')).toBe(42)
  })

  it('shares in-flight promises between concurrent callers', async () => {
    let resolve!: (v: string) => void
    const loader = vi.fn(() => new Promise<string>((r) => (resolve = r)))
    const p1 = loadCached('t2', loader)
    const p2 = loadCached('t2', loader)
    resolve('ok')
    expect(await Promise.all([p1, p2])).toEqual(['ok', 'ok'])
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('does not cache failures', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(loadCached('t3', failing)).rejects.toThrow('boom')
    expect(cacheHas('t3')).toBe(false)
    expect(await loadCached('t3', async () => 'second try')).toBe('second try')
  })

  it('invalidates by prefix', async () => {
    await loadCached('repo-a\u0000x', async () => 1)
    await loadCached('repo-b\u0000x', async () => 2)
    cacheInvalidate('repo-a')
    expect(cacheHas('repo-a\u0000x')).toBe(false)
    expect(cacheHas('repo-b\u0000x')).toBe(true)
  })

  it('evicts the least recently used entries beyond its capacity', async () => {
    for (let i = 0; i < 320; i++) await loadCached(`lru-${i}`, async () => i)
    expect(cacheHas('lru-0')).toBe(false)
    expect(cacheHas('lru-319')).toBe(true)
  })
})
