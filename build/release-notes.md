### Fixed
- **Opening some repositories failed** with "unable to read config file '.git/config.worktree'". It happened when the
  repository has per-worktree settings turned on (`extensions.worktreeConfig`, which tools such as
  `git sparse-checkout` turn on) but no `.git/config.worktree` file yet. Adar now opens them, and still checks that
  file for commands when it exists.

### Install
**macOS** (Apple Silicon): download `Adar-0.14.2-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.14.2-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.14.2-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.14.2-linux-amd64.deb` with `sudo apt install ./Adar-0.14.2-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
