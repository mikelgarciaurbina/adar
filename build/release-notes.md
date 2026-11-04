### New
- **Agents at work.** Adar watches the worktrees of the repositories you have open and shows what the agent in each one is doing: *working* (changing files), *quiet* (it stopped with changes not committed or commits not pushed, so it may be waiting for an answer or a permission) or *idle*.
- **In the left panel**, each worktree says how many files it is changing and since when, which agent works there (from its commits' `Co-Authored-By`, the branch prefix such as `claude/` or `codex/`, or its folder) and how many commits it made since you last looked.
- **In the tabs and the graph.** A green dot on a tab while its agent works, a sun one when it goes quiet. In the graph a dashed row shows another worktree's work in progress above its branch, whose label says how many files it is changing, and the commits made since you looked are tinted.
- **The Agents view** (*Agents* in the toolbar, ⇧⌘E): the worktrees of the tab group in front, or of every open repository, in Working, Quiet and Idle, with the files changing now, the last 30 minutes, where its commits stand and what is new since you looked.
- **Notifications** when an agent commits, pushes or goes quiet. Never for what you do in Adar itself, nor for the worktree whose tab is in front. *Don't tell me when it goes quiet* on a worktree's menu silences one.
- **At work in the menu bar panel**: the worktrees working or quiet in the project's group, a click away. An agent going quiet lights the antlers' dot.
- *Settings → General → Agents at work*: turn it off, also watch each repository's own folder, the notifications, after how long an agent counts as quiet, and the branch prefixes that name an agent.

### Improved
- The active tab of a tab group takes the group's colour.

### Install
**macOS** (Apple Silicon): download `Adar-0.20.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.20.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.20.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.20.0-linux-amd64.deb` with `sudo apt install ./Adar-0.20.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
