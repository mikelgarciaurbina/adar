### Fixed
- **The bar above a file's diff always stays on one line.** In a narrower window *Stage File* and the close button
  dropped to a second line. Now the path gives way first, its folder before the file's name
  (`src/const…/en.json`), then labels become icons: History and Blame, Full file, Unified / Split, Discard File, the
  change counter and Stage File. Every button keeps its tooltip.
- In a very narrow panel, Unified / Split, Full file, History and Blame move into the **⋯** menu, so the file, its
  changes and its actions still fit.

### Install
**macOS** (Apple Silicon): download `Adar-0.23.1-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.23.1-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.23.1-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.23.1-linux-amd64.deb` with `sudo apt install ./Adar-0.23.1-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
