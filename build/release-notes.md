### New
- **Pull requests from GitHub.** Turn them on from the new *Pull requests* section of the left panel, or in
  **Settings → Integrations**. Adar signs in with your GitHub CLI (`gh`), or with a personal access token it keeps
  encrypted, and only talks to GitHub while this is on.
- **On your branches.** A branch with a pull request shows its number and how its checks went, in the graph and next
  to the branch in the toolbar. The left panel lists the open pull requests, with *Review* on the ones waiting for you.
- **One next step at a time.** Click a pull request to see its checks, reviews and conflicts, and do what comes next:
  merge it (then switch to the base branch, pull and delete the branch), bring the base branch in to fix conflicts,
  check it out (one from a fork as `pr/<number>`), or review it on GitHub.
- **Create a pull request** from a branch's menu, by dropping a branch on another, from the message after pushing a
  new branch, or with *Create Pull Request…* in the command palette. The title and description are written from the
  branch's commits, and Adar pushes the branch first when it needs to.

### Install
**macOS** (Apple Silicon): download `Adar-0.9.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.9.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.9.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.9.0-linux-amd64.deb` with `sudo apt install ./Adar-0.9.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
