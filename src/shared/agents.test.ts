// The shared rules of Agents at work: working, quiet and idle, which agent, the strip, new commits, settings.

import { describe, expect, it } from 'vitest'
import {
  agentOf,
  agentState,
  DEFAULT_AGENT_PREFIXES,
  newSince,
  parseAgentNotice,
  sanitizeAgentPrefixes,
  sanitizeWorktreesSeen,
  stripOf,
  type AgentWorktree
} from './agents'

const MIN = 60_000
const NOW = Date.UTC(2026, 10, 3, 17, 42, 30)

function wt(over: Partial<AgentWorktree> = {}): AgentWorktree {
  return {
    path: '/p/claude-rooms',
    repo: '/p/booking',
    name: 'claude-rooms',
    isMain: false,
    branch: 'claude/hold-rooms',
    head: 'a'.repeat(40),
    files: [],
    fileCount: 0,
    added: 0,
    removed: 0,
    base: 'main',
    ahead: 0,
    unpushed: null,
    upstream: null,
    commits: [],
    coAuthors: [],
    activity: [],
    lastChange: null,
    since: null,
    ...over
  }
}

describe('agentState', () => {
  it('is working while things change, quiet when it stops with work left, idle otherwise', () => {
    expect(agentState(wt(), NOW, 5)).toBe('idle')
    expect(agentState(wt({ lastChange: NOW - 4000, fileCount: 7 }), NOW, 5)).toBe('working')
    expect(agentState(wt({ lastChange: NOW - 4 * MIN, fileCount: 7 }), NOW, 5)).toBe('working')
    expect(agentState(wt({ lastChange: NOW - 6 * MIN, fileCount: 3 }), NOW, 5)).toBe('quiet')
    // Commits not pushed are work left too; a branch never pushed has all its commits to push.
    expect(agentState(wt({ lastChange: NOW - 6 * MIN, ahead: 2 }), NOW, 5)).toBe('quiet')
    expect(agentState(wt({ lastChange: NOW - 6 * MIN, ahead: 2, unpushed: 0, upstream: 'origin/x' }), NOW, 5)).toBe('idle')
    expect(agentState(wt({ lastChange: NOW - 31 * MIN, fileCount: 3 }), NOW, 5)).toBe('idle')
    expect(agentState(wt({ lastChange: NOW - 3 * MIN, fileCount: 3 }), NOW, 2)).toBe('quiet')
  })
})

describe('agentOf', () => {
  it('takes the trailers first, then the branch prefix, then the folder', () => {
    expect(agentOf(wt({ coAuthors: ['Codex'] }), DEFAULT_AGENT_PREFIXES)).toBe('Codex')
    expect(agentOf(wt(), DEFAULT_AGENT_PREFIXES)).toBe('Claude')
    expect(agentOf(wt({ branch: 'ane/fix-dates' }), DEFAULT_AGENT_PREFIXES)).toBeNull()
    expect(agentOf(wt({ branch: 'bot/x' }), [{ prefix: 'bot/', name: 'Devin' }])).toBe('Devin')
    expect(agentOf(wt({ branch: 'fix', path: '/p/booking/.claude/worktrees/fix' }), [])).toBe('Claude')
  })
})

describe('stripOf', () => {
  it('puts files per minute and commits on the last 30 minutes', () => {
    const minute = Math.floor(NOW / MIN) * MIN
    const strip = stripOf(
      wt({
        activity: [
          [minute - 40 * MIN, 9],
          [minute - 29 * MIN, 2],
          [minute, 3]
        ],
        commits: [{ sha: 'b'.repeat(40), subject: 'x', at: NOW - 10 * MIN }]
      }),
      NOW
    )
    expect(strip.bars).toHaveLength(30)
    expect(strip.bars[0]).toBe(2)
    expect(strip.bars[29]).toBe(3)
    expect(strip.bars.reduce((a, b) => a + b)).toBe(5)
    expect(strip.commits).toEqual([19])
  })
})

describe('newSince', () => {
  const commits = ['c3', 'c2', 'c1'].map((sha, i) => ({ sha: sha.repeat(20), subject: sha, at: NOW - i * MIN }))
  it('lists the commits above the one the user saw, or newer than when they looked', () => {
    const w = wt({ head: commits[0].sha, commits })
    expect(newSince(w, undefined)).toEqual([])
    expect(newSince(w, { sha: commits[0].sha, at: NOW })).toEqual([])
    expect(newSince(w, { sha: commits[2].sha, at: 0 }).map((c) => c.subject)).toEqual(['c3', 'c2'])
    expect(newSince(w, { sha: 'f'.repeat(40), at: NOW - 90_000 }).map((c) => c.subject)).toEqual(['c3', 'c2'])
  })
})

describe('settings and notices', () => {
  it('keeps well-formed prefixes and seen marks only', () => {
    expect(sanitizeAgentPrefixes([{ prefix: ' claude/ ', name: 'Claude' }, { prefix: 'claude/', name: 'Again' }, { prefix: '', name: 'x' }, 'x'])).toEqual([
      { prefix: 'claude/', name: 'Claude' }
    ])
    expect(sanitizeWorktreesSeen({ '/a': { sha: 'a'.repeat(40), at: 2 }, '/b': { sha: 'nope', at: 1 }, '/c': null })).toEqual({ '/a': { sha: 'a'.repeat(40), at: 2 } })
  })

  it('validates the notices the UI asks for', () => {
    const open = { path: '/p/claude-rooms', repo: '/p/booking', view: 'commit', sha: 'a'.repeat(40) }
    expect(parseAgentNotice({ title: 't', subtitle: 's', body: 'b', open })).toEqual({ title: 't', subtitle: 's', body: 'b', open })
    expect(parseAgentNotice({ title: 't', subtitle: 's', body: 'b', open: { ...open, view: 'shell' } })).toBeNull()
    expect(parseAgentNotice({ title: 't', subtitle: 's', body: 'b', open: { path: null, repo: '/p', view: 'agents', sha: 'zz' } })).toEqual({
      title: 't',
      subtitle: 's',
      body: 'b',
      open: { path: null, repo: '/p', view: 'agents' }
    })
  })
})
