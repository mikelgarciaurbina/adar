// Custom tab group colours: reading what the user types, and drawing one colour in both themes.
// Each theme keeps the colour's hue and chroma (OKLCH) and moves only its lightness into the range
// the eight Basoa group colours sit in, so a pale or a very dark pick still reads on Gaua and Eguna.

import type { CustomGroupColor, GroupColor } from './types'

/** "#E8559A", "e8559a" or "#E59" → "#e8559a"; null when it is not a colour. */
export function normalizeHexColor(raw: unknown): CustomGroupColor | null {
  if (typeof raw !== 'string') return null
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${hex.toLowerCase()}`
}

export function isCustomGroupColor(color: GroupColor): color is CustomGroupColor {
  return color.startsWith('#')
}

/** Lightness (OKLCH) of a group's line, dot and name in Gaua; of its line and dot, and of its name, in Eguna. */
const NIGHT: Range = [0.74, 0.92]
const DAY_LINE: Range = [0.5, 0.66]
const DAY_INK: Range = [0.4, 0.49]
type Range = readonly [number, number]

export interface GroupColorVariants {
  /** Gaua: line, dot and name. */
  night: CustomGroupColor
  /** Eguna: line and dot. */
  day: CustomGroupColor
  /** Eguna: the name. */
  dayInk: CustomGroupColor
}

export function groupColorVariants(color: CustomGroupColor): GroupColorVariants {
  const [l, c, h] = toOklch(color)
  const at = ([lo, hi]: Range) => fromOklch(Math.min(hi, Math.max(lo, l)), c, h)
  return { night: at(NIGHT), day: at(DAY_LINE), dayInk: at(DAY_INK) }
}

// ── HSV, for the picker's square (saturation × brightness) and hue bar ─────────────────────────

export interface Hsv {
  /** 0…360 */
  h: number
  /** 0…1 */
  s: number
  /** 0…1 */
  v: number
}

export function hexToHsv(color: CustomGroupColor): Hsv {
  const [r, g, b] = channels(color)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): CustomGroupColor {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return toHex([f(5), f(3), f(1)])
}

// ── sRGB ↔ OKLCH ──────────────────────────────────────────────────────────────────────────────

function channels(color: CustomGroupColor): [number, number, number] {
  const n = parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255) as [number, number, number]
}

function toHex(rgb: number[]): CustomGroupColor {
  return `#${rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
const fromLinear = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

function toOklch(color: CustomGroupColor): [number, number, number] {
  const [r, g, b] = channels(color).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}

function linearRgb(L: number, C: number, h: number): [number, number, number] {
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}

const inGamut = (rgb: number[]) => rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4)

/** The colour at this lightness and hue, with the chroma lowered only as far as sRGB needs. */
function fromOklch(L: number, C: number, h: number): CustomGroupColor {
  let rgb = linearRgb(L, C, h)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = C
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(linearRgb(L, mid, h))) lo = mid
      else hi = mid
    }
    rgb = linearRgb(L, lo, h)
  }
  return toHex(rgb.map((x) => fromLinear(Math.max(0, x))))
}
