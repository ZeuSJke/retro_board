'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '../store'
import { userColor, initials } from '../utils/theme'
import type { TimerState } from '../types'
import Dialog from './Dialog'
import TimerWidget from './TimerWidget'
import styles from './Topbar.module.css'

const PHASE_LABELS: Record<string, string> = {
  brainstorm: 'Мозговой штурм',
  reveal: 'Обсуждение',
  discuss: 'Дискуссия',
  vote: 'Голосование',
}

const PHASE_ICONS: Record<string, string> = {
  brainstorm: 'edit_note',
  reveal: 'visibility',
  discuss: 'forum',
  vote: 'how_to_vote',
}

const PHASE_ORDER = ['brainstorm', 'reveal', 'discuss', 'vote']

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
  activeUsers: string[]
  facilitator: string | null
  phase: string | null
  onFacilitatorStart: () => void
  onFacilitatorStop: () => void
  onPhaseChange: (phase: string) => void
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
  activeUsers,
  facilitator,
  phase,
  onFacilitatorStart,
  onFacilitatorStop,
  onPhaseChange,
}: TopbarProps) {
  const router = useRouter()
  const { username, setUsername } = useAppStore()
  const [usernameOpen, setUsernameOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [tempName, setTempName] = useState('')
  const [tempBoard, setTempBoard] = useState('')
  const [tempMaxVotes, setTempMaxVotes] = useState(5)
  const [renameError, setRenameError] = useState<string | null>(null)

  const isFacilitator = facilitator === username
  const MAX_VISIBLE_AVATARS = 4
  const visibleUsers = activeUsers.slice(0, MAX_VISIBLE_AVATARS)
  const extraUsers = activeUsers.length - MAX_VISIBLE_AVATARS

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
          {/* Phase indicator */}
          {phase && (
            <div className={styles.phaseChip} title={PHASE_LABELS[phase] || phase}>
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                {PHASE_ICONS[phase] || 'flag'}
              </span>
              {PHASE_LABELS[phase] || phase}
            </div>
          )}

          {/* Facilitator controls */}
          {isFacilitator && (
            <div className={styles.facControls}>
              {PHASE_ORDER.map((p) => (
                <button
                  key={p}
                  className={`${styles.facBtn} ${phase === p ? styles.facBtnActive : ''}`}
                  onClick={() => onPhaseChange(p)}
                  title={PHASE_LABELS[p]}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
                    {PHASE_ICONS[p]}
                  </span>
                </button>
              ))}
              <button
                className={`${styles.facBtn} ${styles.facBtnStop}`}
                onClick={onFacilitatorStop}
                title="Завершить режим ведущего"
              >
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>close</span>
              </button>
            </div>
          )}

          {/* Become facilitator button */}
          {!facilitator && (
            <button className={styles.iconBtn} onClick={onFacilitatorStart} title="Стать ведущим">
              <span className="material-symbols-rounded">present_to_all</span>
            </button>
          )}

          {/* Facilitator badge (when someone else is facilitator) */}
          {facilitator && !isFacilitator && (
            <span className={styles.facBadge} title={`Ведущий: ${facilitator}`}>
              <span className="material-symbols-rounded" style={{ fontSize: 14 }}>present_to_all</span>
              {facilitator}
            </span>
          )}

          {timerState && (
            <TimerWidget
              timerState={timerState}
              onStart={onTimerStart}
              onPause={onTimerPause}
              onReset={onTimerReset}
              readOnly={!!facilitator && !isFacilitator}
            />
          )}

          <button className={styles.iconBtn} onClick={() => router.push('/dashboard')} title="История ретро">
            <span className="material-symbols-rounded">analytics</span>
          </button>

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

          {/* Presence avatars */}
          {activeUsers.length > 0 && (
            <div className={styles.presence} title={activeUsers.join(', ')}>
              {visibleUsers.map((u) => (
                <div key={u} className={styles.avatar} style={{ background: userColor(u) }}>
                  {initials(u)}
                </div>
              ))}
              {extraUsers > 0 && (
                <div className={styles.avatarExtra}>+{extraUsers}</div>
              )}
            </div>
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
