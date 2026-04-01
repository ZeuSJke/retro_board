'use client'

import type { ReactNode } from 'react'
import styles from './Dialog.module.css'

interface DialogProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  onConfirm: (() => void) | null
  confirmLabel?: string
  danger?: boolean
  icon?: string | null
  confirmDisabled?: boolean
}

export default function Dialog({
  open,
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = 'Сохранить',
  danger = false,
  icon = null,
  confirmDisabled = false,
}: DialogProps) {
  if (!open) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    // Only close if the mouse down and mouse up both happened on the overlay itself
    // and not on the children (dialog content)
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        // Track where the click started
        if (e.target === e.currentTarget) {
          e.currentTarget.setAttribute('data-clicking-overlay', 'true')
        } else {
          e.currentTarget.removeAttribute('data-clicking-overlay')
        }
      }}
      onMouseUp={(e) => {
        // Only trigger onClose if the click started on the overlay AND ended on the overlay
        if (
          e.target === e.currentTarget &&
          e.currentTarget.getAttribute('data-clicking-overlay') === 'true'
        ) {
          onClose()
        }
        e.currentTarget.removeAttribute('data-clicking-overlay')
      }}
    >
      <div className={styles.dialog} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
        {icon && (
          <div
            className={styles.iconWrap}
            style={{
              background: danger ? 'var(--md-error-container)' : 'var(--md-primary-container)',
            }}
          >
            <span
              className="material-symbols-rounded filled"
              style={{
                fontSize: 30,
                color: danger ? 'var(--md-error)' : 'var(--md-primary)',
              }}
            >
              {icon}
            </span>
          </div>
        )}

        <div className={styles.title}>{title}</div>

        <div style={{ marginBottom: 24 }}>{children}</div>

        <div className={styles.actions}>
          <button className={styles.textBtn} onClick={onClose}>
            Отмена
          </button>
          {onConfirm && (
            <button
              type="button"
              className={`${styles.filledBtn} ${danger ? styles.dangerBtn : ''}`}
              onClick={(e) => { e.preventDefault(); onConfirm() }}
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
