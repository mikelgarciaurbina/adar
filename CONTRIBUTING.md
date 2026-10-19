# Contributing to Adar

Thanks for your interest in Adar! Bug reports, ideas, docs and code are all welcome.

## Reporting bugs and requesting features

- Search [existing issues](https://github.com/mikelgarciaurbina/adar/issues) first.
- Use the issue templates. For bugs include your Adar version (*Adar → About*), macOS version, `git --version`,
  steps to reproduce and, if possible, a screenshot.
- Never paste tokens, passwords or private repository contents in an issue.
- Security problems: follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

```bash
git clone https://github.com/mikelgarciaurbina/adar.git
cd adar
npm install
npm run dev     # Electron app with hot reload
npm run web     # renderer in a browser at http://127.0.0.1:5898 (fast UI iteration)
```

Requirements: Node.js 22+, Git 2.26+, macOS (other platforms are not supported yet).

Useful fixtures:

```bash
scripts/make-fixture-repo.sh /tmp/adar-fx            # demo repo with branches, merges, tags, a stash and a remote
scripts/make-fixture-repo.sh /tmp/adar-fx --conflict # same, left in the middle of a merge conflict
node scripts/make-big-repo.mjs /tmp/adar-big 20000   # 20k commits for performance work
```

## Making changes

1. Read [AGENTS.md](AGENTS.md): it describes the architecture (shared contract in `src/shared`, git backend in
   `src/main`, React UI in `src/renderer`), coding conventions and testing tools.
2. Create a branch from `main` and keep pull requests focused on one change.
3. Follow the existing style. Key rules:
   - The renderer talks to the backend only through `AdarApi` (`src/shared/api.ts`).
   - Mutating git operations from the UI go through `src/renderer/src/actions/git.ts`.
   - git is always spawned with argument arrays, never through a shell.
   - Styles use the CSS variables in `src/renderer/src/styles/theme.css`; check both dark and light themes.
   - Don't add npm dependencies without discussing it in an issue first.
4. Add or update tests:
   - Backend: integration tests that create temporary git repositories (`src/main/git/**/__tests__`).
   - UI logic: unit tests next to the module (`*.test.ts`).
   - For visual changes, attach before/after screenshots to the PR (`scripts/e2e.sh` can capture the real app).
5. Make sure everything passes:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

6. Open a pull request describing the change, why it's needed and how you tested it.

## Commit messages

Use short, imperative subjects ("Add blame view", "Fix push of new branches"). Reference issues with `#123` in the
body when relevant.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
