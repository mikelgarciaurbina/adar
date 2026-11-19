import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

// Apple's /usr/bin/git launches the selected developer tool on every invocation.
// Resolve it once for the Git fixtures, respecting other installations earlier on PATH.
function fixtureGit(): string {
  if (process.platform !== 'darwin') return 'git'
  const selected = spawnSync('/usr/bin/which', ['git'], { encoding: 'utf8' })
  if (selected.stdout?.trim() !== '/usr/bin/git') return 'git'
  const tool = spawnSync('/usr/bin/xcrun', ['--find', 'git'], { encoding: 'utf8' })
  return tool.status === 0 ? tool.stdout.trim() : 'git'
}

const rendererAndShared = 'src/{renderer,shared}/**/*.test.{ts,tsx}'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    projects: [
      // Reuse workers with a fresh JS context for each renderer or shared test file.
      { extends: true, test: { name: 'renderer-shared', include: [rendererAndShared], pool: 'vmForks' } },
      // Native integration suites change process settings and need separate OS processes.
      { extends: true, test: { name: 'backend', include: ['src/**/*.test.{ts,tsx}'], exclude: [...configDefaults.exclude, rendererAndShared] } }
    ],
    env: { ADAR_TEST_GIT: fixtureGit() },
    // The CLI and release tests read these files directly, outside the import graph.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      '**/resources/bin/adar', '**/build/release-notes.md', '**/electron-builder.yml', '**/.github/workflows/release.yml',
      '**/package-lock.json'
    ],
    // Backend integration tests spawn real git and file watchers; on a loaded machine (or a busy CI
    // runner) a single test can take 20 s+, so keep a generous bound instead of flaky timeouts.
    testTimeout: 90000,
    hookTimeout: 60000
  }
})
