### Changed
- **Push offers a force push right away when the branch is behind its remote**, like GitKraken. After a rebase or an
  amend (for example ↑16 ↓1), Push asks "Force push next?" straight away instead of trying first and waiting for the
  remote to refuse. If the remote refuses a push Adar did not see coming, you get the same question. The force push
  still uses a lease: if someone else pushed in the meantime, Adar asks again before overwriting their commits.
- "Pull first" is no longer offered when a push is refused: you asked to push. (It also pulled the checked-out branch
  when you were pushing a different one.)

### Install
**macOS** (Apple Silicon): download `Adar-0.6.2-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.6.2-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.6.2-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.6.2-linux-amd64.deb` with `sudo apt install ./Adar-0.6.2-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
