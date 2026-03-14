'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '../store'
import { userColor, initials } from '../utils/theme'

export default function WelcomeDialog({ onConfirm }) {
  const { username: savedName } = useAppStore()
  const [name, setName] = useState(savedName === 'Аноним' ? '' : savedName)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  const handleConfirm = () => {
    const trimmed = name.trim() || 'Аноним'
    onConfirm(trimmed)
  }

  const displayName = name.trim() || '?'
  const avatarColor = name.trim() ? userColor(name.trim()) : '#CAC4D0'

  return (
    <div style={{ ...styles.overlay, opacity: visible ? 1 : 0 }}>
      <div
        style={{
          ...styles.card,
          transform: visible
            ? 'translateY(0) scale(1)'
            : 'translateY(24px) scale(0.97)',
        }}
      >
        <div style={styles.logoStrip}>
          <span className="material-symbols-rounded filled" style={{ fontSize: 22, color: 'white' }}>
            sticky_note_2
          </span>
          <span style={styles.logoText}>RetroBoard</span>
        </div>

        <div style={styles.body}>
          <div style={{ ...styles.avatar, background: avatarColor }}>
            <span style={styles.avatarText}>{initials(displayName)}</span>
            {name.trim() && (
              <div style={{ ...styles.avatarRing, borderColor: avatarColor }} />
            )}
          </div>

          <h1 style={styles.title}>Добро пожаловать!</h1>
          <p style={styles.subtitle}>Введите имя — его увидят все участники доски</p>

          <div style={styles.inputWrap}>
            <span className="material-symbols-rounded" style={styles.inputIcon}>
              person
            </span>
            <input
              style={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ваше имя"
              maxLength={60}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              spellCheck={false}
            />
            {name.trim() && (
              <button style={styles.clearBtn} onClick={() => setName('')}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                  close
                </span>
              </button>
            )}
          </div>

          <button style={styles.btn} onClick={handleConfirm}>
            <span>Войти на доску</span>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
              arrow_forward
            </span>
          </button>

          <p style={styles.hint}>Нажмите Enter или кнопку выше, чтобы продолжить</p>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.65)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    transition: 'opacity 0.3s ease',
  },
  card: {
    background: 'var(--md-surface)',
    borderRadius: 32,
    width: '100%',
    maxWidth: 440,
    boxShadow: '0 24px 48px rgba(0,0,0,0.3), 0 8px 16px rgba(0,0,0,0.2)',
    overflow: 'hidden',
    transition: 'transform 0.35s cubic-bezier(0.2, 0, 0, 1), opacity 0.3s ease',
  },
  logoStrip: {
    background: 'var(--md-primary)',
    padding: '14px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoText: {
    color: 'white',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: -0.3,
  },
  body: {
    padding: '36px 40px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    position: 'relative',
    transition: 'background 0.25s ease',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: 700,
    color: 'white',
    userSelect: 'none',
    fontFamily: "'Roboto', sans-serif",
  },
  avatarRing: {
    position: 'absolute',
    inset: -4,
    borderRadius: '50%',
    border: '2.5px solid',
    opacity: 0.4,
    transition: 'border-color 0.25s ease',
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    color: 'var(--md-on-surface)',
    margin: 0,
    marginBottom: 8,
    fontFamily: "'Roboto', sans-serif",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--md-on-surface-variant)',
    textAlign: 'center',
    lineHeight: 1.5,
    margin: 0,
    marginBottom: 28,
    maxWidth: 300,
    fontFamily: "'Roboto', sans-serif",
  },
  inputWrap: {
    width: '100%',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    marginBottom: 16,
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    fontSize: 20,
    color: 'var(--md-on-surface-variant)',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    height: 52,
    border: '1.5px solid var(--md-outline-variant)',
    borderRadius: 16,
    padding: '0 44px 0 44px',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 16,
    color: 'var(--md-on-surface)',
    background: 'var(--md-surface-variant)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  clearBtn: {
    position: 'absolute',
    right: 10,
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--md-on-surface-variant)',
  },
  btn: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    border: 'none',
    background: 'var(--md-primary)',
    color: 'var(--md-on-primary)',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 14,
    transition: 'opacity 0.15s, transform 0.1s',
    letterSpacing: 0.2,
  },
  hint: {
    fontSize: 12,
    color: 'var(--md-on-surface-variant)',
    opacity: 0.7,
    margin: 0,
    fontFamily: "'Roboto', sans-serif",
  },
}
