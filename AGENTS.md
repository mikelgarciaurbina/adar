# Adar — visual Git client (GitKraken-style) for any repository

Guide for contributors and coding agents. "Adar" means "branch" in Basque (the app was briefly called "Rama";
settings migrate from `~/Library/Application Support/Rama`).

Electron 44 + electron-vite 6 + React 19 + TypeScript 7 + zustand. The backend shells out to the system `git`
binary, so it works with every repository the user's git can access (SSH keys, Keychain, credential helpers,
private hosts). Clean-room implementation: never copy GitKraken code, assets or branding. MIT licensed.

## Layout
- `src/shared/` — the contract: `types.ts` (domain types, settings), `api.ts` (`AdarApi`, the ONLY renderer↔backend
  API, plus `API_METHODS`), `errors.ts` (`AdarError`, `describeError`, `errorDetail`), `update.ts` (updater types and
  pure helpers), `patch.ts` (partial-staging patch builder), `menubar.ts` (the menu bar panel's calls and limits),
  `hosting.ts` (provider-neutral pull request types, GitHub's GraphQL query and the pure mapping of its answers),
  `agents.ts` (Agents at work: what a watched worktree is doing — `AgentWorktree`, `AgentEvent` — and the rules both
  sides share: `agentState` working / quiet / idle, `agentOf` from Co-Authored-By trailers, the branch prefix or the
  folder, the 30-minute strip, `newSince`, the settings sanitizers and `parseAgentNotice`),
  `review.ts` (reviewing a pull request in Adar: threads, reviews, Viewed marks, the timeline, GitHub's review query and
  changes, `parseReviewAction`/`parsePullNotice` for what the renderer sends, and `PullActivity`: the signed-in user's
  part in each open pull request, read by the list query, for the blue dots and notifications),
  `bitbucket.ts` / `gitlab.ts` / `azure.ts` (pure mapping of Bitbucket Cloud and Data Center answers / of GitLab's merge
  requests / of Azure DevOps' pull requests, votes and branch policies), `remoteUrl.ts` (remote URL → web page, provider;
  `hostingOf`/`pickHostingRemote` find GitHub — github.com, signed-in GitHub Enterprise servers and github.* hosts —,
  GitLab — gitlab.com, gitlab.* hosts and signed-in instances —, bitbucket.org, Data Center and Azure DevOps remotes —
  dev.azure.com, ssh.dev.azure.com and <org>.visualstudio.com, all as https://dev.azure.com/<org>), `groupColor.ts` (custom tab group
  colours: hex parsing, HSV for the picker, and each theme's version of a colour — same hue and chroma in OKLCH, lightness
  moved into the range the Basoa group colours use, so names stay readable).
- `src/main/` — Electron main process.
  - `index.ts` window, native menu, IPC (`dispatch.ts`), dev/e2e hooks; `quitGuard.ts` asks the renderer before quitting.
  - `backend.ts` composes the read side (`git/read/*`, parsers in `git/parsers/*`), the write side (`git/write/*`) and
    `hosting/` (pull requests).
  - `git/runner.ts` spawns git (argument arrays only, deterministic env); `git/context.ts` (`GitContext`: `git`,
    `gitNetwork`, `exclusive`, `gitDir`, `operationState`); `git/ops.ts` (read/write split).
  - `system/` — settings/recents/trusted repos store, askpass bridge (credential prompts → UI), file watcher with
    polling fallback, login-shell `PATH` fix. `activity.ts` is Agents at work's `ActivityTracker`: a WatcherManager of
    its own on the linked worktrees of the open tabs (and each repository's folder with `agentsWatchMain`), a look at a
    worktree when it changes (`git/read/activity.ts`: status, numstat, its own commits, all with GIT_OPTIONAL_LOCKS=0),
    files dated by their modification time, commits and pushes (`own` when they happen during or just after an
    operation Adar ran there: `backend.ts` wraps `exclusive` and `gitNetwork`), quiet once per stop, all sent as
    'agents' events; `watchAgents`, `getAgentWorktrees` and `notifyAgent` (a click sends 'open-agent').
  - `menuBar.ts` — macOS menu bar extra: the tray icon (template images in `resources/tray`, drawn by
    `scripts/render-tray-icons.cjs`: at rest, a dot for new commits, four fetch-animation frames), the panel window
    (`src/renderer/menubar.html`) and new-commit notifications after a fetch (every platform). The panel's window may
    only call `MENUBAR_METHODS` and `PANEL_API_METHODS` (`src/shared/menubar.ts`), and only on repositories Adar opened
    (`openRepo` and its trust check, or the panel's `menuBarUseRepo`).
  - `updater.ts` — in-app updates from GitHub Releases (check → download → verify → replace bundle → relaunch) on
    macOS; Windows and Linux builds only check, and "Download" opens the release page. When only an administrator can
    change Adar's folder (a standard account and /Applications) it asks for the password first and only the bundle swap
    runs as root (`ADMIN_SWAP_SCRIPT`, inline); if that is cancelled, the renderer explains how to install by hand.
    `admin.ts` is the macOS password dialog (osascript), shared with `cli.ts`.
  - `hosting/` — pull requests on GitHub (github.com and GitHub Enterprise servers, their API under `/api`), GitLab
    (merge requests, gitlab.com and self-managed), Bitbucket Cloud, Bitbucket Data Center and Azure DevOps, each opt-in
    (`settings.githubAuth`, `githubServers`, `gitlabServers`, `bitbucketAuth` + `bitbucketEmail`, `bitbucketServers`,
    `azureServers`; a server's `auth` says how Adar signs in to it). `provider.ts` is the interface each one implements
    (`githubProvider.ts`, `gitlabProvider.ts`, `bitbucketCloud.ts`, `bitbucketServer.ts`, `azureProvider.ts`); `http.ts`
    the JSON client that only calls its own base address (and fetches pictures on its own host); `auth.ts` the GitHub
    and GitLab CLIs' sign-ins (`gh auth token`, `glab config get token` or `glab auth status --show-token`, asked each
    time, never stored) and the token files encrypted with Electron `safeStorage` (`PlatformAdapter.secrets`: GitHub,
    one per GitHub Enterprise server, one personal access token per GitLab instance, Bitbucket Cloud's API token, one
    HTTP access token per Data Center server, one per Azure DevOps organization). GitLab can also use the token git's
    credential helper keeps (`git credential fill` with every prompt off, never stored). `githubDevice.ts` signs in to
    github.com from the browser (OAuth device flow with Adar's OAuth app, `GITHUB_OAUTH_CLIENT_ID`; not offered while it
    is empty); the device code stays in the main process and the renderer polls `checkGithubSignIn`. `avatars.ts` maps
    what each provider knows about an author's picture (`getAuthorAvatars`: GitHub by commit, GitLab by public email,
    Bitbucket by commit; Azure DevOps none), returned as data: URLs and cached. `index.ts` picks the repository's remote and provider;
    the providers' `review`/`reviewAction` (GitHub only) read and change a review, `preparePullReview` fetches a pull
    request's commits without making branches and says where its changes start and how it moved on since a commit (an
    ancestor, the same changes rebased — `git range-diff` —, rewritten, or only merges), and `notifyPullRequest` shows a
    notification through `PlatformAdapter.notify` (a click sends an `open-pull` event). `index.ts` also
    makes the local branch for checking a pull request out (forks: `pr/<n>` from `refs/pull/<n>/head` on GitHub or
    `refs/pull-requests/<n>/from` on Data Center, `mr/<n>` from `refs/merge-requests/<n>/head` on GitLab). Nothing talks
    to a service while its pull requests are off, and tokens never reach the renderer or the logs. The UI uses each
    provider's words (`lib/pulls.ts`: `pullNoun`, `pullRef` — "merge request !12" on GitLab, "!12" on Azure DevOps).
  - `cli.ts` / `cliPath.ts` — install/uninstall the `adar` command (symlink to `resources/bin/adar`, shipped in the
    bundle as `Contents/Resources/bin/adar`); `openRequests.ts` queues folders to open from the CLI/Dock
    (`open-file`), `--open-repo=<path>` launch args and second instances until the renderer takes them.
- `src/preload/` — exposes `window.adarBridge` (generic invoke/onEvent/setZoom). Context isolation + sandbox.
- `src/server/` — HTTP bridge so the renderer runs in a browser: `npm run web` → open the printed
  `http://127.0.0.1:5898/#t=<token>` URL (the token authenticates the bridge).
- `src/renderer/src/` — UI.
  - `api/client.ts` — `api` (typed AdarApi proxy), `updates`, `onAdarEvent`, `newOpId`, `isMac`.
  - `store/appStore.ts` — zustand `useApp`: tabs (`RepoTab`), selection, centre view, settings, undo/redo stacks.
  - `actions/git.tsx` — user-level git actions (confirmations, toasts, busy state, refresh, undo entries). UI code calls
    these instead of `api` for anything that mutates a repository.
  - `actions/cleanup.tsx` — "Clean up branches" (fetch with prune, then `getBranchCleanup`; delete with one undo entry for
    the local branches) and the count on the Local section; which branches can go and how they are grouped is pure, in
    `lib/cleanup.ts` (merged pull requests count as merged, so squash merges are found; environment names such as `pre`
    or `qa` are listed but never ticked). The dialog is `components/modals/BranchCleanupDialog.tsx`. Branches it never
    offers, here or on the remote: the base branch, `LONG_LIVED`, the repository's own names and patterns ("Never clean
    up", `keepBranch` → `git config adar.keepBranch` in the common config, read into `RepoInfo.keptBranches`) and, while
    pull requests are on, what the service protects (`getProtectedBranches`, `PullProvider.protectedBranches`; null when
    it would not say, as Bitbucket for non-admins). Their list is `components/modals/KeptBranchesDialog.tsx`.
  - `actions/reflog.tsx` — recovering lost commits: the reflog view (`components/reflog/ReflogView.tsx`, a centre view:
    *Lost commits* grouped by what left them behind — reset, deleted branch, detached HEAD, rewritten — and *Every move*
    of HEAD or a branch), moving a reset branch back (`fastForwardBranch`; Undo with `reset --keep` or `moveBranch`),
    restoring a deleted branch, a `recovered/…` branch for any lost commit. Backend: `git/read/reflog.ts` (`getReflog`,
    `getLostCommits`, `findDanglingCommits` with git fsck), the grouping is pure in `git/parsers/reflog.ts`. Opened from
    Undo's menu (and a click on Undo with nothing to undo), the Local section's menu, the palette and the Repository menu.
  - `actions/worktrees.tsx` — worktrees: each tab's list (`useWorktrees`, from `getWorktrees`), opening one as a tab in
    the group of the tab it came from, creating one (dialog `components/modals/NewWorktreeDialog.tsx`, or one click for a
    pull request), removing with undo, and `finishWorktree` after its pull request is merged. Local branches checked out
    in another worktree carry `Ref.worktree`; a linked worktree's tab has `RepoInfo.mainWorktree`. Backend:
    `git/read/worktrees.ts`, `git/write/worktrees.ts`.
  - `actions/groups.tsx` — tab groups (open/close a group, group a folder's repositories, the grouping suggestion);
    groups are saved in `settings.tabGroups`, pure helpers in `lib/tabGroups.ts`
    (dragging a group's label, or Move Group Left/Right on its menu, moves the whole group: `moveGroupTabs`).
  - `actions/pulls.tsx` — pull request actions (turn on, create after pushing, check out, merge, clean up, bring the base
    branch in); `components/pulls/` — the store and its sync (`pullStore.ts`: the active repository after each fetch, on
    focus, at most once a minute; every open one every three minutes), the chip on branch labels, the details panel and
    the dialogs; pure helpers in `lib/pulls.ts`.
  - `actions/agents.tsx` — Agents at work: opening a worktree on its changes or a commit (`showWorktree`), the Agents
    view, marking a worktree as seen (`settings.worktreesSeen`), silencing its quiet notifications. `components/agents/`
    — `agentStore.ts` (the watched worktrees from the main process, the clock, which tabs are watched, seen marks,
    notifications), `model.ts` (pure: labels, the tab dot, the view's columns, `noticesFor`), `parts.tsx` (mark, state,
    strip), `AgentsView.tsx` (a centre view: working, quiet and idle cards of the active repository's worktrees, its tab
    group's or every open tab's — `settings.agentsScope`, which the toolbar's badge follows too),
    `graph.ts` (the graph's dashed rows for other worktrees' work in progress, `AgentRow` in `graph/model.ts`, and the
    commits new since the user looked). Worktree rows in the left panel have two lines; the tab bar, the toolbar
    (Agents, ⇧⌘E) and the menu bar panel ("At work", `menuBarOpenAgent`) show the state too.
  - `actions/review.tsx` — reviewing in Adar and keeping up: `openReview` (GitHub; other services open their page),
    `openInbox`, loading what the review shows, line comments kept for the review (`components/review/reviewStore.ts`,
    in localStorage until submitted), replies, resolve, Viewed marks, `submitReview`; `markSeen` and `setFollowing`
    (`settings.pullsSeen`, `pullsFollowed`, `pullsUnfollowed`). `components/review/` — the review view (a centre view:
    files with Viewed marks, all changes or since the last review, one file's diff with its threads in `ReviewDiff.tsx`,
    the conversation and the commits; Esc goes back) and `ReviewPanel.tsx` (the right panel while reviewing: the kept
    comments, verdict, summary, Submit, reviewers, checks); pure helpers in `model.ts`. What changed since the user
    looked is pure in `lib/following.ts` (`pullNews`: the blue dot and its words); `components/pulls/InboxView.tsx` is
    the inbox of every open repository (a centre view; `inbox.ts` sorts it, `needsYou` is the toolbar's Reviews badge),
    `PullNews.tsx` the dot's chip in the left panel and on branch chips and the graph's marks (`useReviewMarks`), and
    `notices.ts` the notifications after each refresh while Adar is not in front (more than three become one).
  - `commands.ts` — command registry shared by the native menu, shortcuts and the command palette.
  - `menubar/` — the menu bar panel (its own entry, `menubar.html`): `MenuBarPanel.tsx` (project switcher, branch with
    Pull/Push, mini graph reusing `components/graph`), pure helpers in `model.ts`.
  - `components/` — `common` (Modal, Button, dialogs, ContextMenu, toast, Avatar, Resizer, ErrorBoundary), `layout`
    (tabs, toolbar, status bar, welcome, logo), `graph`, `sidebar`, `details` (commit details, staging, composer),
    `diff` (diff, blame, history; changed images in `ImageDiff.tsx`: side by side, swipe, onion skin and difference, with
    the changed pixels and areas found in `imageCompare.ts`), `conflicts`, `rebase`, `modals`, `palette` (palette + git console), `update`.
  - `lib/` — lane colours, formatting, ref helpers, drag & drop, keyboard helpers; `providerAvatars.ts` batches the
    provider pictures `Avatar` asks for when Gravatar has none (`settings.providerAvatars`, only while pull requests are
    on for the active repository).
  - `styles/theme.css` — design tokens: the Basoa palette of the website mapped onto the app's names (dark = Gaua,
    light = Eguna). `--accent` is fern for lines, icons and text (deep fern on light surfaces); fills such as primary
    buttons use `--accent-fill` with `--accent-text` on top. Graph lanes are `--lane-1…6` (fern, moss, sea, heather,
    ember, sun) with `-ink` variants for text on their wash; tab groups use the same palette plus bone and mist, or a
    custom #rrggbb drawn through `lib/groupColors.ts` (`groupLine`/`groupInk`: `light-dark()` of the two theme versions;
    the picker is `components/common/ColourPicker.tsx`, the group's popover `components/layout/GroupColourPopover.tsx`).
    ALWAYS use CSS variables; dark and light themes must both work.
  - `assets/fonts/` — Geist, Geist Mono and Instrument Serif italic (OFL, same files as `site/src/fonts`), bundled so
    the app makes no font requests. Instrument Serif is only for the word "adar" on the welcome screen.
- `site/` — the project website (https://adargit.com): a separate npm project (Astro, static output) deployed by
  Cloudflare Pages from this repository (root directory `site`, `npm run build`, output `dist`), and rebuilt after each
  release through the deploy hook in `release.yml` (secret `CLOUDFLARE_DEPLOY_HOOK`). `src/views/` has the landing
  (`Home.astro`; the 3D scene is hand-written WebGL2 in `src/scripts/branches.js`), `Agents.astro` (working with AI
  coding agents and Adar, step by step, with screenshots of the review view and the inbox from `src/assets`; only
  what Adar already does), `Roadmap.astro` (renders the
  repository's `ROADMAP.md` and the GitHub Releases at build time — `src/lib/roadmap.ts`, `src/lib/releases.ts`) and
  `Design.astro` (the Basoa design system); `src/pages/404.astro` is the trilingual not-found page. Shared layout/nav/footer/icon in `src/layouts` and
  `src/components`; tokens in `src/styles/tokens.css` (also published as `/tokens.css`); fonts self-hosted; build
  telemetry off; the browser only calls the GitHub API for the star count. Separate from the app's own `theme.css`.
  Always link with `url()` from `src/lib/url.ts` (respects the base).
  The site is in English (root), Spanish (`/es`) and Basque (`/eu`) with localized slugs and anchors (`src/i18n/config.ts`:
  routes, anchors, `pageUrl()`). Pages in `src/pages/` are thin wrappers around the templates in `src/views/`; all copy lives
  in `src/i18n/` (`ui.ts` shared, `home.ts`, `agents.ts`, `roadmap.ts`, `design.ts`), and strings for scripts reach them through the
  layout's `#i18n` JSON (`t()` in `site.js`). Add every new string in all three languages. Illustrations of the app stay in
  English (its interface is English); ROADMAP.md items and release notes are shown as written.

## Conventions
- CSS class prefixes per module: `app-` shell, `ui-` common, `tb-`/`wl-` toolbar, tabs, status bar, welcome, `sb-` left
  panel, `gr-` graph, `det-` right panel, `diff-` diff/blame/history, `cf-` conflicts, `rb-` rebase, `md-` modals,
  `pal-` palette/console, `up-` updates, `mb-` menu bar panel, `pr-` pull requests, `rl-` reflog, `rv-` review, `ib-` pull
  request inbox, `ag-` agents at work. Each module imports its own `.css` file.
- Icons: `lucide-react`. Virtualised lists: `@tanstack/react-virtual`. Syntax highlighting: `highlight.js`.
- Do not add npm dependencies without discussing it first.

## Safety rules (keep them when changing code)
- Spawn git only through `GitContext` with argument arrays — never a shell. Reject user-supplied names/refs that start
  with `-`. Use `--pathspec-from-file` + `GIT_LITERAL_PATHSPECS` for path lists.
- Mutating operations per repo run inside `ctx.exclusive(repo, …)`.
- Untrusted repositories: `openRepo` refuses (`UNTRUSTED_REPO`) repos whose local config runs commands until the user
  trusts them; never execute files from a repository (see `openInEditor`), never write through symlinks, validate that
  paths stay inside the repo.
- Destructive actions confirm first (`confirm({ danger: true })`) and, where possible, push an undo entry. Undo/redo
  entries record HEAD and refuse to run when the repository changed since.
- Never log or persist credentials; redact `user:token@` in URLs.

## Testing
- Typecheck: `npm run typecheck`. Tests: `npx vitest run [path]` (backend tests create temporary repositories; UI logic
  has unit and server-side render tests).
- Real app, scripted: `scripts/e2e.sh <workdir> <steps.json> [--no-build]` builds into `<workdir>/out` (parallel-safe),
  launches Electron with `<workdir>/ud` as user data and saves screenshots to `<workdir>/shots`. Steps: `{"size":[w,h]}`,
  `{"wait":ms}`, `{"js":"expr"}`, `{"jsFile":"/abs/file.js"}`, `{"shot":"name"}`; the menu bar panel: `{"panel":true}` opens
  it, `{"panelJs":"expr"}` runs in it, `{"panelShot":"name"}` captures it. Notifications are only logged
  (`[capture] notify …`); `{"clickNotice":true}` clicks the last one. A step can stub `document.hasFocus = () => false`
  so pull request notifications are sent. Load `scripts/e2e-helpers.js` first for
  `window.e2e` (click/type/key/drag/contextMenu/menuItem/waitFor/state/errors). `window.__adar = { store, api, updates }`.
  Seed `<workdir>/ud/settings.json` with `{"openTabs":["/abs/repo"],"activeTab":"/abs/repo","autoFetchMinutes":0}`.
- Fixtures: `scripts/make-fixture-repo.sh <dir> [--conflict]` (demo repo + bare origin),
  `node scripts/make-big-repo.mjs <dir> [commits] [branches]` (performance).
- Website: `cd site && npm install && npm run dev` (http://localhost:4321/), or `npm run build && npm run preview`
  to check the static output. Add `?capture` to a URL to keep WebGL frames readable by screenshot tools.
- Pull requests without touching GitHub, GitLab, Bitbucket or Azure DevOps: unpackaged builds send API calls to
  `ADAR_GITHUB_API=http://127.0.0.1:<port>` / `ADAR_BITBUCKET_API=http://127.0.0.1:<port>` / `ADAR_GITLAB_URL=http://127.0.0.1:<port>`
  (gitlab.com's stand-in; its API under `/api/v4`) / `ADAR_AZURE_URL=http://127.0.0.1:<port>` (dev.azure.com's stand-in;
  organizations under it) when set (a fake API server), and `ADAR_HOSTING_LOOPBACK=1` lets a GitLab instance, GitHub
  Enterprise or Data Center server be `http://127.0.0.1:<port>`. Signing in from the browser: `ADAR_GITHUB_WEB` (github.com's
  `/login/device/code` and `/login/oauth/access_token`) and `ADAR_GITHUB_CLIENT_ID` (any id, before Adar has its own); in
  scripted runs `openExternal` only logs the address, so the developer's browser never opens. For GitHub put a fake `gh`
  first on `PATH` (it must print a token for `gh auth token`, or exit 1 to be signed out) and point `GH_CONFIG_DIR` at a
  `hosts.yml` with `user:`; the same for `glab`. Run the app's git with `GIT_CONFIG_GLOBAL=<file>` and `GIT_CONFIG_NOSYSTEM=1`
  so the developer's credential helpers are never asked (a `credential.helper = store --file=<file>` there stands in for
  one). Serve the `git@github.com:…`,
  `git@gitlab.com:…`, `git@bitbucket.org:…` or `ssh://git@<host>:7999/…` origin from a local bare repository through
  `GIT_SSH_COMMAND` (name the script `ssh` so git passes the port; `url.<x>.insteadOf` would change what
  `git remote -v` shows).
- Updater end to end with packaged builds: `scripts/test-updater.sh <workdir>` (must print `UPDATER TEST PASSED`);
  `--admin-sim` takes the administrator path without the dialog, `--admin` makes the folder read-only and needs a person
  to type an administrator's password.

## Commands
- `npm run dev` (desktop app), `npm run web` (browser), `npm run build`, `npm run dist` (local .dmg/.zip),
  `npm run dist:win` / `npm run dist:linux` (x64 NSIS installer / AppImage + .deb; best built on their own system).
- Release: bump the version (`npm version x.y.z`), push the tag; `.github/workflows/release.yml` builds macOS, Windows
  and Linux on their own runners, uploads everything to a draft release, verifies the assets and publishes it. Installed
  apps pick it up through the in-app updater. macOS assets keep their arch-only names (`Adar-<v>-arm64.zip`), which
  installed apps look for; Windows/Linux assets name their system and are never .zip/.dmg.
- Release notes: write `build/release-notes.md` in the release commit, together with the version bump. It is the GitHub
  release body and is also bundled into the app, whose What's new panel (`components/update/WhatsNew.tsx`) shows it,
  without its Install section, the first time a newer version runs (`settings.lastRunVersion`). A test checks that it
  names the version's assets (`Adar-<v>-…`).
