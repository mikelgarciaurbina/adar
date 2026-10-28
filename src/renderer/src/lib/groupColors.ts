// Tab group colours in CSS: a Basoa colour is its theme token (--group-<name>, tuned per theme in
// theme.css); a custom one is drawn with light-dark(), Eguna's version first, so it follows the theme
// like the tokens do (the variants come from shared/groupColor.ts). Also the picker's Recent row.

import { groupColorVariants, isCustomGroupColor } from '@shared/groupColor'
import type { CustomGroupColor, GroupColor, TabGroup, TabGroupColor } from '@shared/types'

export const GROUP_COLOR_LABELS: Record<TabGroupColor, string> = {
  fern: 'Fern',
  moss: 'Moss',
  sea: 'Sea',
  heather: 'Heather',
  ember: 'Ember',
  sun: 'Sun',
  bone: 'Bone',
  mist: 'Mist'
}

/** Recent custom colours kept in settings (the picker shows them with the ones other groups use). */
export const RECENT_GROUP_COLORS = 6

/** CSS colour of a group's line, tint and dot. */
export function groupLine(color: GroupColor): string {
  if (!isCustomGroupColor(color)) return `var(--group-${color})`
  const v = groupColorVariants(color)
  return `light-dark(${v.day}, ${v.night})`
}

/** CSS colour of a group's name. */
export function groupInk(color: GroupColor): string {
  if (!isCustomGroupColor(color)) return `var(--group-${color}-ink)`
  const v = groupColorVariants(color)
  return `light-dark(${v.dayInk}, ${v.night})`
}

/** "Ember", or "#E8559A" for a custom colour. */
export function groupColorLabel(color: GroupColor): string {
  return isCustomGroupColor(color) ? color.toUpperCase() : GROUP_COLOR_LABELS[color]
}

/** Custom colours groups use (with the first group using each), in group order. */
export function customColorsInUse(groups: readonly Pick<TabGroup, 'name' | 'color'>[]): Array<{ color: CustomGroupColor; group: string }> {
  const out: Array<{ color: CustomGroupColor; group: string }> = []
  for (const g of groups) {
    if (isCustomGroupColor(g.color) && !out.some((x) => x.color === g.color)) out.push({ color: g.color, group: g.name || 'Unnamed group' })
  }
  return out
}

/** The picker's Recent row: the colours other groups use, then the ones picked lately, without repeats. */
export function recentColorChoices(groups: readonly Pick<TabGroup, 'name' | 'color'>[], recent: readonly CustomGroupColor[], max = 8): Array<{ color: CustomGroupColor; group?: string }> {
  const out: Array<{ color: CustomGroupColor; group?: string }> = customColorsInUse(groups)
  for (const c of recent) if (!out.some((x) => x.color === c)) out.push({ color: c })
  return out.slice(0, max)
}

/** Settings' recent colours after picking `color` (newest first). */
export function rememberGroupColor(recent: readonly CustomGroupColor[], color: GroupColor): CustomGroupColor[] {
  if (!isCustomGroupColor(color)) return [...recent]
  return [color, ...recent.filter((c) => c !== color)].slice(0, RECENT_GROUP_COLORS)
}
