import { describe, expect, it } from 'vitest'
import { loadCollapsedSections, loadToggled, MAX_TOGGLED, saveCollapsedSections, saveToggled, sectionStorageKey, treeStorageKey } from './storage'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k)
  }
}

const throwing = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  }
}

describe('collapsed sections', () => {
  it('round-trips per section', () => {
    const s = memoryStorage()
    saveCollapsedSections(new Set(['tags', 'stashes'] as const), s)
    expect(s.map.get(sectionStorageKey('tags'))).toBe('1')
    expect(s.map.has(sectionStorageKey('local'))).toBe(false)
    expect([...loadCollapsedSections(s)].sort()).toEqual(['stashes', 'tags'])
    saveCollapsedSections(new Set(), s)
    expect(loadCollapsedSections(s).size).toBe(0)
  })

  it('survives broken or missing storage', () => {
    expect(loadCollapsedSections(throwing).size).toBe(0)
    expect(() => saveCollapsedSections(new Set(['local'] as const), throwing)).not.toThrow()
    expect(loadCollapsedSections(null).size).toBe(0)
    expect(() => saveCollapsedSections(new Set(), null)).not.toThrow()
  })
})

describe('toggled folders', () => {
  it('round-trips per repo', () => {
    const s = memoryStorage()
    saveToggled('/repo/a', new Set(['f:local:feature', 'r:origin']), s)
    expect([...loadToggled('/repo/a', s)]).toEqual(['f:local:feature', 'r:origin'])
    expect(loadToggled('/repo/b', s).size).toBe(0)
    saveToggled('/repo/a', new Set(), s)
    expect(s.map.has(treeStorageKey('/repo/a'))).toBe(false)
  })

  it('caps the number of remembered keys', () => {
    const s = memoryStorage()
    const many = new Set(Array.from({ length: MAX_TOGGLED + 50 }, (_, i) => `f:local:x${i}`))
    saveToggled('/r', many, s)
    const loaded = loadToggled('/r', s)
    expect(loaded.size).toBe(MAX_TOGGLED)
    expect(loaded.has(`f:local:x${MAX_TOGGLED + 49}`)).toBe(true)
    expect(loaded.has('f:local:x0')).toBe(false)
  })

  it('ignores corrupt data and broken storage', () => {
    const s = memoryStorage()
    s.map.set(treeStorageKey('/r'), '{not json')
    expect(loadToggled('/r', s).size).toBe(0)
    s.map.set(treeStorageKey('/r'), JSON.stringify(['ok', 3, null]))
    expect([...loadToggled('/r', s)]).toEqual(['ok'])
    s.map.set(treeStorageKey('/r'), JSON.stringify({ a: 1 }))
    expect(loadToggled('/r', s).size).toBe(0)
    expect(loadToggled('/r', throwing).size).toBe(0)
    expect(() => saveToggled('/r', new Set(['a']), throwing)).not.toThrow()
  })
})
