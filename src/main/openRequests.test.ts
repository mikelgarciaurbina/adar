import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { endOpenRequests, pauseOpenRequests, requestOpen, resumeOpenRequests, takeOpenRequests } from './openRequests'

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
    endOpenRequests()
  })

  it('goes on with the same renderer when a load went nowhere, and waits for the next one when it is gone', () => {
    const abs = (p: string) => path.resolve(p)
    const pushed: string[] = []
    expect(takeOpenRequests((p) => pushed.push(p))).toEqual([])
    // A navigation the window refuses: the page starts loading, then stops where it was.
    pauseOpenRequests()
    requestOpen('/while-loading')
    expect(pushed).toEqual([])
    resumeOpenRequests()
    expect(pushed).toEqual([abs('/while-loading')])
    requestOpen('/after')
    expect(pushed).toEqual([abs('/while-loading'), abs('/after')])
    // A new page: what arrives waits until it asks, and resuming brings nothing back.
    pauseOpenRequests()
    endOpenRequests()
    requestOpen('/for-the-next-page')
    resumeOpenRequests()
    expect(pushed).toHaveLength(2)
    const next: string[] = []
    expect(takeOpenRequests((p) => next.push(p))).toEqual([abs('/for-the-next-page')])
    endOpenRequests()
  })
})
