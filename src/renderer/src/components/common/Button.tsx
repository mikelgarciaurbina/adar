import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'default' | 'primary' | 'danger' | 'ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-btn ui-btn-${variant} ui-btn-${size}${className ? ' ' + className : ''}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="ui-spinner ui-spinner-sm" /> : icon}
      {children && <span>{children}</span>}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tooltip / aria-label. */
  label: string
  active?: boolean
  size?: 'sm' | 'md'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = 'md', className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      title={label}
      aria-label={label}
      className={`ui-icon-btn ui-icon-btn-${size}${active ? ' ui-active' : ''}${className ? ' ' + className : ''}`}
      {...rest}
    >
      {children}
    </button>
  )
})

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`ui-spinner ui-spinner-${size}`} aria-label="Loading" />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ui-kbd">{children}</kbd>
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty-icon">{icon}</div>}
      <div className="ui-empty-title">{title}</div>
      {children && <div className="ui-empty-body">{children}</div>}
    </div>
  )
}
