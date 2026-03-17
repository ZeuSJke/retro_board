'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '../store'
import { userColor, initials } from '../utils/theme'
import styles from './WelcomeDialog.module.css'

interface WelcomeDialogProps {
  onConfirm: (name: string) => void
}

export default function WelcomeDialog({ onConfirm }: WelcomeDialogProps) {
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
    <div className={styles.overlay} style={{ opacity: visible ? 1 : 0 }}>
      <div
        className={styles.card}
        style={{
          transform: visible
            ? 'translateY(0) scale(1)'
            : 'translateY(24px) scale(0.97)',
        }}
      >
        <div className={styles.logoStrip}>
          <span className="material-symbols-rounded filled" style={{ fontSize: 22, color: 'white' }}>
            sticky_note_2
          </span>
          <span className={styles.logoText}>RetroBoard</span>
        </div>

        <div className={styles.body}>
          <div className={styles.avatar} style={{ background: avatarColor }}>
            <span className={styles.avatarText}>{initials(displayName)}</span>
            {name.trim() && (
              <div className={styles.avatarRing} style={{ borderColor: avatarColor }} />
            )}
          </div>

          <h1 className={styles.title}>Добро пожаловать!</h1>
          <p className={styles.subtitle}>Введите имя — его увидят все участники доски</p>

          <div className={styles.inputWrap}>
            <span className={`material-symbols-rounded ${styles.inputIcon}`}>
              person
            </span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ваше имя"
              maxLength={60}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
              spellCheck={false}
            />
            {name.trim() && (
              <button className={styles.clearBtn} onClick={() => setName('')}>
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                  close
                </span>
              </button>
            )}
          </div>

          <button className={styles.btn} onClick={handleConfirm}>
            <span>Войти на доску</span>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
              arrow_forward
            </span>
          </button>

          <p className={styles.hint}>Нажмите Enter или кнопку выше, чтобы продолжить</p>
        </div>
      </div>
    </div>
  )
}
