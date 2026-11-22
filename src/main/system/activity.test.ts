// The commit tracker: reading a folder's HEAD and upstream, and following a repository's folder and a linked
// worktree through commits (an agent's and Adar's own) and pushes.

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agents'
import type { AdarEvent } from '@shared/types'
import { createGitContext } from '../git/context'
import { lookAtHead, parseAgentLog } from '../git/read/activity'
import { cleanupTmp, commitFile, fakePlatform, git, initRepo, isolateGitConfig, tmpDir } from '../git/write/__tests__/helpers'
import { ActivityTracker } from './activity'

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

function worktreeSetup() {
  const repo = fs.realpathSync(initRepo())
  commitFile(repo, 'a.txt', 'one\ntwo\n', 'first')
  const wt = path.join(fs.realpathSync(tmpDir('adar-agents-')), 'claude-rooms')
  git(repo, ['worktree', 'add', '-q', '-b', 'claude/hold-rooms', wt])
  return { repo, wt }
}

function addOrigin(repo: string): string {
  const origin = path.join(fs.realpathSync(tmpDir('adar-agents-origin-')), 'origin.git')
  git(repo, ['init', '-q', '--bare', origin])
  git(repo, ['remote', 'add', 'origin', origin])
  return origin
}

describe('reading', () => {
  it('reads commits and the agents of their Co-Authored-By trailers', () => {
    const rec = (sha: string, t: number, s: string, trailers: string) => `${sha}\x1f${t}\x1f${s}\x1f${trailers}\x1e\n`
    const out =
      rec('a'.repeat(40), 200, 'Second', 'Codex <codex@openai.com>') +
      rec('b'.repeat(40), 100, 'First', 'Claude <noreply@anthropic.com>\x1dAne <ane@example.com>')
    expect(parseAgentLog(out)).toEqual({
      commits: [
        { sha: 'a'.repeat(40), subject: 'Second', at: 200_000 },
        { sha: 'b'.repeat(40), subject: 'First', at: 100_000 }
      ],
      coAuthors: ['Claude', 'Codex']
    })
  })

  it('says where a folder’s HEAD and upstream are', async () => {
    const { repo, wt } = worktreeSetup()
    const ctx = createGitContext(fakePlatform, () => undefined)
    const head = git(repo, ['rev-parse', 'HEAD']).trim()
    expect(await lookAtHead(ctx, wt)).toEqual({ head, branch: 'claude/hold-rooms', upstream: null, upstreamSha: null })

    addOrigin(repo)
    git(repo, ['push', '-q', '-u', 'origin', 'main'])
    expect(await lookAtHead(ctx, repo)).toEqual({ head, branch: 'main', upstream: 'origin/main', upstreamSha: head })

    git(wt, ['checkout', '-q', '--detach'])
    expect(await lookAtHead(ctx, wt)).toMatchObject({ head, branch: null, upstream: null })
    expect(await lookAtHead(ctx, path.join(repo, 'no-such-folder'))).toBeNull()
  })
})

describe('ActivityTracker', () => {
  let tracker: ActivityTracker | null = null
  afterEach(() => tracker?.dispose())

  function track(on = true) {
    const events: AdarEvent[] = []
    const ctx = createGitContext(fakePlatform, () => undefined)
    tracker = new ActivityTracker({ ctx, emit: (e) => events.push(e), settings: async () => ({ notifyAgentCommits: on }), ownGraceMs: 200 })
    const said = () => events.flatMap((e): AgentEvent[] => (e.type === 'agents' ? e.events : []))
    return { tracker, events, said }
  }

  it('follows the repository’s folder and its worktrees, and nothing while the notifications are off', async () => {
    const { repo, wt } = worktreeSetup()
    const on = track()
    await on.tracker.watch([repo])
    await on.tracker.lookNow()
    expect(on.tracker.list()).toEqual([
      { path: repo, repo, isMain: true, branch: 'main' },
      { path: wt, repo, isMain: false, branch: 'claude/hold-rooms' }
    ])
    // Nothing happened yet: the first look only records where things are.
    expect(on.said()).toEqual([])
    on.tracker.dispose()

    const off = track(false)
    await off.tracker.watch([repo])
    await off.tracker.lookNow()
    expect(off.tracker.list()).toEqual([])
  })

  it('tells of an agent’s commits and its first push, and marks Adar’s own', async ({ onTestFinished }) => {
    const { repo, wt } = worktreeSetup()
    const { tracker, said } = track()
    await tracker.watch([repo])
    await tracker.lookNow()

    commitFile(wt, 'hold.ts', 'a\nb\n', 'Hold rooms while paying\n\nCo-Authored-By: Claude <noreply@anthropic.com>')
    await tracker.lookNow()
    expect(said()).toEqual([
      {
        kind: 'commit',
        path: wt,
        repo,
        branch: 'claude/hold-rooms',
        isMain: false,
        files: 1,
        agent: 'Claude',
        own: false,
        commits: [expect.objectContaining({ subject: 'Hold rooms while paying' })]
      }
    ])

    // What Adar commits itself is its own.
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    tracker.ownStart(wt)
    commitFile(wt, 'b.txt', 'b\n', 'From Adar')
    tracker.ownEnd(wt)
    await tracker.lookNow()
    expect(said().at(-1)).toMatchObject({ kind: 'commit', own: true })
    vi.setSystemTime(Date.now() + 300)

    addOrigin(repo)
    git(wt, ['push', '-q', '-u', 'origin', 'claude/hold-rooms'])
    await tracker.lookNow()
    // A first push counts from the base the branch started at; the agent is the one its commits name.
    expect(said().at(-1)).toMatchObject({ kind: 'push', path: wt, upstream: 'origin/claude/hold-rooms', count: 2, subject: 'From Adar', agent: 'Claude', own: false })
  })

  it('names the commit pushed on the base branch, in the repository’s own folder', async () => {
    const repo = fs.realpathSync(initRepo())
    commitFile(repo, 'a.txt', 'one\n', 'first')
    addOrigin(repo)
    git(repo, ['push', '-q', '-u', 'origin', 'main'])
    const { tracker, said } = track()
    await tracker.watch([repo])
    await tracker.lookNow()

    commitFile(repo, 'hero.css', 'h1 { margin: 0 }\n', 'Fix hero spacing')
    commitFile(repo, 'nav.css', 'nav { gap: 8px }\n', 'Tighten the nav')
    await tracker.lookNow()
    expect(said()).toEqual([expect.objectContaining({ kind: 'commit', path: repo, isMain: true, branch: 'main', agent: null, files: 2 })])
    git(repo, ['push', '-q'])
    await tracker.lookNow()
    expect(said().at(-1)).toMatchObject({ kind: 'push', path: repo, isMain: true, upstream: 'origin/main', count: 2, subject: 'Tighten the nav', own: false })
  })

  it('looks again when the tabs’ watcher reports a change of refs', async () => {
    const { repo, wt } = worktreeSetup()
    const { tracker, said } = track()
    await tracker.watch([repo])
    await tracker.lookNow()
    commitFile(wt, 'hold.ts', 'a\n', 'Hold rooms')
    // Files changing is no reason to look; refs are (they are shared by every worktree of the repository).
    tracker.repoChanged({ type: 'repo-changed', repoPath: repo, scopes: ['worktree'] })
    await new Promise((r) => setTimeout(r, 150))
    expect(said()).toEqual([])
    tracker.repoChanged({ type: 'repo-changed', repoPath: repo, scopes: ['refs'] })
    await vi.waitFor(() => expect(said()).toEqual([expect.objectContaining({ kind: 'commit', path: wt })]), { timeout: 8000 })
  })
})
