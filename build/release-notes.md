### New
- **Terminal tabs say what goes on in them.** Three shells are no longer three tabs called `zsh`, nor two agents two
  called *Claude Code*.
- **An agent's tab carries its task**, in the words the agent gives its terminal: *Claude Code · Pricing section
  heading rename*.
- **A shell's tab shows the command it runs** (`npm run dev`) and, at its prompt, the folder it went to (`site`) or its
  own name in the project's folder.
- Tabs that would read the same are numbered (`zsh`, `zsh 2`), and a name you gave a tab stays as it is. When the strip
  gets crowded, the agents' tasks give way first and the names stay whole.

### Changed
- **Violet for working.** The dot of an agent at work was blue, too close to the green of one that has finished on a
  dot that small. It is now violet; amber (it needs you) and green (it has finished) stay as they were.
- An agent you start by typing `claude` or `codex` goes by its name from the moment it starts, and a terminal opened
  with a launcher is no longer called after it once the agent has ended and you run something else there.
- *Settings → Terminal*: *Follow the shell's folder* is now *Follow the shell's folder and commands*.

### Good to know
- The command comes from zsh, through what Adar adds to it while that setting is on; in other shells the tab shows
  the program in front, as before. Variables set in front of a command (`TOKEN=… npm test`) are left out, and so is a
  line that starts with a space. The command is only shown: Adar does not save it.
- Tried with Claude Code. Codex gave its terminal no title when tried, so its tab says *Codex* alone. On Windows and
  Linux this has only passed its automated tests so far.

### Install
**macOS** (Apple Silicon): download `Adar-0.26.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.26.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.26.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.26.0-linux-amd64.deb` with `sudo apt install ./Adar-0.26.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
