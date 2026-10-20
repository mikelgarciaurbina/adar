import { describe, expect, it } from 'vitest'
import { pauseOpenRequests, requestOpen, takeOpenRequests } from './openRequests'

describe('open requests', () => {
  it('queues requests until the renderer asks, then pushes them; pausing queues again', () => {
    requestOpen('/a')
    requestOpen('/a') // duplicates collapse while queued
    requestOpen('/b/../c')
    const pushed: string[] = []
    expect(takeOpenRequests((p) => pushed.push(p))).toEqual(['/a', '/c'])
    requestOpen('/d')
    expect(pushed).toEqual(['/d'])
    pauseOpenRequests()
    requestOpen('/e')
    expect(pushed).toEqual(['/d'])
    expect(takeOpenRequests((p) => pushed.push(p))).toEqual(['/e'])
    requestOpen('   ')
    expect(pushed).toEqual(['/d'])
    pauseOpenRequests()
  })
})
