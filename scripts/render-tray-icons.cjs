// Renders the menu bar icons (macOS template images: black on transparent, macOS tints them) into
// resources/tray: the antlers at rest, with the "new commits" dot, and the four frames of the fetch
// animation (the commits light up from the root to the tips). 18 pt with @2x versions.
//   ./node_modules/.bin/electron scripts/render-tray-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const out = path.resolve(__dirname, '../resources/tray')

const TRUNK = '<path d="M32 55V45"/>'
const BEAMS = '<path d="M32 45C25 42 12 38 11 24C10.5 17 12 12 15.5 7.5"/><path d="M32 45C39 42 52 38 53 24C53.5 17 52 12 48.5 7.5"/>'
const TINES = '<path d="M11.6 31C18 29.5 23 26 24.5 19.5"/><path d="M52.4 31C46 29.5 41 26 39.5 19.5"/>'
const ROOT = '<circle cx="32" cy="55.5" r="6" fill="#000" stroke="none"/>'
const TINE_TIPS = '<circle cx="24.6" cy="19" r="4.8" fill="#000" stroke="none"/><circle cx="39.4" cy="19" r="4.8" fill="#000" stroke="none"/>'
const TIPS = '<circle cx="15.5" cy="7.5" r="5.2" fill="#000" stroke="none"/><circle cx="48.5" cy="7.5" r="5.2" fill="#000" stroke="none"/>'
/** Fetch frames: the parts lit so far are solid, the rest faint. */
const STAGES = [TRUNK + ROOT, BEAMS, TINES + TINE_TIPS, TIPS]
const DIM = 0.3

function mark(lit) {
  return STAGES.map((part, i) => `<g opacity="${i < lit ? 1 : DIM}">${part}</g>`).join('')
}

function svg(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round">${body}</svg>`
}

const ICONS = {
  trayTemplate: mark(4),
  // The dot is cut out of the mark so it reads on its own at 18 pt.
  trayNewTemplate: `<defs><mask id="m"><rect width="64" height="64" fill="#fff"/><circle cx="54" cy="51" r="11.5" fill="#000"/></mask></defs><g mask="url(#m)">${mark(4)}</g><circle cx="54" cy="51" r="7.5" fill="#000" stroke="none"/>`,
  trayFetch1Template: mark(1),
  trayFetch2Template: mark(2),
  trayFetch3Template: mark(3),
  trayFetch4Template: mark(4)
}

app.dock?.hide()
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true })
  const win = new BrowserWindow({ width: 64, height: 64, show: false, frame: false, transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(30)
  for (const [name, body] of Object.entries(ICONS)) {
    for (const [suffix, size] of [['', 18], ['@2x', 36]]) {
      const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg(size, body)}</body></html>`
      await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
      await new Promise((r) => setTimeout(r, 300))
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
      const file = path.join(out, `${name}${suffix}.png`)
      fs.writeFileSync(file, image.resize({ width: size, height: size, quality: 'best' }).toPNG())
      console.log('wrote', path.relative(process.cwd(), file))
    }
  }
  app.quit()
})
