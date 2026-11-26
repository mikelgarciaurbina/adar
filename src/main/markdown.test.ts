// Markdown documents Adar previews: the file read as text, its pictures and where its links lead.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_MARKDOWN_BYTES } from '@shared/markdown'
import { createMarkdownOps, markdownHandler, readMarkdownFile, readMarkdownImage, resolveMarkdownLink, resolveReference, setMarkdownHandler } from './markdown'
import type { PlatformAdapter } from './platform'

const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-md-')))
const at = (...name: string[]) => path.join(dir, ...name)
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

fs.mkdirSync(at('repo', '.git'), { recursive: true })
fs.mkdirSync(at('repo', 'docs', 'img'), { recursive: true })
fs.writeFileSync(at('repo', 'README.md'), '\ufeff# Hello\n')
fs.writeFileSync(at('repo', 'docs', 'guide.md'), '# Guide\n')
fs.writeFileSync(at('repo', 'docs', 'img', 'a b.png'), PNG)
fs.writeFileSync(at('repo', 'logo.png'), PNG)
fs.writeFileSync(at('repo', 'run.sh'), '#!/bin/sh\n', { mode: 0o755 })
fs.writeFileSync(at('secret.txt'), 'secret')
// A link named like a document that leads to something else.
fs.symlinkSync(at('secret.txt'), at('repo', 'trap.md'))
fs.symlinkSync(at('repo', 'README.md'), at('repo', 'link.md'))
fs.mkdirSync(at('repo', 'folder.md'))
fs.writeFileSync(at('huge.md'), '')
fs.truncateSync(at('huge.md'), MAX_MARKDOWN_BYTES + 1)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const readme = at('repo', 'README.md')
const guide = at('repo', 'docs', 'guide.md')

describe('a Markdown file to preview', () => {
  it('is read as text, and not again while it is the same', async () => {
    const file = await readMarkdownFile(readme)
    expect(file).toMatchObject({ path: readme, text: '# Hello\n', size: 11 })
    expect(await readMarkdownFile(readme, { unless: file!.version })).toBeNull()
    fs.writeFileSync(readme, '# Hello again\n')
    expect(await readMarkdownFile(readme, { unless: file!.version })).toMatchObject({ text: '# Hello again\n' })
    expect(await readMarkdownFile(at('repo', 'link.md'))).toMatchObject({ path: at('repo', 'link.md'), text: '# Hello again\n' })
  })

  it('is nothing but a Markdown file', async () => {
    await expect(readMarkdownFile(at('repo', 'missing.md'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    for (const p of [at('repo', 'trap.md'), at('repo', 'folder.md'), at('secret.txt'), at('repo', 'run.sh'), at('huge.md'), 'README.md', '', 42, `${readme}\0`]) {
      await expect(readMarkdownFile(p)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
  })
})

describe('what a document refers to', () => {
  it('is read beside the document, from its repository or from the home', async () => {
    expect(await resolveReference(guide, 'img/a%20b.png')).toEqual({ path: at('repo', 'docs', 'img', 'a b.png'), anchor: '' })
    expect(await resolveReference(guide, '../README.md#set-up')).toEqual({ path: readme, anchor: 'set-up' })
    expect(await resolveReference(guide, '#top')).toEqual({ path: guide, anchor: 'top' })
    // As GitHub reads it: from the repository's root.
    expect(await resolveReference(guide, '/logo.png?raw=true')).toEqual({ path: at('repo', 'logo.png'), anchor: '' })
    expect(await resolveReference(guide, '~/notes.md')).toEqual({ path: path.join(os.homedir(), 'notes.md'), anchor: '' })
    expect(await resolveReference(guide, `${pathToFileURL(readme).href}#usage`)).toEqual({ path: readme, anchor: 'usage' })
  })

  it('is never the web or another scheme', async () => {
    for (const ref of ['https://example.com/a.png', 'mailto:me@example.com', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//example.com/a.png', 'file://server/share/a.png', '', ' ', 'a\0b']) {
      expect(await resolveReference(guide, ref)).toBeNull()
    }
    expect(await resolveReference('guide.md', 'a.png')).toBeNull()
  })

  it('shows pictures only', async () => {
    const url = `data:image/png;base64,${PNG.toString('base64')}`
    expect(await readMarkdownImage(guide, 'img/a%20b.png')).toBe(url)
    expect(await readMarkdownImage(guide, '/logo.png')).toBe(url)
    for (const src of ['../README.md', '../run.sh', '../../secret.txt', 'missing.png', 'https://example.com/a.png']) expect(await readMarkdownImage(guide, src)).toBeNull()
  })

  it('tells documents from other files, and what is not there', async () => {
    expect(await resolveMarkdownLink(guide, '../README.md#usage')).toEqual({ path: readme, markdown: true, anchor: 'usage' })
    expect(await resolveMarkdownLink(guide, '../run.sh')).toEqual({ path: at('repo', 'run.sh'), markdown: false, anchor: '' })
    expect(await resolveMarkdownLink(guide, 'img')).toEqual({ path: at('repo', 'docs', 'img'), markdown: false, anchor: '' })
    // Named like a document, but something else behind the link, or a folder.
    expect(await resolveMarkdownLink(guide, '../trap.md')).toMatchObject({ markdown: false })
    expect(await resolveMarkdownLink(guide, '../folder.md')).toMatchObject({ markdown: false })
    expect(await resolveMarkdownLink(guide, 'missing.md')).toBeNull()
    expect(await resolveMarkdownLink(guide, 'https://example.com')).toBeNull()
  })
})

describe('the API of the preview', () => {
  const platform = (over: Partial<PlatformAdapter>): PlatformAdapter => ({ isElectron: true, appVersion: '0', userDataDir: dir, pickDirectory: async () => null, openExternal: async () => undefined, showInFolder: async () => undefined, ...over })

  it('reads no file over the browser bridge', async () => {
    const ops = createMarkdownOps(platform({ isElectron: false }))
    await expect(ops.readMarkdownFile(readme)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(ops.markdownImage(guide, '/logo.png')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(ops.markdownLink(guide, '../README.md')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(ops.pickMarkdownFile()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('picks Markdown files, and only an installed app can become the one they open with', async () => {
    const asked: unknown[] = []
    const ops = createMarkdownOps(platform({ pickFile: async (opts) => (asked.push(opts), readme) }))
    expect(await ops.pickMarkdownFile({ defaultPath: dir })).toBe(readme)
    expect(asked[0]).toMatchObject({ defaultPath: dir, filters: [{ name: 'Markdown', extensions: expect.arrayContaining(['md', 'markdown']) }] })
    expect(await ops.markdownDefaultApp()).toBeNull()
    await expect(ops.setMarkdownDefaultApp()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('the app Markdown files open with', () => {
  it.runIf(process.platform === 'darwin')('is read from macOS', async () => {
    // A bundle id such as com.apple.dt.Xcode, or '' when no app opens them.
    expect(await markdownHandler()).toMatch(/^[A-Za-z0-9.-]*$/)
  })

  it('is never set to something that is no bundle id', async () => {
    await expect(setMarkdownHandler('dev.adar"; rm -rf')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
