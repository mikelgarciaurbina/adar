// Administrator rights through osascript: the arguments reach the snippet untouched, a background snippet outlives
// the call, and cancelling is told apart from failing. The dialog itself needs a person: these runs leave out
// "with administrator privileges" and otherwise use the same AppleScript.
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { adminAppleScript, adminCommand, adminError } from './admin'

const execFileP = promisify(execFile)
const tmp = mkdtempSync(path.join(os.tmpdir(), 'adar-admin-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('adminCommand', () => {
  it('asks for administrator privileges, with the prompt when given', () => {
    const lines = adminAppleScript()
    expect(lines.filter((l) => l.includes('do shell script'))).toEqual([
      '    do shell script cmd with administrator privileges',
      '    do shell script cmd with prompt (item 3 of argv) with administrator privileges'
    ])
    const argv = adminCommand('echo "$1"', ['a b'], { background: true, prompt: 'Adar needs a password.' })
    expect(argv.slice(-4)).toEqual(['echo "$1"', 'background', 'Adar needs a password.', 'a b'])
    expect(adminCommand('true', [], {}).slice(-3)).toEqual(['true', 'wait', ''])
  })
})

describe('adminError', () => {
  it('tells a cancelled dialog apart from a failure, keeping the reason', () => {
    expect(adminError({ stderr: '0:310: execution error: User canceled. (-128)\n', message: 'Command failed' }, 'x').code).toBe('CANCELLED')
    const wrong = adminError(
      { stderr: '0:310: execution error: The administrator user name or password was incorrect. (-60005)\n', message: 'Command failed' },
      'Could not get administrator rights to replace Adar'
    )
    expect(wrong.code).toBe('UNKNOWN')
    expect(wrong.message).toBe('Could not get administrator rights to replace Adar: The administrator user name or password was incorrect.')
    expect(adminError(new Error('spawn ENOENT'), 'No rights').message).toBe('No rights')
  })
})

describe.skipIf(process.platform !== 'darwin')('the AppleScript (without privileges)', () => {
  const run = (script: string, args: string[], background = false) =>
    execFileP('/usr/bin/osascript', adminCommand(script, args, { background, prompt: 'unused here' }, false))

  it('passes every argument to the snippet as-is', async () => {
    const out = path.join(tmp, 'args.txt')
    const args = [`it's "quoted"`, '$HOME `id` $(id)', 'two\nlines', '-n', '']
    await run('out="$1"; shift; for a in "$@"; do printf "%s\\0" "$a"; done > "$out"', [out, ...args])
    expect(readFileSync(out, 'utf8').split('\0').slice(0, -1)).toEqual(args)
  })

  it('returns at once for a background snippet, which keeps running', { timeout: 20_000 }, async () => {
    // The snippet only finishes after the call has returned (it waits for `go`, at most 10 s).
    const go = path.join(tmp, 'go')
    const done = path.join(tmp, 'done.txt')
    await run('i=0; while [ ! -e "$1" ] && [ "$i" -lt 100 ]; do i=$((i + 1)); sleep 0.1; done; [ -e "$1" ] && echo done > "$2"', [go, done], true)
    writeFileSync(go, '')
    for (let i = 0; i < 100 && !existsSync(done); i++) await new Promise((r) => setTimeout(r, 100))
    expect(readFileSync(done, 'utf8')).toBe('done\n')
  })
})
