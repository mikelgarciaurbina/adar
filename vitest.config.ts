import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Backend integration tests spawn real git and file watchers; on a loaded machine (or a busy CI
    // runner) a single test can take 20 s+, so keep a generous bound instead of flaky timeouts.
    testTimeout: 90000,
    hookTimeout: 60000
  }
})
