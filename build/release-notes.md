### New
- **A terminal inside Adar.** Each project's tab now shows the *Graph*, a *Terminal* or *Both* (the graph with the
  terminal docked under it), from the toolbar or with ⌘E. It is your own login shell, in the project's folder, and it
  keeps running while you look at the graph or at another tab.
- **Tabs and splits.** Several terminals per project in tabs, and panes split right (⌘D) or down (⇧⌘D) that you resize
  by their divider, zoom (⇧⌘↩) and move between (⌥⌘ and the arrows, ⌘[ and ⌘]). ⌘T opens a terminal, ⌘W closes the
  pane, ⌘K clears it and ⌘F finds in it. On Windows and Linux, Ctrl+Shift takes ⌘'s place for most of them.
- **Run Claude Code or Codex there.** *+* on the terminals' strip starts a shell or a launcher: Claude Code, Codex or
  any program you add in *Settings → Terminal*. Typing `claude` or `codex` yourself works the same.
- **A dot that says what the agent is doing.** Blue and pulsing while it works, amber when it needs you (a question, a
  permission), green when it has finished: on the tab, on its group and in the status bar, with a notification when it
  needs you or finishes. Claude Code reports all three through hooks Adar adds for its own terminals; Codex reports
  when it needs you or finishes, through its terminal notifications.
- **A terminal for a tab group.** The button beside a group's label opens the group's own terminals, in the folder its
  repositories share, with the group's repositories and their changes on the left: an agent started there works
  across all of them.
- **In zsh**, file and folder names complete whatever their case (`cd adar` and Tab finds `Adar`), and a pane's header
  follows `cd`, so a new pane starts where the one beside it is. Your own start-up files, history and key bindings
  stay as they are.
- *Settings → Terminal*: launchers, font, cursor, scrollback, Option as Meta, copy on select and the notifications.

### Changed
- **Agents at work made way for the terminal.** The Agents view, its toolbar button, the worktree states in the left
  panel, the dashed rows in the graph and *At work* in the menu bar panel are gone: the agent itself now says what it
  is doing, in its terminal. The notifications when an agent commits or pushes stay, also for a repository's own
  folder, and say more at a glance: the action and the branch first (*Pushed 1 commit to origin/main*), then the tab
  group and the repository.
- **New commits after a fetch** are notified for every local branch that tracks a remote, not only the checked-out one.
- *Open in Terminal* is now *Open in External Terminal*.

### Good to know
- The terminal was built and tried on macOS. On Windows (PowerShell, or the distribution's shell for a repository
  inside WSL) and Linux it has only passed its automated tests so far: please open an issue with what you find.
- The dot needs the agent to be signed in and running in one of Adar's terminals; an agent you run in another app is
  still told apart by its commits and pushes, as before.

### Install
**macOS** (Apple Silicon): download `Adar-0.25.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.25.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.25.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.25.0-linux-amd64.deb` with `sudo apt install ./Adar-0.25.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
