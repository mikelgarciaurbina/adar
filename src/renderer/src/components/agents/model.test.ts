// Agents at work in the UI: the words for a worktree's state, the dot a tab carries, the Agents view's columns
// and which events become notifications.

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AgentEvent, AgentWorktree } from '@shared/agents'
import { aheadText, boardOf, noticesFor, scopeOf, shortAgo, stateLabel, stateOf, tabDot } from './model'

const MIN = 60_000
const NOW = Date.UTC(2026, 10, 3, 17, 42, 30)
const S = DEFAULT_SETTINGS

function wt(over: Partial<AgentWorktree> = {}): AgentWorktree {
  return {
    path: '/p/claude-rooms',
    repo: '/p/booking-web',
    name: 'claude-rooms',
    isMain: false,
    branch: 'claude/hold-rooms',
    head: 'a'.repeat(40),
    files: [],
    fileCount: 7,
    added: 212,
    removed: 38,
    base: 'main',
    ahead: 3,
    unpushed: null,
    upstream: null,
    commits: [],
    coAuthors: [],
    activity: [],
    lastChange: NOW - 4000,
    since: NOW - 16 * MIN,
    ...over
  }
}

describe('labels', () => {
  it('says what a worktree is doing', () => {
    expect(shortAgo(4000)).toBe('now')
    expect(shortAgo(12_000)).toBe('12 s')
    expect(shortAgo(6 * MIN)).toBe('6 min')
    expect(stateLabel(wt(), 'working', NOW)).toBe('7 files · now')
    const quiet = wt({ lastChange: NOW - 6 * MIN, fileCount: 3 })
    expect(stateOf(quiet, NOW, S)).toBe('quiet')
    expect(stateLabel(quiet, 'quiet', NOW)).toBe('quiet 6 min')
    expect(aheadText(wt())).toEqual({ ahead: '3 commits ahead of main', push: 'not pushed' })
    expect(aheadText(wt({ ahead: 0 }))).toEqual({ ahead: 'nothing committed yet', push: null })
    expect(aheadText(wt({ unpushed: 1, upstream: 'origin/x' })).push).toBe('1 not pushed')
  })
})

describe('tabDot', () => {
  it('marks a worktree’s own tab, and its repository’s tab while one of them works', () => {
    const working = wt()
    const quiet = wt({ path: '/p/codex-rates', lastChange: NOW - 6 * MIN })
    expect(tabDot({ path: '/p/claude-rooms', mainWorktree: '/p/booking-web' }, [working, quiet], NOW, S)).toBe('working')
    expect(tabDot({ path: '/p/codex-rates', mainWorktree: '/p/booking-web' }, [working, quiet], NOW, S)).toBe('quiet')
    expect(tabDot({ path: '/p/booking-web', mainWorktree: null }, [working, quiet], NOW, S)).toBe('working')
    expect(tabDot({ path: '/p/booking-web', mainWorktree: null }, [quiet], NOW, S)).toBeNull()
    expect(tabDot({ path: '/p/other', mainWorktree: null }, [working], NOW, S)).toBeNull()
  })
})

describe('scopeOf', () => {
  const rooms = wt()
  const main = wt({ path: '/p/booking-web', name: 'booking-web', isMain: true, branch: 'main' })
  const api = wt({ path: '/p/api-codex', repo: '/p/booking-api', name: 'api-codex', branch: 'codex/rates' })
  const other = wt({ path: '/p/blog-claude', repo: '/p/blog', name: 'blog-claude' })
  const all = [rooms, main, api, other]
  const groups = [{ id: 'g', name: 'booking', color: 'ember' as const, repos: ['/p/booking-web', '/p/booking-api'], collapsed: false }]
  const mainOf = (p: string) => (p === '/p/claude-rooms' ? '/p/booking-web' : p)
  const paths = (s: { list: AgentWorktree[] }) => s.list.map((w) => w.path)

  it("shows the active repository's worktrees, the main folder included, from its tab or a worktree's", () => {
    const tab = { path: '/p/booking-web', mainWorktree: null }
    expect(paths(scopeOf(all, tab, 'repo', groups, mainOf))).toEqual(['/p/claude-rooms', '/p/booking-web'])
    const fromWorktree = scopeOf(all, { path: '/p/claude-rooms', mainWorktree: '/p/booking-web' }, 'repo', groups, mainOf)
    expect(paths(fromWorktree)).toEqual(['/p/claude-rooms', '/p/booking-web'])
    expect(fromWorktree.repo).toBe('/p/booking-web')
  })

  it("shows its tab group's or every open tab's", () => {
    const tab = { path: '/p/booking-web', mainWorktree: null }
    const group = scopeOf(all, tab, 'group', groups, mainOf)
    expect(paths(group)).toEqual(['/p/claude-rooms', '/p/booking-web', '/p/api-codex'])
    expect(group.group?.name).toBe('booking')
    expect(paths(scopeOf(all, tab, 'all', groups, mainOf))).toHaveLength(4)
  })

  it('falls back to the repository for a tab outside any group', () => {
    const s = scopeOf(all, { path: '/p/blog', mainWorktree: null }, 'group', groups, mainOf)
    expect(s.scope).toBe('repo')
    expect(s.group).toBeNull()
    expect(paths(s)).toEqual(['/p/blog-claude'])
  })
})

describe('boardOf', () => {
  it('sorts worktrees into working, quiet, idle and folded', () => {
    const board = boardOf(
      [
        wt({ path: '/a', name: 'a' }),
        wt({ path: '/b', name: 'b', lastChange: NOW - 6 * MIN }),
        wt({ path: '/c', name: 'c', lastChange: NOW - 2 * 3600_000 }),
        wt({ path: '/d', name: 'd', lastChange: NOW - 3 * 24 * 3600_000 }),
        wt({ path: '/e', name: 'e', lastChange: null })
      ],
      NOW,
      S
    )
    expect([board.working, board.quiet, board.idle, board.folded].map((l) => l.map((w) => w.name))).toEqual([['a'], ['b'], ['c'], ['d', 'e']])
  })
})

describe('noticesFor', () => {
  const name = (repo: string) => repo.split('/').pop()!
  const commit = (path: string, own = false): AgentEvent => ({
    kind: 'commit',
    path,
    repo: '/p/booking-web',
    commits: [{ sha: 'b'.repeat(40), subject: 'Hold rooms while paying', at: NOW }],
    files: 4,
    own
  })

  it('tells what an agent did, except Adar’s own work and the worktree in front', () => {
    const worktrees = { '/p/claude-rooms': wt({ coAuthors: ['Claude'] }) }
    const [n] = noticesFor([commit('/p/claude-rooms')], worktrees, S, null, name)
    expect(n).toEqual({
      title: 'claude/hold-rooms committed',
      subtitle: 'booking-web · claude-rooms · with Claude',
      body: 'Hold rooms while paying · 4 files',
      open: { path: '/p/claude-rooms', repo: '/p/booking-web', view: 'commit', sha: 'b'.repeat(40) }
    })
    expect(noticesFor([commit('/p/claude-rooms', true)], worktrees, S, null, name)).toEqual([])
    expect(noticesFor([commit('/p/claude-rooms')], worktrees, S, '/p/claude-rooms', name)).toEqual([])
    expect(noticesFor([commit('/p/claude-rooms')], worktrees, { ...S, notifyAgentCommits: false }, null, name)).toEqual([])
  })

  it('says when one goes quiet, unless muted, and bundles more than three', () => {
    const quiet: AgentEvent = { kind: 'quiet', path: '/p/claude-rooms', repo: '/p/booking-web' }
    const worktrees = { '/p/claude-rooms': wt({ fileCount: 7 }) }
    expect(noticesFor([quiet], worktrees, S, null, name)[0]).toMatchObject({ title: 'claude-rooms went quiet', body: 'No changes for a while, 7 files not committed. It may be waiting for you.' })
    expect(noticesFor([quiet], worktrees, { ...S, agentsQuietMuted: ['/p/claude-rooms'] }, null, name)).toEqual([])
    const many = noticesFor([commit('/a'), commit('/b'), commit('/c'), quiet], worktrees, S, null, name)
    expect(many).toEqual([
      { title: '4 agents need a look', subtitle: 'booking-web', body: '3 committed, 1 went quiet', open: { path: null, repo: '/p/booking-web', view: 'agents' } }
    ])
  })
})
