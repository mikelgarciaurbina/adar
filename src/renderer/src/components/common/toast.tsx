// Toast notifications:
//   toast.success('Pushed main to origin')
//   toast.error(err)                       // accepts unknown errors, uses describeError()
//   const id = toast.loading('Pushing…'); toast.update(id, { kind: 'success', message: 'Pushed' })
// <ToastHost/> is mounted once in App.

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { create } from 'zustand'
import { describeError, errorDetail } from '@shared/errors'

export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'loading'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  message: ReactNode
  detail?: string
  actions?: ToastAction[]
  /** ms; 0 = sticky. */
  duration: number
}

interface ToastStore {
  toasts: Toast[]
  add(t: Omit<Toast, 'id'>): number
  update(id: number, patch: Partial<Omit<Toast, 'id'>>): void
  remove(id: number): void
}

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  add(t) {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-5), { ...t, id }] }))
    schedule(id, t.duration)
    return id
  },
  update(id, patch) {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
    const t = get().toasts.find((x) => x.id === id)
    if (t) schedule(id, patch.duration ?? (patch.kind && patch.kind !== 'loading' ? defaultDuration(patch.kind) : t.duration))
  },
  remove(id) {
    const tm = timers.get(id)
    if (tm) clearTimeout(tm)
    timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
}))

function schedule(id: number, duration: number) {
  const old = timers.get(id)
  if (old) clearTimeout(old)
  timers.delete(id)
  if (duration > 0) timers.set(id, setTimeout(() => useToasts.getState().remove(id), duration))
}

function defaultDuration(kind: ToastKind): number {
  switch (kind) {
    case 'error':
      return 9000
    case 'warning':
      return 7000
    case 'loading':
      return 0
    default:
      return 3500
  }
}

interface ToastOpts {
  detail?: string
  actions?: ToastAction[]
  duration?: number
}

/** Drop undefined keys so they never override defaults (e.g. duration: undefined → sticky toast). */
function defined(opts?: ToastOpts): ToastOpts {
  const out: ToastOpts = {}
  if (!opts) return out
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

export const toast = {
  success: (message: ReactNode, opts?: ToastOpts) =>
    useToasts.getState().add({ kind: 'success', message, duration: defaultDuration('success'), ...defined(opts) }),
  info: (message: ReactNode, opts?: ToastOpts) =>
    useToasts.getState().add({ kind: 'info', message, duration: defaultDuration('info'), ...defined(opts) }),
  warning: (message: ReactNode, opts?: ToastOpts) =>
    useToasts.getState().add({ kind: 'warning', message, duration: defaultDuration('warning'), ...defined(opts) }),
  /** Accepts a string or any thrown error (AdarError stderr is shown as detail). */
  error: (err: unknown, opts?: ToastOpts) => {
    const message = typeof err === 'string' ? err : describeError(err)
    const detail = opts?.detail ?? (typeof err === 'string' ? undefined : errorDetail(err, message))
    return useToasts.getState().add({ kind: 'error', message, duration: defaultDuration('error'), ...defined(opts), detail })
  },
  loading: (message: ReactNode) => useToasts.getState().add({ kind: 'loading', message, duration: 0 }),
  update: (id: number, patch: Partial<Omit<Toast, 'id'>>) => useToasts.getState().update(id, patch),
  dismiss: (id: number) => useToasts.getState().remove(id)
}

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <XCircle size={16} />,
  info: <Info size={16} />,
  warning: <AlertTriangle size={16} />,
  loading: <span className="ui-spinner ui-spinner-sm" />
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  const remove = useToasts((s) => s.remove)
  useEffect(() => () => timers.forEach((t) => clearTimeout(t)), [])
  return createPortal(
    <div className="ui-toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`ui-toast ui-toast-${t.kind}`}>
          <span className="ui-toast-icon">{ICONS[t.kind]}</span>
          <div className="ui-toast-content">
            <div className="ui-toast-message">{t.message}</div>
            {t.detail && <pre className="ui-toast-detail">{t.detail}</pre>}
            {t.actions && (
              <div className="ui-toast-actions">
                {t.actions.map((a, i) => (
                  <button
                    key={i}
                    className="ui-link"
                    onClick={() => {
                      remove(t.id)
                      a.onClick()
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="ui-icon-btn ui-icon-btn-sm" onClick={() => remove(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
