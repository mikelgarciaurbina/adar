// Renders build/icon.svg to transparent PNGs and the macOS .icns (keeps the alpha channel;
// Quick Look's qlmanage paints transparent corners white, so it must not be used for icons).
// Every iconset size is rasterised from the SVG, so the small ones stay crisp.
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
  win.webContents.setFrameRate(30)
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace(
    /<svg /,
    '<svg id="icon" style="display:block;width:1024px;height:1024px" '
  )}</body></html>`
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))

  const render = async (size) => {
    await win.webContents.executeJavaScript(`document.getElementById('icon').style.width = document.getElementById('icon').style.height = '${size}px'`)
    await new Promise((r) => setTimeout(r, 400))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    return image.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }

  const set = fs.mkdtempSync(path.join(os.tmpdir(), 'adar-iconset-')) + '/icon.iconset'
  fs.mkdirSync(set)
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const png = await render(size)
    // 64 px is only the @2x of 32 px; iconutil rejects a plain icon_64x64.
    if (size <= 512 && size !== 64) fs.writeFileSync(`${set}/icon_${size}x${size}.png`, png)
    if (size >= 32) fs.writeFileSync(`${set}/icon_${size / 2}x${size / 2}@2x.png`, png)
    if (size === 1024) {
      fs.writeFileSync(path.join(root, 'build/icon.png'), png)
      fs.writeFileSync(path.join(root, 'resources/icon.png'), png)
    }
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'build/icon.icns')])
  fs.rmSync(path.dirname(set), { recursive: true, force: true })
  console.log('Rendered build/icon.png, resources/icon.png and build/icon.icns')
  app.quit()
})
