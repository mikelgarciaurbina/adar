// Starts the browser dev mode: HTTP API bridge (tsx) + Vite renderer server.
// Usage: npm run web   → open the http://127.0.0.1:5898/#t=<token> URL it prints
// Env: ADAR_API_PORT (default 5899), ADAR_WEB_PORT (default 5898), ADAR_DEV_TOKEN (default: random)
//
// The token authenticates the browser tab to the API bridge (which can run any git command). Only
// the bridge process gets it; the page receives it out of band in the URL fragment (never sent to a
// server) and keeps it in sessionStorage. It is also written to .adar-dev-token (owner-only, removed
// on exit) for local automation.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const token = process.env.ADAR_DEV_TOKEN || randomBytes(24).toString('hex')
const webPort = process.env.ADAR_WEB_PORT || '5898'
const env = {
  ...process.env,
  ADAR_API_PORT: process.env.ADAR_API_PORT || '5899',
  ADAR_WEB_PORT: webPort
}
delete env.ADAR_DEV_TOKEN
const bin = (name) => resolve(root, 'node_modules/.bin', name)
const tokenFile = resolve(root, '.adar-dev-token')

const children = [
  spawn(bin('tsx'), ['watch', '--tsconfig', 'tsconfig.node.json', 'src/server/devServer.ts'], {
    cwd: root,
    env: { ...env, ADAR_DEV_TOKEN: token },
    stdio: 'inherit'
  }),
  spawn(bin('vite'), ['--config', 'vite.web.config.ts'], { cwd: root, env, stdio: 'inherit' })
]

try {
  rmSync(tokenFile, { force: true })
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 })
} catch {
  /* optional convenience */
}
// After Vite's own banner (whose URL has no token and would get 403 from the bridge).
setTimeout(() => {
  console.log(`\n  ➜  Adar web: http://127.0.0.1:${webPort}/#t=${token}\n     (the #t= part is the API token; open this exact URL)\n`)
}, 1500)

const stop = () => {
  for (const c of children) c.kill('SIGTERM')
  rmSync(tokenFile, { force: true })
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', (code) => code && code !== 0 && stop())
