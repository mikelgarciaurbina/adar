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
brings new commits to the checked-out branch · a "What's new" panel with the release notes after each update · GitHub
pull requests (opt-in, signed in through the GitHub CLI or a token): on branch labels and in the left panel with their
checks and reviews, created from a branch (pushed first), checked out (forks too), merged and cleaned up · the same for
Bitbucket Cloud (API token) and Bitbucket Data Center (HTTP access token), with builds, tasks and Bitbucket's merge
strategies and merge checks · and for GitLab merge requests (gitlab.com and self-managed, personal access token), with
their pipelines, approvals and GitLab's merge status · clean up branches in bulk: local branches already in main
(squash-merged pull requests included) or gone from the remote, and merged branches on the remote, with undo ·
worktrees: a section in the left panel, new worktrees for a branch or a pull request opened as tabs in the same group,
a branch checked out in another worktree opens that worktree instead of failing, and once its pull request is merged
the worktree and its branch go in one step · any colour for a tab group (a picker or a hex value), drawn lighter in the
night theme and deeper in the day theme so its name stays readable · branches that are never cleaned up: environment
branches (`pre`, `int`, `qa`…) are listed but never ticked, *Never clean up* keeps a branch or a pattern (`env/*`) out
for good, here and on the remote, and branches protected on GitHub, GitLab or Bitbucket count too when pull requests
are on · changed images compared four ways (side by side, swipe, onion skin and difference, which paints the changed
pixels), at Fit or 1:1, with N / P going through the areas that changed · recover lost commits: what a reset, a
deleted branch, a detached HEAD or a rewrite left behind, grouped from the reflog, with a way back for each (move the
branch back, restore the branch, or a new branch), every move of HEAD or a branch in words, and a deeper search for
dropped stashes · Azure DevOps pull requests (a personal access token per organization), with their checks, votes and
branch policies · GitHub Enterprise servers, through the GitHub CLI or a token · GitLab through `glab` or the token git
already keeps for it, before asking for one · authors' pictures from GitHub, GitLab or Bitbucket when Gravatar has none ·
GitHub pull requests reviewed in Adar (GitHub Enterprise too): the files with GitHub's Viewed marks, only what changed
since your review (a rebase with the same changes or a merge of main told apart), line comments, replies and suggested
changes, approve or request changes, the conversation and the commits, with the agents that co-wrote them · an inbox of
the pull requests of every open repository (waiting for your review, the ones you follow, yours), a blue dot on what
changed since you looked, also in the left panel and on the branch where the commit you reviewed is marked, and
notifications for review requests, new commits or replies, and reviews or failed checks on yours · agents at work: the
worktrees of the open repositories as they work (working, quiet with work left — it may be waiting for an answer — or
idle), with the files changing now, the last 30 minutes and which agent (Co-Authored-By trailers, the branch prefix or
the folder), in the left panel, the tabs, the graph (a dashed row for each worktree's work in progress), an Agents view
and the menu bar panel, and notifications when an agent commits, pushes or goes quiet · moving a whole tab group, by
its label or from its menu · pull requests reviewed in Adar on GitLab, Bitbucket (Cloud and Data Center) and Azure
DevOps too, with their own reviews (GitLab's draft notes, Bitbucket Data Center's pending comments), approvals or votes,
threads to resolve, suggested changes where the service has them and Viewed marks Adar keeps where it has none; and
their activity (reviews, comments, pushes) for the inbox's blue dots and the notifications · an agent's work reviewed
before its pull request: its commits and its changes not committed against the base branch, with Viewed marks and
notes on lines copied as one message for the agent's chat, and on the next round only what changed since · on Windows,
repositories inside WSL run the distribution's own git (its SSH keys, credential helpers and hooks), opened from
**Open Repository in WSL…** or any `\\wsl.localhost\…` folder.

---

## Next (0.21 – 0.24)

### Supervise AI agents and the team
Code and commits are more and more written by AI agents. Adar is where people see what the agents did, review it,
and keep up with their colleagues' branches and pull requests.
- [ ] **Diffs for large changes**: a file tree with the lines added and removed, lockfiles and generated files folded
      away, whitespace changes hidden on demand, and keyboard navigation through files and changes.
- [ ] **AI-authored commits**: recognise `Co-Authored-By` trailers (Claude, Copilot, Codex, Cursor…) and show a badge in
      the graph and the commit details, with a human / AI filter.
- [ ] **Review a conflict resolution**: for a merge commit, show only what the resolution changed compared with git's
      own automatic merge (`git show --remerge-diff`).
- [ ] **After a force push**: compare the old and the new version of a branch an agent or a colleague rewrote
      (`git range-diff`, from the remote-tracking branch's reflog).
- [ ] **Team view** for a tab group: each repository's branch, changes and ahead/behind, colleagues' remote branches by
      author with their last activity, open pull requests, and what reached main since yesterday; batch pull.
- [ ] Notifications for every branch with an upstream (not only the checked-out one), and when a pull request is merged.
- [ ] **Blame → pull request**: from a line to the pull request that brought it in, with its conversation.

### Diffs and history
- [ ] Compare any two refs or files ("Compare with…"), and browse the repository tree at any commit.
- [ ] **Commit signing** (GPG / SSH) and "verified" badges in the graph and commit details: who, or what, made each
      commit.
- [ ] Word-wrap toggle and keyboard line cursor for line staging. *(good first issue)*
- [ ] Blame: honour `.git-blame-ignore-revs`, "blame previous revision", paging for very long file histories.

### Localization (i18n)
- [ ] Lightweight translation layer (`t()` + JSON catalogs, `Intl` for plurals, dates and numbers); a test that flags
      missing keys.
- [ ] **English, Spanish (castellano) and Basque (euskara)** as the first languages.
- [ ] Follow the macOS language by default, with a language selector in Settings.
- [ ] Per-language glossary for git terms (commit, branch, merge, rebase, stash…), which most localized tools keep
      in English or translate consistently.
- [ ] Contributor guide for adding a language through a pull request.

### Hosting integrations (opt-in)
- [ ] GitHub: sign in from the browser (device flow; built, waiting for Adar's OAuth app).

---

## Later

### Platforms
Windows and Linux builds shipped in 0.6.0 as a beta. Still to do:
- [ ] **Windows**: sign the installer (for example through SignPath's free signing for open source) so SmartScreen
  stops warning; check `.cmd` editors and the Git for Windows askpass on real machines; an arm64 build.
- [ ] **Windows**: check repositories inside WSL on real machines (opened from `\\wsl.localhost\…` or **Open Repository
  in WSL…**, git runs inside the distribution with its keys, credential helpers and hooks): speed with one `wsl.exe` per
  git command, credential prompts through interop, changes found by polling, and an `adar` command inside WSL.
- [ ] **Linux**: an `.rpm` package and arm64 builds; check file watching, askpass and terminal integration on real
  desktops (GNOME, KDE).
- [ ] **Windows and Linux**: install updates from inside the app (today **Download** opens the release page), and the
  `adar` command-line tool (macOS only for now).

### Git workflow
Less pressing now that agents make most commits, merges and stashes themselves.
- [ ] Partial stash (selected files or hunks), rename stash, compare a stash with the working tree.
- [ ] Readable output for failing hooks (pre-commit, commit-msg) instead of a raw error.
- [ ] Tags: sort by date, folder grouping, release-style annotated tag editor. *(good first issue)*
- [ ] Clone dialog options: shallow, single branch, partial clone, sparse checkout; cancel a running clone.
- [ ] Merge tool: line-level selection, optional base (ancestor) pane, syntax highlighting in the output editor.
- [ ] External diff / merge tools (VS Code, Kaleidoscope, FileMerge, Beyond Compare).

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
- [ ] App menu: once the `adar` command is installed, show **Uninstall Command Line Tool…** instead of *Install…*
  (rebuild the menu after installing or uninstalling, and check at startup). Today uninstalling is only in
  Settings → Integrations and the command palette. *(good first issue)*
- [ ] Accessibility pass: screen-reader labels, full keyboard navigation, reduced motion.
- [ ] First-run tour.

### Project and quality
- [ ] DOM interaction tests (Testing Library) and end-to-end tests of the packaged app in CI, with screenshot diffs.
- [ ] Project website with screenshots, docs and a changelog.
- [ ] Extension API (custom commands, panels, hosting providers).
- [ ] Opt-in crash reports (no telemetry).

### Distribution
- [ ] Delta updates (smaller downloads).
- [ ] The updater checks that a downloaded macOS update is signed with Adar's Developer ID (the same team as the
      running app) before replacing it.
- [ ] Sign update archives with an offline maintainer key (ed25519) and verify them in the updater, on top of today's
      GitHub digest, host, bundle-identity and version checks.

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
