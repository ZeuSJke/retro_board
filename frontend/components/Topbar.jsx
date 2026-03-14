'use client'

import { useState } from 'react'
import { useAppStore } from '../store'
import Dialog from './Dialog'
import TimerWidget from './TimerWidget'

export default function Topbar({
  boardName,
  onBoardsToggle,
  onThemeToggle,
  onRename,
  onExport,
  timerState,
  onTimerStart,
  onTimerPause,
  onTimerReset,
}) {
  const { username, setUsername } = useAppStore()
  const [usernameOpen, setUsernameOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [tempName, setTempName] = useState('')
  const [tempBoard, setTempBoard] = useState('')
  const [renameError, setRenameError] = useState(null)

  return (
    <>
      <header style={styles.bar}>
        <button style={styles.iconBtn} onClick={onBoardsToggle}>
          <span className="material-symbols-rounded">menu</span>
        </button>
        <div style={styles.logo}>RetroBoard</div>
        <button
          style={styles.boardName}
          onClick={() => {
            setTempBoard(boardName)
            setRenameError(null)
            setNameOpen(true)
          }}
          title="Переименовать доску"
        >
          {boardName}
        </button>
        <div style={styles.actions}>
          {timerState && (
            <TimerWidget
              timerState={timerState}
              onStart={onTimerStart}
              onPause={onTimerPause}
              onReset={onTimerReset}
            />
          )}

          {onExport && (
            <button style={styles.iconBtn} onClick={onExport} title="Экспорт в PDF">
              <span className="material-symbols-rounded">picture_as_pdf</span>
            </button>
          )}

          <button
            style={styles.chip}
            onClick={() => {
              setTempName(username)
              setUsernameOpen(true)
            }}
          >
            <span className="material-symbols-rounded">account_circle</span>
            {username}
          </button>
          <button style={styles.iconBtn} onClick={onThemeToggle} title="Тема">
            <span className="material-symbols-rounded">palette</span>
          </button>
        </div>
      </header>

      <Dialog
        open={usernameOpen}
        title="Ваше имя"
        onClose={() => setUsernameOpen(false)}
        onConfirm={() => {
          if (tempName.trim()) setUsername(tempName.trim())
          setUsernameOpen(false)
        }}
      >
        <input
          style={styles.input}
          value={tempName}
          onChange={(e) => setTempName(e.target.value)}
          placeholder="Введите имя"
          maxLength={60}
          onKeyDown={(e) =>
            e.key === 'Enter' && (setUsername(tempName.trim()), setUsernameOpen(false))
          }
          autoFocus
        />
      </Dialog>

      <Dialog
        open={nameOpen}
        title="Название доски"
        onClose={() => { setNameOpen(false); setRenameError(null) }}
        onConfirm={async () => {
          try {
            await onRename(tempBoard)
            setNameOpen(false)
            setRenameError(null)
          } catch (e) {
            setRenameError(e?.response?.data?.detail || 'Ошибка переименования')
          }
        }}
      >
        <input
          style={{ ...styles.input, borderColor: renameError ? 'var(--md-error)' : 'var(--md-outline)' }}
          value={tempBoard}
          onChange={(e) => { setTempBoard(e.target.value); setRenameError(null) }}
          placeholder="Название доски"
          maxLength={120}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              try {
                await onRename(tempBoard)
                setNameOpen(false)
                setRenameError(null)
              } catch (err) {
                setRenameError(err?.response?.data?.detail || 'Ошибка переименования')
              }
            }
          }}
          autoFocus
        />
        {renameError && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--md-error)' }}>{renameError}</p>
        )}
      </Dialog>
    </>
  )
}

const styles = {
  bar: {
    height: 64,
    background: 'var(--md-surface-1)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: 12,
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    boxShadow: 'var(--elevation-2)',
  },
  logo: {
    fontFamily: "'Roboto', sans-serif",
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--md-primary)',
    letterSpacing: -0.5,
  },
  boardName: {
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--md-on-surface-variant)',
    flex: 1,
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 8,
    border: '1px solid transparent',
    background: 'transparent',
    fontFamily: "'Roboto', sans-serif",
    textAlign: 'left',
    transition: 'var(--transition)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 320,
  },
  actions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginLeft: 'auto',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: 'none',
    background: 'transparent',
    color: 'var(--md-on-surface-variant)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition)',
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    background: 'var(--md-secondary-container)',
    color: 'var(--md-on-secondary-container)',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    fontFamily: "'Roboto', sans-serif",
  },
  input: {
    width: '100%',
    border: '1px solid var(--md-outline)',
    borderRadius: 12,
    padding: '12px 14px',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 14,
    color: 'var(--md-on-surface)',
    background: 'var(--md-surface)',
    outline: 'none',
  },
}
