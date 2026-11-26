### New
- **Markdown preview.** Read a `.md` file as it will look, without leaving Adar: the plan your agent just wrote, a
  README, your notes. It opens over the window with its outline, tables, task lists and highlighted code, and a
  *Preview / Source* switch. *Edit* opens it in your editor; Esc closes it.
- **It follows the file.** While the preview is open it keeps up with the file, so you read a plan as the agent writes
  it.
- **From the terminal.** ⌘-click on the path of a Markdown file that Claude Code, Codex or a command prints, such as
  `docs/PLAN.md`, opens its preview. Closing it gives the keyboard back to the terminal.
- **From the Finder.** Adar is now under *Open With* for Markdown files. To open them with Adar on a double click, run
  *Open Markdown Files with Adar by Default…* from the command palette (⌘P) once. `adar notes.md` opens one from a
  terminal, and *File → Open Markdown File…* from Adar.
- **In a diff.** A changed Markdown file has a *Preview* button (the eye) that shows it as it reads in the version the
  diff is about: that commit's, the staged one or your working copy's.
- **Links between documents.** A link to another Markdown file opens it in the preview, with a way back; a link to the
  web opens in your browser.

### Fixed
- **Clicking a notification goes where it says.** A notification about new commits from your teammates now opens that
  project.
- A notification about an agent that finished, a pull request or an agent's commit now opens its tab also when Adar's
  window was closed: before, Adar came to the front on the tab it had before.
- Notifications left in Notification Center from before Adar restarted or updated still open their project (macOS).
- A project opened from a notification or from the `adar` command comes to the front also when a tab group's own view
  was there.

### Good to know
- The preview never runs anything a document says, and keeps none of its HTML. Pictures beside the document are shown;
  pictures on the web are not loaded, only named, and a click opens them in your browser. Mermaid diagrams show as
  code.
- Adar does not take Markdown files from the app that opens them now: that is your choice, with the command above or
  with *Get Info → Open with → Change All…* in the Finder.
- On Linux Adar is listed under "Open with" for Markdown files. The Windows installer registers nothing yet: choose
  Adar by hand under "Open with".
- The fixes to notifications could only be tried with simulated clicks, since macOS delivers notifications to signed
  builds only. If a click still goes nowhere, please tell us which notification it was and whether Adar's window was
  open.
- Opening Markdown files from the Finder and making Adar their default app are new in this build and were not tried on
  an installed one before it.
- Built and tried on macOS. On Windows and Linux this has only passed its automated tests so far.

### Install
**macOS** (Apple Silicon): download `Adar-0.30.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.30.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.30.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.30.0-linux-amd64.deb` with `sudo apt install ./Adar-0.30.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
