import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  onOk?: () => void
  okDisabled?: boolean
  initialFocus?: RefObject<HTMLElement | null>
  children: ReactNode
  footerNote?: ReactNode
}

export function Dialog({
  open,
  title,
  onClose,
  onOk,
  okDisabled,
  initialFocus,
  children,
  footerNote,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    // Copy the ref values to locals inside the effect so the cleanup
    // closes over stable references instead of reading ref.current.
    const panel = panelRef.current
    const primaryButton = primaryButtonRef.current

    const focusTarget = initialFocus?.current ?? primaryButton
    focusTarget?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (event.target instanceof HTMLElement && event.target.dataset.ownsEscape === 'true') return
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return

      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    panel?.addEventListener('keydown', handleKeyDown)
    return () => {
      panel?.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, initialFocus])

  if (!open) return null

  return (
    <div className="dialog-overlay" role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-footer">
          {footerNote ? <span className="dialog-footer-note">{footerNote}</span> : null}
          {onOk ? (
            <>
              <button
                type="button"
                ref={primaryButtonRef}
                className="primary"
                onClick={onOk}
                disabled={okDisabled}
              >
                OK
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" ref={primaryButtonRef} onClick={onClose}>
              Close
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
