// Shell-like argument splitting for the Git console. Commands are never run through
// a shell: the resulting array is passed straight to `git` by the backend, so this
// only needs to reproduce POSIX quoting rules (no globbing, no variable expansion).
//
//   'single'   literal, no escapes
//   "double"   \" \\ \$ \` and backslash-newline are escapes; other backslashes are literal
//   \x         outside quotes escapes any character (backslash-newline is a continuation)
//   '' / ""    produce an empty argument
//   a"b c"d    adjacent pieces concatenate into one argument ("ab cd")

export interface SplitResult {
  args: string[]
  /** Set when the line cannot be parsed (e.g. an unterminated quote). */
  error: string | null
}

const DOUBLE_QUOTE_ESCAPES = new Set(['"', '\\', '$', '`'])

export function splitArgs(line: string): SplitResult {
  const args: string[] = []
  let cur = ''
  let inToken = false
  let i = 0
  const n = line.length

  while (i < n) {
    const ch = line[i]

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (inToken) {
        args.push(cur)
        cur = ''
        inToken = false
      }
      i++
      continue
    }

    if (ch === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) return { args, error: 'Unterminated single quote' }
      cur += line.slice(i + 1, end)
      inToken = true
      i = end + 1
      continue
    }

    if (ch === '"') {
      i++
      let closed = false
      while (i < n) {
        const c = line[i]
        if (c === '"') {
          closed = true
          i++
          break
        }
        if (c === '\\' && i + 1 < n) {
          const next = line[i + 1]
          if (DOUBLE_QUOTE_ESCAPES.has(next)) {
            cur += next
            i += 2
            continue
          }
          if (next === '\n') {
            i += 2
            continue
          }
        }
        cur += c
        i++
      }
      if (!closed) return { args, error: 'Unterminated double quote' }
      inToken = true
      continue
    }

    if (ch === '\\') {
      if (i + 1 < n) {
        const next = line[i + 1]
        if (next !== '\n') {
          cur += next
          inToken = true
        }
        i += 2
      } else {
        // Trailing lone backslash: keep it literally.
        cur += '\\'
        inToken = true
        i++
      }
      continue
    }

    cur += ch
    inToken = true
    i++
  }

  if (inToken) args.push(cur)
  return { args, error: null }
}

/** Split a console line into git arguments, dropping a leading "git" if typed. */
export function parseGitCommandLine(line: string): SplitResult {
  const res = splitArgs(line)
  if (res.error) return res
  const args = res.args[0] === 'git' ? res.args.slice(1) : res.args
  return { args, error: null }
}

/** Quote an argument for display so the echoed command can be copied back. */
export function quoteArg(arg: string): string {
  if (arg === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./^~-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/** Display form of a git command: "git log --oneline 'my file'". */
export function formatCommand(args: readonly string[]): string {
  return ['git', ...args.map(quoteArg)].join(' ')
}

/**
 * Why a command cannot run in the console (it would wait for terminal input that
 * never comes), or null when it is fine. Git runs with GIT_EDITOR=true and no TTY.
 */
export function interactiveReason(args: readonly string[]): string | null {
  const [cmd, ...rest] = args
  if (!cmd) return null
  const has = (...flags: string[]) => rest.some((a) => flags.includes(a) || flags.some((f) => f.startsWith('--') && a.startsWith(f + '=')))
  const shortFlag = (letter: string) => rest.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter))
  switch (cmd) {
    case 'add':
    case 'checkout':
    case 'restore':
    case 'reset':
    case 'stash':
    case 'commit': {
      // "stash show -p" prints a diff; only push/save (or bare stash) are interactive with -p.
      const sub = rest[0]
      if (cmd === 'stash' && sub && !sub.startsWith('-') && sub !== 'push' && sub !== 'save') return null
      if (has('--patch', '--interactive') || shortFlag('p'))
        return 'Interactive patch mode needs a terminal. Use the staging panel to stage hunks or lines.'
      if (cmd === 'add' && shortFlag('i')) return 'Interactive add needs a terminal. Use the staging panel instead.'
      return null
    }
    case 'clean':
      if (has('--interactive') || shortFlag('i')) return 'Interactive clean needs a terminal.'
      return null
    case 'rebase':
      if (has('--interactive') || shortFlag('i')) return 'Interactive rebase runs in the graph: right-click a commit → Interactive rebase.'
      return null
    case 'mergetool':
    case 'difftool':
    case 'gui':
    case 'citool':
    case 'gitk':
      return `git ${cmd} opens an external interactive tool and is not supported here.`
    case 'help':
      return rest.length && !has('-a', '--all', '-g', '--guides') ? 'git help <command> opens a manual page; use “git <command> -h” for a summary.' : null
    case 'credential':
      return 'git credential reads from stdin and is not supported here.'
    default:
      return null
  }
}
