// Git console history: credentials typed into a command must never be persisted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadHistory, pushHistory, redactHistory, redactHistoryEntry, saveHistory } from './history'

const KEY = 'adar.console.history'

class MemoryStorage {
  data = new Map<string, string>()
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v))
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

let storage: MemoryStorage
beforeEach(() => {
  storage = new MemoryStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
})
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('redactHistoryEntry', () => {
  it('hides credentials embedded in http(s) URLs (user:token or a bare token user)', () => {
    expect(redactHistoryEntry('remote set-url origin https://me:ghp_abc123@github.com/me/repo.git')).toBe(
      'remote set-url origin https://***@github.com/me/repo.git'
    )
    expect(redactHistoryEntry('clone https://oauth2:glpat-XYZ@gitlab.com/g/r.git dir')).toBe('clone https://***@gitlab.com/g/r.git dir')
    expect(redactHistoryEntry('clone "https://ghp_tok@github.com/o/r"')).toBe('clone "https://***@github.com/o/r"')
  })

  it('hides passwords in other URL schemes but keeps a plain ssh user', () => {
    expect(redactHistoryEntry('remote add x ssh://git:hunter2@host/r.git')).toBe('remote add x ssh://git:***@host/r.git')
    expect(redactHistoryEntry('remote add x ssh://git@github.com/o/r.git')).toBe('remote add x ssh://git@github.com/o/r.git')
    expect(redactHistoryEntry('remote add x git@github.com:o/r.git')).toBe('remote add x git@github.com:o/r.git')
  })

  it('hides extraHeader / credential config values in every quoting style', () => {
    expect(redactHistoryEntry('-c http.extraHeader="Authorization: Bearer SECRET" fetch')).toBe('-c http.extraHeader=*** fetch')
    expect(redactHistoryEntry(`-c 'http.extraheader=Authorization: Basic SECRET' fetch origin`)).toBe(`-c 'http.extraheader=***' fetch origin`)
    expect(redactHistoryEntry('-c "http.https://example.com/.extraHeader=PRIVATE-TOKEN: SECRET" pull')).toBe(
      '-c "http.https://example.com/.extraHeader=***" pull'
    )
    expect(redactHistoryEntry('config --global http.https://github.com/.extraheader "AUTHORIZATION: basic SECRET"')).toBe(
      'config --global http.https://github.com/.extraheader ***'
    )
    expect(redactHistoryEntry('config --unset credential.helper')).toBe('config --unset credential.helper')
    expect(redactHistoryEntry('config --get-all http.extraheader --show-origin')).toBe('config --get-all http.extraheader --show-origin')
    expect(redactHistoryEntry("-c credential.helper='!f() { echo password=SECRET; }; f' push")).toBe('-c credential.helper=*** push')
    expect(redactHistoryEntry('-c http.extraHeader=Authorization:SECRET fetch')).toBe('-c http.extraHeader=*** fetch')
  })

  it('leaves ordinary commands alone', () => {
    for (const line of ['status', 'log --oneline -20', 'commit -m "fix: a=b"', 'fetch https://github.com/o/r.git', 'config user.email a@b.c']) {
      expect(redactHistoryEntry(line)).toBe(line)
    }
  })
})

describe('persisted console history', () => {
  it('stores only redacted entries; the in-memory list keeps the raw line', () => {
    const raw = 'remote set-url origin https://me:ghp_SECRET@github.com/me/repo.git'
    const mem = pushHistory(['status'], raw)
    saveHistory(KEY, mem)
    expect(mem.at(-1)).toBe(raw)
    expect(storage.getItem(KEY)).not.toContain('ghp_SECRET')
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual(['status', 'remote set-url origin https://***@github.com/me/repo.git'])
  })

  it('scrubs tokens stored by earlier versions when loading', () => {
    storage.setItem(KEY, JSON.stringify(['status', 'clone https://oauth2:glpat-OLD@gitlab.com/g/r.git', '-c http.extraHeader="Authorization: Bearer OLD" fetch']))
    const loaded = loadHistory(KEY)
    expect(loaded).toEqual(['status', 'clone https://***@gitlab.com/g/r.git', '-c http.extraHeader=*** fetch'])
    expect(storage.getItem(KEY)).not.toMatch(/OLD/)
  })

  it('does not rewrite clean storage and keeps the latest of entries that redact to the same text', () => {
    expect(redactHistory(['push https://a:t1@h/r', 'status', 'push https://a:t2@h/r'])).toEqual(['status', 'push https://***@h/r'])
    storage.setItem(KEY, JSON.stringify(['status']))
    let writes = 0
    const set = storage.setItem.bind(storage)
    storage.setItem = (k, v) => {
      writes++
      set(k, v)
    }
    expect(loadHistory(KEY)).toEqual(['status'])
    expect(writes).toBe(0)
  })
})
