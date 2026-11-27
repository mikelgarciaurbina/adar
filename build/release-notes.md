### New
- **Edit files in Adar.** A quick fix, a `.env` your agent will not touch, a line you spotted while reviewing: change
  it without opening another editor. The new *Files* view (the *Files* button in the toolbar, or ⇧⌘E) has the
  repository's files on the left, the file in the middle and your changes on the right, so you edit, save with ⌘S, see
  it among the changes and commit.
- **Every file is there.** The tree lists what Git ignores too (a `.env`, your local settings), dimmed, and marks what
  changed. Find a file by name in the tree's field or in the command palette (⌘P): type its name and press Enter.
- **Edit, from a diff.** A file's diff has an *Edit* button that opens the file at the change you are looking at; Esc
  takes you back to the diff. The same on the review of an agent's work and on the file menus.
- **From the terminal.** ⌘-click on a path that Claude Code, Codex or a command prints opens the file. With a line
  after it, such as `src/main/index.ts:120`, it opens at that line. The terminal stays below.
- **From the Finder (macOS).** Adar is under *Open With* for text and code. `adar notes.txt` opens a file from a
  terminal, and *File → Open File…* from Adar. A file that is in no open repository opens in a sheet over the window.
- **It knows an agent may be writing too.** While a file is open Adar keeps looking at it on disk. If you changed
  nothing, the text follows what the agent writes. If you did, Adar tells you the file changed and lets you reload it
  or keep your text: nothing is written over without telling you.
- **An editor, not an IDE.** Syntax colours, find and replace (⌘F, ⌥⌘F), several cursors (⌘D), comment a line (⌘/)
  and undo. No autocomplete, no language server, nothing to set up. One file at a time.

### Changed
- `adar <file>` now opens the file itself. It used to open the repository the file is in; `adar <folder>` still does.
- *Edit* in the Markdown preview opens Adar's editor. *Open file* on the file menus is now *Open in your editor*, next
  to the new *Edit*.
- **A smaller app.** Adar carried its interface libraries twice. It is about 45 MB smaller on disk now.
- **Electron 44.11.6**, which brings a security fix (GHSA-jr5w-w6x2-84p9) and the rest of that line's fixes.

### Good to know
- The editor reads and writes UTF-8 text and keeps a file's line endings and permissions. It does not open files
  larger than 5 MB, binary files, links or anything inside a `.git` folder. Text you have not saved stays in memory
  only, and Adar asks before you leave it behind.
- The tree finds and opens files. It does not create, rename or move them.
- Adar does not take text or code files from the app that opens them now: it is only listed under *Open With*. On
  Linux and Windows nothing is registered for them yet; choose Adar by hand under "Open with".
- The editor's shortcuts were tried with simulated key presses. If one does something else on your Mac (⌘F finding
  commits instead of text, for instance), please tell us which.
- Opening text and code files from the Finder is new in this build and was not tried on an installed one before it.
- Built and tried on macOS. On Windows and Linux this has only passed its automated tests so far.

### Install
**macOS** (Apple Silicon): download `Adar-0.31.0-arm64.dmg` and drag Adar to Applications. The first time, macOS asks
whether to open an app downloaded from the Internet: click **Open**.

**Windows** (64-bit): download `Adar-0.31.0-win-x64.exe` and run it. The installer is not signed yet, so SmartScreen
may say "Windows protected your PC"; click **More info**, then **Run anyway**. Needs Git for Windows (repositories
inside WSL use the git of their distribution).

**Linux** (64-bit): download `Adar-0.31.0-linux-x86_64.AppImage`, make it executable (`chmod +x`) and run it (it needs
`libfuse2`), or install `Adar-0.31.0-linux-amd64.deb` with `sudo apt install ./Adar-0.31.0-linux-amd64.deb`.

Already using Adar on a Mac? Use **Adar → Check for Updates…**. Requires Git 2.26 or newer.
