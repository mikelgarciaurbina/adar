// Browser-only dev mode: the renderer runs in a normal browser tab and talks to
// src/server/devServer.ts over HTTP instead of Electron IPC. Used for fast UI work
// and automated visual checks. Start with `npm run web`.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = Number(process.env.ADAR_API_PORT || 5899)

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  server: {
    port: Number(process.env.ADAR_WEB_PORT || 5898),
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      // Never add the bridge token here: anything that can reach this port would then be let in.
      // The page sends its own token, received out of band (see src/server/bridge.ts).
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true
      }
    }
  }
})
