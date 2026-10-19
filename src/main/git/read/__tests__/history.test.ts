// Integration tests for log / refs / commit details / file history / blame on temp repos.
import { cleanupTempDirs, commitAll, configureRepo, git, initTestRepo, isolateGitConfig, makeBackend, tempDir, write } from './helpers'

isolateGitConfig()

import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Backend } from '../../../backend'
import { buildLogArgs, DEFAULT_LOG_REVISIONS } from '../history'

let backend: Backend

beforeAll(() => {
  backend = makeBackend().backend
})

afterAll(async () => {
  await backend.dispose()
  cleanupTempDirs()
})

describe('buildLogArgs', () => {
  it('puts --exclude before --all and always ends revisions with --', () => {
    const { args } = buildLogArgs({}, { follow: false, maxCount: 10, skip: 5 })
    expect(args).toContain('--date-order')
    expect(args).toContain('--max-count=11')
    expect(args).toContain('--skip=5')
    const all = args.indexOf('--all')
    expect(args.indexOf('--exclude=refs/stash')).toBeLessThan(all)
    expect(args[args.length - 1]).toBe('--')
    expect(DEFAULT_LOG_REVISIONS[DEFAULT_LOG_REVISIONS.length - 1]).toBe('--all')
  })

  it('maps search modes', () => {
    expect(buildLogArgs({ search: { mode: 'message', text: 'Fix' } }, { follow: false, maxCount: 1, skip: 0 }).args).toEqual(
      expect.arrayContaining(['--grep=Fix', '-i', '-F'])
    )
    expect(buildLogArgs({ search: { mode: 'author', text: 'ann' } }, { follow: false, maxCount: 1, skip: 0 }).args).toContain('--author=ann')
    expect(buildLogArgs({ search: { mode: 'content', text: 'foo(' } }, { follow: false, maxCount: 1, skip: 0 }).args).toContain('-Gfoo(')
    const p = buildLogArgs({ search: { mode: 'path', text: 'src/*.ts' } }, { follow: false, maxCount: 1, skip: 0 })
    expect(p.args.slice(-2)).toEqual(['--', 'src/*.ts'])
    expect(p.literal).toBe(false)
  })

  it('rejects option-like revisions', () => {
    expect(() => buildLogArgs({ revisions: ['--output=/tmp/x'] }, { follow: false, maxCount: 1, skip: 0 })).toThrow(/Invalid revision/)
  })
})

describe('getLog', () => {
  let repo: string
  const shas: string[] = []

  beforeAll(() => {
    repo = initTestRepo()
    for (let i = 1; i <= 25; i++) {
      write(repo, 'counter.txt', `${i}\n`)
      if (i === 7) write(repo, 'docs/guide.md', 'needle in a haystack\n')
      shas.push(commitAll(repo, i === 3 ? 'Fix: Important BUG\n\nLonger body\nwith two lines' : `commit ${i}`, i === 5 ? { author: 'Ann Other <ann@other.io>' } : {}))
    }
    git(repo, ['checkout', '-q', '-b', 'feature'])
    write(repo, 'feature.txt', 'f1\n')
    shas.push(commitAll(repo, 'feature 1'))
    write(repo, 'feature.txt', 'f2\n')
    shas.push(commitAll(repo, 'feature 2'))
    git(repo, ['checkout', '-q', 'main'])
    write(repo, 'counter.txt', 'stashed\n')
    git(repo, ['stash', 'push', '-q', '-m', 'wip stash'])
  }, 120_000)

  it('paginates with hasMore over all refs (stash excluded)', async () => {
    const first = await backend.getLog(repo, { maxCount: 10 })
    expect(first.commits).toHaveLength(10)
    expect(first.hasMore).toBe(true)
    expect(first.commits[0].subject).toBe('feature 2') // newest first (date order)
    expect(first.commits.some((c) => c.subject.includes('wip stash'))).toBe(false)

    const last = await backend.getLog(repo, { maxCount: 10, skip: 20 })
    expect(last.commits).toHaveLength(7)
    expect(last.hasMore).toBe(false)
    expect(last.commits[last.commits.length - 1].parents).toEqual([])

    const exact = await backend.getLog(repo, { maxCount: 27 })
    expect(exact.commits).toHaveLength(27)
    expect(exact.hasMore).toBe(false)
  })

  it('parses multiline messages', async () => {
    const page = await backend.getLog(repo, { maxCount: 100 })
    const fix = page.commits.find((c) => c.subject === 'Fix: Important BUG')!
    expect(fix.body).toBe('Longer body\nwith two lines')
    expect(fix.authorName).toBe('Test User')
    expect(fix.authorEmail).toBe('test@example.com')
    expect(fix.authorDate).toBeGreaterThan(1_700_000_000)
    expect(fix.shortSha.length).toBeGreaterThanOrEqual(7)
  })

  it('restricts to given revisions', async () => {
    const mainOnly = await backend.getLog(repo, { revisions: ['main'], maxCount: 100 })
    expect(mainOnly.commits).toHaveLength(25)
    expect(mainOnly.commits.some((c) => c.subject.startsWith('feature'))).toBe(false)
    const range = await backend.getLog(repo, { revisions: ['main..feature'] })
    expect(range.commits.map((c) => c.subject)).toEqual(['feature 2', 'feature 1'])
    await expect(backend.getLog(repo, { revisions: ['-n1'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('searches by message, author, sha, content and path', async () => {
    const msg = await backend.getLog(repo, { search: { mode: 'message', text: 'important bug' } })
    expect(msg.commits.map((c) => c.subject)).toEqual(['Fix: Important BUG'])

    const author = await backend.getLog(repo, { search: { mode: 'author', text: 'ANN OTHER' } })
    expect(author.commits.map((c) => c.subject)).toEqual(['commit 5'])

    const sha = await backend.getLog(repo, { search: { mode: 'sha', text: shas[9].slice(0, 9) } })
    expect(sha.commits.map((c) => c.sha)).toEqual([shas[9]])
    expect(sha.hasMore).toBe(false)
    expect((await backend.getLog(repo, { search: { mode: 'sha', text: 'deadbeefdeadbeef' } })).commits).toEqual([])

    const content = await backend.getLog(repo, { search: { mode: 'content', text: 'needle' } })
    expect(content.commits.map((c) => c.subject)).toEqual(['commit 7'])

    const byPath = await backend.getLog(repo, { search: { mode: 'path', text: 'docs' } })
    expect(byPath.commits.map((c) => c.subject)).toEqual(['commit 7'])

    const pathOpt = await backend.getLog(repo, { path: 'feature.txt' })
    expect(pathOpt.commits.map((c) => c.subject)).toEqual(['feature 2', 'feature 1'])
  })

  it('returns an empty page for an empty repository', async () => {
    const empty = initTestRepo()
    expect(await backend.getLog(empty)).toEqual({ commits: [], hasMore: false })
    expect(await backend.getLog(empty, { revisions: ['HEAD'] })).toEqual({ commits: [], hasMore: false })
  })

  it('rejects non-repositories with NOT_A_REPO', async () => {
    await expect(backend.getLog(tempDir())).rejects.toMatchObject({ code: 'NOT_A_REPO' })
    await expect(backend.getLog('/definitely/not/here')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(backend.getRefs(tempDir())).rejects.toMatchObject({ code: 'NOT_A_REPO' })
    await expect(backend.getStatus(tempDir())).rejects.toMatchObject({ code: 'NOT_A_REPO' })
  })
})

describe('getRefs', () => {
  let remote: string
  let repo: string
  let other: string

  beforeAll(() => {
    const base = tempDir()
    remote = path.join(base, 'remote.git')
    git(base, ['init', '-q', '--bare', '-b', 'main', remote])
    repo = initTestRepo(path.join(base, 'work'))
    write(repo, 'a.txt', 'a\n')
    const c1 = commitAll(repo, 'first')
    git(repo, ['remote', 'add', 'origin', remote])
    git(repo, ['push', '-q', '-u', 'origin', 'main'])
    git(repo, ['checkout', '-q', '-b', 'feature/gone'])
    commitAll(repo, 'gone work')
    git(repo, ['push', '-q', '-u', 'origin', 'feature/gone'])
    git(repo, ['checkout', '-q', 'main'])
    git(repo, ['push', '-q', 'origin', '--delete', 'feature/gone'])
    git(repo, ['fetch', '-q', '--prune', 'origin'])
    git(repo, ['remote', 'set-head', 'origin', 'main'])
    git(repo, ['tag', 'v-light'])
    git(repo, ['tag', '-a', 'v1.0', '-m', 'Release one\n\nWith notes', c1])

    // Another clone pushes a commit so that main is behind; then a local commit makes it ahead too.
    other = path.join(base, 'other')
    git(base, ['clone', '-q', remote, other])
    configureRepo(other)
    write(other, 'b.txt', 'b\n')
    commitAll(other, 'from other')
    git(other, ['push', '-q', 'origin', 'main'])
    git(repo, ['fetch', '-q', 'origin'])
    write(repo, 'c.txt', 'c\n')
    commitAll(repo, 'local ahead')

    git(repo, ['branch', 'zz-local'])
    write(repo, 'a.txt', 'changed\n')
    write(repo, 'untracked.txt', 'u\n')
    git(repo, ['stash', 'push', '-q', '-u', '-m', 'my stash'])
    git(repo, ['checkout', '-q', 'zz-local'])
    write(repo, 'a.txt', 'second\n')
    git(repo, ['stash', 'push', '-q'])
    git(repo, ['checkout', '-q', 'main'])
  }, 120_000)

  it('lists branches with tracking info, HEAD first', async () => {
    const refs = await backend.getRefs(repo)
    expect(refs.head.branch).toBe('main')
    expect(refs.head.detached).toBe(false)
    expect(refs.branches.map((b) => b.name)).toEqual(['main', 'feature/gone', 'zz-local'])
    const main = refs.branches[0]
    expect(main).toMatchObject({ isHead: true, upstream: 'origin/main', ahead: 1, behind: 1, type: 'branch', fullName: 'refs/heads/main' })
    expect(main.sha).toBe(refs.head.sha)
    expect(refs.branches[1]).toMatchObject({ name: 'feature/gone', upstream: 'origin/feature/gone', upstreamGone: true, isHead: false })
    expect(refs.branches[2].upstream).toBeUndefined()
  })

  it('lists remote branches including the symbolic origin/HEAD', async () => {
    const refs = await backend.getRefs(repo)
    expect(refs.remotes.map((r) => r.name)).toEqual(['origin/HEAD', 'origin/main'])
    expect(refs.remotes[0]).toMatchObject({ remote: 'origin', isSymbolic: true })
    expect(refs.remotes[1]).toMatchObject({ remote: 'origin', type: 'remote' })
    expect(refs.remotes[1].isSymbolic).toBeUndefined()
  })

  it('peels annotated tags', async () => {
    const refs = await backend.getRefs(repo)
    const c1 = git(repo, ['rev-list', '--max-parents=0', 'HEAD']).trim()
    const v1 = refs.tags.find((t) => t.name === 'v1.0')!
    expect(v1).toMatchObject({ annotated: true, sha: c1, tagMessage: 'Release one\n\nWith notes' })
    const light = refs.tags.find((t) => t.name === 'v-light')!
    expect(light.annotated).toBe(false)
    expect(light.tagMessage).toBeUndefined()
  })

  it('lists stashes with index, base and branch', async () => {
    const refs = await backend.getRefs(repo)
    expect(refs.stashes).toHaveLength(2)
    expect(refs.stashes[0]).toMatchObject({ index: 0, ref: 'stash@{0}', branch: 'zz-local' })
    expect(refs.stashes[1]).toMatchObject({ index: 1, ref: 'stash@{1}', branch: 'main', message: 'On main: my stash' })
    const base = git(repo, ['rev-parse', 'stash@{1}^1']).trim()
    expect(refs.stashes[1].baseSha).toBe(base)
    expect(refs.stashes[1].date).toBeGreaterThan(0)
  })

  it('lists submodules', async () => {
    const sub = initTestRepo()
    write(sub, 'lib.txt', 'lib\n')
    commitAll(sub, 'lib')
    const host = initTestRepo()
    write(host, 'x.txt', 'x\n')
    commitAll(host, 'host')
    git(host, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'libs/sub'])
    commitAll(host, 'add submodule')
    const refs = await backend.getRefs(host)
    expect(refs.submodules).toHaveLength(1)
    expect(refs.submodules[0]).toMatchObject({ path: 'libs/sub', url: sub, status: 'initialized' })
    expect(refs.submodules[0].sha).toMatch(/^[0-9a-f]{40}$/)
    expect((await backend.getRefs(repo)).submodules).toEqual([])
  })

  it('computes ahead/behind of many branches sharing an upstream in one batch', async () => {
    const r = initTestRepo()
    for (let i = 1; i <= 5; i++) {
      write(r, 'f.txt', `${i}\n`)
      commitAll(r, `c${i}`)
    }
    git(r, ['branch', 't1', 'main~4'])
    git(r, ['branch', 't2', 'main~2'])
    git(r, ['checkout', '-q', '-b', 't3'])
    write(r, 'g.txt', 'ahead\n')
    commitAll(r, 'ahead on t3')
    git(r, ['checkout', '-q', 'main'])
    for (const b of ['t1', 't2', 't3']) git(r, ['branch', `--set-upstream-to=main`, b])
    git(r, ['branch', 's1', 'main~3'])
    git(r, ['branch', '--set-upstream-to=t1', 's1'])
    git(r, ['remote', 'add', 'origin', '/nonexistent/adar.git'])
    git(r, ['branch', 'g1'])
    git(r, ['config', 'branch.g1.remote', 'origin'])
    git(r, ['config', 'branch.g1.merge', 'refs/heads/deleted-upstream'])
    const refs = await backend.getRefs(r)
    const by = (n: string) => refs.branches.find((b) => b.name === n)!
    expect(by('t1')).toMatchObject({ upstream: 'main', ahead: 0, behind: 4 })
    expect(by('t2')).toMatchObject({ upstream: 'main', ahead: 0, behind: 2 })
    expect(by('t3')).toMatchObject({ upstream: 'main', ahead: 1, behind: 0 })
    expect(by('s1')).toMatchObject({ upstream: 't1', ahead: 1, behind: 0 })
    expect(by('g1')).toMatchObject({ upstream: 'origin/deleted-upstream', upstreamGone: true, ahead: 0, behind: 0 })
    expect(by('main').upstream).toBeUndefined()
  })

  it('works on an unborn repository', async () => {
    const empty = initTestRepo()
    const refs = await backend.getRefs(empty)
    expect(refs.head).toEqual({ sha: null, branch: 'main', detached: false, unborn: true })
    expect(refs.branches).toEqual([])
    expect(refs.stashes).toEqual([])
  })
})

describe('commit details, file history and blame', () => {
  let repo: string
  let root: string
  let second: string
  let merge: string

  beforeAll(() => {
    repo = initTestRepo()
    write(repo, 'a.txt', 'line1\nline2\n')
    write(repo, 'bin.dat', Buffer.from([0, 1, 2, 3]))
    root = commitAll(repo, 'root')
    git(repo, ['mv', 'a.txt', 'b.txt'])
    write(repo, 'b.txt', 'line1\nline2\nline3\n')
    second = commitAll(repo, 'rename and extend')
    git(repo, ['checkout', '-q', '-b', 'side'])
    write(repo, 'side.txt', 'side\n')
    commitAll(repo, 'side work')
    git(repo, ['checkout', '-q', 'main'])
    write(repo, 'main.txt', 'main\n')
    commitAll(repo, 'main work')
    git(repo, ['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'])
    merge = git(repo, ['rev-parse', 'HEAD']).trim()
  }, 120_000)

  it('lists files of the root commit', async () => {
    const d = await backend.getCommitDetails(repo, root)
    expect(d.commit.sha).toBe(root)
    expect(d.commit.parents).toEqual([])
    expect(d.files).toEqual([
      { path: 'a.txt', status: 'added', additions: 2, deletions: 0 },
      { path: 'bin.dat', status: 'added', additions: 0, deletions: 0, binary: true }
    ])
    expect(d.additions).toBe(2)
    expect(d.deletions).toBe(0)
  })

  it('detects renames', async () => {
    const d = await backend.getCommitDetails(repo, second.slice(0, 10))
    expect(d.files).toEqual([{ path: 'b.txt', oldPath: 'a.txt', status: 'renamed', additions: 1, deletions: 0 }])
  })

  it('diffs merge commits against the first parent', async () => {
    const d = await backend.getCommitDetails(repo, merge)
    expect(d.commit.parents).toHaveLength(2)
    expect(d.files.map((f) => f.path)).toEqual(['side.txt'])
    expect(d.commit.subject).toBe('Merge side')
  })

  it('rejects unknown commits with NOT_FOUND', async () => {
    await expect(backend.getCommitDetails(repo, 'f'.repeat(40))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(backend.getCommitDetails(repo, '--all')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('compares two revisions', async () => {
    const files = await backend.getCompareFiles(repo, root, merge)
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['b.txt', 'renamed'],
      ['main.txt', 'added'],
      ['side.txt', 'added']
    ])
  })

  it('follows file history across a rename', async () => {
    const history = await backend.getFileHistory(repo, 'b.txt')
    expect(history.map((c) => c.subject)).toEqual(['rename and extend', 'root'])
    expect(await backend.getFileHistory(repo, 'b.txt', { maxCount: 1 })).toHaveLength(1)
    expect(await backend.getFileHistory(initTestRepo(), 'x.txt')).toEqual([])
  })

  it('blames lines to the commits that introduced them', async () => {
    const blame = await backend.getBlame(repo, 'b.txt')
    expect(blame).toHaveLength(3)
    expect(blame.map((l) => l.content)).toEqual(['line1', 'line2', 'line3'])
    expect(blame[0]).toMatchObject({ lineNo: 1, sha: root, summary: 'root', authorName: 'Test User', authorEmail: 'test@example.com', origLineNo: 1 })
    expect(blame[2]).toMatchObject({ lineNo: 3, sha: second, summary: 'rename and extend' })
    const atRoot = await backend.getBlame(repo, 'a.txt', root)
    expect(atRoot).toHaveLength(2)
    await expect(backend.getBlame(repo, 'nope.txt', 'HEAD')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('returns the HEAD message', async () => {
    expect(await backend.getHeadMessage(repo)).toBe('Merge side')
    expect(await backend.getHeadMessage(initTestRepo())).toBe('')
  })
})
