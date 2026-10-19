# Adar — visual Git client (GitKraken-style) for any repository

"Adar" means "branch" in Basque (the app was briefly called "Rama"; settings migrate from ~/Library/Application Support/Rama).

Electron 44 + electron-vite 6 + React 19 + TypeScript 7 + zustand. The backend shells out to the
system `git` binary, so it works with every repo the user's git can access (SSH keys, Keychain,
credential helpers, private hosts). Clean-room implementation: do not copy GitKraken code/assets/branding.

## Layout
- `src/shared/` — contract: `types.ts` (domain types), `api.ts` (`AdarApi`, the ONLY renderer↔backend API), `errors.ts` (`AdarError`, `describeError`).
- `src/main/` — Electron main. `index.ts` (window/menu/IPC), `dispatch.ts`, `backend.ts` (`createBackend` composes read ops + `git/write` ops), `git/runner.ts` (spawn git), `git/context.ts` (`GitContext`: git/gitNetwork/exclusive/gitDir/operationState), `git/ops.ts` (read/write split).
- `src/preload/` — exposes `window.adarBridge` (generic invoke/onEvent/setZoom).
- `src/server/devServer.ts` — HTTP bridge so the renderer runs in a browser: `npm run web` → http://127.0.0.1:5898.
- `src/renderer/src/` — UI.
  - `api/client.ts` — `api` (typed AdarApi proxy), `onAdarEvent`, `newOpId`, `isMac`.
  - `store/appStore.ts` — zustand `useApp`: tabs (`RepoTab`), selection, centre view, settings, undo stacks. Hooks: `useActiveTab`, `useTab`, `useSettings`.
  - `actions/git.ts` — user-level git actions (confirm dialogs, toasts, busy, refresh, undo). UI must call these rather than `api` for mutating operations.
  - `commands.ts` — command registry (menu, shortcuts, palette).
  - `components/common/` — `Modal`, `Button`/`IconButton`/`Spinner`/`EmptyState`/`Kbd`, `dialogs` (`confirm`/`prompt`/`choose`/`form`/`validateRefName`), `ContextMenu` (`showContextMenu`, `showMenuBelow`), `toast`, `Avatar`, `Resizer`.
  - `lib/` — `colors.ts` (lane palette), `format.ts` (dates, status letters/colours), `refs.ts` (refsBySha...), `dnd.ts` (ref drag & drop), `keys.ts`.
  - `styles/theme.css` — design tokens. ALWAYS use CSS variables; both dark & light themes must work.

## Conventions
- CSS class prefixes per module: `app-` shell, `ui-` common, `tb-` toolbar/tabs/status/welcome, `sb-` left panel, `gr-` graph, `det-` right panel, `diff-` diff/blame/history, `cf-` conflicts, `rb-` rebase, `md-` modals, `pal-` palette/console. Each module imports its own `.css` file.
- Icons: `lucide-react`. Virtualised lists: `@tanstack/react-virtual`. Syntax highlighting: `highlight.js`.
- Never spawn git through a shell; always argument arrays via `GitContext`.
- Mutating git operations per repo run inside `ctx.exclusive(repo, ...)`.
- Do not add npm dependencies without asking.

## Testing the real app (e2e)
- `scripts/e2e.sh <workdir> <steps.json>` builds into `<workdir>/out` (isolated → parallel-safe), launches Electron with
  `<workdir>/ud` as user data and writes screenshots to `<workdir>/shots`. Steps: `{"size":[w,h]}`, `{"wait":ms}`,
  `{"js":"expr"}` (result printed), `{"shot":"name"}`. `window.__adar = { store, api }` is available to js steps.
- Seed `<workdir>/ud/settings.json` with `{"openTabs":["/abs/repo"],"activeTab":"/abs/repo","autoFetchMinutes":0}`.
- Fixtures: `scripts/make-fixture-repo.sh <dir> [--conflict]` (realistic demo repo + bare origin),
  `node scripts/make-big-repo.mjs <dir> [commits] [branches]` (performance).

## Commands
- Typecheck: `npm run typecheck` (or `npx tsc --noEmit -p tsconfig.web.json` / `tsconfig.node.json`).
- Tests: `npx vitest run [path]` (backend tests create temp repos; pure UI logic has unit tests).
- Build: `npm run build`; run desktop app: `npm run dev`; browser mode: `npm run web`.
