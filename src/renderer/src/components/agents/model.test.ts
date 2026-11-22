// Which commits and pushes become notifications, and what they say.

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AgentEvent } from '@shared/agents'
import { noticesFor } from './model'

const S = DEFAULT_SETTINGS
const name = (repo: string) => repo.split('/').pop()!
type Commit = Extract<AgentEvent, { kind: 'commit' }>
type Push = Extract<AgentEvent, { kind: 'push' }>

const commit = (over: Partial<Commit> = {}): AgentEvent => ({
  kind: 'commit',
  path: '/p/claude-rooms',
  repo: '/p/booking-web',
  branch: 'claude/hold-rooms',
  isMain: false,
  commits: [{ sha: 'b'.repeat(40), subject: 'Hold rooms while paying', at: 0 }],
  files: 4,
  agent: 'Claude',
  own: false,
  ...over
})

const push = (over: Partial<Push> = {}): AgentEvent => ({
  kind: 'push',
  path: '/p/landing',
  repo: '/p/landing',
  branch: 'master',
  isMain: true,
  count: 1,
  upstream: 'origin/master',
  subject: 'Fix hero spacing',
  agent: null,
  own: false,
  ...over
})

describe('noticesFor', () => {
  it('tells what an agent committed, except Adar’s own work and the folder in front', () => {
    expect(noticesFor([commit()], S, null, name)).toEqual([
      {
        title: 'Committed to claude/hold-rooms',
        subtitle: 'booking-web · claude-rooms · with Claude',
        body: 'Hold rooms while paying · 4 files',
        open: { path: '/p/claude-rooms', repo: '/p/booking-web', view: 'commit', sha: 'b'.repeat(40) }
      }
    ])
    const three = commit({ commits: [1, 2, 3].map((n) => ({ sha: String(n).repeat(40), subject: `Commit ${n}`, at: 0 })), files: 1 })
    expect(noticesFor([three], S, null, name)[0].body).toBe('Commit 1 and 2 more · 1 file')
    expect(noticesFor([commit({ own: true })], S, null, name)).toEqual([])
    expect(noticesFor([commit()], S, '/p/claude-rooms', name)).toEqual([])
    expect(noticesFor([commit()], { ...S, notifyAgentCommits: false }, null, name)).toEqual([])
  })

  it('says which branch was pushed and where: the tab group, the repository once, a folder only when it adds something', () => {
    const grouped = { ...S, tabGroups: [{ id: 'g1', name: 'Basoa', color: 'fern' as const, repos: ['/p/landing'], collapsed: false }] }

    // The repository's own folder: its name once, and the group its tab is in.
    expect(noticesFor([push()], grouped, null, name)).toEqual([
      { title: 'Pushed 1 commit to origin/master', subtitle: 'Basoa › landing', body: 'Fix hero spacing', open: { path: '/p/landing', repo: '/p/landing', view: 'changes' } }
    ])
    expect(noticesFor([push({ count: 3 })], S, null, name)[0]).toMatchObject({ title: 'Pushed 3 commits to origin/master', subtitle: 'landing', body: 'Fix hero spacing and 2 more' })
    // A first push of a branch with nothing of its own yet, and a commit git could not name.
    expect(noticesFor([push({ count: 0, subject: '' })], S, null, name)[0]).toMatchObject({ title: 'Pushed to origin/master', body: '' })
    expect(noticesFor([push({ own: true })], S, null, name)).toEqual([])

    // A linked worktree: its repository's group, its folder and the agent; the folder is left out when it is the branch.
    const linked = { path: '/p/claude-rooms', isMain: false, branch: 'claude/hold-rooms', upstream: 'origin/claude/hold-rooms', agent: 'Claude' }
    expect(noticesFor([push(linked)], grouped, null, name)[0]).toMatchObject({
      title: 'Pushed 1 commit to origin/claude/hold-rooms',
      subtitle: 'Basoa › landing · claude-rooms · with Claude'
    })
    expect(noticesFor([push({ ...linked, path: '/p/hotfix', branch: 'hotfix', agent: null })], S, null, name)[0].subtitle).toBe('landing')
    // Detached HEAD: the folder stands in for the branch, in the title only.
    expect(noticesFor([commit({ branch: null, agent: null })], S, null, name)[0]).toMatchObject({ title: 'Committed in claude-rooms', subtitle: 'booking-web' })
  })

  it('makes one notification of more than three', () => {
    const many = noticesFor([commit(), commit({ path: '/p/b' }), commit({ path: '/p/c' }), push()], S, null, name)
    expect(many).toEqual([
      {
        title: '4 commits and pushes while you were away',
        subtitle: 'booking-web and landing',
        body: '3 committed, 1 pushed',
        open: { path: '/p/claude-rooms', repo: '/p/booking-web', view: 'changes' }
      }
    ])
  })
})
