### Changed
- **The Agents view shows the active repository** by default: the agents in its worktrees, and in its own folder when Adar watches it, as in the left panel. A switch in its header shows the agents of its tab group or of every open tab instead, with how many each has, and Adar remembers your choice. The *Agents* badge in the toolbar counts the same agents the view shows.
- **Agents at work has its own section in Settings**, beside *Graph* and *Diff*, instead of being at the bottom of *General*: what Adar watches, when an agent counts as quiet, the notifications and the branch prefixes that name an agent.

### Install
**macOS** (Apple Silicon): download `Adar-0.20.1-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.20.1-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.20.1-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.20.1-linux-amd64.deb` with `sudo apt install ./Adar-0.20.1-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
