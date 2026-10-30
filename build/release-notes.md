### New
- **Branches that are never cleaned up.** *Clean up branches* now leaves long-lived branches alone. Branches named like
  an environment (`pre`, `int`, `qa`, `uat`, `prod`…) are still listed, but never ticked for you, like `release/`
  branches.
- **Never clean up** keeps a branch out for good, here and on origin: on a row of *Clean up branches* (under the
  pointer), or in the branch's menu in the left panel or the graph. The toast offers **Undo**.
- **Branches never cleaned up**, one list per repository: *Edit…* at the end of *Clean up branches*, the *Local*
  section's menu or the command palette. It shows the default branch and the branches you keep, and takes patterns
  too: `env/*` keeps `env/eu` and `env/us`, and the list shows what each pattern matches. The × stops keeping one.
- **Protected branches count too** while pull requests are on: Adar asks GitHub or GitLab which branches are protected
  and keeps them. Bitbucket tells only repository admins, so for anyone else the list says so and you keep the ones
  you need yourself.
- **Saved in the repository**, in its own Git config: its worktrees share the list, and it stays when you move the
  folder. It is not shared with your team. You can still delete a kept branch by hand; the confirmation reminds you
  that you keep it.

### Install
**macOS** (Apple Silicon): download `Adar-0.15.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.15.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.15.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.15.0-linux-amd64.deb` with `sudo apt install ./Adar-0.15.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
