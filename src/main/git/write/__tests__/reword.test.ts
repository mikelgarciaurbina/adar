import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTmp, cloneSetup, commitFile, expectCode, git, head, initRepo, isolateGitConfig, makeOps, read, status, subjects, tmpDir, write } from './helpers'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

/** base ← A ← B ← C, each adding its own file. */
function linearRepo(): { dir: string; shas: Record<string, string> } {
  const dir = initRepo()
  const shas: Record<string, string> = {}
  shas.base = commitFile(dir, 'base.txt', 'base\n', 'base')
  for (const n of ['A', 'B', 'C']) shas[n] = commitFile(dir, `${n}.txt`, `${n}\n`, `${n} subject`)
  return { dir, shas }
}

const message = (dir: string, rev: string) => git(dir, ['log', '-1', '--format=%B', rev]).replace(/\n+$/, '')
const tree = (dir: string, rev: string) => git(dir, ['rev-parse', `${rev}^{tree}`]).trim()
/** Every commit's tree (sorted: recreated commits get new committer dates, which reorders git log). */
const allTrees = (dir: string) => git(dir, ['log', '--format=%T']).trim().split('\n').sort()
const authors = (dir: string) => git(dir, ['log', '--format=%an|%ae|%ad', '--date=raw']).trim()
const hook = (dir: string, name: string, body: string) => {
  const file = path.join(dir, '.git', 'hooks', name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
}

describe('rewordCommit', () => {
  it('edits the HEAD message without committing staged changes', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    write(dir, 'staged.txt', 'staged\n')
    git(dir, ['add', 'staged.txt'])
    write(dir, 'A.txt', 'unstaged edit\n')

    const res = await ops.rewordCommit(dir, shas.C, 'C reworded\n\nWith a body')
    expect(res).toMatchObject({ ok: true, previousHead: shas.C })
    expect(res.newSha).toBe(head(dir))
    expect(message(dir, 'HEAD')).toBe('C reworded\n\nWith a body')
    expect(tree(dir, 'HEAD')).toBe(tree(dir, shas.C)) // content unchanged
    expect(git(dir, ['rev-parse', 'HEAD^']).trim()).toBe(shas.B)
    expect(status(dir)).toContain('A  staged.txt') // still staged, not committed
    expect(read(dir, 'A.txt')).toBe('unstaged edit\n')
    expect(git(dir, ['symbolic-ref', 'HEAD']).trim()).toBe('refs/heads/main')
    expect(git(dir, ['reflog', '-1', '--format=%gs', 'main']).trim()).toBe(`adar: edit message of ${shas.C.slice(0, 7)}`)
  })

  it('edits an older commit, keeping later commits, trees, authors and uncommitted work', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    write(dir, 'C.txt', 'dirty\n')
    write(dir, 'new.txt', 'untracked\n')
    write(dir, 'B.txt', 'staged edit\n')
    git(dir, ['add', 'B.txt'])
    git(dir, ['add', '-N', 'new.txt']) // intent-to-add: git stash cannot even handle this
    const before = authors(dir)
    const mtime = fs.statSync(path.join(dir, 'A.txt')).mtimeMs

    const res = await ops.rewordCommit(dir, shas.A, 'A reworded')
    expect(res.ok).toBe(true)
    expect(subjects(dir)).toEqual(['C subject', 'B subject', 'A reworded', 'base'])
    expect(res.newSha).toBe(head(dir, 'HEAD~2'))
    expect(message(dir, res.newSha!)).toBe('A reworded')
    expect(tree(dir, 'HEAD')).toBe(tree(dir, shas.C))
    expect(tree(dir, 'HEAD~1')).toBe(tree(dir, shas.B))
    expect(head(dir, 'HEAD~3')).toBe(shas.base) // history below is untouched
    expect(authors(dir)).toBe(before) // authors and author dates kept
    expect(status(dir).split('\n').sort()).toEqual(['M  B.txt', ' A new.txt', ' M C.txt'].sort())
    expect(read(dir, 'new.txt')).toBe('untracked\n')
    expect(fs.statSync(path.join(dir, 'A.txt')).mtimeMs).toBe(mtime) // nothing was checked out
  })

  it('never touches ignored files, stashes or checkout hooks', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    // A secret committed by mistake, then untracked and ignored; the real one lives on locally.
    commitFile(dir, '.env', 'API_KEY=placeholder\n', 'add env')
    const middle = commitFile(dir, 'b.txt', 'b\n', 'add b')
    git(dir, ['rm', '-q', '--cached', '.env'])
    commitFile(dir, '.gitignore', '.env\n', 'stop tracking env')
    write(dir, '.env', 'API_KEY=REAL-SECRET\n')
    write(dir, 'scratch.txt', 'mine\n')
    git(dir, ['stash', 'push', '-q', '--include-untracked', '-m', 'user wip'])
    write(dir, '.env', 'API_KEY=REAL-SECRET\n')
    hook(dir, 'post-checkout', 'echo ran > "$GIT_DIR/../checkout-hook-ran"')

    const res = await ops.rewordCommit(dir, middle, 'add b (reworded)')
    expect(res.ok).toBe(true)
    expect(subjects(dir)).toEqual(['stop tracking env', 'add b (reworded)', 'add env'])
    expect(read(dir, '.env')).toBe('API_KEY=REAL-SECRET\n')
    expect(git(dir, ['stash', 'list', '--format=%gs']).trim()).toBe('On main: user wip')
    expect(fs.existsSync(path.join(dir, 'checkout-hook-ran'))).toBe(false)
    expect(status(dir)).toBe('')
  })

  it('edits the root commit and keeps merges intact when rewriting across them', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    git(dir, ['checkout', '-q', '-b', 'side', shas.A])
    const side = commitFile(dir, 'side.txt', 'side\n', 'side work')
    git(dir, ['checkout', '-q', 'main'])
    git(dir, ['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'])
    const after = commitFile(dir, 'after.txt', 'after\n', 'after merge')
    const trees = allTrees(dir)

    // Before the merge: the merge is recreated with the rewritten first parent and the untouched side branch.
    const res = await ops.rewordCommit(dir, shas.B, 'B reworded')
    expect(res.ok).toBe(true)
    expect(allTrees(dir)).toEqual(trees)
    const merge = git(dir, ['rev-list', '--parents', '-n', '1', 'HEAD~1']).trim().split(' ')
    expect(merge).toHaveLength(3)
    expect(merge[2]).toBe(side)
    expect(message(dir, 'HEAD~1^1~1')).toBe('B reworded')
    expect(message(dir, 'HEAD')).toBe('after merge')
    expect(head(dir)).not.toBe(after)

    // The merge itself, and the root commit (every commit is recreated).
    expect((await ops.rewordCommit(dir, head(dir, 'HEAD~1'), 'Merge side (edited)')).ok).toBe(true)
    expect(git(dir, ['rev-list', '--parents', '-n', '1', 'HEAD~1']).trim().split(' ')).toHaveLength(3)
    expect((await ops.rewordCommit(dir, shas.base, 'root reworded')).ok).toBe(true)
    expect(subjects(dir, '--first-parent')).toEqual(['after merge', 'Merge side (edited)', 'C subject', 'B reworded', 'A subject', 'root reworded'])
    expect(allTrees(dir)).toEqual(trees)
    expect(git(dir, ['rev-list', '--max-parents=0', 'HEAD']).trim().split('\n')).toHaveLength(1)
  })

  it('works on a detached HEAD', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    git(dir, ['checkout', '-q', '--detach'])
    const res = await ops.rewordCommit(dir, shas.B, 'B detached')
    expect(res.ok).toBe(true)
    expect(() => git(dir, ['symbolic-ref', '-q', 'HEAD'])).toThrow() // still detached
    expect(subjects(dir)).toEqual(['C subject', 'B detached', 'A subject', 'base'])
    expect(head(dir, 'main')).toBe(shas.C) // branches are not moved
  })

  it('is a no-op when the message is unchanged (whitespace cleanup included)', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    const res = await ops.rewordCommit(dir, shas.B, 'B subject   \n\n\n')
    expect(res).toMatchObject({ ok: true, newSha: shas.B })
    expect(head(dir)).toBe(shas.C)
  })

  it('refuses commits outside the branch, operations in progress, shallow edges and empty messages', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    await expectCode(ops.rewordCommit(dir, shas.B, '   '), 'INVALID_ARGUMENT')

    git(dir, ['checkout', '-q', '-b', 'side', shas.A])
    const side = commitFile(dir, 'side.txt', 'side\n', 'side work')
    git(dir, ['checkout', '-q', 'main'])
    expect((await ops.getRewordInfo(dir, side)).editable).toBe(false)
    await expectCode(ops.rewordCommit(dir, side, 'nope'), 'INVALID_ARGUMENT')

    // A merge in progress (conflicts) blocks editing.
    git(dir, ['checkout', '-q', '-b', 'conflict', shas.C])
    commitFile(dir, 'C.txt', 'theirs\n', 'conflicting')
    git(dir, ['checkout', '-q', 'main'])
    const ours = commitFile(dir, 'C.txt', 'ours\n', 'ours change')
    expect(() => git(dir, ['merge', 'conflict'])).toThrow()
    expect((await ops.getRewordInfo(dir, ours)).reason).toMatch(/merge in progress/)
    await expectCode(ops.rewordCommit(dir, ours, 'nope'), 'INVALID_ARGUMENT')
    git(dir, ['merge', '--abort'])

    // Shallow clones: the boundary commit has parents git never downloaded.
    const origin = tmpDir('adar-wtest-shallow-')
    git(origin, ['clone', '-q', '--bare', dir, 'origin.git'])
    const parent = tmpDir('adar-wtest-shallow-clone-')
    git(parent, ['clone', '-q', '--depth', '2', `file://${path.join(origin, 'origin.git')}`, 'work'])
    const shallow = path.join(parent, 'work')
    git(shallow, ['config', 'user.name', 'Test User'])
    git(shallow, ['config', 'user.email', 'test@example.com'])
    const boundary = head(shallow, 'HEAD~1')
    expect((await ops.getRewordInfo(shallow, boundary)).reason).toMatch(/shallow clone/)
    await expectCode(ops.rewordCommit(shallow, boundary, 'nope'), 'INVALID_ARGUMENT')
    expect(git(shallow, ['rev-list', '--count', 'HEAD']).trim()).toBe('2')
    expect((await ops.getRewordInfo(shallow, 'HEAD')).editable).toBe(true) // its parent is there
    expect((await ops.rewordCommit(shallow, head(shallow), 'top reworded')).ok).toBe(true)
    expect(git(shallow, ['rev-parse', 'HEAD^']).trim()).toBe(boundary)
  }, 60_000)

  it('runs the commit-msg hook, which can reject or amend the message', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    hook(dir, 'commit-msg', 'grep -q "^feat" "$1" || { echo "subject must start with feat" >&2; exit 1; }\necho "Change-Id: I42" >> "$1"')
    const err = await expectCode(ops.rewordCommit(dir, shas.A, 'A reworded'), 'INVALID_ARGUMENT')
    expect(err.message).toMatch(/commit-msg hook rejected the message:\nsubject must start with feat/)
    expect(head(dir)).toBe(shas.C)

    const res = await ops.rewordCommit(dir, shas.A, 'feat: A reworded')
    expect(res.ok).toBe(true)
    expect(message(dir, res.newSha!)).toBe('feat: A reworded\nChange-Id: I42')
    expect(message(dir, 'HEAD')).toBe('C subject') // only the edited commit goes through the hook
  })

  it('signs the recreated commits when commit.gpgSign is set, and changes nothing if signing fails', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    const bin = tmpDir('adar-wtest-gpg-')
    const fake = path.join(bin, 'fake-gpg')
    fs.writeFileSync(
      fake,
      '#!/bin/sh\ncat >/dev/null\nprintf "\\n[GNUPG:] SIG_CREATED D 1 8 00 0 FAKE\\n" >&2\nprintf -- "-----BEGIN PGP SIGNATURE-----\\nfake\\n-----END PGP SIGNATURE-----\\n"\n',
      { mode: 0o755 }
    )
    git(dir, ['config', 'commit.gpgSign', 'true'])
    git(dir, ['config', 'gpg.program', fake])
    const res = await ops.rewordCommit(dir, shas.B, 'B signed')
    expect(res.ok).toBe(true)
    for (const rev of ['HEAD', 'HEAD~1']) expect(git(dir, ['cat-file', 'commit', rev])).toContain('gpgsig -----BEGIN PGP SIGNATURE-----')
    expect(git(dir, ['cat-file', 'commit', 'HEAD~2'])).not.toContain('gpgsig') // A is untouched

    const before = head(dir)
    git(dir, ['config', 'gpg.program', 'false'])
    await expectCode(ops.rewordCommit(dir, shas.A, 'A unsigned?'), 'GIT_FAILED')
    expect(head(dir)).toBe(before)

    // git would tidy this author when signing: refuse rather than change it.
    git(dir, ['config', 'gpg.program', fake])
    const odd = `tree ${tree(dir, 'HEAD')}\nparent ${head(dir)}\nauthor "Doe, John" <q@x> 1700000000 -0000\ncommitter I <i@x> 1700000000 +0000\n\nodd\n`
    git(dir, ['update-ref', 'refs/heads/main', git(dir, ['hash-object', '-t', 'commit', '-w', '--stdin', '--literally'], { input: odd }).trim()])
    const oddHead = head(dir)
    const err = await expectCode(ops.rewordCommit(dir, shas.A, 'A again'), 'INVALID_ARGUMENT')
    expect(err.message).toMatch(/unusual author/)
    expect(head(dir)).toBe(oddHead)
  })

  it('keeps non-UTF-8 messages readable (commits are rewritten as UTF-8)', async () => {
    const { ops } = makeOps()
    const dir = initRepo()
    git(dir, ['config', 'i18n.commitEncoding', 'ISO-8859-1'])
    const latin1 = (text: string) => {
      const file = path.join(dir, '.git', 'MSG')
      fs.writeFileSync(file, Buffer.from(text, 'latin1'))
      return file
    }
    write(dir, 'a.txt', 'a\n')
    git(dir, ['add', 'a.txt'])
    git(dir, ['commit', '-q', '-F', latin1('Café first\n')])
    const first = head(dir)
    write(dir, 'b.txt', 'b\n')
    git(dir, ['add', 'b.txt'])
    git(dir, ['commit', '-q', '-F', latin1('Crème second\n')])

    const info = await ops.getRewordInfo(dir, first)
    expect(info.message).toBe('Café first')
    const res = await ops.rewordCommit(dir, first, 'Café first — edited ñ')
    expect(res.ok).toBe(true)
    expect(git(dir, ['log', '--encoding=UTF-8', '--format=%s'])).toBe('Crème second\nCafé first — edited ñ\n')
    expect(git(dir, ['cat-file', 'commit', 'HEAD~1'])).not.toContain('encoding') // the edited message is UTF-8 now
    expect(git(dir, ['cat-file', 'commit', 'HEAD'])).toContain('encoding ISO-8859-1') // the later commit is copied as is
  })

  it('copies later commits byte for byte, odd author lines and extra headers included', async () => {
    const { ops } = makeOps()
    const { dir, shas } = linearRepo()
    // Commits as importers or other tools write them: git itself would tidy these author lines.
    const craft = (author: string, subject: string) => {
      const body = `tree ${tree(dir, 'HEAD')}\nparent ${head(dir)}\nauthor ${author}\ncommitter Importer <imp@x> 1700000000 +0000\nchange-id zzkqxyl\n\n${subject}\n`
      const sha = git(dir, ['hash-object', '-t', 'commit', '-w', '--stdin', '--literally'], { input: body }).trim()
      git(dir, ['update-ref', 'refs/heads/main', sha])
      return sha
    }
    craft('"Doe, John" <q@x> 1700000000 -0000', 'quoted author')
    craft('<svn@x> 1700000100 +0099', 'no author name')
    const authorLines = (rev: string) => git(dir, ['cat-file', 'commit', rev]).split('\n').filter((l) => /^(author|change-id) /.test(l))
    const before = [authorLines('HEAD'), authorLines('HEAD~1')]

    const res = await ops.rewordCommit(dir, shas.B, 'B reworded')
    expect(res.ok).toBe(true)
    expect([authorLines('HEAD'), authorLines('HEAD~1')]).toEqual(before)
    expect(git(dir, ['cat-file', 'commit', 'HEAD'])).toContain('committer Test User <test@example.com>')
    expect(subjects(dir)).toEqual(['no author name', 'quoted author', 'C subject', 'B reworded', 'A subject', 'base'])
  })

  it('reports where the commit already is: upstream, other branches and tags', async () => {
    const { ops } = makeOps()
    const { repo } = cloneSetup()
    const pushed = head(repo)
    git(repo, ['branch', 'feature'])
    git(repo, ['tag', 'v1.0'])
    const local = commitFile(repo, 'local.txt', 'x\n', 'local only')
    expect(await ops.getRewordInfo(repo, pushed)).toMatchObject({
      editable: true,
      isHead: false,
      rewritten: 2,
      branch: 'main',
      upstream: 'origin/main',
      localBranches: ['feature'],
      remoteBranches: [],
      tags: ['v1.0']
    })
    expect(await ops.getRewordInfo(repo, local)).toMatchObject({
      editable: true,
      isHead: true,
      rewritten: 1,
      upstream: null,
      localBranches: [],
      tags: [],
      message: 'local only'
    })
  })
})
