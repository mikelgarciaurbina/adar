### New
- **Adar for Windows and Linux (beta).** Adar now runs on 64-bit Windows 10 and 11 (an installer for your user, no
  administrator rights needed) and on 64-bit Linux (an AppImage for most distributions, and a `.deb` for Debian,
  Ubuntu and their derivatives). It is the same app with the same features, and keyboard shortcuts use Ctrl. These
  builds are new: if something misbehaves, please [open an issue](https://github.com/mikelgarciaurbina/adar/issues).
- On Windows and Linux, Adar tells you when a new version is out, and its **Download** button opens the release page
  to get the new installer.
- Nothing changes on macOS. Every change to Adar is now tested on macOS, Windows and Linux.

### Install
**macOS** (Apple Silicon): download `Adar-0.6.0-arm64.dmg` and drag Adar to Applications. The app is not signed with
an Apple Developer ID yet, so macOS may say it "is damaged" the first time; run this once in Terminal and open it
again:

```
xattr -dr com.apple.quarantine /Applications/Adar.app
```

**Windows** (64-bit): download `Adar-0.6.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.6.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.6.0-linux-amd64.deb` with `sudo apt install ./Adar-0.6.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
