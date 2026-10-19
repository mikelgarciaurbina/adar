// Graph lane palette (vivid, readable on dark and light backgrounds) and
// deterministic per-string colours for avatars.

export const LANE_COLORS = [
  '#1fb6d4', // cyan
  '#3d7cf5', // blue
  '#9b4dff', // violet
  '#e044c8', // magenta
  '#f0306e', // pink-red
  '#f2553a', // orange-red
  '#f59a23', // orange
  '#f2cb2e', // yellow
  '#7fd13b', // lime
  '#2fcc8f' // green
] as const

export function laneColor(lane: number): string {
  return LANE_COLORS[((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length]
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stable muted colour for an author/email. */
export function colorForString(s: string): string {
  const h = hashString(s.toLowerCase()) % 360
  return `hsl(${h} 55% 45%)`
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
