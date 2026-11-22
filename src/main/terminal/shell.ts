// What Adar adds to the user's shell in its terminals (zsh, the shell macOS comes with): the shell tells the terminal
// which folder it is in, so a new pane starts where its neighbour is, and file and folder names complete whatever
// their case ("cd adar" + Tab finds Adar). zsh reads its start-up files from $ZDOTDIR, so Adar points that at a
// folder of its own whose files run the user's own first, exactly as without Adar, add these few lines and give
// $ZDOTDIR back. Nothing of the user's is changed, and everything else about the shell (history, key bindings,
// prompt) stays what their own files make it.

import { promises as fs } from 'node:fs'
import path from 'node:path'

/** The user's own start-up file of the same name, read as if Adar's folder were not there. */
const own = (file: string) => `if [[ -n $ADAR_USER_ZDOTDIR ]]; then ZDOTDIR=$ADAR_USER_ZDOTDIR; else unset ZDOTDIR; fi
[[ -f \${ZDOTDIR:-$HOME}/${file} ]] && builtin source "\${ZDOTDIR:-$HOME}/${file}"`

/** zsh's start-up files as Adar's terminals read them, by name. */
export function zshFiles(): Record<string, string> {
  return {
    '.zshenv': `# Adar's terminal: your own .zshenv first.
${own('.zshenv')}
# It may have chosen another folder for the rest of your files.
ADAR_USER_ZDOTDIR=\${ZDOTDIR-}
ZDOTDIR=$ADAR_ZDOTDIR
`,
    '.zprofile': `# Adar's terminal: your own .zprofile.
${own('.zprofile')}
ZDOTDIR=$ADAR_ZDOTDIR
`,
    '.zshrc': `# Adar's terminal: your own .zshrc, then what Adar adds (Settings › Terminal).
# The system's zshrc put the history beside these files: it belongs with yours.
[[ $HISTFILE == "$ADAR_ZDOTDIR/.zsh_history" ]] && HISTFILE=\${ADAR_USER_ZDOTDIR:-$HOME}/.zsh_history
${own('.zshrc')}

# The folder this shell is in, told to the terminal (OSC 7): a new pane starts where this one is.
_adar_report_cwd() {
  emulate -L zsh
  setopt no_multibyte
  local i c out=
  for (( i = 1; i <= \${#PWD}; i++ )); do
    c=$PWD[i]
    if [[ $c == [a-zA-Z0-9/._~-] ]]; then out+=$c; else out+=%\${(l:2::0:)$(( [##16] #c ))}; fi
  done
  builtin printf '\\e]7;file://%s%s\\a' "$HOST" "$out"
}
autoload -Uz add-zsh-hook
add-zsh-hook chpwd _adar_report_cwd
_adar_report_cwd

if [[ -n $ADAR_COMPLETE_ANY_CASE ]]; then
  # File and folder names complete whatever their case; commands and options stay exact. It takes zsh's completion
  # system, started here (its cache beside these files) when your own files did not start it.
  if (( ! $+functions[compdef] )); then
    autoload -Uz compinit && compinit -i -d "$ADAR_ZDOTDIR/.zcompdump"
  fi
  zstyle ':completion:*:*:*:*:(all-|globbed-|)files' matcher 'm:{a-z}={A-Z}'
  zstyle ':completion:*:*:*:*:(local-|path-|)directories' matcher 'm:{a-z}={A-Z}'
fi

# A login shell has its .zlogin left to read; for any other this was the last file.
[[ -o login ]] && ZDOTDIR=$ADAR_ZDOTDIR
`,
    '.zlogin': `# Adar's terminal: your own .zlogin; from here on $ZDOTDIR is yours again.
${own('.zlogin')}
`
  }
}

/** Is this a shell Adar knows how to add to? */
export function integrates(shell: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32' && path.basename(shell) === 'zsh'
}

/**
 * Write the files (once per run is enough: they only change with Adar) and say what the shell's environment needs
 * to read them; null when they could not be written (the shell then starts as without Adar).
 */
export async function shellIntegration(userDataDir: string, opts: { anyCase: boolean; userZdotdir: string | undefined }): Promise<Record<string, string> | null> {
  const dir = path.join(userDataDir, 'terminal', 'zsh')
  try {
    await fs.mkdir(dir, { recursive: true })
    for (const [name, text] of Object.entries(zshFiles())) {
      const file = path.join(dir, name)
      // Only when it differs: shells already running may be reading it.
      if ((await fs.readFile(file, 'utf8').catch(() => null)) !== text) await fs.writeFile(file, text, { encoding: 'utf8', mode: 0o644 })
    }
  } catch {
    return null
  }
  return {
    ZDOTDIR: dir,
    ADAR_ZDOTDIR: dir,
    ADAR_USER_ZDOTDIR: opts.userZdotdir ?? '',
    ...(opts.anyCase ? { ADAR_COMPLETE_ANY_CASE: '1' } : {})
  }
}
