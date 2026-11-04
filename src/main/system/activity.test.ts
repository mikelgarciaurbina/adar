// Agents at work, main side: parsing what git says about a worktree, looking at a real one (changes, lines,
// commits with their agents) and the tracker following a linked worktree through edits, commits (an agent's and
// Adar's own) and a first push.

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/agents'
import { DEFAULT_SETTINGS, type AdarEvent, type AppSettings } from '@shared/types'
import { createGitContext } from '../git/context'
import { lookAtWorktree, parseAgentLog, parseNumstat, parseStatusLook } from '../git/read/activity'
import { cleanupTmp, commitFile, fakePlatform, git, initRepo, isolateGitConfig, tmpDir, write } from '../git/write/__tests__/helpers'
import { ActivityTracker } from './activity'

beforeAll(() => isolateGitConfig())
afterAll(() => cleanupTmp())

describe('parsing', () => {
  it('reads the branch, upstream and changes of git status v2', () => {
    const out = [
      '# branch.oid 1111111111111111111111111111111111111111',
      '# branch.head claude/hold rooms',
      '# branch.upstream origin/claude/hold',
      '# branch.ab +2 -0',
      '1 .M N... 100644 100644 100644 aaa bbb src/a file.ts',
      '1 A. N... 000000 100644 100644 000 ccc new.ts',
      '2 R. N... 100644 100644 100644 ddd ddd R100 moved.ts',
      'old.ts',
      'u UU N... 100644 100644 100644 100644 e f g both.ts',
      '? notes.md',
      ''
    ].join('\0')
    expect(parseStatusLook(out)).toEqual({
      head: '1111111111111111111111111111111111111111',
      branch: 'claude/hold rooms',
      upstream: 'origin/claude/hold',
      ahead: 2,
      entries: [
        { path: 'src/a file.ts', status: 'M' },
        { path: 'new.ts', status: 'A' },
        { path: 'moved.ts', status: 'R' },
        { path: 'both.ts', status: 'U' },
        { path: 'notes.md', status: '?' }
      ]
    })
    expect(parseStatusLook('# branch.oid (initial)\0# branch.head (detached)\0')).toMatchObject({ head: null, branch: null })
  })

  it('reads numstat, renames and binary files included', () => {
    const out = ['3\t1\ta.ts', '-\t-\timage.png', '5\t0\t', 'old.ts', 'new.ts', ''].join('\0')
    expect([...parseNumstat(out)]).toEqual([
      ['a.ts', [3, 1]],
      ['image.png', [0, 0]],
      ['new.ts', [5, 0]]
    ])
  })

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
})

function worktreeSetup() {
  const repo = fs.realpathSync(initRepo())
  commitFile(repo, 'a.txt', 'one\ntwo\n', 'first')
  const wt = path.join(fs.realpathSync(tmpDir('adar-agents-')), 'claude-rooms')
  git(repo, ['worktree', 'add', '-q', '-b', 'claude/hold-rooms', wt])
  for (const [k, v] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false']
  ]) git(wt, ['config', k, v])
  return { repo, wt }
}

describe('lookAtWorktree', () => {
  it('lists the changes with their lines and the branch’s own commits', async () => {
    const { wt } = worktreeSetup()
    const ctx = createGitContext(fakePlatform, () => undefined)
    commitFile(wt, 'hold.ts', 'export const hold = 1\n', 'Hold rooms\n\nCo-Authored-By: Claude <noreply@anthropic.com>')
    write(wt, 'a.txt', 'one\ntwo\nthree\n')
    write(wt, 'notes.md', 'a\nb\nc\n')
    fs.rmSync(path.join(wt, 'hold.ts'))

    const look = await lookAtWorktree(ctx, wt, 'main')
    expect(look).toMatchObject({ branch: 'claude/hold-rooms', upstream: null, unpushed: null, ahead: 1, added: 4, removed: 1, coAuthors: ['Claude'] })
    expect(look!.commits.map((c) => c.subject)).toEqual(['Hold rooms'])
    expect(look!.files.map((f) => [f.path, f.status, f.added, f.removed]).sort()).toEqual([
      ['a.txt', 'M', 1, 0],
      ['hold.ts', 'D', 0, 1],
      ['notes.md', '?', 3, 0]
    ])
    expect(look!.files.find((f) => f.path === 'hold.ts')!.at).toBe(0)
    expect(look!.files.find((f) => f.path === 'a.txt')!.at).toBeGreaterThan(Date.now() - 60_000)
  })
})

describe('ActivityTracker', () => {
  let tracker: ActivityTracker | null = null
  afterEach(() => tracker?.dispose())

  function track(settings: Partial<AppSettings> = {}) {
    const events: AdarEvent[] = []
    const ctx = createGitContext(fakePlatform, () => undefined)
    tracker = new ActivityTracker({
      ctx,
      emit: (e) => events.push(e),
      settings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
      watcher: { fsWatch: false, pollMs: 0 },
      ownGraceMs: 200
    })
    const said = () => events.flatMap((e): AgentEvent[] => (e.type === 'agents' ? e.events : []))
    return { tracker, events, said }
  }

  it('follows a linked worktree through edits, commits and a first push', async () => {
    const { repo, wt } = worktreeSetup()
    const { tracker, said } = track()
    await tracker.watch([repo])
    await tracker.lookNow()
    // The repository's own folder is not watched unless asked.
    expect(tracker.list().map((w) => [w.name, w.branch, w.repo, w.isMain])).toEqual([['claude-rooms', 'claude/hold-rooms', repo, false]])
    expect(tracker.list()[0]).toMatchObject({ fileCount: 0, ahead: 0, lastChange: null, base: 'main' })

    write(wt, 'hold.ts', 'a\nb\n')
    await tracker.lookNow()
    const editing = tracker.list()[0]
    expect(editing.files.map((f) => [f.path, f.status, f.added])).toEqual([['hold.ts', '?', 2]])
    expect(editing.lastChange).toBeGreaterThan(Date.now() - 60_000)
    expect(editing.activity.reduce((n, [, c]) => n + c, 0)).toBe(1)

    git(wt, ['add', 'hold.ts'])
    git(wt, ['commit', '-q', '-m', 'Hold rooms while paying\n\nCo-Authored-By: Claude <noreply@anthropic.com>'])
    await tracker.lookNow()
    expect(said()).toEqual([
      expect.objectContaining({ kind: 'commit', path: wt, repo, files: 1, own: false, commits: [expect.objectContaining({ subject: 'Hold rooms while paying' })] })
    ])
    expect(tracker.list()[0]).toMatchObject({ fileCount: 0, ahead: 1, unpushed: null, coAuthors: ['Claude'] })

    // What Adar commits itself is its own.
    tracker.ownStart(wt)
    commitFile(wt, 'b.txt', 'b\n', 'From Adar')
    tracker.ownEnd(wt)
    await tracker.lookNow()
    expect(said().at(-1)).toMatchObject({ kind: 'commit', own: true })
    await new Promise((r) => setTimeout(r, 300))

    const origin = path.join(fs.realpathSync(tmpDir('adar-agents-origin-')), 'origin.git')
    git(repo, ['init', '-q', '--bare', origin])
    git(repo, ['remote', 'add', 'origin', origin])
    git(wt, ['push', '-q', '-u', 'origin', 'claude/hold-rooms'])
    await tracker.lookNow()
    expect(said().at(-1)).toMatchObject({ kind: 'push', upstream: 'origin/claude/hold-rooms', count: 2, own: false })
    expect(tracker.list()[0]).toMatchObject({ unpushed: 0, upstream: 'origin/claude/hold-rooms' })
  })

  it('watches the repository’s own folder when asked, and nothing while Agents at work is off', async () => {
    const { repo } = worktreeSetup()
    const on = track({ agentsWatchMain: true })
    await on.tracker.watch([repo])
    await on.tracker.lookNow()
    expect(on.tracker.list().map((w) => [w.isMain, w.branch])).toEqual([
      [true, 'main'],
      [false, 'claude/hold-rooms']
    ])
    on.tracker.dispose()

    const off = track({ agentsOn: false })
    await off.tracker.watch([repo])
    await off.tracker.lookNow()
    expect(off.tracker.list()).toEqual([])
  })
})
