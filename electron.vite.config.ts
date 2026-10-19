import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')
const version = (process.env['ADAR_VERSION_OVERRIDE'] ||
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version) as string

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    define: { __ADAR_VERSION__: JSON.stringify(version) }
  },
  preload: {
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
