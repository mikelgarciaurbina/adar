// When a freshly mounted diff may take the keyboard focus. Opening a file from
// the right panel's file list (or the left panel) must leave the focus there so
// the arrow keys keep walking through the files while the diff follows along.

/**
 * Containers that own the keyboard while focused: lists and trees with arrow-key
 * navigation, the side panels, dialogs and menus.
 */
export const KEEP_FOCUS_SELECTOR = [
  '[role="listbox"]',
  '[role="tree"]',
  '[role="grid"]',
  '[role="list"]',
  '[role="dialog"]',
  '[role="menu"]',
  '.app-left',
  '.app-right',
  '.det-root',
  '.sb-root',
  '.ui-backdrop',
  '.ui-menu'
].join(', ')

/**
 * Whether a newly shown diff should move the focus to itself: yes when nothing in
 * particular has the focus (the body, or an element that was just unmounted),
 * no when the user is in a text field or in another keyboard-navigable list.
 */
export function shouldTakeFocus(active: Element | null | undefined, own?: Pick<Node, 'contains'> | null): boolean {
  if (!active || active.tagName === 'BODY' || active.tagName === 'HTML') return true
  // Already inside the diff (nothing to do), or somewhere that keeps the keyboard.
  if (own?.contains(active)) return false
  const tag = active.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active as HTMLElement).isContentEditable) return false
  return !active.closest(KEEP_FOCUS_SELECTOR)
}
