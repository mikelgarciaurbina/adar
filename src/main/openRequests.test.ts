import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pauseOpenRequests, requestOpen, takeOpenRequests } from './openRequests'

describe('open requests', () => {
  it('queues requests until the renderer asks, then pushes them; pausing queues again', () => {
    // Requests are absolute and normalised (on Windows '/a' resolves to the current drive: C:\a).
    const abs = (p: string) => path.resolve(p)
    requestOpen('/a')
    requestOpen('/a') // duplicates collapse while queued
    requestOpen('/b/../c')
    const pushed: string[] = []
    expect(takeOpenRequests((p) => pushed.push(p))).toEqual([abs('/a'), abs('/c')])
    requestOpen('/d')
    expect(pushed).toEqual([abs('/d')])
    pauseOpenRequests()
    requestOpen('/e')
    expect(pushed).toEqual([abs('/d')])
    expect(takeOpenRequests((p) => pushed.push(p))).toEqual([abs('/e')])
    requestOpen('   ')
    expect(pushed).toEqual([abs('/d')])
    pauseOpenRequests()
  })
})
