### New
- **Pull requests from Bitbucket.** Repositories on Bitbucket Cloud and Bitbucket Data Center get everything GitHub
  ones have: pull requests on their branches, in the left panel and in the details panel, created from a branch
  (pushed first), checked out, merged and cleaned up.
- **Turning it on.** Use *Show pull requests from Bitbucket…* in the *Pull requests* section of the left panel. For
  Bitbucket Cloud, enter your Atlassian account email and an API token with the scopes `read:user:bitbucket`,
  `read:repository:bitbucket`, `read:pullrequest:bitbucket` and `write:pullrequest:bitbucket`. For Bitbucket Data
  Center, enter your server's address and an HTTP access token with *Repository write* permission. Adar keeps the
  tokens encrypted on this computer and only talks to Bitbucket while this is on. **Settings → Integrations** lists
  every sign-in.
- **In Bitbucket's words.** Builds instead of checks, open tasks, reviews that need work, and *Declined* pull requests,
  which offer to delete their branch here. Merging uses the repository's own strategies (merge commit, squash,
  fast-forward…) with its default first. On Data Center, Adar shows Bitbucket's merge checks: the approvals, tasks or
  conflicts that still stand in the way.
- Data Center repositories are recognised by an https address with `/scm/` or ssh on port 7999. Once you are signed
  in to a server, any remote on its host is recognised too.

### Improved
- A pull request whose checks are still running says how many: "1 of 4 checks running".

### Install
**macOS** (Apple Silicon): download `Adar-0.10.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.10.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.10.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.10.0-linux-amd64.deb` with `sudo apt install ./Adar-0.10.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
