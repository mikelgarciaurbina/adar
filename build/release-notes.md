### New
- **Drag a terminal tab to another place.** The tabs of a project's terminals reorder like Adar's own tabs: drag one
  along the strip and a line shows where it will land. *Move Tab Left* and *Move Tab Right* are on the tab's menu too.
- **Move a pane by its header.** Drag a pane's header onto another pane of the same tab and drop it on the side that
  lights up: left, right, top or bottom. After a split right, dragging the right pane onto the left half of the other
  one makes them change places, each keeping its width; dropping it on the top or the bottom turns the split.
- *Move Pane Left / Right / Up / Down* on a pane's menu does the same without dragging, past the pane beside it.

### Good to know
- The terminal that moves keeps running and keeps the keyboard, and the order of tabs and panes is remembered as
  before.
- A pane moves within its own tab: it cannot be dropped on another tab yet.
- Built and tried on macOS. On Windows and Linux this has only passed its automated tests so far.

### Install
**macOS** (Apple Silicon): download `Adar-0.27.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.27.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.27.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.27.0-linux-amd64.deb` with `sudo apt install ./Adar-0.27.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
