### New
- **Review an agent's work before its pull request.** *Review* on an agent's card in the *Agents* view (also on a
  worktree's menu and in the command palette) opens everything its worktree has that main lacks: the branch's commits
  and the changes not committed yet, in the review view, with *Viewed* marks. Adar only reads the worktree: its index,
  HEAD and branches stay as the agent left them.
- **Notes for the agent.** Click + next to a line to leave a note (or suggest a change). *Copy for the agent* copies
  them all as one message, with each file, line and the code it is about, ready to paste into the agent's chat.
- **Only what changed on the next round.** Copying the notes, or *Mark as reviewed*, keeps the version you reviewed.
  When the agent goes on, *New changes* appears and *Since your review* shows only the files it changed since, leaving
  out what came from main.
- Once the work is committed, the review's panel offers the branch's pull request.

### Install
**macOS** (Apple Silicon): download `Adar-0.23.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.23.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.23.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.23.0-linux-amd64.deb` with `sudo apt install ./Adar-0.23.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
