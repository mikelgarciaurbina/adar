import { describe, expect, it } from 'vitest'
import { ANTIALIASED, CHANGED, CHANGED_RGB, SAME, changedAreas, colourDelta, compareImages, differenceImage, type Pixels } from './imageCompare'

type RGBA = [number, number, number, number]
const WHITE: RGBA = [255, 255, 255, 255]
const BLACK: RGBA = [0, 0, 0, 255]

function image(width: number, height: number, fill: RGBA = WHITE): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(fill, i * 4)
  return { width, height, data }
}

function paint(p: Pixels, x: number, y: number, w: number, h: number, colour: RGBA): Pixels {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) p.data.set(colour, (yy * p.width + xx) * 4)
  return p
}

const copy = (p: Pixels): Pixels => ({ ...p, data: new Uint8ClampedArray(p.data) })

describe('image comparison', () => {
  it('measures colour difference as the eye sees it', () => {
    const p = paint(image(3, 1), 1, 0, 1, 1, BLACK)
    paint(p, 2, 0, 1, 1, [255, 255, 255, 0])
    expect(colourDelta(p.data, 0, p.data, 0)).toBe(0)
    expect(colourDelta(p.data, 0, p.data, 4)).toBeCloseTo(32857, 0)
    // A transparent pixel looks white.
    expect(colourDelta(p.data, 0, p.data, 8)).toBe(0)
  })

  it('finds nothing in identical images, and leaves out what the eye barely sees', async () => {
    const a = paint(image(60, 40), 10, 10, 20, 10, [30, 80, 200, 255])
    expect(await compareImages(a, copy(a), { ignoreAntialiasing: true })).toMatchObject({ width: 60, height: 40, changed: 0, areas: [] })
    const b = paint(copy(a), 10, 10, 20, 10, [31, 81, 201, 255])
    expect((await compareImages(a, b, { ignoreAntialiasing: false }))!.changed).toBe(0)
  })

  it('groups changed pixels into areas in reading order', async () => {
    const a = image(400, 300)
    const b = copy(a)
    paint(b, 300, 40, 30, 10, BLACK) // top right
    paint(b, 20, 40, 12, 8, BLACK) // top left, same height: read first
    paint(b, 50, 200, 40, 40, [200, 30, 30, 255]) // lower down
    // Two changes a few pixels apart make one area.
    paint(b, 100, 200, 5, 5, BLACK)
    const cmp = (await compareImages(a, b, { ignoreAntialiasing: true }))!
    expect(cmp.changed).toBe(30 * 10 + 12 * 8 + 40 * 40 + 25)
    expect(cmp.areas).toEqual([
      { x: 20, y: 40, width: 12, height: 8 },
      { x: 300, y: 40, width: 30, height: 10 },
      { x: 50, y: 200, width: 55, height: 40 }
    ])
    expect(cmp.mask[40 * 400 + 20]).toBe(CHANGED)
    expect(cmp.mask[0]).toBe(SAME)
  })

  it('lines images of different sizes up at the top left, and counts what only one has as changed', async () => {
    const a = image(50, 40)
    const b = image(50, 60)
    const cmp = (await compareImages(a, b, { ignoreAntialiasing: true }))!
    expect(cmp).toMatchObject({ width: 50, height: 60, changed: 50 * 20 })
    expect(cmp.areas).toEqual([{ x: 0, y: 40, width: 50, height: 20 }])
  })

  it('leaves out anti-aliased edges when asked', async () => {
    // A black and white edge; After has a grey column on it, as a smoothed edge would.
    const a = paint(image(20, 12), 0, 0, 10, 12, BLACK)
    const b = paint(copy(a), 10, 0, 1, 12, [128, 128, 128, 255])
    const ignoring = (await compareImages(a, b, { ignoreAntialiasing: true }))!
    expect(ignoring.changed).toBe(0)
    expect(ignoring.mask[5 * 20 + 10]).toBe(ANTIALIASED)
    expect(ignoring.areas).toEqual([])
    const strict = (await compareImages(a, b, { ignoreAntialiasing: false }))!
    expect(strict.changed).toBe(12)
    expect(strict.areas).toEqual([{ x: 10, y: 0, width: 1, height: 12 }])
    // A real change is never taken for anti-aliasing.
    const moved = paint(copy(a), 10, 0, 4, 12, BLACK)
    expect((await compareImages(a, moved, { ignoreAntialiasing: true }))!.changed).toBe(48)
  })

  it('stops when cancelled', async () => {
    const a = image(2000, 400)
    expect(await compareImages(a, copy(a), { ignoreAntialiasing: true }, () => true)).toBeNull()
  })

  it('reads areas on one line from left to right, even when the right one starts higher', () => {
    const width = 300
    const mask = new Uint8Array(width * 100)
    const fill = (x: number, y: number, w: number, h: number) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) mask[yy * width + xx] = CHANGED
    }
    fill(200, 40, 60, 20) // a button, two pixels higher
    fill(20, 42, 30, 12) // a price on its left
    fill(100, 80, 10, 10) // below both
    expect(changedAreas(mask, width, 100).map((a) => a.x)).toEqual([20, 200, 100])
  })

  it('merges boxes that overlap, and lists a noisy image as it is', () => {
    const width = 200
    const height = 200
    const mask = new Uint8Array(width * height)
    // An L shape far apart at its ends, around a dot inside its box.
    for (let x = 0; x < 180; x++) mask[10 * width + x] = CHANGED
    for (let y = 10; y < 190; y++) mask[y * width + 179] = CHANGED
    mask[100 * width + 60] = CHANGED
    expect(changedAreas(mask, width, height)).toEqual([{ x: 0, y: 10, width: 180, height: 180 }])
  })

  it('paints the Difference picture: changes in red over a faded After', async () => {
    const a = paint(image(4, 1), 0, 0, 1, 1, BLACK)
    const b = paint(copy(a), 3, 0, 1, 1, BLACK)
    const cmp = (await compareImages(a, b, { ignoreAntialiasing: false }))!
    const out = differenceImage(a, b, cmp)
    expect([...out.slice(12, 16)]).toEqual([...CHANGED_RGB, 255])
    expect([...out.slice(4, 8)]).toEqual([255, 255, 255, 255])
    // Unchanged black fades to a light grey.
    expect(out[0]).toBe(199)
  })
})
