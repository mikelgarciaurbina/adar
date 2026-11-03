### New
- **Review pull requests in Adar.** *Review changes* opens a GitHub pull request (GitHub Enterprise too) instead of the
  graph: its files with GitHub's *Viewed* marks, lockfiles and build output folded away, one file's diff with its
  comment threads, the conversation in order and the commits. Comment on a line or several, suggest a change, reply,
  resolve, then submit your review with *Comment*, *Approve* or *Request changes*. V marks a file viewed, N goes to the
  next one.
- **Only what changed since your review.** *Since your review* shows the commits pushed after it, and says when the
  branch was rebased with the same changes, rewritten by a force push, or only had main merged in.
- **Who wrote it.** A *Claude* (or *Copilot*, *Codex*, *Cursor*…) mark next to the author when an agent co-wrote the
  commits, from their `Co-Authored-By` lines.
- **Pull requests of every open repository.** *Reviews* in the toolbar (⇧⌘R) lists what waits for your review, the
  pull requests you follow (you reviewed or commented on them, or followed them with the bell) and yours, each with
  the one thing to know: new commits since your review, a reply, a failed check, or ready to merge. Its badge counts
  the ones that need you.
- **A blue dot on what changed since you looked.** In the list, the left panel and on the branch's pull request chip;
  in the graph the commits added since are tinted and the commit you reviewed is marked. *Mark as seen* clears it, the
  bell stops it for one pull request.
- **Notifications for pull requests**, while Adar is in the background: someone asks for your review, one you follow
  gets commits or a reply, or yours is reviewed, fails a check or can be merged. Each kind can be turned off in
  *Settings → General → Notifications*.
- GitLab, Bitbucket and Azure DevOps pull requests are in the list too; reviewing them still opens their website.

### Install
**macOS** (Apple Silicon): download `Adar-0.19.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.19.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.19.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.19.0-linux-amd64.deb` with `sudo apt install ./Adar-0.19.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
