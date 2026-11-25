// Holding a letter in a terminal, pure: the accents the Mac offers for it (press and hold, as in any of its text
// fields: hold n, press 1, ñ), and what each key does while they are offered. A terminal gets every repeat of a held
// key as one more key, so Adar offers them itself: the letter typed first gives way to the accent chosen.

/** A held key's accents, in the Mac's order: the number of each is its place, from 1. */
export const ACCENTS: Readonly<Record<string, string>> = {
  a: 'àáâäæãåā',
  A: 'ÀÁÂÄÆÃÅĀ',
  c: 'çćč',
  C: 'ÇĆČ',
  e: 'èéêëēėę',
  E: 'ÈÉÊËĒĖĘ',
  i: 'îïíīįì',
  I: 'ÎÏÍĪĮÌ',
  l: 'ł',
  L: 'Ł',
  n: 'ñń',
  N: 'ÑŃ',
  o: 'ôöòóœøōõ',
  O: 'ÔÖÒÓŒØŌÕ',
  s: 'ßśš',
  S: 'ŚŠ',
  u: 'ûüùúū',
  U: 'ÛÜÙÚŪ',
  y: 'ÿ',
  Y: 'Ÿ',
  z: 'žźż',
  Z: 'ŽŹŻ'
}

/** The accents a key offers when held; none for keys without them. */
export function accentsOf(key: string): string[] {
  return Object.hasOwn(ACCENTS, key) ? [...ACCENTS[key]] : []
}

/** The accents on offer in a terminal: for which key, and which one the arrows reached (-1: none yet). */
export interface AccentMenu {
  id: string
  base: string
  options: string[]
  at: number
}

/** What a key does about the accents. */
export type AccentStep =
  /** Nothing to do with them: the terminal takes the key as always. */
  | { kind: 'pass' }
  /** Theirs, and nothing more to do (the held key repeating while they are offered). */
  | { kind: 'swallow' }
  | { kind: 'open'; menu: AccentMenu }
  | { kind: 'move'; at: number }
  /** This accent takes the place of the letter typed. */
  | { kind: 'choose'; text: string }
  /** They go away; the key then does what it does (`pass`), or nothing more (Esc). */
  | { kind: 'close'; pass: boolean }

type Key = Pick<KeyboardEvent, 'type' | 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'])

/**
 * What a key does in terminal `id`, with `menu` on offer (in this terminal or another) and holding a key for accents
 * `enabled`. Only key presses count: what a key's release does is the terminal's.
 */
export function accentStep(menu: AccentMenu | null, id: string, ev: Key, enabled: boolean): AccentStep {
  if (ev.type !== 'keydown') return { kind: 'pass' }
  const plain = !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.isComposing
  if (menu && menu.id !== id) return { kind: 'close', pass: true }
  if (menu) {
    if (ev.repeat && ev.key === menu.base) return { kind: 'swallow' }
    if (MODIFIERS.has(ev.key)) return { kind: 'pass' }
    const n = plain && /^[1-9]$/.test(ev.key) ? Number(ev.key) : 0
    if (n && n <= menu.options.length) return { kind: 'choose', text: menu.options[n - 1] }
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      const last = menu.options.length - 1
      if (ev.key === 'ArrowRight') return { kind: 'move', at: menu.at >= last ? 0 : menu.at + 1 }
      return { kind: 'move', at: menu.at <= 0 ? last : menu.at - 1 }
    }
    if (ev.key === 'Enter' && menu.at >= 0) return { kind: 'choose', text: menu.options[menu.at] }
    if (ev.key === 'Escape') return { kind: 'close', pass: false }
    return { kind: 'close', pass: true }
  }
  if (enabled && ev.repeat && plain) {
    const options = accentsOf(ev.key)
    if (options.length) return { kind: 'open', menu: { id, base: ev.key, options, at: -1 } }
  }
  return { kind: 'pass' }
}
