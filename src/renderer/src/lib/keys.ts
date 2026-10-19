import { isMac } from '@renderer/api/client'

/** True when keyboard focus is in a text field (so global shortcuts should not fire). */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Cmd on macOS, Ctrl elsewhere. */
export function isMod(e: KeyboardEvent | React.KeyboardEvent | React.MouseEvent | MouseEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

/** Display label for shortcuts: "⌘⇧S" on mac, "Ctrl+Shift+S" elsewhere. */
export function shortcutLabel(spec: string): string {
  const parts = spec.split('+')
  if (isMac) {
    return parts
      .map((p) =>
        p === 'Mod' ? '⌘' : p === 'Shift' ? '⇧' : p === 'Alt' ? '⌥' : p === 'Ctrl' ? '⌃' : p === 'Enter' ? '↩' : p === 'Up' ? '↑' : p === 'Down' ? '↓' : p
      )
      .join('')
  }
  return parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)).join('+')
}
