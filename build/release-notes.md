### New
- **Merge requests from GitLab.** Repositories on gitlab.com and on your own GitLab get what GitHub and Bitbucket
  ones have: merge requests on their branches, in the left panel and in the details panel, created from a branch
  (pushed first), checked out, merged and cleaned up.
- **Turning it on.** Use *Show merge requests from GitLab…* in the left panel and paste a personal access token with
  the `api` scope (in GitLab, *Edit profile → Access tokens*). For your own GitLab, check its address first: Adar
  fills it in from the remote. Adar keeps the token encrypted on this computer, one per GitLab, and only talks to
  GitLab while this is on. **Settings → Integrations** lists every sign-in.
- **In GitLab's words.** Merge request !12, the jobs of its pipeline, approvals, and what GitLab says still stands
  in the way of merging (a running pipeline, unresolved threads, a missing approval…). Merging follows the project's
  merge method and squash option, and a merge request from a fork is checked out as `mr/<number>`.
- Adar recognises gitlab.com, servers named `gitlab.…`, and any GitLab you have signed in to.

### Install
**macOS** (Apple Silicon): download `Adar-0.11.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.11.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.11.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.11.0-linux-amd64.deb` with `sudo apt install ./Adar-0.11.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
