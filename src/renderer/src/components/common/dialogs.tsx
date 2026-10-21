// Imperative, promise-based dialogs usable from anywhere (actions, menus...):
//   if (await confirm({ title: 'Delete branch?', danger: true })) ...
//   const name = await prompt({ title: 'Create branch', label: 'Branch name' })
//   const choice = await choose({ title: 'Reset', options: [{ value: 'soft', label: 'Soft' }] })
//   const values = await form({ title: 'Create tag', fields: [...] })
// <DialogHost/> is mounted once in App.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Button } from './Button'
import { Modal } from './Modal'

export type FormField =
  | {
      type: 'text' | 'password'
      name: string
      label: string
      placeholder?: string
      defaultValue?: string
      required?: boolean
      autoFocus?: boolean
      monospace?: boolean
      hint?: string
      validate?: (value: string, all: Record<string, string | boolean>) => string | null
    }
  | { type: 'textarea'; name: string; label: string; placeholder?: string; defaultValue?: string; rows?: number; hint?: string }
  | { type: 'checkbox'; name: string; label: string; defaultValue?: boolean; hint?: string }
  | {
      type: 'select'
      name: string
      label: string
      options: Array<{ value: string; label: string }>
      defaultValue?: string
      hint?: string
    }
  | {
      /** A row of colour swatches (radio buttons); `note` is shown under them for the picked one. */
      type: 'swatches'
      name: string
      label: string
      options: Array<{ value: string; label: string; color: string; note?: string }>
      defaultValue?: string
    }

export interface FormOptions {
  title: string
  message?: ReactNode
  fields: FormField[]
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  width?: number
}

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Optional checkbox, returned via confirmWithCheckbox(). */
  checkbox?: { label: string; defaultValue?: boolean }
}

export interface PromptOptions {
  title: string
  message?: ReactNode
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  monospace?: boolean
  validate?: (value: string) => string | null
}

export interface ChooseOption<T> {
  value: T
  label: string
  description?: string
  danger?: boolean
}

export interface ChooseOptions<T> {
  title: string
  message?: ReactNode
  options: ChooseOption<T>[]
  cancelLabel?: string
}

type DialogRequest =
  | { id: number; kind: 'form'; opts: FormOptions; resolve: (v: Record<string, string | boolean> | null) => void }
  | { id: number; kind: 'choose'; opts: ChooseOptions<unknown>; resolve: (v: unknown) => void }

interface DialogStore {
  queue: DialogRequest[]
  push(req: DialogRequest): void
  pop(id: number): void
}

const useDialogs = create<DialogStore>((set) => ({
  queue: [],
  push: (req) => set((s) => ({ queue: [...s.queue, req] })),
  pop: (id) => set((s) => ({ queue: s.queue.filter((r) => r.id !== id) }))
}))

let nextId = 1

export function form(opts: FormOptions): Promise<Record<string, string | boolean> | null> {
  return new Promise((resolve) => {
    useDialogs.getState().push({ id: nextId++, kind: 'form', opts, resolve })
  })
}

export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  const res = await confirmWithCheckbox(opts)
  return res.confirmed
}

export async function confirmWithCheckbox(opts: ConfirmOptions): Promise<{ confirmed: boolean; checked: boolean }> {
  const fields: FormField[] = opts.checkbox
    ? [{ type: 'checkbox', name: 'checked', label: opts.checkbox.label, defaultValue: opts.checkbox.defaultValue }]
    : []
  const res = await form({
    title: opts.title,
    message: opts.message,
    fields,
    confirmLabel: opts.confirmLabel ?? 'OK',
    cancelLabel: opts.cancelLabel,
    danger: opts.danger
  })
  return { confirmed: !!res, checked: !!res?.checked }
}

export async function prompt(opts: PromptOptions): Promise<string | null> {
  const res = await form({
    title: opts.title,
    message: opts.message,
    confirmLabel: opts.confirmLabel ?? 'OK',
    fields: [
      {
        type: 'text',
        name: 'value',
        label: opts.label ?? '',
        placeholder: opts.placeholder,
        defaultValue: opts.defaultValue,
        required: true,
        autoFocus: true,
        monospace: opts.monospace,
        validate: opts.validate ? (v) => opts.validate!(v) : undefined
      }
    ]
  })
  return res ? String(res.value) : null
}

export function choose<T>(opts: ChooseOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    useDialogs.getState().push({
      id: nextId++,
      kind: 'choose',
      opts: opts as ChooseOptions<unknown>,
      resolve: resolve as (v: unknown) => void
    })
  })
}

/** Validates a git ref name (subset of git check-ref-format rules). Returns an error message or null. */
export function validateRefName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Name is required'
  if (/\s/.test(n)) return 'Spaces are not allowed'
  if (/[~^:?*[\\\x00-\x1f\x7f]/.test(n)) return 'Contains invalid characters (~ ^ : ? * [ \\)'
  if (n.includes('..')) return '".." is not allowed'
  if (n.includes('@{')) return '"@{" is not allowed'
  if (n.startsWith('/') || n.endsWith('/') || n.includes('//')) return 'Invalid use of "/"'
  if (n.endsWith('.') || n.endsWith('.lock')) return 'Cannot end with "." or ".lock"'
  if (n.startsWith('-')) return 'Cannot start with "-"'
  if (n === '@') return '"@" is not a valid name'
  if (n.split('/').some((part) => part.startsWith('.'))) return 'Components cannot start with "."'
  return null
}

// ── Host ───────────────────────────────────────────────────────────────────

export function DialogHost() {
  const current = useDialogs((s) => s.queue[0])
  if (!current) return null
  if (current.kind === 'form') return <FormDialog key={current.id} req={current} />
  return <ChooseDialog key={current.id} req={current} />
}

function FormDialog({ req }: { req: Extract<DialogRequest, { kind: 'form' }> }) {
  const { opts } = req
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const v: Record<string, string | boolean> = {}
    for (const f of opts.fields) {
      if (f.type === 'checkbox') v[f.name] = f.defaultValue ?? false
      else if (f.type === 'select' || f.type === 'swatches') v[f.name] = f.defaultValue ?? f.options[0]?.value ?? ''
      else v[f.name] = f.defaultValue ?? ''
    }
    return v
  })
  const [touched, setTouched] = useState(false)
  const firstInput = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = firstInput.current
    if (el) {
      el.focus()
      if ('select' in el) el.select()
    }
  }, [])

  const errors: Record<string, string | null> = {}
  for (const f of opts.fields) {
    if (f.type === 'text' || f.type === 'password') {
      const val = String(values[f.name] ?? '')
      if (f.required && !val.trim()) errors[f.name] = 'Required'
      else if (f.validate) errors[f.name] = f.validate(val, values)
    }
  }
  const hasErrors = Object.values(errors).some(Boolean)

  const close = (result: Record<string, string | boolean> | null) => {
    useDialogs.getState().pop(req.id)
    req.resolve(result)
  }
  const submit = () => {
    setTouched(true)
    if (hasErrors) return
    close(values)
  }

  let focusAssigned = false
  const refFor = (autoFocus?: boolean) => {
    if (focusAssigned && !autoFocus) return undefined
    focusAssigned = true
    return (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (el && !firstInput.current) firstInput.current = el
    }
  }

  return (
    <Modal
      title={opts.title}
      onClose={() => close(null)}
      width={opts.width ?? 460}
      footer={
        <>
          <Button onClick={() => close(null)}>{opts.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={opts.danger ? 'danger' : 'primary'} onClick={submit} disabled={touched && hasErrors}>
            {opts.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {opts.message && <div className="ui-dialog-message">{opts.message}</div>}
        {opts.fields.map((f) => {
          const err = touched ? errors[f.name] : null
          switch (f.type) {
            case 'checkbox':
              return (
                <label key={f.name} className="ui-check">
                  <input
                    type="checkbox"
                    checked={!!values[f.name]}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
                  />
                  <span>{f.label}</span>
                  {f.hint && <small className="ui-hint">{f.hint}</small>}
                </label>
              )
            case 'select':
              return (
                <label key={f.name} className="ui-field">
                  <span className="ui-label">{f.label}</span>
                  <select
                    className="ui-input"
                    value={String(values[f.name])}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {f.hint && <small className="ui-hint">{f.hint}</small>}
                </label>
              )
            case 'swatches': {
              const picked = f.options.find((o) => o.value === values[f.name])
              return (
                <fieldset key={f.name} className="ui-field ui-swatch-field">
                  <legend className="ui-label">{f.label}</legend>
                  <div className="ui-swatches">
                    {f.options.map((o) => (
                      <input
                        key={o.value}
                        type="radio"
                        className={`ui-swatch${o.note ? ' ui-swatch-used' : ''}`}
                        name={`dialog-${req.id}-${f.name}`}
                        value={o.value}
                        aria-label={o.note ? `${o.label}, ${o.note}` : o.label}
                        title={o.note ? `${o.label} (${o.note})` : o.label}
                        checked={values[f.name] === o.value}
                        style={{ '--swatch': o.color } as React.CSSProperties}
                        onChange={() => setValues((v) => ({ ...v, [f.name]: o.value }))}
                      />
                    ))}
                  </div>
                  {picked && (
                    <small className="ui-hint">
                      {picked.label}
                      {picked.note ? ` · ${picked.note}` : ''}
                    </small>
                  )}
                </fieldset>
              )
            }
            case 'textarea':
              return (
                <label key={f.name} className="ui-field">
                  <span className="ui-label">{f.label}</span>
                  <textarea
                    ref={refFor()}
                    className="ui-input"
                    rows={f.rows ?? 4}
                    placeholder={f.placeholder}
                    value={String(values[f.name])}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        submit()
                      }
                    }}
                  />
                  {f.hint && <small className="ui-hint">{f.hint}</small>}
                </label>
              )
            default:
              return (
                <label key={f.name} className="ui-field">
                  {f.label && <span className="ui-label">{f.label}</span>}
                  <input
                    ref={refFor(f.autoFocus)}
                    className={`ui-input${f.monospace ? ' ui-mono' : ''}${err ? ' ui-invalid' : ''}`}
                    type={f.type}
                    placeholder={f.placeholder}
                    value={String(values[f.name])}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                  {err ? <small className="ui-error">{err}</small> : f.hint && <small className="ui-hint">{f.hint}</small>}
                </label>
              )
          }
        })}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function ChooseDialog({ req }: { req: Extract<DialogRequest, { kind: 'choose' }> }) {
  const { opts } = req
  const close = (v: unknown) => {
    useDialogs.getState().pop(req.id)
    req.resolve(v)
  }
  return (
    <Modal
      title={opts.title}
      onClose={() => close(null)}
      width={480}
      footer={<Button onClick={() => close(null)}>{opts.cancelLabel ?? 'Cancel'}</Button>}
    >
      {opts.message && <div className="ui-dialog-message">{opts.message}</div>}
      <div className="ui-choices">
        {opts.options.map((o, i) => (
          <button
            key={i}
            className={`ui-choice${o.danger ? ' ui-choice-danger' : ''}`}
            autoFocus={i === 0}
            onClick={() => close(o.value)}
          >
            <span className="ui-choice-label">{o.label}</span>
            {o.description && <span className="ui-choice-desc">{o.description}</span>}
          </button>
        ))}
      </div>
    </Modal>
  )
}
