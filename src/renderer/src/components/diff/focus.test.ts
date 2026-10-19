import { describe, expect, it } from 'vitest'
import { KEEP_FOCUS_SELECTOR, shouldTakeFocus } from './focus'

/** Minimal stand-in for a DOM element: a tag and the selectors it sits inside. */
function el(tagName: string, within: string[] = [], extra: Partial<{ isContentEditable: boolean }> = {}): Element {
  const selectors = KEEP_FOCUS_SELECTOR.split(', ')
  return {
    tagName,
    isContentEditable: !!extra.isContentEditable,
    closest: (sel: string) => (sel.split(', ').some((s) => selectors.includes(s) && within.includes(s)) ? {} : null)
  } as unknown as Element
}

const container = (...inside: Element[]) => ({ contains: (n: Node | null) => inside.includes(n as unknown as Element) })

describe('shouldTakeFocus', () => {
  it('takes the focus when nothing in particular has it', () => {
    expect(shouldTakeFocus(null)).toBe(true)
    expect(shouldTakeFocus(undefined)).toBe(true)
    expect(shouldTakeFocus(el('BODY'))).toBe(true)
    expect(shouldTakeFocus(el('HTML'))).toBe(true)
  })

  it('leaves the focus in the right panel file list so arrow keys keep walking the files', () => {
    expect(shouldTakeFocus(el('DIV', ['[role="listbox"]', '.det-root', '.app-right']))).toBe(false)
  })

  it('leaves the focus in the left panel tree, the graph and dialogs', () => {
    expect(shouldTakeFocus(el('DIV', ['[role="tree"]', '.app-left']))).toBe(false)
    expect(shouldTakeFocus(el('DIV', ['[role="grid"]']))).toBe(false)
    expect(shouldTakeFocus(el('BUTTON', ['[role="dialog"]', '.ui-backdrop']))).toBe(false)
    // Any control of a side panel, not only its lists.
    expect(shouldTakeFocus(el('BUTTON', ['.app-right']))).toBe(false)
  })

  it('never steals the focus from a text field', () => {
    expect(shouldTakeFocus(el('INPUT'))).toBe(false)
    expect(shouldTakeFocus(el('TEXTAREA'))).toBe(false)
    expect(shouldTakeFocus(el('SELECT'))).toBe(false)
    expect(shouldTakeFocus(el('DIV', [], { isContentEditable: true }))).toBe(false)
  })

  it('takes the focus from other places (e.g. a toolbar button)', () => {
    expect(shouldTakeFocus(el('BUTTON'))).toBe(true)
  })

  it('does nothing when the focus is already inside the diff', () => {
    const inner = el('DIV')
    expect(shouldTakeFocus(inner, container(inner))).toBe(false)
    expect(shouldTakeFocus(el('BUTTON'), container(inner))).toBe(true)
  })
})
