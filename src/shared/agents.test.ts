// Commits Adar did not make: which agent they are an agent's, and the notices the UI may ask for.

import { describe, expect, it } from 'vitest'
import { agentOf, agentsNamed, coAuthorAgents, parseAgentNotice } from './agents'

describe('which agent', () => {
  it('reads the agents named in Co-Authored-By trailers, in the order first seen', () => {
    expect(agentsNamed(['Claude <noreply@anthropic.com>', 'Ane <ane@example.com>', 'codex <codex@openai.com>', 'Claude Fable <x@y>'])).toEqual(['Claude', 'Codex'])
    expect(coAuthorAgents(['Fix it\n\nCo-Authored-By: Claude <noreply@anthropic.com>', 'Other\n\nco-authored-by: Cursor Agent <a@b>\nReviewed-by: Claude'])).toEqual(['Claude', 'Cursor'])
    expect(coAuthorAgents(['No trailers here'])).toEqual([])
  })

  it('takes the trailers first, then the branch prefix, then the folder', () => {
    expect(agentOf(['Codex', 'Claude'], 'claude/x', '/p/app')).toBe('Codex')
    expect(agentOf([], 'claude/hold-rooms', '/p/app')).toBe('Claude')
    expect(agentOf([], 'feature/x', '/p/app/.claude/worktrees/x')).toBe('Claude')
    expect(agentOf([], 'feature/x', '/p/app')).toBeNull()
    expect(agentOf([], null, '/p/app')).toBeNull()
  })
})

describe('notices', () => {
  it('validates the notices the UI asks for', () => {
    const ok = { title: 'Committed to main', subtitle: 'landing', body: 'Fix · 1 file', open: { path: '/p/landing', repo: '/p/landing', view: 'commit', sha: 'a'.repeat(40) } }
    expect(parseAgentNotice(ok)).toEqual(ok)
    expect(parseAgentNotice({ ...ok, open: { ...ok.open, sha: 'not-a-sha' } })?.open).toEqual({ path: '/p/landing', repo: '/p/landing', view: 'commit' })
    expect(parseAgentNotice({ ...ok, open: { ...ok.open, view: 'agents' } })).toBeNull()
    expect(parseAgentNotice({ ...ok, open: { ...ok.open, path: null } })).toBeNull()
    expect(parseAgentNotice({ ...ok, title: 7 })).toBeNull()
    expect(parseAgentNotice(null)).toBeNull()
  })
})
