// Files a terminal links to: a picture read to be shown, and what may be opened with its own app (never a program).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, openableFile, readTerminalImage } from './files'

// The real path as the system gives it (on Windows the long name of a folder, not its 8.3 short one), as the code reads it.
const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'adar-links-')))
const at = (name: string) => path.join(dir, name)
// The smallest PNG there is: one transparent pixel.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')
fs.writeFileSync(at('pic.png'), PNG)
fs.writeFileSync(at('guía.html'), '<!doctype html><title>x</title>')
fs.writeFileSync(at('notes.txt'), 'hello')
fs.writeFileSync(at('run.sh'), '#!/bin/sh\necho ran\n', { mode: 0o755 })
fs.mkdirSync(at('folder.png'))
fs.symlinkSync(at('pic.png'), at('link.png'))
// A link named like a web page that leads to a script.
fs.symlinkSync(at('run.sh'), at('trap.html'))
fs.writeFileSync(at('huge.png'), '')
fs.truncateSync(at('huge.png'), MAX_IMAGE_BYTES + 1)

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('files a terminal links to', () => {
  it('reads a picture to show it, and nothing else', async () => {
    const img = await readTerminalImage(at('pic.png'))
    expect(img).toEqual({ url: `data:image/png;base64,${PNG.toString('base64')}`, size: PNG.length })
    expect(await readTerminalImage(at('link.png'))).toEqual(img)
    for (const p of [at('guía.html'), at('notes.txt'), at('folder.png'), at('missing.png'), at('huge.png'), 'pic.png', '', 42, `${at('pic.png')}\0`]) {
      expect(await readTerminalImage(p)).toBeNull()
    }
  })

  it('opens pictures, web pages and PDFs with their app, never a program or a script', async () => {
    expect(await openableFile(at('guía.html'))).toBe(at('guía.html'))
    expect(await openableFile(at('link.png'))).toBe(at('pic.png'))
    await expect(openableFile(at('notes.txt'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(openableFile(at('trap.html'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(openableFile(at('run.sh'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(openableFile(at('folder.png'))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(openableFile(at('missing.html'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(openableFile('guía.html')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
