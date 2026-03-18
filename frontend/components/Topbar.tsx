'use client'

import { useState } from 'react'
import { useAppStore } from '../store'
import type { TimerState } from '../types'
import Dialog from './Dialog'
import TimerWidget from './TimerWidget'
import styles from './Topbar.module.css'

interface TopbarProps {
  boardName: string
  maxVotes: number
  votesUsed: number
  onBoardsToggle: () => void
  onThemeToggle: () => void
  onBoardSettings: (data: { name?: string; max_votes?: number }) => Promise<void>
  onExport?: () => void
  timerState: TimerState | null
  onTimerStart: (duration: number, remaining: number) => void
  onTimerPause: () => void
  onTimerReset: (duration: number) => void
}

export default function Topbar({
  boardName,
  maxVotes,
  votesUsed,
  onBoardsToggle,
  onThemeToggle,
  onBoardSettings,
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
  const [tempMaxVotes, setTempMaxVotes] = useState(5)
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
            setTempMaxVotes(maxVotes)
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

          <span
            className={styles.chip}
            style={{ cursor: 'default', gap: 4, fontSize: 13 }}
            title={`Голосов: ${votesUsed} из ${maxVotes}`}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>thumb_up</span>
            {votesUsed}/{maxVotes}
          </span>
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
        title="Настройки доски"
        onClose={() => { setNameOpen(false); setRenameError(null) }}
        onConfirm={async () => {
          try {
            const data: { name?: string; max_votes?: number } = {}
            if (tempBoard.trim() !== boardName) data.name = tempBoard.trim()
            if (tempMaxVotes !== maxVotes) data.max_votes = tempMaxVotes
            if (Object.keys(data).length > 0) await onBoardSettings(data)
            setNameOpen(false)
            setRenameError(null)
          } catch (e: unknown) {
            const err = e as { response?: { data?: { detail?: string } } }
            setRenameError(err?.response?.data?.detail || 'Ошибка сохранения')
          }
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--md-on-surface-variant)' }}>Название доски</label>
          <input
            className={styles.input}
            style={{ borderColor: renameError ? 'var(--md-error)' : 'var(--md-outline)', marginTop: 4 }}
            value={tempBoard}
            onChange={(e) => { setTempBoard(e.target.value); setRenameError(null) }}
            placeholder="Название доски"
            maxLength={120}
            autoFocus
          />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--md-on-surface-variant)' }}>Лимит голосов на участника</label>
          <input
            className={styles.input}
            style={{ marginTop: 4, width: 80 }}
            type="number"
            min={1}
            max={99}
            value={tempMaxVotes}
            onChange={(e) => setTempMaxVotes(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
          />
        </div>
        {renameError && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--md-error)' }}>{renameError}</p>
        )}
      </Dialog>
    </>
  )
}
