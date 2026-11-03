### New
- **Pull requests on Azure DevOps.** Repositories on dev.azure.com (or an old `visualstudio.com` address) show their
  pull requests on their branches and in the *Pull requests* section, like GitHub's, GitLab's and Bitbucket's: checks
  and builds, reviewers' votes, and what the branch policies still ask for before one can be completed. Create, check
  out and complete them from Adar. Turn them on with a personal access token for the organization (*Code: Read &
  write*), kept encrypted on this computer.
- **GitHub Enterprise.** A repository on your company's GitHub (such as `github.example.com`) offers its pull requests
  too: sign in through the GitHub CLI for that server (`gh auth login --hostname <server>`) or with a token, one per
  server.
- **GitLab without creating a token.** When the GitLab CLI is signed in, or git already keeps a token for your GitLab to
  push and pull over https, Adar offers to use it. It asks for it each time and keeps no copy.
- **Authors' pictures from GitHub, GitLab and Bitbucket.** In repositories whose pull requests are on, authors with no
  Gravatar show the picture of their account there, in the graph, the commit details, blame and file history. Turn it
  off in *Settings → General*.
- *Settings → Integrations* says how Adar signs in to each service and server.

### Install
**macOS** (Apple Silicon): download `Adar-0.18.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.18.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.18.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.18.0-linux-amd64.deb` with `sudo apt install ./Adar-0.18.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
