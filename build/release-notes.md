### New
- **Review pull requests in Adar on GitLab, Bitbucket and Azure DevOps.** *Review changes* now opens GitLab merge
  requests (gitlab.com and self-managed) and pull requests on Bitbucket Cloud, Bitbucket Data Center and Azure DevOps in
  Adar, as it already did for GitHub: the files, one file's diff with its comment threads, only what changed since your
  review, the conversation and the commits. Comment on a line, reply, resolve a thread and submit your review.
- **Each service's own review.** On GitLab your comments go out together as one review and *Approve* also approves the
  merge request. On Bitbucket Data Center they go out together with *Approved* or *Needs work*; on Bitbucket Cloud with
  *Approve* or *Request changes*; on Azure DevOps with your vote, *Approved* or *Waiting for author*.
- **Suggested changes** in each service's own format on GitLab, Bitbucket Data Center and Azure DevOps (Bitbucket Cloud
  has none).
- **Viewed marks on every service.** Where the service keeps none, Adar keeps them on this computer, and a file you
  marked shows as changed when new commits touch it.
- **Blue dots and notifications for every service.** Reviews, replies and new commits on GitLab, Bitbucket and Azure
  DevOps pull requests now count for the blue dot, the *Reviews* badge and the notifications, as GitHub's already did.

### Install
**macOS** (Apple Silicon): download `Adar-0.22.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.22.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows.

**Linux** (64-bit): download `Adar-0.22.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.22.0-linux-amd64.deb` with `sudo apt install ./Adar-0.22.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
