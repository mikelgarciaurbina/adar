### New
- **Clean up branches.** After a fetch, the *Local* section of the left panel shows how many of your branches can
  go without losing anything; click it, or use *Clean up branches…* in the section's menu or the command palette.
  Adar fetches with prune and lists them in one dialog.
- **Already in main**, ticked: branches merged into main, and branches whose pull request or merge request was
  merged with that very commit (squash and rebase merges included, which git alone calls unmerged). The
  checked-out one too: Adar switches to main and pulls first.
- **Gone from origin**: branches whose copy on the remote was deleted. When they have commits that are in no other
  branch, they stay unticked and say how many would be lost.
- **On origin**, folded away: remote branches already in main, which you can delete for everyone.
- One click deletes what you ticked, and **Undo** brings the local branches back. Main, develop and the like are
  always kept, and release branches are never ticked for you.

### Install
**macOS** (Apple Silicon): download `Adar-0.12.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.12.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.12.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.12.0-linux-amd64.deb` with `sudo apt install ./Adar-0.12.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
