### Fixed
- **The Worktrees section** is now always in the left panel, under *Local*. Until now it only appeared once a
  repository had a second worktree, so there was no obvious place to make the first one. While there is none it says
  *No other worktrees*, and its **+** (or *New worktree…* in its menu) opens the New worktree dialog.

### Install
**macOS** (Apple Silicon): download `Adar-0.13.1-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.13.1-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.13.1-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.13.1-linux-amd64.deb` with `sudo apt install ./Adar-0.13.1-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
