### New
- **Drop files on a terminal.** Drag a file or a folder from the Finder, the desktop or another app onto a terminal
  pane and its path is typed where the cursor is, as in other terminals. It is how you hand an agent a screenshot:
  drop it on Claude Code and it becomes an attachment (*[Image #1]*).
- Several files are typed one after another, and the pane takes the keyboard so you can go on writing. While the
  files are over a pane it says what dropping them will do.

### Good to know
- The path is only typed, never run: Adar adds no line end, and leaves out a path with control characters in it.
- Spaces and other characters a shell would act on are written so that the path reads back whole: behind backslashes
  in zsh, bash and the like, in quotes in PowerShell, and as the `/mnt/c/…` path for a repository inside WSL.
- What has no file on disk, such as a picture dragged straight out of a web page, cannot be dropped: save it first.
- Built and tried on macOS, with Claude Code. On Windows and Linux, and with Codex, this has only passed its automated
  tests so far.

### Install
**macOS** (Apple Silicon): download `Adar-0.28.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.28.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.28.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.28.0-linux-amd64.deb` with `sudo apt install ./Adar-0.28.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
