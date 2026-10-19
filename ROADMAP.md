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
dark/light themes · credential prompts for HTTPS tokens and SSH passphrases · in-app updates from GitHub Releases.

---

## Next (0.2 – 0.4)

### Distribution
- [ ] **Code signing & notarization** with an Apple Developer ID, so macOS opens Adar without Gatekeeper warnings.
- [ ] **Homebrew cask** — `brew install --cask adar`.
- [ ] **Update channels** (stable / beta) and a "What's new" panel after updating.
- [ ] Delta updates (smaller downloads) once the app is signed.

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
- [ ] **Linux** builds (AppImage, deb, rpm) — verify file watching, askpass and terminal integration.
- [ ] **Windows** builds (NSIS installer) — `.cmd` editors, Git for Windows askpass, path handling.

### Power features
- [ ] **Bisect UI**: mark good / bad / skip from the graph, show the remaining range.
- [ ] **Git LFS**: file status, lock/unlock, pointer-file awareness in diffs.
- [ ] Submodules: init/update per submodule, open a submodule in its own tab, show its diff as a commit range.
- [ ] Patch workflow: export (`format-patch`), apply (`am`), copy a diff as a patch.
- [ ] Embedded terminal (xterm.js) next to the git console; streaming output and cancel for long console commands.
- [ ] Multiple identities: per-folder profiles (`includeIf`), SSH key helper.

### Scale and performance
- [ ] Graph layout and log parsing in a worker; use git's commit-graph file for 500k+ commit repositories.
- [ ] Watch the working tree respecting `.gitignore` (or use `core.fsmonitor`) to avoid refresh noise from build output.
- [ ] Faster status for huge monorepos (untracked cache, partial status).

### Experience
- [ ] Customizable keyboard shortcuts.
- [ ] Custom themes (theme files), font and density options, high-contrast theme.
- [ ] Workspaces: repository groups, favourites and a multi-repository dashboard with batch fetch/pull.
- [ ] Optional system notifications when a fetch brings new commits to branches you track.
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

- macOS only, unsigned builds (see *Distribution*).
- The interface is English-only (see *Localization*).
- Conflict resolution works per conflict chunk, not per line; there is no base pane.
- Line staging is mouse-only; untracked, added, deleted and binary files can only be staged whole.
- The git console waits for a command to finish (no streaming, no cancel); interactive commands are not supported.
- File history shows up to 2000 commits and older paths across renames are resolved best-effort.
- Clones cannot be cancelled once started.
- The working-tree watcher does not apply `.gitignore`, so heavy build output can trigger extra refreshes.
