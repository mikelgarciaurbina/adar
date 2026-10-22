### Improved
- **Adar for Mac is signed and notarized by Apple.** macOS now opens it like any other app from the Internet: no more
  "Adar is damaged" and no Terminal command. Your settings, open tabs and tab groups stay as they are.
- Windows and Linux builds are unchanged.

### Install
**macOS** (Apple Silicon): download `Adar-0.6.1-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.6.1-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.6.1-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.6.1-linux-amd64.deb` with `sudo apt install ./Adar-0.6.1-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
