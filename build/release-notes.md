### New
- **What's new after an update.** The first time a new version of Adar opens, it shows what changed in that version
  (these notes), right in the app and without going online. Open it again whenever you like from the command palette
  (*What's New in Adar*), or from **Adar → What's New in Adar** on macOS. **All releases** opens the notes of every
  version on GitHub.

### Fixed
- Release notes in the update notice show a point that runs over several lines as a single item again, and *italic*
  text in italics.

### Install
**macOS** (Apple Silicon): download `Adar-0.8.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.8.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.8.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.8.0-linux-amd64.deb` with `sudo apt install ./Adar-0.8.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
