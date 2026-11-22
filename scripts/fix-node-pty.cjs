// node-pty 1.1.0 ships its macOS prebuilds without the execute bit on spawn-helper, the small program every
// terminal is started through, so the first spawn fails with "posix_spawnp failed". Runs after `npm install` /
// `npm ci` (postinstall), which is also where a packaged build takes its copy from.
const fs = require('node:fs')
const path = require('node:path')

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
let dirs = []
try {
  dirs = fs.readdirSync(prebuilds)
} catch {
  // node-pty built from source (Linux), or not installed yet: nothing to fix.
}
for (const dir of dirs) {
  const helper = path.join(prebuilds, dir, 'spawn-helper')
  try {
    if (fs.statSync(helper).isFile()) fs.chmodSync(helper, 0o755)
  } catch {
    // No helper for this platform (Windows).
  }
}
