// Graph lanes take the Basoa palette in the website's order (fern, moss, sea, heather, ember, sun).
// The values live in theme.css (--lane-1…6), so each theme can tune them; avatars borrow the same six.

export const LANE_COUNT = 6

/** Position (0…5) of a lane in the palette. */
export function lanePaletteIndex(lane: number): number {
  return ((lane % LANE_COUNT) + LANE_COUNT) % LANE_COUNT
}

/** CSS colour of a lane: lines, nodes and washes. */
export function laneColor(lane: number): string {
  return `var(--lane-${lanePaletteIndex(lane) + 1})`
}

/** CSS colour for text on a lane's wash (deeper than the lane in the light theme). */
export function laneInk(lane: number): string {
  return `var(--lane-${lanePaletteIndex(lane) + 1}-ink)`
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stable lane for an author/email or a remote, so avatars belong to the same palette. */
export function laneForString(s: string): number {
  return hashString(s.toLowerCase()) % LANE_COUNT
}

/** Background and text colours of an avatar-like badge for `s`. */
export function badgeColorsFor(s: string): { background: string; color: string } {
  const lane = laneForString(s)
  return { background: `color-mix(in srgb, ${laneColor(lane)} 22%, var(--bg-1))`, color: laneInk(lane) }
}

export function initials(name: string): string {
  const parts = name
    .replace(/[<>@].*$/, '')
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
