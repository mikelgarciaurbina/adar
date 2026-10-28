import { describe, expect, it } from 'vitest'
import { groupColorVariants, hexToHsv, hsvToHex, normalizeHexColor } from './groupColor'
import type { CustomGroupColor } from './types'

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Tab bar backgrounds: Gaua's and Eguna's --chrome. */
const GAUA = '#050706'
const EGUNA = '#e6e3d8'

describe('group colours', () => {
  it('reads #rrggbb, rrggbb and #rgb, and nothing else', () => {
    expect(normalizeHexColor('#E8559A')).toBe('#e8559a')
    expect(normalizeHexColor(' e8559a ')).toBe('#e8559a')
    expect(normalizeHexColor('#E59')).toBe('#ee5599')
    for (const bad of ['', '#', '#e8559', '#e8559a0', 'red', 'rgb(0,0,0)', 12, null]) expect(normalizeHexColor(bad)).toBeNull()
  })

  it('draws a colour lighter in Gaua and deeper in Eguna, keeping what is already in range', () => {
    expect(groupColorVariants('#e8559a')).toEqual({ night: '#ff73b1', day: '#e75499', dayInk: '#ab1167' })
    // A pale yellow and a navy: as picked they would vanish on one of the themes.
    const butter = groupColorVariants('#fff2a6')
    const navy = groupColorVariants('#1f2e7a')
    expect(contrast('#fff2a6', EGUNA)).toBeLessThan(1.5)
    expect(contrast('#1f2e7a', GAUA)).toBeLessThan(2)
    expect(contrast(butter.dayInk, EGUNA)).toBeGreaterThan(4.5)
    expect(contrast(navy.night, GAUA)).toBeGreaterThan(7)
    // The Basoa lanes sit in these ranges already: Gaua's fern and ember come back as they are.
    expect(groupColorVariants('#c5f56a').night).toBe('#c5f56a')
    expect(groupColorVariants('#ff8c5f').night).toBe('#ff8c5f')
  })

  it('keeps every group name readable on the tab bar, whatever the colour', () => {
    for (let h = 0; h < 360; h += 15) {
      for (const s of [0, 0.4, 1]) {
        for (const v of [0.1, 0.5, 1]) {
          const color = hsvToHex({ h, s, v })
          const { night, dayInk } = groupColorVariants(color)
          expect(contrast(night, GAUA), `${color} in Gaua`).toBeGreaterThanOrEqual(7)
          expect(contrast(dayInk, EGUNA), `${color} in Eguna`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('converts to and from hue, saturation and brightness', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
    for (const c of ['#e8559a', '#00b8c4', '#7a2d8c', '#808080', '#000000'] as CustomGroupColor[]) expect(hsvToHex(hexToHsv(c))).toBe(c)
  })
})
