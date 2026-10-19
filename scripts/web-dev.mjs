// Starts the browser dev mode: HTTP API bridge (tsx) + Vite renderer server.
// Usage: npm run web   → open http://127.0.0.1:5898
// Env: ADAR_API_PORT (default 5899), ADAR_WEB_PORT (default 5898)
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = {
  ...process.env,
  ADAR_DEV_TOKEN: process.env.ADAR_DEV_TOKEN || randomBytes(24).toString('hex'),
  ADAR_API_PORT: process.env.ADAR_API_PORT || '5899',
  ADAR_WEB_PORT: process.env.ADAR_WEB_PORT || '5898'
}
const bin = (name) => resolve(root, 'node_modules/.bin', name)

const children = [
  spawn(bin('tsx'), ['watch', '--tsconfig', 'tsconfig.node.json', 'src/server/devServer.ts'], { cwd: root, env, stdio: 'inherit' }),
  spawn(bin('vite'), ['--config', 'vite.web.config.ts'], { cwd: root, env, stdio: 'inherit' })
]

const stop = () => {
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', (code) => code && code !== 0 && stop())
