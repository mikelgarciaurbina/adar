### New
- **Repositories inside WSL, with WSL's own git (Windows).** Open them with **File → Open Repository in WSL…** (or
  *Open in WSL…* on the tabs' **+**), which starts in your Linux home folder, or open any `\\wsl.localhost\…` folder.
  Adar then runs the git of that Linux distribution, as VS Code does: your SSH keys and agent, credential helpers,
  hooks and identity there, no more "dubious ownership", and no Git for Windows needed for them.
- Credential prompts from git inside WSL appear in Adar as usual. *Open in Terminal* opens a shell of the
  distribution in the repository's folder.
- *Author Identity… → All repositories* on a repository inside WSL saves it to that distribution's global config.

This is new and has not been tried on many machines yet: changes made outside Adar show up a little later than on
your own disk, and every git command starts through `wsl.exe`. If something doesn't work, please
[open an issue](https://github.com/mikelgarciaurbina/adar/issues).

### Install
**macOS** (Apple Silicon): download `Adar-0.24.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.24.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.24.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.24.0-linux-amd64.deb` with `sudo apt install ./Adar-0.24.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
