'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Topbar from './Topbar'
import BoardsPanel from './BoardsPanel'
import ThemePanel from './ThemePanel'
import BoardPage from './BoardPage'
import WelcomeDialog from './WelcomeDialog'
import { useAppStore } from '../store'
import { applyTheme } from '../utils/theme'
import { getBoards, getBoardBySlug, updateBoard, createBoard } from '../api'
import { useTimer } from '../hooks/useTimer'
import { useFacilitator } from '../hooks/useFacilitator'
import { boardToBoardListItem } from '../utils/boardMapper'
import type { Board, BoardListItem } from '../types'
import styles from './App.module.css'

interface AppProps {
  boardId: string
}

export default function App({ boardId }: AppProps) {
  const router = useRouter()
  const theme = useAppStore((s) => s.theme)
  const currentBoardId = useAppStore((s) => s.currentBoardId)
  const setCurrentBoard = useAppStore((s) => s.setCurrentBoard)
  const setUsername = useAppStore((s) => s.setUsername)
  const username = useAppStore((s) => s.username)
  const workspace = useAppStore((s) => s.workspace)
  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [currentBoard, setCurrentBoardData] = useState<Board | null>(null)
  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false)
  const [themePanelOpen, setThemePanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showWelcome, setShowWelcome] = useState(!workspace || username === 'Аноним')

  const exportRef = useRef<(() => void) | null>(null)
  const [votesUsed, setVotesUsed] = useState(0)
  const [activeUsers, setActiveUsers] = useState<string[]>([])

  const {
    timer,
    autoAdvance,
    setAutoAdvance,
    sendTimerRef,
    restoreTimer,
    handleTimerWsEvent,
    handleTimerStart,
    handleTimerPause,
    handleTimerReset,
  } = useTimer(boardId)

  const {
    facilitator,
    phase,
    sendFacilitatorRef,
    handleFacilitatorStart,
    handleFacilitatorStop,
    handlePhaseChange,
    handleNextPhase,
    handleFacilitatorChanged,
    handlePhaseChanged,
  } = useFacilitator(sendTimerRef, timer.duration)

  const handleWelcomeConfirm = (name: string) => {
    setUsername(name)
    setShowWelcome(false)
  }

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    loadBoards()
  }, [])

  useEffect(() => {
    if (boardId) {
      loadBoard(boardId)
    }
  }, [boardId])

  const loadBoards = async () => {
    try {
      setError(null)
      let list = await getBoards()
      if (list.length === 0) {
        const board = await createBoard('Моя первая ретро-доска')
        list = [boardToBoardListItem(board)]
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
      restoreTimer(id)
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
        autoAdvance={autoAdvance}
        onAutoAdvanceChange={setAutoAdvance}
        onNextPhase={handleNextPhase}
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
