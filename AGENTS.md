# Adar — visual Git client (GitKraken-style) for any repository

Guide for contributors and coding agents. "Adar" means "branch" in Basque (the app was briefly called "Rama";
settings migrate from `~/Library/Application Support/Rama`).

Electron 44 + electron-vite 6 + React 19 + TypeScript 7 + zustand. The backend shells out to the system `git`
binary, so it works with every repository the user's git can access (SSH keys, Keychain, credential helpers,
private hosts). Clean-room implementation: never copy GitKraken code, assets or branding. MIT licensed.

## Layout
- `src/shared/` — the contract: `types.ts` (domain types, settings), `api.ts` (`AdarApi`, the ONLY renderer↔backend
  API, plus `API_METHODS`), `errors.ts` (`AdarError`, `describeError`, `errorDetail`), `update.ts` (updater types and
  pure helpers), `patch.ts` (partial-staging patch builder).
- `src/main/` — Electron main process.
  - `index.ts` window, native menu, IPC (`dispatch.ts`), dev/e2e hooks; `quitGuard.ts` asks the renderer before quitting.
  - `backend.ts` composes the read side (`git/read/*`, parsers in `git/parsers/*`) and the write side (`git/write/*`).
  - `git/runner.ts` spawns git (argument arrays only, deterministic env); `git/context.ts` (`GitContext`: `git`,
    `gitNetwork`, `exclusive`, `gitDir`, `operationState`); `git/ops.ts` (read/write split).
  - `system/` — settings/recents/trusted repos store, askpass bridge (credential prompts → UI), file watcher with
    polling fallback, login-shell `PATH` fix.
  - `updater.ts` — in-app updates from GitHub Releases (check → download → verify → replace bundle → relaunch).
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
  - `commands.ts` — command registry shared by the native menu, shortcuts and the command palette.
  - `components/` — `common` (Modal, Button, dialogs, ContextMenu, toast, Avatar, Resizer, ErrorBoundary), `layout`
    (tabs, toolbar, status bar, welcome, logo), `graph`, `sidebar`, `details` (commit details, staging, composer),
    `diff` (diff, blame, history), `conflicts`, `rebase`, `modals`, `palette` (palette + git console), `update`.
  - `lib/` — lane colours, formatting, ref helpers, drag & drop, keyboard helpers.
  - `styles/theme.css` — design tokens. ALWAYS use CSS variables; dark and light themes must both work.

## Conventions
- CSS class prefixes per module: `app-` shell, `ui-` common, `tb-`/`wl-` toolbar, tabs, status bar, welcome, `sb-` left
  panel, `gr-` graph, `det-` right panel, `diff-` diff/blame/history, `cf-` conflicts, `rb-` rebase, `md-` modals,
  `pal-` palette/console, `up-` updates. Each module imports its own `.css` file.
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
  `{"wait":ms}`, `{"js":"expr"}`, `{"jsFile":"/abs/file.js"}`, `{"shot":"name"}`. Load `scripts/e2e-helpers.js` first for
  `window.e2e` (click/type/key/drag/contextMenu/menuItem/waitFor/state/errors). `window.__adar = { store, api, updates }`.
  Seed `<workdir>/ud/settings.json` with `{"openTabs":["/abs/repo"],"activeTab":"/abs/repo","autoFetchMinutes":0}`.
- Fixtures: `scripts/make-fixture-repo.sh <dir> [--conflict]` (demo repo + bare origin),
  `node scripts/make-big-repo.mjs <dir> [commits] [branches]` (performance).
- Updater end to end with packaged builds: `scripts/test-updater.sh <workdir>` (must print `UPDATER TEST PASSED`).

## Commands
- `npm run dev` (desktop app), `npm run web` (browser), `npm run build`, `npm run dist` (local .dmg/.zip).
- Release: bump the version (`npm version x.y.z`), push the tag; `.github/workflows/release.yml` builds, uploads to a
  draft release, verifies the assets and publishes it. Installed apps pick it up through the in-app updater.
