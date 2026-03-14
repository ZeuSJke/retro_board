'use client'

export default function Dialog({
  open,
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = 'Сохранить',
  danger = false,
  icon = null,
}) {
  if (!open) return null

  return (
    <div
      style={styles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={styles.dialog}>
        {icon && (
          <div
            style={{
              ...styles.iconWrap,
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

        <div style={styles.title}>{title}</div>

        <div style={{ marginBottom: 24 }}>{children}</div>

        <div style={styles.actions}>
          <button style={styles.textBtn} onClick={onClose}>
            Отмена
          </button>
          <button
            style={{
              ...styles.filledBtn,
              ...(danger ? styles.dangerBtn : {}),
            }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 300,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    background: 'var(--md-surface)',
    borderRadius: 28,
    padding: 28,
    width: 'min(440px, calc(100vw - 48px))',
    boxShadow: 'var(--elevation-3)',
    display: 'flex',
    flexDirection: 'column',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 12,
    color: 'var(--md-on-surface)',
    lineHeight: 1.3,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  textBtn: {
    height: 40,
    padding: '0 16px',
    borderRadius: 20,
    border: 'none',
    background: 'transparent',
    color: 'var(--md-primary)',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  filledBtn: {
    height: 40,
    padding: '0 24px',
    borderRadius: 20,
    border: 'none',
    background: 'var(--md-primary)',
    color: 'var(--md-on-primary)',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  dangerBtn: {
    background: 'var(--md-error)',
    color: '#ffffff',
  },
}
