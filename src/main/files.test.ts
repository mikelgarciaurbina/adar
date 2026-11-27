// The files Adar edits itself: a repository's files listed, one read for the editor, its text written back.

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_EDIT_BYTES, contentOf } from '@shared/files'
import { createFileOps, listFiles, listFolder, pathKind, readTextFile, saveTextFile } from './files'
import { cleanupTmp, commitFile, expectCode, fakePlatform, git, initRepo, isolateGitConfig, testContext, tmpDir, write } from './git/write/__tests__/helpers'
import { createGitContext } from './git/context'

beforeAll(isolateGitConfig)
afterAll(cleanupTmp)

const windows = process.platform === 'win32'
const read = (file: string) => fs.readFileSync(file)

function project(): string {
  const dir = initRepo()
  commitFile(dir, 'README.md', '# Hello\n', 'readme')
  commitFile(dir, 'src/main.ts', 'export const a = 1\n', 'main')
  commitFile(dir, 'src/gone.ts', 'gone\n', 'gone')
  commitFile(dir, '.gitignore', '.env\nnode_modules/\n*.log\n', 'ignore')
  fs.rmSync(path.join(dir, 'src/gone.ts'))
  write(dir, 'src/new.ts', 'new\n')
  write(dir, '.env', 'TOKEN=abc\n')
  write(dir, 'debug.log', 'log\n')
  write(dir, 'node_modules/pkg/index.js', 'module.exports = 1\n')
  write(dir, 'node_modules/pkg/.git/config', '[core]\n')
  // Another repository inside, which git does not track.
  write(dir, 'vendor/lib/a.txt', 'a\n')
  git(path.join(dir, 'vendor/lib'), ['init', '-q', '--template=', '-b', 'main'])
  return dir
}

describe('the files of a repository', () => {
  it('are what git tracks and is there, what it does not know, and what it ignores', async () => {
    const dir = project()
    const list = await listFiles(testContext(), dir)
    expect([...list.files].sort()).toEqual(['.gitignore', 'README.md', 'src/main.ts', 'src/new.ts'])
    expect([...list.ignored].sort()).toEqual(['.env', 'debug.log'])
    expect(list.folders).toEqual(['node_modules'])
    expect(list.repositories).toEqual(['vendor/lib'])
    expect(list.truncated).toBe(false)
  })

  it('lists a file in conflict once', async () => {
    const dir = initRepo()
    commitFile(dir, 'a.txt', 'base\n', 'base')
    git(dir, ['checkout', '-q', '-b', 'other'])
    commitFile(dir, 'a.txt', 'theirs\n', 'theirs')
    git(dir, ['checkout', '-q', 'main'])
    commitFile(dir, 'a.txt', 'ours\n', 'ours')
    expect(() => git(dir, ['merge', 'other'])).toThrow()
    expect((await listFiles(testContext(), dir)).files).toEqual(['a.txt'])
  })

  it('is refused for what is not a repository', async () => {
    await expectCode(listFiles(testContext(), tmpDir()), 'NOT_A_REPO')
  })

  it('reads an ignored folder only when asked, by name and without Git’s own files', async () => {
    const dir = project()
    const ctx = testContext()
    expect(await listFolder(ctx, dir, 'node_modules')).toEqual([{ name: 'pkg', kind: 'folder' }])
    expect((await listFolder(ctx, dir, 'node_modules/pkg')).map((e) => e.name)).toEqual(['index.js'])
    await expectCode(listFolder(ctx, dir, '../outside'), 'INVALID_ARGUMENT')
    await expectCode(listFolder(ctx, dir, '.git'), 'INVALID_ARGUMENT')
    await expectCode(listFolder(ctx, dir, 'node_modules/pkg/.git'), 'INVALID_ARGUMENT')
    await expectCode(listFolder(ctx, dir, 'nowhere'), 'NOT_FOUND')
    await expectCode(listFolder(ctx, dir, 'README.md'), 'INVALID_ARGUMENT')
  })

  it.skipIf(windows)('does not look into a folder that is a link', async () => {
    const dir = project()
    const outside = tmpDir()
    write(outside, 'secret.txt', 'secret\n')
    fs.symlinkSync(outside, path.join(dir, 'link'))
    await expectCode(listFolder(testContext(), dir, 'link'), 'INVALID_ARGUMENT')
  })
})

describe('a file to edit', () => {
  it('is read as text with its version, and not again while it is the same', async () => {
    const dir = project()
    const file = path.join(dir, 'src/main.ts')
    const text = await readTextFile(file, { root: dir })
    expect(text).toMatchObject({ path: file, real: file, text: 'export const a = 1\n', size: 19, bom: false })
    expect(await readTextFile(file, { root: dir, unless: text!.version })).toBeNull()
    // Another size: read again, with another version.
    fs.writeFileSync(file, 'export const a = 22\n')
    const again = await readTextFile(file, { root: dir, unless: text!.version })
    expect(again?.text).toBe('export const a = 22\n')
    expect(contentOf(again!.version)).not.toBe(contentOf(text!.version))
  })

  it('names the same content the same whenever it is read', async () => {
    const dir = project()
    const file = path.join(dir, 'README.md')
    const first = await readTextFile(file)
    fs.utimesSync(file, new Date(2020, 1, 1), new Date(2020, 1, 1))
    const second = await readTextFile(file, { unless: first!.version })
    expect(second?.version).not.toBe(first!.version)
    expect(contentOf(second!.version)).toBe(contentOf(first!.version))
  })

  it('keeps a byte order mark apart from the text', async () => {
    const dir = project()
    write(dir, 'bom.txt', '﻿hello\n')
    expect(await readTextFile(path.join(dir, 'bom.txt'))).toMatchObject({ text: 'hello\n', bom: true })
  })

  it('may be anywhere when no repository is given, and must be inside the one that is', async () => {
    const dir = project()
    const outside = tmpDir()
    write(outside, 'notes.txt', 'notes\n')
    expect((await readTextFile(path.join(outside, 'notes.txt')))?.text).toBe('notes\n')
    await expectCode(readTextFile(path.join(outside, 'notes.txt'), { root: dir }), 'INVALID_ARGUMENT')
    await expectCode(readTextFile(path.join(dir, '..', path.basename(outside), 'notes.txt'), { root: dir }), 'INVALID_ARGUMENT')
    await expectCode(readTextFile(dir, { root: dir }), 'INVALID_ARGUMENT')
  })

  it('is refused when it is not text Adar can write back', async () => {
    const dir = project()
    fs.writeFileSync(path.join(dir, 'image.bin'), Buffer.from([1, 2, 0, 3]))
    fs.writeFileSync(path.join(dir, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
    fs.writeFileSync(path.join(dir, 'huge.txt'), '')
    fs.truncateSync(path.join(dir, 'huge.txt'), MAX_EDIT_BYTES + 1)
    expect((await expectCode(readTextFile(path.join(dir, 'image.bin')), 'INVALID_ARGUMENT')).message).toMatch(/not a text file/)
    expect((await expectCode(readTextFile(path.join(dir, 'latin1.txt')), 'INVALID_ARGUMENT')).message).toMatch(/not UTF-8/)
    expect((await expectCode(readTextFile(path.join(dir, 'huge.txt')), 'INVALID_ARGUMENT')).message).toMatch(/too large/)
    expect((await expectCode(readTextFile(path.join(dir, 'src')), 'INVALID_ARGUMENT')).message).toMatch(/is a folder/)
    await expectCode(readTextFile(path.join(dir, 'nowhere.txt')), 'NOT_FOUND')
    await expectCode(readTextFile(path.join(dir, 'no/such/folder.txt')), 'NOT_FOUND')
    await expectCode(readTextFile('relative.txt'), 'INVALID_ARGUMENT')
    await expectCode(readTextFile(path.join(dir, 'a\0b')), 'INVALID_ARGUMENT')
  })

  it('is never one of Git’s own files', async () => {
    const dir = project()
    for (const p of ['.git/config', '.git/hooks/pre-commit', '.GIT/config', 'node_modules/pkg/.git/config']) {
      expect((await expectCode(readTextFile(path.join(dir, p)), 'INVALID_ARGUMENT')).message).toMatch(/Git's own files/)
      await expectCode(saveTextFile(path.join(dir, p), { text: '#!/bin/sh\n', expected: null }), 'INVALID_ARGUMENT')
    }
    expect(fs.existsSync(path.join(dir, '.git/hooks/pre-commit'))).toBe(false)
    // A file that only looks like them is a file like any other.
    write(dir, '.gitignore', 'x\n')
    expect((await readTextFile(path.join(dir, '.gitignore')))?.text).toBe('x\n')
  })

  it.skipIf(windows)('is never read or written through a link, which names where it leads', async () => {
    const dir = project()
    const outside = tmpDir()
    write(outside, 'secret.txt', 'secret\n')
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'trap.txt'))
    fs.symlinkSync(path.join(dir, 'README.md'), path.join(dir, 'inside.md'))
    for (const name of ['trap.txt', 'inside.md']) {
      const err = await expectCode(readTextFile(path.join(dir, name)), 'INVALID_ARGUMENT')
      expect(err.message).toMatch(/is a link to /)
      await expectCode(saveTextFile(path.join(dir, name), { text: 'x\n', expected: null }), 'INVALID_ARGUMENT')
    }
    expect(read(path.join(outside, 'secret.txt')).toString()).toBe('secret\n')
    expect(read(path.join(dir, 'README.md')).toString()).toBe('# Hello\n')
  })

  it.skipIf(windows)('follows the links among its folders, but not out of its repository', async () => {
    const dir = project()
    const outside = tmpDir()
    write(outside, 'notes.txt', 'notes\n')
    // A folder of the repository that is a link to one outside it.
    fs.symlinkSync(outside, path.join(dir, 'elsewhere'))
    const viaLink = path.join(dir, 'elsewhere', 'notes.txt')
    await expectCode(readTextFile(viaLink, { root: dir }), 'INVALID_ARGUMENT')
    await expectCode(saveTextFile(viaLink, { text: 'x\n', expected: null, root: dir }), 'INVALID_ARGUMENT')
    // Asked for by its own path, with no repository: the real file is what is edited.
    expect(await readTextFile(viaLink)).toMatchObject({ path: viaLink, real: path.join(outside, 'notes.txt'), text: 'notes\n' })
    expect(read(path.join(outside, 'notes.txt')).toString()).toBe('notes\n')
    // A repository reached through a link is still that repository.
    const parent = tmpDir()
    fs.symlinkSync(dir, path.join(parent, 'repo'))
    const through = path.join(parent, 'repo')
    expect(await readTextFile(path.join(through, 'README.md'), { root: through })).toMatchObject({ real: path.join(dir, 'README.md') })
  })
})

describe('saving a file', () => {
  it('writes the text in place and gives the new version', async () => {
    const dir = project()
    const file = path.join(dir, 'src/main.ts')
    if (!windows) fs.chmodSync(file, 0o755)
    const opened = await readTextFile(file, { root: dir })
    const saved = await saveTextFile(file, { text: 'export const a = 2\r\n', expected: opened!.version, root: dir })
    expect(read(file).toString()).toBe('export const a = 2\r\n')
    expect(saved.size).toBe(20)
    expect(saved.version).toBe((await readTextFile(file))!.version)
    if (!windows) expect(fs.statSync(file).mode & 0o777).toBe(0o755)
    // The next save starts from what the last one wrote.
    await saveTextFile(file, { text: 'export const a = 3\n', expected: saved.version, root: dir })
    expect(read(file).toString()).toBe('export const a = 3\n')
  })

  it('writes a byte order mark only when the text starts with one', async () => {
    const dir = project()
    const file = path.join(dir, 'bom.txt')
    write(dir, 'bom.txt', '﻿hello\n')
    const opened = await readTextFile(file)
    await saveTextFile(file, { text: '﻿bye\n', expected: opened!.version })
    expect([...read(file).subarray(0, 4)]).toEqual([0xef, 0xbb, 0xbf, 0x62])
  })

  it('is refused when the file changed since it was opened, until the version that is there is named', async () => {
    const dir = project()
    const file = path.join(dir, 'README.md')
    const opened = await readTextFile(file, { root: dir })
    fs.writeFileSync(file, '# Written by an agent\n')
    const err = await expectCode(saveTextFile(file, { text: '# Mine\n', expected: opened!.version, root: dir }), 'CONFLICT')
    expect(err.message).toMatch(/changed on disk/)
    expect(read(file).toString()).toBe('# Written by an agent\n')
    // The user was told and keeps their text: the editor names what is there now.
    const now = await readTextFile(file, { root: dir })
    await saveTextFile(file, { text: '# Mine\n', expected: now!.version, root: dir })
    expect(read(file).toString()).toBe('# Mine\n')
  })

  it('does not mind a file that was only touched', async () => {
    const dir = project()
    const file = path.join(dir, 'README.md')
    const opened = await readTextFile(file)
    fs.utimesSync(file, new Date(2021, 1, 1), new Date(2021, 1, 1))
    await saveTextFile(file, { text: '# Hi\n', expected: opened!.version })
    expect(read(file).toString()).toBe('# Hi\n')
  })

  it('is refused when the file is gone, and puts it back when no file is expected', async () => {
    const dir = project()
    const file = path.join(dir, 'README.md')
    const opened = await readTextFile(file)
    fs.rmSync(file)
    expect((await expectCode(saveTextFile(file, { text: '# Mine\n', expected: opened!.version }), 'CONFLICT')).message).toMatch(/no longer there/)
    expect(fs.existsSync(file)).toBe(false)
    // Kept all the same: there is no file to name, and none must be there.
    await saveTextFile(file, { text: '# Mine\n', expected: null })
    expect(read(file).toString()).toBe('# Mine\n')
    // With no file expected, one that appeared meanwhile is not written over.
    await expectCode(saveTextFile(file, { text: '# Other\n', expected: null }), 'CONFLICT')
  })

  it('refuses what is not a save, and text that is no text', async () => {
    const dir = project()
    const file = path.join(dir, 'README.md')
    const opened = await readTextFile(file)
    await expectCode(saveTextFile(file, null), 'INVALID_ARGUMENT')
    await expectCode(saveTextFile(file, { text: 1, expected: opened!.version }), 'INVALID_ARGUMENT')
    await expectCode(saveTextFile(file, { text: 'x', expected: 3 }), 'INVALID_ARGUMENT')
    await expectCode(saveTextFile(file, { text: 'a\0b', expected: opened!.version }), 'INVALID_ARGUMENT')
    await expectCode(saveTextFile(path.join(dir, 'src'), { text: 'x', expected: null }), 'INVALID_ARGUMENT')
    expect(read(file).toString()).toBe('# Hello\n')
  })

  it('waits for what Adar is doing in the repository', async () => {
    const dir = project()
    const file = path.join(dir, 'README.md')
    const opened = await readTextFile(file, { root: dir })
    const order: string[] = []
    let release = () => {}
    const locks = new Map<string, Promise<unknown>>()
    const exclusive = <T,>(repo: string, fn: () => Promise<T>): Promise<T> => {
      const next = (locks.get(repo) ?? Promise.resolve()).then(fn)
      locks.set(repo, next.catch(() => undefined))
      return next
    }
    const busy = exclusive(dir, () => new Promise<void>((done) => (release = () => (order.push('checkout'), done()))))
    const saving = saveTextFile(file, { text: '# Mine\n', expected: opened!.version, root: dir }, exclusive).then(() => order.push('save'))
    await new Promise((r) => setTimeout(r, 30))
    expect(order).toEqual([])
    release()
    await Promise.all([busy, saving])
    expect(order).toEqual(['checkout', 'save'])
  })
})

describe('what a path given to Adar is', () => {
  it('is a folder, a Markdown document, another file or nothing', async () => {
    const dir = project()
    expect(await pathKind(dir)).toBe('folder')
    expect(await pathKind(path.join(dir, 'README.md'))).toBe('markdown')
    expect(await pathKind(path.join(dir, 'src/main.ts'))).toBe('file')
    expect(await pathKind(path.join(dir, 'nowhere'))).toBe('missing')
    expect(await pathKind('relative')).toBe('missing')
    expect(await pathKind(null)).toBe('missing')
  })
})

describe('outside the desktop app', () => {
  it('lists a repository but neither opens nor saves a file', async () => {
    const dir = project()
    const ops = createFileOps(createGitContext(fakePlatform, () => undefined))
    expect((await ops.listFiles(dir)).files).toContain('README.md')
    const file = path.join(dir, 'README.md')
    expect((await expectCode(ops.readTextFile(file), 'INVALID_ARGUMENT')).message).toMatch(/desktop app/)
    await expectCode(ops.saveTextFile(file, { text: 'x', expected: null }), 'INVALID_ARGUMENT')
    await expectCode(ops.pathKind(file), 'INVALID_ARGUMENT')
    expect(read(file).toString()).toBe('# Hello\n')
    const desktop = createFileOps(createGitContext({ ...fakePlatform, isElectron: true }, () => undefined))
    expect((await desktop.readTextFile(file))?.text).toBe('# Hello\n')
    expect(await desktop.pathKind(file)).toBe('markdown')
  })
})
