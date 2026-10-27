### New
- **Worktrees.** Work on another branch in its own folder, without stashing or switching: *New worktree…* in the
  *Local* section's menu, in a branch's menu or in the command palette. Pick an existing branch (a remote one gets a
  local branch that tracks it) or a new one from any branch; Adar proposes a folder next to the repository and opens
  it in a new tab, in the same tab group, marked *worktree*.
- **The Worktrees section** of the left panel lists them with their branch and uncommitted changes. From there you
  open them, reveal them in Finder, open a terminal, copy the path, lock them, or forget the ones whose folder is gone.
- **Pull requests in a worktree**: *In a worktree*, in a pull request's panel, checks it out in its own folder, so you
  can review it while your own work stays as it is.
- **Branches checked out in another worktree** carry a folder mark in the left panel and in the graph. Checking one
  out offers to open its worktree instead of failing, and *Clean up branches* leaves them alone.
- **When its pull request is merged**, the worktree says so. One click removes it, deletes its branch here and on
  origin, takes you back to the main folder and pulls main; merging from the worktree's own tab can do it all at once.
  Uncommitted changes are never thrown away without asking, and **Undo** brings the branch and the worktree back.
- **Removing a worktree** keeps its branch, names the files with uncommitted changes first, and can be undone.

### Install
**macOS** (Apple Silicon): download `Adar-0.13.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.13.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.13.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.13.0-linux-amd64.deb` with `sudo apt install ./Adar-0.13.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
