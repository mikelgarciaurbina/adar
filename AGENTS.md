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
  `bitbucket.ts` (pure mapping of Bitbucket Cloud and Data Center answers), `remoteUrl.ts` (remote URL → web page,
  provider; `hostingOf`/`pickHostingRemote` find GitHub, bitbucket.org and Data Center remotes).
- `src/main/` — Electron main process.
  - `index.ts` window, native menu, IPC (`dispatch.ts`), dev/e2e hooks; `quitGuard.ts` asks the renderer before quitting.
  - `backend.ts` composes the read side (`git/read/*`, parsers in `git/parsers/*`), the write side (`git/write/*`) and
    `hosting/` (pull requests).
  - `git/runner.ts` spawns git (argument arrays only, deterministic env); `git/context.ts` (`GitContext`: `git`,
    `gitNetwork`, `exclusive`, `gitDir`, `operationState`); `git/ops.ts` (read/write split).
  - `system/` — settings/recents/trusted repos store, askpass bridge (credential prompts → UI), file watcher with
    polling fallback, login-shell `PATH` fix.
  - `menuBar.ts` — macOS menu bar extra: the tray icon (template images in `resources/tray`, drawn by
    `scripts/render-tray-icons.cjs`: at rest, a dot for new commits, four fetch-animation frames), the panel window
    (`src/renderer/menubar.html`) and new-commit notifications after a fetch (every platform). The panel's window may
    only call `MENUBAR_METHODS` and `PANEL_API_METHODS` (`src/shared/menubar.ts`), and only on repositories Adar opened
    (`openRepo` and its trust check, or the panel's `menuBarUseRepo`).
  - `updater.ts` — in-app updates from GitHub Releases (check → download → verify → replace bundle → relaunch) on
    macOS; Windows and Linux builds only check, and "Download" opens the release page.
  - `hosting/` — pull requests on GitHub, Bitbucket Cloud and Bitbucket Data Center, each opt-in
    (`settings.githubAuth`, `bitbucketAuth` + `bitbucketEmail`, `bitbucketServers`). `provider.ts` is the interface each
    one implements (`githubProvider.ts`, `bitbucketCloud.ts`, `bitbucketServer.ts`); `http.ts` the JSON client that only
    calls its own base address; `auth.ts` the GitHub CLI sign-in (asks `gh auth token` each time, never stored) and the
    token files encrypted with Electron `safeStorage` (`PlatformAdapter.secrets`: GitHub, Bitbucket Cloud's API token,
    one HTTP access token per Data Center server). `index.ts` picks the repository's remote and provider, and makes the
    local branch for checking a pull request out (`pr/<n>` for forks, from `refs/pull/<n>/head` on GitHub or
    `refs/pull-requests/<n>/from` on Data Center). Nothing talks to a service while its pull requests are off, and
    tokens never reach the renderer or the logs.
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
  - `actions/groups.tsx` — tab groups (open/close a group, group a folder's repositories, the grouping suggestion);
    groups are saved in `settings.tabGroups`, pure helpers in `lib/tabGroups.ts`.
  - `actions/pulls.tsx` — pull request actions (turn on, create after pushing, check out, merge, clean up, bring the base
    branch in); `components/pulls/` — the store and its sync (`pullStore.ts`: after each fetch, on focus, at most once a
    minute otherwise), the chip on branch labels, the details panel and the dialogs; pure helpers in `lib/pulls.ts`.
  - `commands.ts` — command registry shared by the native menu, shortcuts and the command palette.
  - `menubar/` — the menu bar panel (its own entry, `menubar.html`): `MenuBarPanel.tsx` (project switcher, branch with
    Pull/Push, mini graph reusing `components/graph`), pure helpers in `model.ts`.
  - `components/` — `common` (Modal, Button, dialogs, ContextMenu, toast, Avatar, Resizer, ErrorBoundary), `layout`
    (tabs, toolbar, status bar, welcome, logo), `graph`, `sidebar`, `details` (commit details, staging, composer),
    `diff` (diff, blame, history), `conflicts`, `rebase`, `modals`, `palette` (palette + git console), `update`.
  - `lib/` — lane colours, formatting, ref helpers, drag & drop, keyboard helpers.
  - `styles/theme.css` — design tokens: the Basoa palette of the website mapped onto the app's names (dark = Gaua,
    light = Eguna). `--accent` is fern for lines, icons and text (deep fern on light surfaces); fills such as primary
    buttons use `--accent-fill` with `--accent-text` on top. Graph lanes are `--lane-1…6` (fern, moss, sea, heather,
    ember, sun) with `-ink` variants for text on their wash; tab groups use the same palette plus bone and mist.
    ALWAYS use CSS variables; dark and light themes must both work.
  - `assets/fonts/` — Geist, Geist Mono and Instrument Serif italic (OFL, same files as `site/src/fonts`), bundled so
    the app makes no font requests. Instrument Serif is only for the word "adar" on the welcome screen.
- `site/` — the project website (https://adargit.com): a separate npm project (Astro, static output) deployed by
  Cloudflare Pages from this repository (root directory `site`, `npm run build`, output `dist`), and rebuilt after each
  release through the deploy hook in `release.yml` (secret `CLOUDFLARE_DEPLOY_HOOK`). `src/views/` has the landing
  (`Home.astro`; the 3D scene is hand-written WebGL2 in `src/scripts/branches.js`), `Roadmap.astro` (renders the
  repository's `ROADMAP.md` and the GitHub Releases at build time — `src/lib/roadmap.ts`, `src/lib/releases.ts`) and
  `Design.astro` (the Basoa design system); `src/pages/404.astro` is the trilingual not-found page. Shared layout/nav/footer/icon in `src/layouts` and
  `src/components`; tokens in `src/styles/tokens.css` (also published as `/tokens.css`); fonts self-hosted; build
  telemetry off; the browser only calls the GitHub API for the star count. Separate from the app's own `theme.css`.
  Always link with `url()` from `src/lib/url.ts` (respects the base).
  The site is in English (root), Spanish (`/es`) and Basque (`/eu`) with localized slugs and anchors (`src/i18n/config.ts`:
  routes, anchors, `pageUrl()`). Pages in `src/pages/` are thin wrappers around the templates in `src/views/`; all copy lives
  in `src/i18n/` (`ui.ts` shared, `home.ts`, `roadmap.ts`, `design.ts`), and strings for scripts reach them through the
  layout's `#i18n` JSON (`t()` in `site.js`). Add every new string in all three languages. Illustrations of the app stay in
  English (its interface is English); ROADMAP.md items and release notes are shown as written.

## Conventions
- CSS class prefixes per module: `app-` shell, `ui-` common, `tb-`/`wl-` toolbar, tabs, status bar, welcome, `sb-` left
  panel, `gr-` graph, `det-` right panel, `diff-` diff/blame/history, `cf-` conflicts, `rb-` rebase, `md-` modals,
  `pal-` palette/console, `up-` updates, `mb-` menu bar panel, `pr-` pull requests. Each module imports its own `.css`
  file.
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
  it, `{"panelJs":"expr"}` runs in it, `{"panelShot":"name"}` captures it. Load `scripts/e2e-helpers.js` first for
  `window.e2e` (click/type/key/drag/contextMenu/menuItem/waitFor/state/errors). `window.__adar = { store, api, updates }`.
  Seed `<workdir>/ud/settings.json` with `{"openTabs":["/abs/repo"],"activeTab":"/abs/repo","autoFetchMinutes":0}`.
- Fixtures: `scripts/make-fixture-repo.sh <dir> [--conflict]` (demo repo + bare origin),
  `node scripts/make-big-repo.mjs <dir> [commits] [branches]` (performance).
- Website: `cd site && npm install && npm run dev` (http://localhost:4321/), or `npm run build && npm run preview`
  to check the static output. Add `?capture` to a URL to keep WebGL frames readable by screenshot tools.
- Pull requests without touching GitHub or Bitbucket: unpackaged builds send API calls to
  `ADAR_GITHUB_API=http://127.0.0.1:<port>` / `ADAR_BITBUCKET_API=http://127.0.0.1:<port>` when set (a fake API server),
  and `ADAR_HOSTING_LOOPBACK=1` lets a Data Center server be `http://127.0.0.1:<port>`. For GitHub put a fake `gh` first
  on `PATH` (it must print a token for `gh auth token`) and point `GH_CONFIG_DIR` at a `hosts.yml` with `user:`. Serve
  the `git@github.com:…`, `git@bitbucket.org:…` or `ssh://git@<host>:7999/…` origin from a local bare repository through
  `GIT_SSH_COMMAND` (name the script `ssh` so git passes the port; `url.<x>.insteadOf` would change what
  `git remote -v` shows).
- Updater end to end with packaged builds: `scripts/test-updater.sh <workdir>` (must print `UPDATER TEST PASSED`).

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
