// openInEditor without an editor command: repository files must never reach a launcher that runs
// them (symlinks to .command files, executables, .app bundles), and Windows must not go through cmd.exe.
import { chmodSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const launched: Array<[string, string[]]> = []
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>()
  return {
    ...orig,
    // Only app.ts uses execFile (macOS `open`); git itself is spawned with spawn(), which stays real.
    execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out: string, err2: string) => void) => {
      launched.push([cmd, args])
      cb(null, '', '')
    }
  }
})

import type { GitContext } from '../../context'
import type { SystemServices } from '../../../system'
import { createAppOps, planDefaultOpen } from '../app'

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'adar-open-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function file(rel: string, content = 'x\n', mode = 0o644): string {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  chmodSync(abs, mode)
  return abs
}
function link(rel: string, target: string): string {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  symlinkSync(target, abs)
  return abs
}

// A checked-out repository: an executable .command, a symlink with an innocent name pointing at it,
// an extension-less executable, an app bundle and a folder that is a bundle without the extension.
const command = file('repo/scripts/x.command', '#!/bin/sh\ntouch /tmp/pwned\n', 0o755)
const docs = link('repo/docs.md', 'scripts/x.command')
const picture = link('repo/picture.png', 'scripts/x.command')
const build = file('repo/build', '#!/bin/sh\n', 0o755)
const notes = file('repo/notes.txt')
const png = file('repo/logo.png')
const exePng = file('repo/odd.png', 'x', 0o755)
const app = path.join(root, 'repo/Tool.app')
file('repo/Tool.app/Contents/MacOS/Tool', '#!/bin/sh\n', 0o755)
const appLink = link('repo/Open me', 'Tool.app')
const hidden = path.join(root, 'repo/Thing')
file('repo/Thing/Contents/Info.plist', '<plist/>')
const plainDir = path.join(root, 'repo/src')
mkdirSync(plainDir, { recursive: true })
const desktop = file('repo/run.desktop')
const weird = file('repo/a&b %PATH% ^c.txt')
const bat = file('repo/setup.bat')

describe('planDefaultOpen', () => {
  it('macOS: files open in the text editor, decided on the symlink target', async () => {
    expect(await planDefaultOpen(docs, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: ['-t', command] })
    expect(await planDefaultOpen(picture, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: ['-t', command] })
    expect(await planDefaultOpen(command, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: ['-t', command] })
    expect(await planDefaultOpen(build, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: ['-t', build] })
    expect(await planDefaultOpen(notes, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: ['-t', notes] })
    // Viewer-only types keep their default app, unless executable.
    expect(await planDefaultOpen(png, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: [png] })
    expect(await planDefaultOpen(exePng, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: ['-t', exePng] })
  })

  it('macOS: bundles are revealed, never opened; plain folders open in Finder', async () => {
    expect(await planDefaultOpen(app, 'darwin')).toEqual({ kind: 'reveal', path: app })
    expect(await planDefaultOpen(appLink, 'darwin')).toEqual({ kind: 'reveal', path: app })
    expect(await planDefaultOpen(hidden, 'darwin')).toEqual({ kind: 'reveal', path: hidden })
    expect(await planDefaultOpen(plainDir, 'darwin')).toEqual({ kind: 'exec', command: 'open', args: [plainDir] })
  })

  it('Windows: no cmd.exe; Notepad for anything but viewer types', async () => {
    expect(await planDefaultOpen(weird, 'win32')).toEqual({ kind: 'spawn', command: 'notepad.exe', args: [weird] })
    expect(await planDefaultOpen(bat, 'win32')).toEqual({ kind: 'spawn', command: 'notepad.exe', args: [bat] })
    expect(await planDefaultOpen(png, 'win32', { canOpenPath: true })).toEqual({ kind: 'openPath', path: png })
    expect(await planDefaultOpen(png, 'win32')).toEqual({ kind: 'spawn', command: 'notepad.exe', args: [png] })
    expect(await planDefaultOpen(plainDir, 'win32')).toEqual({ kind: 'reveal', path: plainDir })
  })

  it('Linux: executables and launchers are refused', async () => {
    expect(await planDefaultOpen(docs, 'linux')).toMatchObject({ kind: 'refuse' })
    expect(await planDefaultOpen(build, 'linux')).toMatchObject({ kind: 'refuse' })
    expect(await planDefaultOpen(desktop, 'linux')).toMatchObject({ kind: 'refuse', message: expect.stringMatching(/Editor command/) })
    expect(await planDefaultOpen(notes, 'linux')).toEqual({ kind: 'spawn', command: 'xdg-open', args: [notes] })
    expect(await planDefaultOpen(plainDir, 'linux')).toEqual({ kind: 'spawn', command: 'xdg-open', args: [plainDir] })
  })

  it('reports missing paths and dangling symlinks as NOT_FOUND', async () => {
    const dangling = link('repo/dangling.md', 'nowhere.command')
    await expect(planDefaultOpen(dangling, 'darwin')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe.skipIf(process.platform !== 'darwin')('openInEditor (macOS, no editor command)', () => {
  const revealed: string[] = []
  const ctx = {
    platform: {
      isElectron: false,
      appVersion: 'test',
      userDataDir: root,
      pickDirectory: async () => null,
      openExternal: async () => undefined,
      showInFolder: async (p: string) => void revealed.push(p)
    }
  } as unknown as GitContext
  const services = { settings: { getSettings: async () => ({ editorCommand: '' }) } } as unknown as SystemServices
  const ops = createAppOps(ctx, services)

  beforeEach(() => {
    launched.length = 0
    revealed.length = 0
  })

  it('opens a symlink to a .command file as text, not with Terminal', async () => {
    await ops.openInEditor(docs)
    expect(launched).toEqual([['open', ['-t', command]]])
  })

  it('reveals an .app bundle (also the repository folder itself) instead of launching it', async () => {
    await ops.openInEditor(appLink)
    await ops.openInEditor(app)
    expect(launched).toEqual([])
    expect(revealed).toEqual([app, app])
  })
})
