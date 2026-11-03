### New
- **Recover lost commits.** A new view finds the commits no branch reaches any more, in git's reflog, and groups them
  by what left them behind: a reset, a deleted branch, or work on a detached HEAD. It opens from the **Undo** button
  (click it when there is nothing to undo, or right-click it), the *Local* section's menu, the command palette and
  *Repository → Recover Lost Commits…*.
- **One click back.** *Move main back* undoes a reset when nothing the branch has now would be left behind;
  *Restore* brings a deleted branch back with its name; *Create branch…* keeps any lost commits on a new
  `recovered/…` branch. All of them can be undone.
- **How long git keeps them.** Git forgets a lost commit about 30 days after it was left behind, so each group says
  how many days it has left. Old versions left by an amend or a rebase are folded away: their changes live on in the
  new commits.
- **A selected lost commit** shows in the right panel with its files and diff, and with the same ways back:
  create a branch, cherry-pick it onto the current branch, or check it out.
- **Every move** shows the reflog of HEAD or of any branch in words (commit, reset, checkout, merge, rebase, amend,
  pull), marks the commits that are lost, and offers the same actions on a right-click, plus resetting the current
  branch to that point.
- **Look deeper** also finds what no reflog remembers, such as a dropped stash.

### Install
**macOS** (Apple Silicon): download `Adar-0.17.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.17.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.17.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.17.0-linux-amd64.deb` with `sudo apt install ./Adar-0.17.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
