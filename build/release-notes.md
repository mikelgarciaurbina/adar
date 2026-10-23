### New
- **Adar in the menu bar (macOS).** Adar's antlers now sit in the menu bar. They light up from the root to the tips
  while Adar fetches, pulls or pushes, and show a dot when a fetch brings new commits to your branch. Click them for a
  small panel with one project: its branch with how far it is ahead or behind, **Pull** and **Push**, and its latest
  commits on their coloured lanes, with the ones you have not pulled yet marked. It follows the active tab in Adar, or
  you can pick another project from its switcher (your tab groups first, then your other repositories). If a pull
  cannot fast-forward, the panel offers to rebase or merge; anything else (conflicts, a force push) opens Adar.
- **Notifications about new commits.** When a fetch, auto-fetch included, brings new commits to the checked-out
  branch, Adar tells you ("3 new commits on main from origin."). Click the notification to open that repository.
- Both can be turned off in **Settings → General** (*Menu bar icon*, macOS only, and *Notify about new commits*), and
  from the **…** menu of the panel.

### Changed
- **Delete… works on the checked-out branch.** Adar asks which branch to check out instead (preset to the remote's
  default branch, else main, master, develop or trunk), checks it out and then deletes the branch. Only the last local
  branch cannot be deleted.

### Install
**macOS** (Apple Silicon): download `Adar-0.7.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.7.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.7.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.7.0-linux-amd64.deb` with `sudo apt install ./Adar-0.7.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
