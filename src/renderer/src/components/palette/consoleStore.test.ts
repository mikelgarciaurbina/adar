import { beforeEach, describe, expect, it, vi } from 'vitest'

const runGit = vi.fn()
vi.mock('@renderer/api/client', () => ({
  api: new Proxy({}, { get: (_t, prop) => (prop === 'runGit' ? runGit : async () => undefined) }),
  setZoom: () => {},
  newOpId: (p = 'op') => `${p}-1`,
  isElectron: false,
  isMac: false,
  platform: 'other',
  onAdarEvent: () => () => {}
}))

const { useConsole, runConsoleLine, truncateBlock } = await import('./consoleStore')
const { useApp } = await import('@renderer/store/appStore')

const repo = '/repo'
const kinds = () => (useConsole.getState().logs[repo] ?? []).map((l) => l.kind)
const texts = () => (useConsole.getState().logs[repo] ?? []).map((l) => l.text)

beforeEach(() => {
  runGit.mockReset()
  useConsole.setState({ logs: {}, running: {} })
  useApp.setState({ tabs: [], consoleOpen: true })
})

describe('runConsoleLine', () => {
  it('runs git with split args (leading git stripped) and logs output', async () => {
    runGit.mockResolvedValue({ stdout: 'On branch main\n', stderr: 'hint: x\n', code: 0 })
    const ran = await runConsoleLine(repo, `git commit -m "hello world"`)
    expect(ran).toBe(true)
    expect(runGit).toHaveBeenCalledWith(repo, ['commit', '-m', 'hello world'])
    expect(kinds()).toEqual(['cmd', 'out', 'err', 'exit'])
    expect(texts()[0]).toBe(`git commit -m 'hello world'`)
    expect(texts()[1]).toBe('On branch main')
    expect(texts()[3]).toBe('exit 0')
    expect(useConsole.getState().running[repo]).toBe(false)
  })

  it('reports parse errors without running', async () => {
    expect(await runConsoleLine(repo, 'log "oops')).toBe(false)
    expect(runGit).not.toHaveBeenCalled()
    expect(kinds()).toEqual(['err'])
  })

  it('blocks interactive commands', async () => {
    expect(await runConsoleLine(repo, 'add -p')).toBe(false)
    expect(runGit).not.toHaveBeenCalled()
    expect(kinds()).toEqual(['cmd', 'info'])
  })

  it('supports clear and exit built-ins', async () => {
    useConsole.getState().append(repo, [{ kind: 'out', text: 'x' }])
    await runConsoleLine(repo, 'clear')
    expect(kinds()).toEqual([])
    await runConsoleLine(repo, 'exit')
    expect(useApp.getState().consoleOpen).toBe(false)
  })

  it('logs backend failures as stderr', async () => {
    runGit.mockRejectedValue(Object.assign(new Error('spawn git ENOENT'), { code: 'GIT_NOT_INSTALLED' }))
    await runConsoleLine(repo, 'status')
    expect(kinds()).toEqual(['cmd', 'err'])
    expect(texts()[1]).toContain('ENOENT')
  })

  it('prompts for a command when only "git" is typed', async () => {
    await runConsoleLine(repo, 'git')
    expect(kinds()).toEqual(['info'])
  })
})

describe('truncateBlock', () => {
  it('keeps short text and truncates long text with a note', () => {
    expect(truncateBlock('abc', 10)).toBe('abc')
    const t = truncateBlock('x'.repeat(20), 10)
    expect(t.startsWith('x'.repeat(10))).toBe(true)
    expect(t).toContain('10 more characters')
  })
})
