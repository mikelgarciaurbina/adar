### Fixed
- **Updating on a Mac where you are not an administrator** only showed the download in Finder. When only an
  administrator can change the folder Adar is in (a standard account and the Applications folder), **Restart to update**
  now asks for an administrator's name and password, as Finder does, and installs the update. If you cancel, Adar
  explains how to install it by hand. Adar 0.14.2 and older still show the download, so on those Macs install 0.14.3 by
  hand once: later updates install this way.
- **Branch folders closed when you switched branches.** Folders you open or close in the left panel now stay that way
  across checkouts, and checking out a branch opens its folders.

### Install
**macOS** (Apple Silicon): download `Adar-0.14.3-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.14.3-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.14.3-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.14.3-linux-amd64.deb` with `sudo apt install ./Adar-0.14.3-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
