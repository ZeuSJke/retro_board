'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Topbar from './Topbar'
import BoardsPanel from './BoardsPanel'
import ThemePanel from './ThemePanel'
import BoardPage from './BoardPage'
import WelcomeDialog from './WelcomeDialog'
import { useAppStore } from '../store'
import { applyTheme } from '../utils/theme'
import { getBoards, getBoardBySlug, updateBoard, createBoard } from '../api'
import type { Board, BoardListItem, TimerState } from '../types'
import styles from './App.module.css'

interface AppProps {
  boardId: string
}

export default function App({ boardId }: AppProps) {
  const router = useRouter()
  const { theme, currentBoardId, setCurrentBoard, setUsername, username } = useAppStore()
  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [currentBoard, setCurrentBoardData] = useState<Board | null>(null)
  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false)
  const [themePanelOpen, setThemePanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showWelcome, setShowWelcome] = useState(username === 'Аноним')

  const exportRef = useRef<(() => void) | null>(null)
  const [votesUsed, setVotesUsed] = useState(0)
  const [activeUsers, setActiveUsers] = useState<string[]>([])
  const [facilitator, setFacilitator] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const sendFacilitatorRef = useRef<{
    start: () => void
    stop: () => void
    changePhase: (phase: string) => void
  } | null>(null)

  const [timer, setTimer] = useState<TimerState>({ duration: 300, remaining: 300, running: false })
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sendTimerRef = useRef<{
    start: (duration: number, remaining: number) => void
    pause: (remaining: number) => void
    reset: (duration: number) => void
  } | null>(null)
  const timerRestoredRef = useRef(false)

  useEffect(() => {
    if (!boardId || !timerRestoredRef.current) return
    localStorage.setItem(
      `retro_timer_${boardId}`,
      JSON.stringify({
        duration: timer.duration,
        remaining: timer.remaining,
        running: timer.running,
        savedAt: Date.now(),
      }),
    )
  }, [timer.duration, timer.remaining, timer.running, boardId])

  const handleWelcomeConfirm = (name: string) => {
    setUsername(name)
    setShowWelcome(false)
  }

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    loadBoards()
  }, [])

  useEffect(() => {
    if (boardId) {
      timerRestoredRef.current = false
      loadBoard(boardId)
    }
  }, [boardId])

  const loadBoards = async () => {
    try {
      setError(null)
      let list = await getBoards()
      if (list.length === 0) {
        const board = await createBoard('Моя первая ретро-доска')
        list = [board as unknown as BoardListItem]
        router.replace(`/board/${board.slug || board.id}`)
      }
      setBoards(list)
    } catch {
      setError('Не удалось подключиться к серверу. Убедитесь, что бэкенд запущен.')
    }
  }

  const loadBoard = async (id: string) => {
    try {
      setLoading(true)
      const board = await getBoardBySlug(id)
      setCurrentBoardData(board)
      setCurrentBoard(board.id)

      try {
        const saved = localStorage.getItem(`retro_timer_${id}`)
        if (saved) {
          const { duration, remaining, running, savedAt } = JSON.parse(saved)
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
          if (running) {
            const elapsed = Math.floor((Date.now() - savedAt) / 1000)
            const adjusted = Math.max(0, remaining - elapsed)
            setTimer({ duration, remaining: adjusted, running: adjusted > 0 })
            if (adjusted > 0) startCountdown(adjusted)
          } else {
            setTimer({ duration, remaining, running: false })
          }
        }
      } catch { /* ignore corrupted timer data */ }
      timerRestoredRef.current = true

    } catch {
      setError('Не удалось загрузить доску.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectBoard = async (id: string) => {
    setBoardsPanelOpen(false)
    const board = boards.find((b) => b.id === id)
    router.push(`/board/${board?.slug || id}`)
  }

  const handleBoardCreated = async (board: BoardListItem) => {
    setBoards((prev) => [board, ...prev])
    setBoardsPanelOpen(false)
    router.push(`/board/${board.slug || board.id}`)
  }

  const handleBoardDeleted = (id: string) => {
    const remaining = boards.filter((b) => b.id !== id)
    setBoards(remaining)
    if (currentBoard?.id === id && remaining.length > 0) {
      router.push(`/board/${remaining[0].slug || remaining[0].id}`)
    }
  }

  const handleBoardSettings = async (data: { name?: string; max_votes?: number }) => {
    if (!currentBoard) return
    const updated_board = await updateBoard(currentBoard.id, data)
    const updated = { ...currentBoard, ...updated_board }
    setCurrentBoardData(updated)
    setBoards((prev) =>
      prev.map((b) => (b.id === updated.id ? { ...b, name: updated.name, max_votes: updated.max_votes } : b)),
    )
    if (data.name) {
      router.replace(`/board/${updated.slug || updated.id}`)
    }
  }

  const closePanels = () => {
    setBoardsPanelOpen(false)
    setThemePanelOpen(false)
  }

  const startCountdown = useCallback((remaining: number) => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    timerIntervalRef.current = setInterval(() => {
      setTimer((prev) => {
        const next = Math.max(0, prev.remaining - 1)
        if (next <= 0) {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
          return { ...prev, remaining: 0, running: false }
        }
        return { ...prev, remaining: next }
      })
    }, 1000)
  }, [])

  const handleTimerWsEvent = useCallback(
    (event: string, data: Record<string, unknown>) => {
      if (event === 'timer_start') {
        const networkDelay = (Date.now() - ((data.ts as number) || Date.now())) / 1000
        const adjusted = Math.max(0, Math.round((data.remaining as number) - networkDelay))
        setTimer({ duration: data.duration as number, remaining: adjusted, running: true })
        startCountdown(adjusted)
      } else if (event === 'timer_pause') {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        setTimer((prev) => ({
          ...prev,
          ...(data.duration != null ? { duration: data.duration as number } : {}),
          remaining: data.remaining as number,
          running: false,
        }))
      } else if (event === 'timer_reset') {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
        setTimer({ duration: data.duration as number, remaining: data.duration as number, running: false })
      }
    },
    [startCountdown],
  )

  const handleTimerStart = useCallback((duration: number, remaining: number) => {
    sendTimerRef.current?.start(duration, remaining)
  }, [])

  const handleTimerPause = useCallback(() => {
    sendTimerRef.current?.pause(timer.remaining)
  }, [timer.remaining])

  const handleTimerReset = useCallback((duration: number) => {
    sendTimerRef.current?.reset(duration)
  }, [])

  const handleFacilitatorStart = useCallback(() => {
    sendFacilitatorRef.current?.start()
  }, [])

  const handleFacilitatorStop = useCallback(() => {
    sendFacilitatorRef.current?.stop()
  }, [])

  const handlePhaseChange = useCallback((p: string) => {
    sendFacilitatorRef.current?.changePhase(p)
  }, [])

  const handleFacilitatorChanged = useCallback((f: string | null, p: string | null) => {
    setFacilitator(f)
    setPhase(p)
  }, [])

  const handlePhaseChanged = useCallback((p: string) => {
    setPhase(p)
  }, [])

  if (error)
    return (
      <div className={styles.centered}>
        <span
          className="material-symbols-rounded"
          style={{ fontSize: 48, color: 'var(--md-error)', marginBottom: 16 }}
        >
          error
        </span>
        <p style={{ color: 'var(--md-error)', fontWeight: 600, marginBottom: 8 }}>{error}</p>
        <button className={styles.retryBtn} onClick={loadBoards}>
          Повторить
        </button>
      </div>
    )

  if (loading || !currentBoard)
    return (
      <div className={styles.centered}>
        <div className={styles.spinner} />
        <p style={{ color: 'var(--md-on-surface-variant)', fontSize: 14 }}>Загрузка...</p>
      </div>
    )

  if (showWelcome) {
    return <WelcomeDialog onConfirm={handleWelcomeConfirm} />
  }

  return (
    <>
      <Topbar
        boardName={currentBoard?.name || ''}
        maxVotes={currentBoard?.max_votes ?? 5}
        votesUsed={votesUsed}
        onBoardsToggle={() => {
          setThemePanelOpen(false)
          setBoardsPanelOpen((v) => !v)
        }}
        onThemeToggle={() => {
          setBoardsPanelOpen(false)
          setThemePanelOpen((v) => !v)
        }}
        onBoardSettings={handleBoardSettings}
        onExport={() => exportRef.current?.()}
        timerState={currentBoard ? timer : null}
        onTimerStart={handleTimerStart}
        onTimerPause={handleTimerPause}
        onTimerReset={handleTimerReset}
        activeUsers={activeUsers}
        facilitator={facilitator}
        phase={phase}
        onFacilitatorStart={handleFacilitatorStart}
        onFacilitatorStop={handleFacilitatorStop}
        onPhaseChange={handlePhaseChange}
      />

      {(boardsPanelOpen || themePanelOpen) && (
        <div className={styles.overlay} onClick={closePanels} />
      )}

      <BoardsPanel
        open={boardsPanelOpen}
        boards={boards}
        currentId={currentBoard?.id}
        onSelect={handleSelectBoard}
        onCreated={handleBoardCreated}
        onDeleted={handleBoardDeleted}
      />

      <ThemePanel open={themePanelOpen} />

      <main className={styles.main}>
        {currentBoard && (
          <BoardPage
            key={currentBoard.id}
            board={currentBoard}
            onBoardUpdate={setCurrentBoardData}
            exportRef={exportRef}
            onTimerWsEvent={handleTimerWsEvent}
            sendTimerRef={sendTimerRef}
            onVotesChanged={setVotesUsed}
            onPresenceChanged={setActiveUsers}
            onFacilitatorChanged={handleFacilitatorChanged}
            onPhaseChanged={handlePhaseChanged}
            sendFacilitatorRef={sendFacilitatorRef}
          />
        )}
      </main>
    </>
  )
}
