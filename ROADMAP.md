# Adar roadmap

Where Adar is heading. Priorities can change with feedback: open an issue to discuss an item, vote with 👍 on existing
issues, or pick something up (see [CONTRIBUTING.md](CONTRIBUTING.md)). Items marked *(good first issue)* are small and
self-contained.

**Guiding principles**

- **Works with every repository.** Adar drives the user's own `git` and credentials; no accounts, no lock-in.
- **Fast on big repos.** Every feature must stay smooth with 100k+ commits and thousands of refs.
- **Safe by default.** Destructive operations are confirmed and, whenever possible, undoable.
- **Private by default.** No telemetry. Anything that talks to a third-party service is opt-in.

---

## Shipped in 0.1

Commit graph with lanes, avatars, ref labels, WIP and stash nodes · drag & drop merge/rebase/fast-forward/push ·
branches, remotes, tags, stashes and submodules panel · staging by file, hunk and line · commit/amend · unified and
split diffs, hunks or full file · file history and blame · merge-conflict tool · visual interactive rebase ·
fetch/pull/push with upstream handling · undo/redo of git actions · command palette and git console · tabs ·
dark/light themes · credential prompts for HTTPS tokens and SSH passphrases · in-app updates from GitHub Releases ·
`adar` command-line tool (open the current repository from a terminal) · edit the message of existing commits in place ·
tab groups (a project's repositories together, reopened in one click) · the Basoa look of adargit.com in the app (night
and day themes, six lane colours, tab groups as trays) · Fetch All for a tab group · branches keep their lane colour in
the left panel · change markers on the diff's scrollbar · tabs shrink to share the bar · Windows and Linux builds
(beta since 0.6.0: x64 installer, AppImage and .deb), with the tests run on macOS, Windows and Linux · the macOS app
signed with an Apple Developer ID and notarized (since 0.6.1) · the antlers in the macOS menu bar: a panel with one
project's branch and latest commits on their lanes, Pull and Push, and a project switcher · notifications when a fetch
brings new commits to the checked-out branch.

---

## Next (0.2 – 0.4)

### Distribution
- [ ] **Homebrew cask** — `brew install --cask adar`.
- [ ] **Update channels** (stable / beta) and a "What's new" panel after updating.
- [ ] Delta updates (smaller downloads).
- [ ] The updater checks that a downloaded macOS update is signed with Adar's Developer ID (the same team as the
      running app) before replacing it.
- [ ] Sign update archives with an offline maintainer key (ed25519) and verify them in the updater, on top of today's
      GitHub digest, host, bundle-identity and version checks.

### Localization (i18n)
- [ ] Lightweight translation layer (`t()` + JSON catalogs, `Intl` for plurals, dates and numbers); a test that flags
      missing keys.
- [ ] **English, Spanish (castellano) and Basque (euskara)** as the first languages.
- [ ] Follow the macOS language by default, with a language selector in Settings.
- [ ] Per-language glossary for git terms (commit, branch, merge, rebase, stash…), which most localized tools keep
      in English or translate consistently.
- [ ] Contributor guide for adding a language through a pull request.

### Hosting integrations (opt-in)
- [ ] **Pull/merge requests** for GitHub, GitLab, Bitbucket and Azure DevOps: list, open, check out, create from a
      branch and show PR badges on branch labels in the graph. Reuse existing auth (`gh` / `glab` CLIs, credential
      helper tokens) before asking for anything.
- [ ] **CI status** dots on commits and branches (GitHub Actions, GitLab pipelines).
- [ ] "Open on GitHub/GitLab…" for commits, files and line ranges; clickable `#123` issue references.
- [ ] Provider avatars when Gravatar has none.

### Everyday workflow
- [ ] **Worktrees** panel: create, open in a new tab, remove.
- [ ] **Reflog view / "Recover lost commits"** — a safety net beyond undo.
- [ ] **Branch cleanup**: delete merged branches and branches whose upstream is gone, in bulk.
- [ ] **Commit signing** (GPG / SSH) and "verified" badges in the graph and commit details.
- [ ] Commit message helpers: templates (`commit.template`), Conventional Commits prefixes, `Co-authored-by` picker.
- [ ] Readable output for failing hooks (pre-commit, commit-msg) instead of a raw error.
- [ ] `fixup!` commits from the staging area and autosquash in the interactive rebase screen.
- [ ] Partial stash (selected files or hunks), rename stash, compare a stash with the working tree.
- [ ] Tags: sort by date, folder grouping, release-style annotated tag editor. *(good first issue)*
- [ ] Clone dialog options: shallow, single branch, partial clone, sparse checkout; cancel a running clone.

### Diffs, blame and conflicts
- [ ] Merge tool: line-level selection, optional base (ancestor) pane, syntax highlighting in the output editor.
- [ ] External diff / merge tools (VS Code, Kaleidoscope, FileMerge, Beyond Compare).
- [ ] Word-wrap toggle and keyboard line cursor for line staging. *(good first issue)*
- [ ] Image diff modes: swipe and onion skin.
- [ ] Compare any two refs or files ("Compare with…"), and browse the repository tree at any commit.
- [ ] Blame: honour `.git-blame-ignore-revs`, "blame previous revision", paging for very long file histories.

---

## Later

### Platforms
Windows and Linux builds shipped in 0.6.0 as a beta. Still to do:
- [ ] **Windows**: sign the installer (for example through SignPath's free signing for open source) so SmartScreen
  stops warning; check `.cmd` editors and the Git for Windows askpass on real machines; an arm64 build.
- [ ] **Linux**: an `.rpm` package and arm64 builds; check file watching, askpass and terminal integration on real
  desktops (GNOME, KDE).
- [ ] **Windows and Linux**: install updates from inside the app (today **Download** opens the release page), and the
  `adar` command-line tool (macOS only for now).

### Power features
- [ ] **Bisect UI**: mark good / bad / skip from the graph, show the remaining range.
- [ ] **Git LFS**: file status, lock/unlock, pointer-file awareness in diffs.
- [ ] Submodules: init/update per submodule, open a submodule in its own tab, show its diff as a commit range.
- [ ] Patch workflow: export (`format-patch`), apply (`am`), copy a diff as a patch.
- [ ] Embedded terminal (xterm.js) next to the git console; streaming output and cancel for long console commands.
- [ ] Multiple identities: per-folder profiles (`includeIf`), SSH key helper.

### Scale and performance
- [ ] Graph layout and log parsing in a worker, incremental layout when paging; use git's commit-graph file for 500k+ commit
      repositories.
- [ ] Watch the working tree respecting `.gitignore` (or use `core.fsmonitor`) to avoid refresh noise from build output.
- [ ] Faster status for huge monorepos (untracked cache, partial status).

### Experience
- [ ] Customizable keyboard shortcuts.
- [ ] Custom themes (theme files), font and density options, high-contrast theme.
- [ ] Workspaces: a dashboard for a tab group (branch, changes and ahead/behind of each repository) with batch pull,
  and favourites. (Tab groups and Fetch All for a group are done.)
- [ ] Tab groups: any colour for a group (colour picker or hex value) besides the eight Basoa colours, with the
  label's colour adjusted so it stays readable in both themes. *(good first issue)*
- [ ] App menu: once the `adar` command is installed, show **Uninstall Command Line Tool…** instead of *Install…*
  (rebuild the menu after installing or uninstalling, and check at startup). Today uninstalling is only in
  Settings → Integrations and the command palette. *(good first issue)*
- [ ] New-commit notifications for every branch with an upstream, not only the checked-out one (today's notifications
  and the menu bar dot follow the checked-out branch).
- [ ] Accessibility pass: screen-reader labels, full keyboard navigation, reduced motion.
- [ ] First-run tour.

### Opt-in AI assistance
Bring-your-own-key or local models only, disabled by default, and never sending code without an explicit action:
- [ ] Draft a commit message from the staged diff.
- [ ] Draft a pull request description from a branch.
- [ ] Explain a commit or a diff.
- [ ] Suggest a resolution for a merge conflict (always reviewed by the user).

### Project and quality
- [ ] DOM interaction tests (Testing Library) and end-to-end tests of the packaged app in CI, with screenshot diffs.
- [ ] Project website with screenshots, docs and a changelog.
- [ ] Extension API (custom commands, panels, hosting providers).
- [ ] Opt-in crash reports (no telemetry).

---

## Known limitations in 0.1

- macOS on Apple Silicon only (no Intel builds); Windows and Linux on x64 only, in beta. The Windows installer is not
  signed yet (see *Platforms*).
- The interface is English-only (see *Localization*).
- Conflict resolution works per conflict chunk, not per line; there is no base pane.
- Line staging is mouse-only; untracked, added, deleted and binary files can only be staged whole.
- The git console waits for a command to finish (no streaming, no cancel); interactive commands are not supported.
- File history shows up to 2000 commits and older paths across renames are resolved best-effort.
- Clones cannot be cancelled once started.
- When macOS file events are unavailable, Adar falls back to polling: changes show up after 1–2 s instead of instantly.
- An interactive rebase started outside Adar (e.g. in a terminal) is shown as a plain "Rebase in progress".
- A stash whose base commit is not loaded in the graph appears only in the left panel.
- Paging through very long histories recomputes the whole graph layout (about 100 ms per page at 20k commits).
