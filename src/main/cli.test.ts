import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { cliStatus, installCli, planInstall, uninstallCli, type DirState } from './cli'

const SCRIPT = path.resolve(__dirname, '../../resources/bin/adar')
const tmp: string[] = []
const temp = (prefix: string) => {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix))
  tmp.push(d)
  return d
}
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true })
})

describe('planInstall', () => {
  const dir = (d: string, writable: boolean, existing: DirState['existing'] = { kind: 'none' }, exists = true): DirState => ({ dir: d, exists, writable, existing })
  it('prefers the first writable directory and reuses an existing install', () => {
    expect(planInstall([dir('/opt/homebrew/bin', true), dir('/usr/local/bin', true)], false)).toEqual({ dir: '/opt/homebrew/bin', needsAdmin: false })
    expect(planInstall([dir('/opt/homebrew/bin', false, { kind: 'none' }, false), dir('/usr/local/bin', true)], false)).toEqual({ dir: '/usr/local/bin', needsAdmin: false })
    expect(planInstall([dir('/opt/homebrew/bin', true), dir('/usr/local/bin', false, { kind: 'ours' })], false)).toEqual({ dir: '/usr/local/bin', needsAdmin: true })
  })
  it('falls back to /usr/local/bin with administrator rights', () => {
    expect(planInstall([dir('/opt/homebrew/bin', false, { kind: 'none' }, false), dir('/usr/local/bin', false)], false)).toEqual({ dir: '/usr/local/bin', needsAdmin: true })
  })
  it('never replaces an unrelated adar without force', () => {
    const other = { kind: 'other', detail: 'another program' } as const
    expect(planInstall([dir('/opt/homebrew/bin', true, other), dir('/usr/local/bin', true)], false)).toEqual({ conflict: '/opt/homebrew/bin/adar (another program)' })
    expect(planInstall([dir('/opt/homebrew/bin', true, other)], true)).toEqual({ dir: '/opt/homebrew/bin', needsAdmin: false })
  })
})

describe('install / uninstall (temporary directories)', () => {
  let source: string
  let bin: string
  beforeEach(() => {
    const app = temp('adar-app-')
    const res = path.join(app, 'Adar.app', 'Contents', 'Resources', 'bin')
    mkdirSync(res, { recursive: true })
    source = path.join(res, 'adar')
    copyFileSync(SCRIPT, source)
    chmodSync(source, 0o644) // install makes it executable
    bin = temp('adar-bin-')
    process.env.PATH = `${bin}:/usr/bin:/bin`
  })

  it('links the bundled script, reports it, and removes only its own link', async () => {
    expect((await cliStatus(source, [bin])).installedAt).toBeNull()
    const st = await installCli(source, false, [bin], bin)
    expect(st).toMatchObject({ available: true, installedAt: path.join(bin, 'adar'), onPath: true, conflict: null })
    expect(readlinkSync(path.join(bin, 'adar'))).toBe(source)
    expect(lstatSync(source).mode & 0o111).not.toBe(0)
    // Installing again is a no-op that keeps the link.
    expect((await installCli(source, false, [bin])).installedAt).toBe(path.join(bin, 'adar'))
    expect((await uninstallCli(source, [bin])).installedAt).toBeNull()
    expect(existsSync(path.join(bin, 'adar'))).toBe(false)
  })

  it('refuses to replace another adar unless forced, and never uninstalls it', async () => {
    writeFileSync(path.join(bin, 'adar'), '#!/bin/sh\necho someone else\n', { mode: 0o755 })
    expect((await cliStatus(source, [bin])).conflict).toMatch(/another program/)
    await expect(installCli(source, false, [bin])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await uninstallCli(source, [bin])
    expect(existsSync(path.join(bin, 'adar'))).toBe(true)
    expect((await installCli(source, true, [bin])).installedAt).toBe(path.join(bin, 'adar'))
  })

  it('treats a dangling link into an old Adar.app as its own (app moved or DMG ejected)', async () => {
    symlinkSync(path.join(temp('adar-gone-'), 'Old', 'Adar.app', 'Contents', 'Resources', 'bin', 'adar'), path.join(bin, 'adar'))
    expect((await cliStatus(source, [bin], bin)).installedAt).toBe(path.join(bin, 'adar'))
    expect(readlinkSync(path.join(bin, 'adar'))).not.toBe(source)
    await installCli(source, false, [bin], bin)
    expect(readlinkSync(path.join(bin, 'adar'))).toBe(source)
    expect((await uninstallCli(source, [bin], bin)).installedAt).toBeNull()
  })

  it('never treats a regular file as its own, even if it contains the marker', async () => {
    copyFileSync(SCRIPT, path.join(bin, 'adar'))
    expect((await cliStatus(source, [bin], bin)).conflict).toMatch(/another program/)
    await uninstallCli(source, [bin], bin)
    expect(existsSync(path.join(bin, 'adar'))).toBe(true)
  })

  it('reports when the install folder is not on the user PATH, and refuses temporary app locations', async () => {
    expect((await installCli(source, false, [bin], '/usr/bin:/bin')).onPath).toBe(false)
    await uninstallCli(source, [bin], bin)
    const translocated = path.join(temp('adar-tl-'), 'AppTranslocation', 'X', 'd', 'Adar.app', 'Contents', 'Resources', 'bin')
    mkdirSync(translocated, { recursive: true })
    copyFileSync(SCRIPT, path.join(translocated, 'adar'))
    await expect(installCli(path.join(translocated, 'adar'), false, [bin], bin)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(existsSync(path.join(bin, 'adar'))).toBe(false)
  })

  it('recognises a link to another copy of Adar.app as its own (moved app)', async () => {
    const other = temp('adar-old-')
    const oldRes = path.join(other, 'Adar.app', 'Contents', 'Resources', 'bin')
    mkdirSync(oldRes, { recursive: true })
    copyFileSync(SCRIPT, path.join(oldRes, 'adar'))
    symlinkSync(path.join(oldRes, 'adar'), path.join(bin, 'adar'))
    expect((await cliStatus(source, [bin])).installedAt).toBe(path.join(bin, 'adar'))
    // Re-installing points the link at this build.
    await installCli(source, false, [bin])
    expect(readlinkSync(path.join(bin, 'adar'))).toBe(source)
  })
})

describe('adar script', () => {
  const run = (args: string[], env: Record<string, string>, cwd?: string) =>
    spawnSync('/bin/sh', [SCRIPT, ...args], { env: { PATH: '/usr/bin:/bin', HOME: os.tmpdir(), ADAR_CLI_DRY_RUN: '1', ...env }, cwd, encoding: 'utf8' })

  it('opens the current directory, a given folder or the folder of a file', () => {
    const app = path.join(temp('adar-fake-'), 'Adar.app')
    mkdirSync(app, { recursive: true })
    const repo = execFileSync('/bin/sh', ['-c', 'cd "$1" && pwd -P', 'sh', temp('adar repo ')], { encoding: 'utf8' }).trim()
    writeFileSync(path.join(repo, 'file.txt'), 'x')
    expect(run([], { ADAR_APP: app }, repo).stdout.trim()).toBe(`open -a ${app} ${repo} --args --open-repo=${repo}`)
    expect(run([repo], { ADAR_APP: app }).stdout.trim()).toBe(`open -a ${app} ${repo} --args --open-repo=${repo}`)
    expect(run([path.join(repo, 'file.txt')], { ADAR_APP: app }).stdout.trim()).toBe(`open -a ${app} ${repo} --args --open-repo=${repo}`)
  })

  it('finds the app bundle it lives in through a PATH symlink', () => {
    const base = temp('adar-bundle-')
    const res = path.join(base, 'Adar.app', 'Contents', 'Resources', 'bin')
    mkdirSync(res, { recursive: true })
    copyFileSync(SCRIPT, path.join(res, 'adar'))
    const bin = temp('adar-path-')
    symlinkSync(path.join(res, 'adar'), path.join(bin, 'adar'))
    const out = spawnSync(path.join(bin, 'adar'), [base], { env: { PATH: '/usr/bin:/bin', HOME: os.tmpdir(), ADAR_CLI_DRY_RUN: '1' }, encoding: 'utf8' })
    const real = execFileSync('/bin/sh', ['-c', 'cd "$1" && pwd -P', 'sh', base], { encoding: 'utf8' }).trim()
    expect(out.stdout.trim()).toBe(`open -a ${path.join(base, 'Adar.app')} ${real} --args --open-repo=${real}`)
  })

  it('ignores an exported CDPATH and treats "-" as a folder name', () => {
    const app = path.join(temp('adar-fake-'), 'Adar.app')
    mkdirSync(app, { recursive: true })
    const work = execFileSync('/bin/sh', ['-c', 'cd "$1" && pwd -P', 'sh', temp('adar-work-')], { encoding: 'utf8' }).trim()
    const elsewhere = temp('adar-cdpath-')
    mkdirSync(path.join(work, 'repo'))
    mkdirSync(path.join(elsewhere, 'repo'))
    mkdirSync(path.join(work, '-'))
    const viaCdpath = run(['repo'], { ADAR_APP: app, CDPATH: elsewhere }, work)
    expect(viaCdpath.stdout.trim()).toBe(`open -a ${app} ${work}/repo --args --open-repo=${work}/repo`)
    expect(run(['-'], { ADAR_APP: app, OLDPWD: elsewhere }, work).stdout.trim()).toBe(`open -a ${app} ${work}/- --args --open-repo=${work}/-`)
  })

  it('reports missing paths and usage errors', () => {
    const app = path.join(temp('adar-fake-'), 'Adar.app')
    mkdirSync(app, { recursive: true })
    const missing = run(['/no/such/dir'], { ADAR_APP: app })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toMatch(/no such file or directory/)
    expect(run(['a', 'b'], { ADAR_APP: app }).status).toBe(2)
    expect(run(['--help'], {}).stdout).toMatch(/usage: adar/)
  })
})
