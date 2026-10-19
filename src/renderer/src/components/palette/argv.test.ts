import { describe, expect, it } from 'vitest'
import { formatCommand, interactiveReason, parseGitCommandLine, quoteArg, splitArgs } from './argv'
import { navigateHistory, pushHistory } from './history'

describe('splitArgs', () => {
  it('splits on any whitespace and collapses runs', () => {
    expect(splitArgs('  log   --oneline\t-n 5 ')).toEqual({ args: ['log', '--oneline', '-n', '5'], error: null })
    expect(splitArgs('')).toEqual({ args: [], error: null })
    expect(splitArgs('   ')).toEqual({ args: [], error: null })
  })

  it('handles single quotes literally', () => {
    expect(splitArgs(`commit -m 'fix: a "quoted" \\n thing'`).args).toEqual(['commit', '-m', 'fix: a "quoted" \\n thing'])
  })

  it('handles double quotes with POSIX escapes', () => {
    expect(splitArgs('commit -m "say \\"hi\\" \\\\ \\$HOME \\`x\\`"').args).toEqual(['commit', '-m', 'say "hi" \\ $HOME `x`'])
    // Other backslashes stay literal inside double quotes.
    expect(splitArgs('"a\\nb"').args).toEqual(['a\\nb'])
  })

  it('handles backslash escapes outside quotes', () => {
    expect(splitArgs('add my\\ file.txt').args).toEqual(['add', 'my file.txt'])
    expect(splitArgs('a\\"b').args).toEqual(['a"b'])
    expect(splitArgs('trailing\\').args).toEqual(['trailing\\'])
  })

  it('treats backslash-newline as a line continuation', () => {
    expect(splitArgs('log \\\n--oneline').args).toEqual(['log', '--oneline'])
  })

  it('produces empty arguments for empty quotes', () => {
    expect(splitArgs(`commit -m ""`).args).toEqual(['commit', '-m', ''])
    expect(splitArgs(`config x ''`).args).toEqual(['config', 'x', ''])
    expect(splitArgs(`"" ''`).args).toEqual(['', ''])
  })

  it('concatenates adjacent quoted and unquoted pieces', () => {
    expect(splitArgs(`a"b c"d'e f'g`).args).toEqual(['ab cde fg'])
    expect(splitArgs(`--format="%h %s"`).args).toEqual(['--format=%h %s'])
  })

  it('reports unterminated quotes', () => {
    expect(splitArgs(`commit -m "oops`).error).toMatch(/double quote/)
    expect(splitArgs(`commit -m 'oops`).error).toMatch(/single quote/)
  })

  it('does not expand variables or globs', () => {
    expect(splitArgs('add *.ts $HOME').args).toEqual(['add', '*.ts', '$HOME'])
  })
})

describe('parseGitCommandLine', () => {
  it('strips a leading git', () => {
    expect(parseGitCommandLine('git status -sb').args).toEqual(['status', '-sb'])
    expect(parseGitCommandLine('status').args).toEqual(['status'])
    expect(parseGitCommandLine('git').args).toEqual([])
  })

  it('only strips the first token', () => {
    expect(parseGitCommandLine('git grep git').args).toEqual(['grep', 'git'])
    expect(parseGitCommandLine('log git').args).toEqual(['log', 'git'])
  })

  it('propagates errors', () => {
    expect(parseGitCommandLine('git commit -m "x').error).not.toBeNull()
  })
})

describe('quoteArg / formatCommand', () => {
  it('quotes only when needed and round-trips through splitArgs', () => {
    expect(quoteArg('main')).toBe('main')
    expect(quoteArg('--format=%h')).toBe('--format=%h')
    expect(quoteArg('')).toBe("''")
    const tricky = [`it's "here"`, 'a b', '', '$x', 'back\\slash']
    const line = formatCommand(tricky)
    expect(line.startsWith('git ')).toBe(true)
    expect(parseGitCommandLine(line).args).toEqual(tricky)
  })
})

describe('console history', () => {
  it('appends, de-duplicates and trims', () => {
    expect(pushHistory(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(pushHistory(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
    expect(pushHistory(['a'], '   ')).toEqual(['a'])
    expect(pushHistory(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd'])
    expect(pushHistory([], '  status  ')).toEqual(['status'])
  })

  it('navigates like a shell and restores the draft', () => {
    const h = ['status', 'log']
    let state = { cursor: { index: h.length, draft: '' }, text: 'dra' }
    state = navigateHistory(h, state.cursor, -1, state.text)
    expect(state.text).toBe('log')
    state = navigateHistory(h, state.cursor, -1, state.text)
    expect(state.text).toBe('status')
    state = navigateHistory(h, state.cursor, -1, state.text)
    expect(state.text).toBe('status')
    state = navigateHistory(h, state.cursor, 1, state.text)
    expect(state.text).toBe('log')
    state = navigateHistory(h, state.cursor, 1, state.text)
    expect(state.text).toBe('dra')
    state = navigateHistory(h, state.cursor, 1, state.text)
    expect(state.text).toBe('dra')
  })

  it('handles empty history', () => {
    const r = navigateHistory([], { index: 0, draft: '' }, -1, 'x')
    expect(r.text).toBe('x')
  })
})

describe('interactiveReason', () => {
  it('blocks commands that need a terminal', () => {
    expect(interactiveReason(['add', '-p'])).not.toBeNull()
    expect(interactiveReason(['add', '--patch', 'file'])).not.toBeNull()
    expect(interactiveReason(['add', '-i'])).not.toBeNull()
    expect(interactiveReason(['checkout', '-p'])).not.toBeNull()
    expect(interactiveReason(['commit', '--interactive'])).not.toBeNull()
    expect(interactiveReason(['stash', 'push', '-p'])).not.toBeNull()
    expect(interactiveReason(['stash', '-p'])).not.toBeNull()
    expect(interactiveReason(['rebase', '-i', 'HEAD~3'])).not.toBeNull()
    expect(interactiveReason(['clean', '-di'])).not.toBeNull()
    expect(interactiveReason(['mergetool'])).not.toBeNull()
    expect(interactiveReason(['help', 'log'])).not.toBeNull()
  })

  it('allows regular commands', () => {
    expect(interactiveReason([])).toBeNull()
    expect(interactiveReason(['status'])).toBeNull()
    expect(interactiveReason(['log', '-p'])).toBeNull()
    expect(interactiveReason(['stash', 'show', '-p'])).toBeNull()
    expect(interactiveReason(['add', '.'])).toBeNull()
    expect(interactiveReason(['checkout', '-b', 'feature/p'])).toBeNull()
    expect(interactiveReason(['commit', '-m', 'fix -p flag'])).toBeNull()
    expect(interactiveReason(['clean', '-fd'])).toBeNull()
    expect(interactiveReason(['rebase', 'main'])).toBeNull()
    expect(interactiveReason(['help', '-a'])).toBeNull()
  })
})
