import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** Extra class on the panel. */
  className?: string
  /** Close when clicking the backdrop (default true). */
  dismissable?: boolean
}

/** Centered modal panel rendered in a portal. Esc closes it. */
export function Modal({ title, onClose, children, footer, width = 520, className, dismissable = true }: ModalProps) {
  const backdrop = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Only the topmost modal reacts (stacked dialogs), and never while the palette is open.
      const all = document.querySelectorAll('.ui-backdrop')
      if (all[all.length - 1] !== backdrop.current || document.querySelector('.pal-overlay')) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      ref={backdrop}
      className="ui-backdrop"
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`ui-modal${className ? ' ' + className : ''}`} style={{ width }} role="dialog" aria-modal="true">
        <div className="ui-modal-header">
          <div className="ui-modal-title">{title}</div>
          <button className="ui-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
