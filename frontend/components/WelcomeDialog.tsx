'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '../store'
import { loginToWorkspace } from '../api'
import { userColor, initials } from '../utils/theme'
import styles from './WelcomeDialog.module.css'

interface WelcomeDialogProps {
  onConfirm: (name: string) => void
}

export default function WelcomeDialog({ onConfirm }: WelcomeDialogProps) {
  const savedName = useAppStore((s) => s.username)
  const workspace = useAppStore((s) => s.workspace)
  const setWorkspace = useAppStore((s) => s.setWorkspace)

  const [name, setName] = useState(savedName === 'Аноним' ? '' : savedName)
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWorkspaceFields, setShowWorkspaceFields] = useState(!workspace)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [])

  // Sync with Zustand state after async hydration (Next.js SSR uses default state on first render)
  useEffect(() => {
    if (workspace) {
      setShowWorkspaceFields(false)
    }
  }, [workspace])

  useEffect(() => {
    if (savedName && savedName !== 'Аноним') {
      setName((prev) => prev || savedName)
    }
  }, [savedName])

  const handleConfirm = async () => {
    if (!workspace) {
      // Need to login to workspace
      setLoading(true)
      setError(null)
      try {
        const session = await loginToWorkspace({
          workspace_slug: workspaceSlug.trim(),
          access_key: accessKey,
        })
        setWorkspace(session)
        onConfirm(name.trim() || 'Аноним')
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error && 'response' in err && (err as any).response?.status === 401
            ? 'Неверный код команды или ключ доступа'
            : 'Ошибка при подключении к команде'
        setError(errorMsg)
        setLoading(false)
      }
    } else {
      onConfirm(name.trim() || 'Аноним')
    }
  }

  const handleChangeWorkspace = () => {
    setWorkspace(null)
    setShowWorkspaceFields(true)
    setError(null)
    setWorkspaceSlug('')
    setAccessKey('')
  }

  const displayName = name.trim() || '?'
  const avatarColor = name.trim() ? userColor(name.trim()) : '#CAC4D0'
  const canSubmit = workspace
    ? name.trim().length > 0
    : name.trim().length > 0 && workspaceSlug.trim().length > 0 && accessKey.length > 0

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
          <p className={styles.subtitle}>
            {workspace ? 'Введите имя для участия в доске' : 'Войдите в рабочее пространство'}
          </p>

          {workspace && !showWorkspaceFields && (
            <div className={styles.workspaceInfo}>
              <div className={styles.workspaceName}>Команда: {workspace.workspaceName}</div>
              <button className={styles.workspaceChange} onClick={handleChangeWorkspace}>
                Войти в другую команду
              </button>
            </div>
          )}

          {showWorkspaceFields && (
            <>
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Данные команды</div>

                <div className={styles.inputWrap}>
                  <span className={`material-symbols-rounded ${styles.inputIcon}`}>
                    business
                  </span>
                  <input
                    className={styles.input}
                    value={workspaceSlug}
                    onChange={(e) => setWorkspaceSlug(e.target.value)}
                    placeholder="Например: fmrm-core"
                    maxLength={100}
                    disabled={loading}
                    onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleConfirm()}
                    spellCheck={false}
                  />
                </div>

                <div className={styles.inputWrap}>
                  <span className={`material-symbols-rounded ${styles.inputIcon}`}>
                    key
                  </span>
                  <input
                    type="password"
                    className={styles.input}
                    value={accessKey}
                    onChange={(e) => setAccessKey(e.target.value)}
                    placeholder="Ключ доступа"
                    maxLength={100}
                    disabled={loading}
                    onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleConfirm()}
                    spellCheck={false}
                  />
                </div>

                {error && <div className={styles.error}>{error}</div>}
              </div>
            </>
          )}

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Ваше имя</div>

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
                autoFocus={!showWorkspaceFields}
                disabled={loading}
                onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleConfirm()}
                spellCheck={false}
              />
              {name.trim() && (
                <button
                  className={styles.clearBtn}
                  onClick={() => setName('')}
                  disabled={loading}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                    close
                  </span>
                </button>
              )}
            </div>
          </div>

          <button
            className={styles.btn}
            onClick={handleConfirm}
            disabled={loading || !canSubmit}
            style={{
              opacity: loading || !canSubmit ? 0.6 : 1,
              cursor: loading || !canSubmit ? 'not-allowed' : 'pointer',
            }}
          >
            <span>{loading ? 'Вход...' : 'Войти на доску'}</span>
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
              arrow_forward
            </span>
          </button>

          <p className={styles.hint}>
            {showWorkspaceFields
              ? 'Введите код команды и ключ доступа, затем имя'
              : 'Нажмите Enter или кнопку выше, чтобы продолжить'}
          </p>
        </div>
      </div>
    </div>
  )
}
