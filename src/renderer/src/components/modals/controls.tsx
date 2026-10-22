// Small form controls shared by the modals (md- prefix).

import { useId, useRef, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { api } from '@renderer/api/client'
import { Button } from '@renderer/components/common/Button'
import { toast } from '@renderer/components/common/toast'
import { useApp } from '@renderer/store/appStore'

/**
 * Close the current app modal only when it is the topmost backdrop. Prevents Escape
 * in a confirm/credential dialog stacked on top from also closing the modal below.
 */
export function closeIfTopmost(panelClass: string): void {
  // The command palette overlays everything and handles its own Escape.
  if (document.querySelector('.pal-overlay')) return
  const backdrops = document.querySelectorAll('.ui-backdrop')
  const last = backdrops[backdrops.length - 1]
  if (last && !last.querySelector(`.${panelClass}`)) return
  useApp.getState().closeModal()
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled
}: {
  value: T
  options: Array<{ value: T; label: ReactNode; title?: string }>
  onChange: (v: T) => void
  ariaLabel?: string
  disabled?: boolean
}) {
  return (
    <div className="md-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          disabled={disabled}
          className={`md-seg-btn${o.value === value ? ' md-seg-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`md-switch${checked ? ' md-switch-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="md-switch-knob" />
    </button>
  )
}

/** A titled card of setting rows (Settings): rows are separated by hairlines. */
export function SettingGroup({ title, description, children }: { title?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="md-group">
      {(title || description) && (
        <div className="md-group-head">
          {title && <h3 className="md-group-title">{title}</h3>}
          {description && <p className="md-group-desc">{description}</p>}
        </div>
      )}
      <div className="md-group-card">{children}</div>
    </section>
  )
}

/** Native select drawn like the app's inputs, with its own chevron. */
export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="md-select-wrap">
      <select className={`ui-input md-select${className ? ' ' + className : ''}`} {...rest} />
      <ChevronDown size={13} className="md-select-caret" aria-hidden="true" />
    </span>
  )
}

/** Settings row: label + description on the left, control on the right (or below it when `stacked`). */
export function SettingRow({
  label,
  description,
  children,
  htmlFor,
  stacked
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  htmlFor?: string
  stacked?: boolean
}) {
  return (
    <div className={`md-row${stacked ? ' md-row-stacked' : ''}`}>
      <div className="md-row-text">
        {htmlFor ? (
          <label className="md-row-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="md-row-label">{label}</div>
        )}
        {description && <div className="md-row-desc">{description}</div>}
      </div>
      <div className="md-row-control">{children}</div>
    </div>
  )
}

/**
 * Text input with a "Browse…" button opening the native folder picker. After a folder is
 * picked, focus returns to the input so Enter submits the surrounding form.
 */
export function PathField({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  placeholder,
  pickerTitle,
  autoFocus
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  hint?: ReactNode
  disabled?: boolean
  placeholder?: string
  pickerTitle?: string
  autoFocus?: boolean
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const browse = async () => {
    try {
      const dir = await api.pickDirectory({ title: pickerTitle ?? label, defaultPath: value.trim() || undefined })
      if (!dir) return
      onChange(dir)
      const input = inputRef.current
      if (input) {
        input.focus()
        // Caret at the end so the (often long) path's last folder is visible.
        requestAnimationFrame(() => {
          input.setSelectionRange(input.value.length, input.value.length)
          input.scrollLeft = input.scrollWidth
        })
      }
    } catch (err) {
      toast.error(err)
    }
  }
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>
        {label}
      </label>
      <div className="md-path">
        <input
          id={id}
          ref={inputRef}
          className={`ui-input ui-mono${error ? ' ui-invalid' : ''}`}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" onClick={() => void browse()} disabled={disabled} icon={<FolderOpen size={14} />}>
          Browse…
        </Button>
      </div>
      {error ? <small className="ui-error">{error}</small> : hint ? <small className="ui-hint">{hint}</small> : null}
    </div>
  )
}

/** Labelled text input with inline error/hint. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  placeholder,
  monospace,
  autoFocus,
  type = 'text',
  inputRef,
  trailing
}: {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  error?: string | null
  hint?: ReactNode
  disabled?: boolean
  placeholder?: string
  monospace?: boolean
  autoFocus?: boolean
  type?: 'text' | 'password' | 'email'
  inputRef?: React.Ref<HTMLInputElement>
  trailing?: ReactNode
}) {
  const id = useId()
  return (
    <div className="ui-field">
      <label className="ui-label md-label-row" htmlFor={id}>
        <span>{label}</span>
        {trailing}
      </label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        className={`ui-input${monospace ? ' ui-mono' : ''}${error ? ' ui-invalid' : ''}`}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <small className="ui-error">{error}</small> : hint ? <small className="ui-hint">{hint}</small> : null}
    </div>
  )
}

/** Determinate (0–100) or indeterminate progress bar. */
export function ProgressBar({ percent }: { percent?: number }) {
  const determinate = typeof percent === 'number' && Number.isFinite(percent)
  return (
    <div className={`md-progress${determinate ? '' : ' md-progress-indeterminate'}`} role="progressbar" aria-valuenow={determinate ? Math.round(percent) : undefined} aria-valuemin={0} aria-valuemax={100}>
      <div className="md-progress-fill" style={determinate ? { width: `${Math.max(0, Math.min(100, percent))}%` } : undefined} />
    </div>
  )
}
