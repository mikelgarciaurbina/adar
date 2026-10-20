// Renders build/icon.svg to transparent PNGs and the macOS .icns (keeps the alpha channel;
// Quick Look's qlmanage paints transparent corners white, so it must not be used for icons).
//   ./node_modules/.bin/electron scripts/render-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8')

app.dock?.hide()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  win.webContents.setFrameRate(1)
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace(
    /<svg /,
    '<svg style="display:block;width:1024px;height:1024px" '
  )}</body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
  await new Promise((r) => setTimeout(r, 400))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const png = image.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG()
  const out = path.join(root, 'build/icon.png')
  fs.writeFileSync(out, png)
  fs.copyFileSync(out, path.join(root, 'resources/icon.png'))

  // .icns via iconutil (sips keeps transparency when resizing PNGs).
  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'adar-iconset-')) + '/icon.iconset'
  fs.mkdirSync(set)
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), out, '--out', `${set}/icon_${s}x${s}.png`], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), out, '--out', `${set}/icon_${s}x${s}@2x.png`], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'build/icon.icns')])
  fs.rmSync(path.dirname(set), { recursive: true, force: true })
  console.log('Rendered build/icon.png, resources/icon.png and build/icon.icns')
  app.quit()
})
