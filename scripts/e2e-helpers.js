// Helpers for scripted e2e runs (scripts/e2e.sh). Load with a step {"jsFile": "<abs path to this file>"}
// then call e.g. {"js": "e2e.clickText('Stage all changes')"}. Every helper returns a short string
// describing what happened (printed in the run log) and never throws.
;(() => {
  const q = (sel, root = document) => {
    try {
      return root.querySelector(sel)
    } catch {
      return null // not a valid CSS selector (e.g. plain text)
    }
  }
  const qa = (sel, root = document) => {
    try {
      return [...root.querySelectorAll(sel)]
    } catch {
      return []
    }
  }
  const visible = (el) => !!el && el.getClientRects().length > 0
  const describe = (el) => (el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}` : 'null')
  /** Innermost visible element whose trimmed text equals (or, with partial, contains) `text`. */
  const byText = (text, { selector = '*', partial = false, root = document } = {}) => {
    const els = qa(selector, root).filter((el) => {
      if (!visible(el)) return false
      const t = (el.textContent || '').trim()
      return partial ? t.includes(text) : t === text
    })
    return els.find((el) => ![...el.children].some((c) => els.includes(c))) || els[els.length - 1] || null
  }
  const center = (el) => {
    const r = el.getBoundingClientRect()
    return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
  }
  const mouse = (el, type, extra = {}) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...center(el), ...extra }))
  const resolve = (target, opts) => (typeof target === 'string' ? (q(target) || byText(target, opts)) : target)
  const click = (target, opts = {}) => {
    const el = resolve(target, opts)
    if (!el) return `click: not found ${target}`
    el.scrollIntoView?.({ block: 'nearest' })
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) mouse(el, t, opts.mods || {})
    mouse(el, 'click', opts.mods || {})
    return `clicked ${describe(el)}`
  }
  const e2e = {
    q, qa, byText, visible,
    click,
    clickText: (text, opts = {}) => click(byText(text, opts) || text, opts),
    dblclick: (target, opts = {}) => {
      const el = resolve(target, opts)
      if (!el) return `dblclick: not found ${target}`
      mouse(el, 'click'); mouse(el, 'click'); mouse(el, 'dblclick', { detail: 2 })
      return `dblclicked ${describe(el)}`
    },
    contextMenu: (target, opts = {}) => {
      const el = resolve(target, opts)
      if (!el) return `contextmenu: not found ${target}`
      mouse(el, 'contextmenu', { button: 2 })
      return `contextmenu on ${describe(el)}`
    },
    /** Click an item of the open context menu by its label (partial match allowed). */
    menuItem: (label, partial = true) => {
      const item = qa('.ui-menu-item').find((i) => (partial ? i.textContent.includes(label) : i.textContent.trim() === label))
      if (!item) return `menuItem: not found "${label}" (have: ${qa('.ui-menu-item').map((i) => i.textContent.trim()).join(' | ')})`
      mouse(item, 'mouseenter'); mouse(item, 'mouseover'); mouse(item, 'click')
      return `menu → ${item.textContent.trim()}`
    },
    /** Set the value of a React-controlled input/textarea. */
    type: (target, text) => {
      const el = resolve(target)
      if (!el) return `type: not found ${target}`
      el.focus()
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return `typed into ${describe(el)}`
    },
    /** Dispatch a keydown (+keyup) on the focused element. mods: {metaKey, ctrlKey, shiftKey, altKey}. */
    key: (key, mods = {}, target) => {
      const el = (target && resolve(target)) || document.activeElement || document.body
      const init = { key, bubbles: true, cancelable: true, ...mods }
      el.dispatchEvent(new KeyboardEvent('keydown', init))
      el.dispatchEvent(new KeyboardEvent('keyup', init))
      return `key ${key} on ${describe(el)}`
    },
    /** HTML5 drag & drop from one element to another. */
    drag: (from, to) => {
      const a = resolve(from), b = resolve(to)
      if (!a || !b) return `drag: not found ${!a ? from : to}`
      const dt = new DataTransfer()
      const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, ...center(el) }))
      ev(a, 'dragstart'); ev(b, 'dragenter'); ev(b, 'dragover'); ev(b, 'drop'); ev(a, 'dragend')
      return `dragged ${describe(a)} → ${describe(b)}`
    },
    hover: (target) => {
      const el = resolve(target)
      if (!el) return `hover: not found ${target}`
      mouse(el, 'mouseover'); mouse(el, 'mouseenter'); mouse(el, 'mousemove')
      return `hovered ${describe(el)}`
    },
    /** Compact snapshot of the active tab state for assertions. */
    state: () => {
      const s = window.__adar.store.getState()
      const t = s.tabs.find((x) => x.path === s.activePath)
      if (!t) return { tabs: s.tabs.length, modal: s.modal?.kind ?? null }
      return {
        repo: t.name, head: t.info?.head, opState: t.info?.state, selection: t.selection, center: t.center.kind,
        commits: t.commits.length, staged: t.status?.staged.length, unstaged: t.status?.unstaged.length,
        conflicted: t.status?.conflicted.length, branches: t.refs?.branches.map((b) => b.name), stashes: t.refs?.stashes.length,
        modal: s.modal?.kind ?? null, toasts: qa('.ui-toast-message').map((x) => x.textContent.trim()).slice(-4)
      }
    },
    /** Resolve when `text` (or a CSS selector, or a predicate) is present; returns a description. */
    waitFor: (what, timeout = 10000) =>
      new Promise((res) => {
        const t0 = Date.now()
        const check = () => {
          const ok = typeof what === 'function' ? what() : q(what) || byText(what) || byText(what, { partial: true })
          if (ok) return res(`found ${typeof what === 'string' ? what : 'predicate'} after ${Date.now() - t0}ms`)
          if (Date.now() - t0 > timeout) return res(`TIMEOUT waiting for ${typeof what === 'string' ? what : 'predicate'}`)
          setTimeout(check, 100)
        }
        check()
      }),
    toasts: () => qa('.ui-toast').map((x) => x.textContent.trim()),
    errors: () => (window.__e2eErrors || []).slice(-10)
  }
  if (!window.__e2eErrors) {
    window.__e2eErrors = []
    window.addEventListener('error', (e) => window.__e2eErrors.push(String(e.message)))
    window.addEventListener('unhandledrejection', (e) => window.__e2eErrors.push('unhandled: ' + String(e.reason?.message || e.reason)))
  }
  window.e2e = e2e
  return 'e2e helpers ready'
})()
