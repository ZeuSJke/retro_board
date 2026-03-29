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

  return (
    <div
      className={styles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.dialog}>
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
