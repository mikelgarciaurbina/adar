// Pixel comparison for the image diff: which pixels changed (perceived colour difference in YIQ,
// optionally leaving out anti-aliased edges), the changed areas N / P go through, and the
// "Difference" picture. Pure: works on RGBA buffers, so it is tested without a canvas.

export interface Pixels {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8ClampedArray
}

export interface Area {
  x: number
  y: number
  width: number
  height: number
}

export interface Comparison {
  /** The compared surface: both images lined up at the top left, as large as the larger of the two. */
  width: number
  height: number
  /** Per pixel: SAME, CHANGED or ANTIALIASED (a changed pixel left out as an anti-aliased edge). */
  mask: Uint8Array
  changed: number
  /** Changed areas in reading order: rows from top to bottom, left to right in each row. */
  areas: Area[]
}

export const SAME = 0
export const CHANGED = 1
export const ANTIALIASED = 2

export interface CompareOptions {
  /** Leave out the faint edge differences screenshots get from another machine or font smoothing. */
  ignoreAntialiasing: boolean
  /** 0–1: how different two colours must look to count (0.1 ignores what the eye barely sees). */
  threshold?: number
}

/** Areas listed at most (a noisy image would otherwise list thousands). */
export const MAX_AREAS = 500
/** Images larger than this (both sides together) are not compared pixel by pixel. */
export const MAX_COMPARE_PIXELS = 40_000_000

/** The largest YIQ difference there is (black against white). */
const MAX_DELTA = 35215

/** A pixel's colour as seen on white (transparent parts count as white). */
function onWhite(d: Uint8ClampedArray, i: number): [number, number, number] {
  const a = d[i + 3] / 255
  return [255 + (d[i] - 255) * a, 255 + (d[i + 1] - 255) * a, 255 + (d[i + 2] - 255) * a]
}

const luma = (r: number, g: number, b: number) => r * 0.29889531 + g * 0.58662247 + b * 0.11448223

/**
 * Perceived difference between two pixels: squared distance in YIQ, weighted as in Kotsarenko and Ramos,
 * "Measuring perceived color difference using YIQ NTSC transmission color space" (2010).
 */
export function colourDelta(a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number): number {
  if (a[i] === b[j] && a[i + 1] === b[j + 1] && a[i + 2] === b[j + 2] && a[i + 3] === b[j + 3]) return 0
  const [r1, g1, b1] = onWhite(a, i)
  const [r2, g2, b2] = onWhite(b, j)
  const y = luma(r1, g1, b1) - luma(r2, g2, b2)
  const iq = r1 * 0.59597799 - g1 * 0.2741761 - b1 * 0.32180189 - (r2 * 0.59597799 - g2 * 0.2741761 - b2 * 0.32180189)
  const q = r1 * 0.21147017 - g1 * 0.52261711 + b1 * 0.31114694 - (r2 * 0.21147017 - g2 * 0.52261711 + b2 * 0.31114694)
  return 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q
}

/** Brightness of a pixel on white. */
function brightness(p: Pixels, x: number, y: number): number {
  const [r, g, b] = onWhite(p.data, (y * p.width + x) * 4)
  return luma(r, g, b)
}

function samePixel(p: Pixels, x1: number, y1: number, x2: number, y2: number): boolean {
  const i = (y1 * p.width + x1) * 4
  const j = (y2 * p.width + x2) * 4
  const d = p.data
  return d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2] && d[i + 3] === d[j + 3]
}

/** At least three of the pixel's neighbours have its exact colour (the image edge counts as one). */
function inFlatArea(p: Pixels, x: number, y: number): boolean {
  let same = x === 0 || y === 0 || x === p.width - 1 || y === p.height - 1 ? 1 : 0
  for (let ny = Math.max(0, y - 1); ny <= Math.min(p.height - 1, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(p.width - 1, x + 1); nx++) {
      if ((nx !== x || ny !== y) && samePixel(p, x, y, nx, ny) && ++same > 2) return true
    }
  }
  return false
}

/**
 * An anti-aliased edge pixel in `p` (after V. Vysniauskas, "Anti-aliased pixel and intensity slope detector",
 * 2009): it sits between a darker and a brighter neighbour, has few neighbours of its own colour, and the
 * darkest or the brightest neighbour lies in a flat area in both images.
 */
export function isAntialiased(p: Pixels, x: number, y: number, other: Pixels): boolean {
  if (x >= other.width || y >= other.height) return false
  let same = x === 0 || y === 0 || x === p.width - 1 || y === p.height - 1 ? 1 : 0
  const own = brightness(p, x, y)
  let darkest = 0
  let brightest = 0
  let dx = -1
  let dy = -1
  let bx = -1
  let by = -1
  for (let ny = Math.max(0, y - 1); ny <= Math.min(p.height - 1, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(p.width - 1, x + 1); nx++) {
      if (nx === x && ny === y) continue
      const delta = brightness(p, nx, ny) - own
      if (delta === 0) {
        if (++same > 2) return false
      } else if (delta < darkest) {
        darkest = delta
        dx = nx
        dy = ny
      } else if (delta > brightest) {
        brightest = delta
        bx = nx
        by = ny
      }
    }
  }
  if (darkest === 0 || brightest === 0) return false
  const flat = (cx: number, cy: number) => cx < other.width && cy < other.height && inFlatArea(p, cx, cy) && inFlatArea(other, cx, cy)
  return flat(dx, dy) || flat(bx, by)
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Compare `before` and `after`, lined up at the top left. Where only one image has pixels, they count as
 * changed. Yields to the event loop between chunks of rows so a large image does not freeze the window;
 * `cancelled()` stops it (the result is then null).
 */
export async function compareImages(before: Pixels, after: Pixels, opts: CompareOptions, cancelled: () => boolean = () => false): Promise<Comparison | null> {
  const width = Math.max(before.width, after.width)
  const height = Math.max(before.height, after.height)
  const mask = new Uint8Array(width * height)
  const limit = MAX_DELTA * (opts.threshold ?? 0.1) ** 2
  let changed = 0
  const rowsPerChunk = Math.max(1, Math.floor(400_000 / Math.max(1, width)))
  for (let y = 0; y < height; y++) {
    if (y > 0 && y % rowsPerChunk === 0) {
      await pause()
      if (cancelled()) return null
    }
    for (let x = 0; x < width; x++) {
      const k = y * width + x
      const inBefore = x < before.width && y < before.height
      const inAfter = x < after.width && y < after.height
      if (!inBefore || !inAfter) {
        mask[k] = CHANGED
        changed++
        continue
      }
      const delta = colourDelta(before.data, (y * before.width + x) * 4, after.data, (y * after.width + x) * 4)
      if (delta <= limit) continue
      if (opts.ignoreAntialiasing && (isAntialiased(before, x, y, after) || isAntialiased(after, x, y, before))) {
        mask[k] = ANTIALIASED
        continue
      }
      mask[k] = CHANGED
      changed++
    }
  }
  if (cancelled()) return null
  return { width, height, mask, changed, areas: changedAreas(mask, width, height) }
}

/**
 * Group changed pixels into areas: the surface is cut into square cells, cells with a change that touch or
 * are one cell apart join one area, and each area is the box around its changed pixels. Boxes that still
 * overlap are merged.
 */
export function changedAreas(mask: Uint8Array, width: number, height: number): Area[] {
  const cell = Math.max(8, Math.round(Math.max(width, height) / 150))
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  // Per cell: the box around its changed pixels (minX, minY, maxX, maxY), or none.
  const boxes = new Int32Array(cols * rows * 4).fill(-1)
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / cell) * cols
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== CHANGED) continue
      const c = (row + Math.floor(x / cell)) * 4
      if (boxes[c] < 0) {
        boxes[c] = x
        boxes[c + 1] = y
        boxes[c + 2] = x
        boxes[c + 3] = y
      } else {
        if (x < boxes[c]) boxes[c] = x
        if (x > boxes[c + 2]) boxes[c + 2] = x
        boxes[c + 3] = y
      }
    }
  }

  const seen = new Uint8Array(cols * rows)
  let areas: Area[] = []
  const stack: number[] = []
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || boxes[start * 4] < 0) continue
    seen[start] = 1
    stack.push(start)
    let minX = Infinity
    let minY = Infinity
    let maxX = -1
    let maxY = -1
    while (stack.length) {
      const c = stack.pop()!
      minX = Math.min(minX, boxes[c * 4])
      minY = Math.min(minY, boxes[c * 4 + 1])
      maxX = Math.max(maxX, boxes[c * 4 + 2])
      maxY = Math.max(maxY, boxes[c * 4 + 3])
      const cx = c % cols
      const cy = (c - cx) / cols
      for (let ny = Math.max(0, cy - 2); ny <= Math.min(rows - 1, cy + 2); ny++) {
        for (let nx = Math.max(0, cx - 2); nx <= Math.min(cols - 1, cx + 2); nx++) {
          const n = ny * cols + nx
          if (seen[n] || boxes[n * 4] < 0) continue
          seen[n] = 1
          stack.push(n)
        }
      }
    }
    areas.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
  }

  // Boxes of separate groups can still overlap (an L-shaped change around another): merge until none do.
  // A noisy image (thousands of groups) is listed as it is.
  let merged = areas.length <= MAX_AREAS * 4
  while (merged) {
    merged = false
    outer: for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        if (overlap(areas[i], areas[j])) {
          areas[i] = union(areas[i], areas[j])
          areas.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return readingOrder(areas).slice(0, MAX_AREAS)
}

/** Rows from top to bottom (areas whose heights overlap share a row), left to right in each row. */
function readingOrder(areas: Area[]): Area[] {
  const out: Area[] = []
  let row: Area[] = []
  let bottom = -1
  for (const a of [...areas].sort((p, q) => p.y - q.y || p.x - q.x)) {
    if (row.length && a.y >= bottom) {
      out.push(...row.sort((p, q) => p.x - q.x))
      row = []
    }
    row.push(a)
    bottom = Math.max(row.length === 1 ? 0 : bottom, a.y + a.height)
  }
  out.push(...row.sort((p, q) => p.x - q.x))
  return out
}

const overlap = (a: Area, b: Area) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const union = (a: Area, b: Area): Area => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** The red of changed pixels in the Difference picture (the same in both themes: it is drawn on white). */
export const CHANGED_RGB = [229, 72, 45] as const

/**
 * The Difference picture: changed pixels in red over After faded to a light grey (Before where After has
 * no pixels), so even a one-pixel change stands out.
 */
export function differenceImage(before: Pixels, after: Pixels, cmp: Comparison): Uint8ClampedArray {
  const { width, height, mask } = cmp
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x
      const o = k * 4
      out[o + 3] = 255
      if (mask[k] === CHANGED) {
        out[o] = CHANGED_RGB[0]
        out[o + 1] = CHANGED_RGB[1]
        out[o + 2] = CHANGED_RGB[2]
        continue
      }
      const src = x < after.width && y < after.height ? after : before
      const [r, g, b] = onWhite(src.data, (y * src.width + x) * 4)
      const faded = 255 - (255 - luma(r, g, b)) * 0.22
      out[o] = faded
      out[o + 1] = faded
      out[o + 2] = faded
    }
  }
  return out
}
