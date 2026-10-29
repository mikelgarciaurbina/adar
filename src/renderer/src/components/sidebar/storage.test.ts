import { describe, expect, it } from 'vitest'
import { folderStorageKey, loadCollapsedSections, loadFolders, MAX_FOLDER_CHOICES, saveCollapsedSections, saveFolders, sectionStorageKey } from './storage'

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

describe('opened and closed folders', () => {
  it('round-trips per repo, and drops the old format', () => {
    const s = memoryStorage()
    s.map.set('adar.sb.tree./repo/a', JSON.stringify(['f:local:feature']))
    saveFolders('/repo/a', new Map([['f:local:feature', true], ['r:origin', false]]), s)
    expect([...loadFolders('/repo/a', s)]).toEqual([['f:local:feature', true], ['r:origin', false]])
    expect(s.map.has('adar.sb.tree./repo/a')).toBe(false)
    expect(loadFolders('/repo/b', s).size).toBe(0)
    saveFolders('/repo/a', new Map(), s)
    expect(s.map.has(folderStorageKey('/repo/a'))).toBe(false)
  })

  it('caps the number of remembered folders', () => {
    const s = memoryStorage()
    const many = new Map(Array.from({ length: MAX_FOLDER_CHOICES + 50 }, (_, i) => [`f:local:x${i}`, true] as const))
    saveFolders('/r', many, s)
    const loaded = loadFolders('/r', s)
    expect(loaded.size).toBe(MAX_FOLDER_CHOICES)
    expect(loaded.has(`f:local:x${MAX_FOLDER_CHOICES + 49}`)).toBe(true)
    expect(loaded.has('f:local:x0')).toBe(false)
  })

  it('ignores corrupt data and broken storage', () => {
    const s = memoryStorage()
    s.map.set(folderStorageKey('/r'), '{not json')
    expect(loadFolders('/r', s).size).toBe(0)
    s.map.set(folderStorageKey('/r'), JSON.stringify([['ok', true], ['no', 'yes'], [3, false], 'x', null]))
    expect([...loadFolders('/r', s)]).toEqual([['ok', true]])
    s.map.set(folderStorageKey('/r'), JSON.stringify({ a: 1 }))
    expect(loadFolders('/r', s).size).toBe(0)
    expect(loadFolders('/r', throwing).size).toBe(0)
    expect(() => saveFolders('/r', new Map([['a', true]]), throwing)).not.toThrow()
  })
})
