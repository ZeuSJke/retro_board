'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '../store'
import { userColor, initials } from '../utils/theme'
import { getApiErrorMessage } from '../utils/apiError'
import { loginToWorkspace } from '../api'
import type { TimerState } from '../types'
import Dialog from './Dialog'
import TimerWidget from './TimerWidget'
import PhaseProgress from './PhaseProgress'
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
  autoAdvance?: boolean
  onAutoAdvanceChange?: (value: boolean) => void
  onNextPhase?: () => void
  activeUsers: string[]
  facilitator: string | null
  phase: string | null
  onFacilitatorStart: () => void
  onFacilitatorStop: () => void
  onPhaseChange: (phase: string) => void
  hasSummary?: boolean
  isGeneratingSummary?: boolean
  onSummaryClick?: () => void
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
  autoAdvance,
  onAutoAdvanceChange,
  onNextPhase,
  activeUsers,
  facilitator,
  phase,
  onFacilitatorStart,
  onFacilitatorStop,
  onPhaseChange,
  hasSummary,
  isGeneratingSummary,
  onSummaryClick,
}: TopbarProps) {
  const router = useRouter()
  const username = useAppStore((s) => s.username)
  const setUsername = useAppStore((s) => s.setUsername)
  const workspace = useAppStore((s) => s.workspace)
  const setWorkspace = useAppStore((s) => s.setWorkspace)
  const [usernameOpen, setUsernameOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [tempName, setTempName] = useState('')
  const [tempBoard, setTempBoard] = useState('')
  const [tempMaxVotes, setTempMaxVotes] = useState(5)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [showWorkspaceFields, setShowWorkspaceFields] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const isFacilitator = facilitator === username
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const MAX_VISIBLE_AVATARS = isMobile ? 2 : 4
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
          {/* Phase progress stepper */}
          {phase && (
            <PhaseProgress
              phase={phase}
              isFacilitator={isFacilitator}
              onPhaseChange={onPhaseChange}
            />
          )}

          {/* Facilitator stop button */}
          {isFacilitator && (
            <button
              className={`${styles.iconBtn} ${styles.facStopBtn}`}
              onClick={onFacilitatorStop}
              title="Завершить режим ведущего"
            >
              <span className="material-symbols-rounded">close</span>
            </button>
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
              phase={phase}
              autoAdvance={autoAdvance}
              onAutoAdvanceChange={onAutoAdvanceChange}
              onNextPhase={onNextPhase}
            />
          )}

          <button className={styles.iconBtn} onClick={() => router.push('/dashboard')} title="История ретро">
            <span className="material-symbols-rounded">analytics</span>
          </button>

          {onSummaryClick && (
            <button
              className={styles.iconBtn}
              onClick={onSummaryClick}
              title={hasSummary ? 'Просмотреть резюме' : isGeneratingSummary ? 'Генерация итогов...' : 'Резюме недоступно'}
              style={{ color: hasSummary ? 'var(--md-primary)' : isGeneratingSummary ? 'var(--md-tertiary)' : undefined }}
            >
              {isGeneratingSummary ? (
                <span className="material-symbols-rounded" style={{ animation: 'spin 1s linear infinite' }}>
                  hourglass_empty
                </span>
              ) : (
                <span className="material-symbols-rounded" style={{ fontVariationSettings: hasSummary ? "'FILL' 1" : "'FILL' 0" }}>
                  summarize
                </span>
              )}
            </button>
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
        title="Настройки пользователя"
        onClose={() => {
          setUsernameOpen(false)
          setShowWorkspaceFields(false)
          setWorkspaceError(null)
        }}
        onConfirm={async () => {
          if (showWorkspaceFields && workspaceSlug.trim() && accessKey) {
            setWorkspaceLoading(true)
            setWorkspaceError(null)
            try {
              const session = await loginToWorkspace({
                workspace_slug: workspaceSlug.trim(),
                access_key: accessKey,
              })
              // Reset current board because it belongs to the old workspace
              useAppStore.setState({ currentBoardId: null })
              setWorkspace(session)
              setWorkspaceSlug('')
              setAccessKey('')
              setShowWorkspaceFields(false)
              setUsernameOpen(false)
              router.push('/')
              return
            } catch (err: unknown) {
              const errorMsg =
                err instanceof Error && 'response' in err && (err as any).response?.status === 401
                  ? 'Неверный код команды или ключ доступа'
                  : 'Ошибка при подключении к команде'
              setWorkspaceError(errorMsg)
              setWorkspaceLoading(false)
              return
            }
          }
          if (tempName.trim()) setUsername(tempName.trim())
          setUsernameOpen(false)
          setShowWorkspaceFields(false)
          setWorkspaceError(null)
        }}
      >
        {workspace && !showWorkspaceFields && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 12px', background: 'var(--md-surface-container-highest)', borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--md-on-surface-variant)', marginBottom: 2 }}>Текущая команда</div>
              <div style={{ fontWeight: 500 }}>{workspace.workspaceName}</div>
            </div>
            <button
              style={{ background: 'var(--md-secondary-container)', border: 'none', borderRadius: 16, color: 'var(--md-on-secondary-container)', cursor: 'pointer', fontSize: 12, padding: '6px 14px', fontWeight: 500 }}
              onClick={() => setShowWorkspaceFields(true)}
            >
              Сменить
            </button>
          </div>
        )}

        {showWorkspaceFields && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--md-on-surface-variant)', display: 'block', marginBottom: 6 }}>Код команды</label>
              <input
                className={styles.input}
                value={workspaceSlug}
                onChange={(e) => { setWorkspaceSlug(e.target.value); setWorkspaceError(null) }}
                placeholder="Например: fmrm-core"
                maxLength={100}
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--md-on-surface-variant)', display: 'block', marginBottom: 6 }}>Ключ доступа</label>
              <input
                type="password"
                className={styles.input}
                value={accessKey}
                onChange={(e) => { setAccessKey(e.target.value); setWorkspaceError(null) }}
                placeholder="Ключ доступа"
                maxLength={100}
              />
            </div>
            {workspaceError && (
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--md-error)' }}>{workspaceError}</p>
            )}
            <button
              style={{ background: 'none', border: 'none', color: 'var(--md-primary)', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 16 }}
              onClick={() => { setShowWorkspaceFields(false); setWorkspaceError(null) }}
            >
              Отмена
            </button>
          </>
        )}

        <div style={{ marginBottom: 0 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--md-on-surface-variant)', display: 'block', marginBottom: 6 }}>Ваше имя</label>
          <input
            className={styles.input}
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            placeholder="Введите имя"
            maxLength={60}
            onKeyDown={(e) =>
              e.key === 'Enter' && !showWorkspaceFields && (setUsername(tempName.trim()), setUsernameOpen(false))
            }
          />
        </div>
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
            setRenameError(getApiErrorMessage(e, 'Ошибка сохранения'))
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
