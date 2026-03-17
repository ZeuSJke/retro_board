'use client'

import { useState } from 'react'
import { useAppStore } from '../store'
import type { TimerState } from '../types'
import Dialog from './Dialog'
import TimerWidget from './TimerWidget'
import styles from './Topbar.module.css'

interface TopbarProps {
  boardName: string
  onBoardsToggle: () => void
  onThemeToggle: () => void
  onRename: (name: string) => Promise<void>
  onExport?: () => void
  timerState: TimerState | null
  onTimerStart: (duration: number, remaining: number) => void
  onTimerPause: () => void
  onTimerReset: (duration: number) => void
}

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
}: TopbarProps) {
  const { username, setUsername } = useAppStore()
  const [usernameOpen, setUsernameOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [tempName, setTempName] = useState('')
  const [tempBoard, setTempBoard] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)

  return (
    <>
      <header className={styles.bar}>
        <button className={styles.iconBtn} onClick={onBoardsToggle}>
          <span className="material-symbols-rounded">menu</span>
        </button>
        <div className={styles.logo}>RetroBoard</div>
        <button
          className={styles.boardName}
          onClick={() => {
            setTempBoard(boardName)
            setRenameError(null)
            setNameOpen(true)
          }}
          title="Переименовать доску"
        >
          {boardName}
        </button>
        <div className={styles.actions}>
          {timerState && (
            <TimerWidget
              timerState={timerState}
              onStart={onTimerStart}
              onPause={onTimerPause}
              onReset={onTimerReset}
            />
          )}

          {onExport && (
            <button className={styles.iconBtn} onClick={onExport} title="Экспорт в PDF">
              <span className="material-symbols-rounded">picture_as_pdf</span>
            </button>
          )}

          <button
            className={styles.chip}
            onClick={() => {
              setTempName(username)
              setUsernameOpen(true)
            }}
          >
            <span className="material-symbols-rounded">account_circle</span>
            {username}
          </button>
          <button className={styles.iconBtn} onClick={onThemeToggle} title="Тема">
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
          className={styles.input}
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
          } catch (e: unknown) {
            const err = e as { response?: { data?: { detail?: string } } }
            setRenameError(err?.response?.data?.detail || 'Ошибка переименования')
          }
        }}
      >
        <input
          className={styles.input}
          style={{ borderColor: renameError ? 'var(--md-error)' : 'var(--md-outline)' }}
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
              } catch (err: unknown) {
                const error = err as { response?: { data?: { detail?: string } } }
                setRenameError(error?.response?.data?.detail || 'Ошибка переименования')
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
