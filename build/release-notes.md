### New
- **Choose what to start.** Opening a project's terminal, or a tab group's, no longer starts a shell on its own: it
  offers the shell, Claude Code, Codex and any launcher of yours, with the folder they start in. Enter starts a shell.
  The same choice comes back when the last terminal closes.
- **Pictures from links.** Rest the pointer on the path of a picture an agent or a command prints and Adar shows it;
  ⌘-click opens it large, with *Open* and *Show in Finder* at hand. ⌘-click on a web page or a PDF opens it with its
  app (your browser for HTML), and a web address in your browser.
- **Accents with a held key.** Hold n and press 1 for ñ, as elsewhere on the Mac, with the same choices and numbers:
  a → 2 for á, e → 2 for é, i → 3 for í, o → 4 for ó, u → 4 for ú. *Settings → Terminal → Hold a key for its accents*
  turns it off when you would rather the key repeat, as vim expects.

### Fixed
- **Codex and Claude Code at once.** Codex now shows all three states: violet while it works, amber when it waits for
  your approval, green when it has finished. The end of its turn no longer shows as "needs you".
- Moving between panes or tabs no longer turns an agent that waits for you into "working".
- An agent that finishes in a pane beside the one you are using keeps its green dot until you go to it.
- A launcher's tab keeps the agent's name while it starts, instead of showing `zsh 2` for a moment, and a Codex tab
  shows its task without its folder.

### Good to know
- Adar takes the ⌘-click on a link from the program in the terminal, so Codex does not open its own panel as well. A
  plain click stays the program's.
- Adar recognises the paths written in the output; Claude Code and Codex write them in brackets after a link's words. A
  Codex link that does not show its path is known only to Codex, and clicking it still opens Codex's panel.
- From a link Adar only shows pictures, or opens pictures, web pages and PDFs with their app: it looks at the real file
  behind the link and never runs anything.
- Codex reports its three states from version 0.171 on; earlier versions show as before.
- Built and tried on macOS, with Claude Code and Codex. On Windows and Linux this has only passed its automated tests
  so far.

### Install
**macOS** (Apple Silicon): download `Adar-0.29.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.29.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.29.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.29.0-linux-amd64.deb` with `sudo apt install ./Adar-0.29.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
