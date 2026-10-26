### Fixed
- **Bitbucket Cloud sign-in** explains how to make an API token Bitbucket accepts. Atlassian's plain *Create API token*
  makes one without scopes, which Bitbucket refuses. In your Atlassian API tokens, choose **Create API token with
  scopes**, pick **Bitbucket** as the app and select `read:user:bitbucket`, `read:repository:bitbucket`,
  `read:pullrequest:bitbucket` and `write:pullrequest:bitbucket`. The sign-in dialog says so, and when a token has no
  Bitbucket scopes or lacks one, the error says how to fix it.

### Install
**macOS** (Apple Silicon): download `Adar-0.10.1-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.10.1-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.10.1-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.10.1-linux-amd64.deb` with `sudo apt install ./Adar-0.10.1-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
