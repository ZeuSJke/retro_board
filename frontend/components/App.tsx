'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Topbar from './Topbar'
import BoardsPanel from './BoardsPanel'
import ThemePanel from './ThemePanel'
import BoardPage from './BoardPage'
import WelcomeDialog from './WelcomeDialog'
import SummaryModal from './SummaryModal'
import { useAppStore } from '../store'
import { showToast } from '../store/toastStore'
import { applyTheme } from '../utils/theme'
import { getBoards, getBoardBySlug, updateBoard, createBoard, checkWorkspaceSession } from '../api'
import { useTimer } from '../hooks/useTimer'
import { useFacilitator } from '../hooks/useFacilitator'
import { boardToBoardListItem } from '../utils/boardMapper'
import type { Board, BoardListItem, WsBoardUpdatedData } from '../types'
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
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)
  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [currentBoard, setCurrentBoardData] = useState<Board | null>(null)
  const [boardsPanelOpen, setBoardsPanelOpen] = useState(false)
  const [themePanelOpen, setThemePanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)

  const exportRef = useRef<(() => void) | null>(null)
  const selfDeletedIdRef = useRef<string | null>(null)
  const [votesUsed, setVotesUsed] = useState(0)
  const [activeUsers, setActiveUsers] = useState<string[]>([])
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)

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
  } = useTimer(currentBoard?.id ?? '')

  const handleSummaryGenerated = useCallback(() => {
    setIsGeneratingSummary(false)
    if (!currentBoard) return
    setBoards((prev) =>
      prev.map((b) => (b.id === currentBoard.id ? { ...b, has_summary: true } : b))
    )
  }, [currentBoard])

  const handleSummaryFailed = useCallback((message?: string) => {
    setIsGeneratingSummary(false)
    showToast(message || 'Не удалось сгенерировать итоги', 'error')
  }, [])

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

  const handlePhaseChangedWrapper = useCallback((p: string) => {
    handlePhaseChanged(p)
    setIsGeneratingSummary(p === 'summary')
  }, [handlePhaseChanged])

  const handleWelcomeConfirm = async (name: string) => {
    setUsername(name)
    setShowWelcome(false)
    setSessionChecked(true)
    setError(null)
    await loadBoards()
    if (boardId && boardId !== 'start') {
      await loadBoard(boardId)
    }
  }

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // После гидрации проверяем сессию на сервере (и обновляем CSRF TTL).
  // На прямом /board/[id] при 401 не сносим URL: покажем WelcomeDialog и после входа откроем нужную доску.
  useEffect(() => {
    if (!hasHydrated) return
    let cancelled = false

    async function verifySession() {
      const ws = useAppStore.getState().workspace
      const uname = useAppStore.getState().username
      if (!ws) {
        if (!cancelled) {
          setShowWelcome(true)
          setSessionChecked(true)
          setLoading(false)
        }
        return
      }
      try {
        await checkWorkspaceSession()
        if (cancelled) return
        setSessionChecked(true)
        if (uname === 'Аноним') {
          setShowWelcome(true)
          setLoading(false)
        } else {
          setShowWelcome(false)
          await loadBoards()
          if (!cancelled && boardId && boardId !== 'start') {
            await loadBoard(boardId)
          }
        }
      } catch (err: unknown) {
        if (cancelled) return
        const status = (err as { response?: { status?: number } })?.response?.status
        setSessionChecked(true)
        if (status === 401 || !useAppStore.getState().workspace) {
          setShowWelcome(true)
          setLoading(false)
        } else {
          setError('Не удалось подключиться к серверу. Убедитесь, что бэкенд запущен.')
          setLoading(false)
        }
      }
    }

    verifySession()
    return () => { cancelled = true }
  }, [hasHydrated])

  // Реагируем на сброс workspace (например, при протухании куки во время работы → interceptor 401)
  useEffect(() => {
    if (!hasHydrated || !sessionChecked) return
    if (!workspace) {
      setShowWelcome(true)
      setCurrentBoardData(null)
      setError(null)
    }
  }, [hasHydrated, sessionChecked, workspace])

  useEffect(() => {
    if (!hasHydrated || !sessionChecked || !workspace || showWelcome) return
    if (boardId && boardId !== 'start') {
      if (currentBoard && (currentBoard.id === boardId || currentBoard.slug === boardId)) {
        return
      }
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
      } else {
        const inList = list.find((b) => b.slug === boardId || b.id === boardId)
        if (!inList) {
          const target =
            currentBoardId && list.find((b) => b.id === currentBoardId)
              ? list.find((b) => b.id === currentBoardId)!
              : list[0]
          router.replace(`/board/${target.slug || target.id}`)
        }
      }
      setBoards(list)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401 || !useAppStore.getState().workspace) {
        setShowWelcome(true)
        return
      }
      setError('Не удалось подключиться к серверу. Убедитесь, что бэкенд запущен.')
    }
  }

  const loadBoard = async (id: string) => {
    try {
      setLoading(true)
      setError(null)
      const board = await getBoardBySlug(id)
      setCurrentBoardData(board)
      setCurrentBoard(board.id)
      restoreTimer(board.id)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401 || !useAppStore.getState().workspace) {
        setShowWelcome(true)
        return
      }
      if (status === 404) {
        // Доска не найдена (удалена или неверный URL) — попробуем перейти на доступную доску
        const fallback = boards.find((b) => b.id !== id && b.slug !== id)
        if (fallback) {
          showToast('Запрошенная доска не найдена', 'error')
          router.replace(`/board/${fallback.slug || fallback.id}`)
          return
        }
      }
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
    setBoards((prev) => (prev.some((b) => b.id === board.id) ? prev : [board, ...prev]))
    setBoardsPanelOpen(false)
    router.push(`/board/${board.slug || board.id}`)
  }

  const handleBoardDeleted = (id: string) => {
    selfDeletedIdRef.current = id
    const remaining = boards.filter((b) => b.id !== id)
    setBoards(remaining)
    if (currentBoard?.id === id && remaining.length > 0) {
      router.push(`/board/${remaining[0].slug || remaining[0].id}`)
    } else if (currentBoard?.id === id) {
      router.push('/board/start')
    }
  }

  const handleWsBoardCreated = useCallback((board: BoardListItem) => {
    setBoards((prev) => (prev.some((b) => b.id === board.id) ? prev : [board, ...prev]))
  }, [])

  const handleWsBoardUpdated = useCallback((upd: WsBoardUpdatedData) => {
    setBoards((prev) => prev.map((b) => (b.id === upd.id ? { ...b, ...upd } : b)))
    setCurrentBoardData((prev) => (prev && prev.id === upd.id ? { ...prev, ...upd } : prev))
  }, [])

  const handleWsBoardDeleted = useCallback((deletedId: string) => {
    setBoards((prev) => {
      const remaining = prev.filter((b) => b.id !== deletedId)
      if (selfDeletedIdRef.current === deletedId) {
        selfDeletedIdRef.current = null
        return remaining
      }
      if (currentBoard?.id === deletedId) {
        showToast('Текущая доска была удалена', 'info')
        if (remaining.length > 0) {
          router.replace(`/board/${remaining[0].slug || remaining[0].id}`)
        } else {
          router.replace('/board/start')
        }
      }
      return remaining
    })
  }, [currentBoard?.id, router])

  const handleBoardSettings = async (data: { name?: string; max_votes?: number }) => {
    if (!currentBoard) return
    const updated_board = await updateBoard(currentBoard.id, data)
    const updated: Board = {
      ...currentBoard,
      ...updated_board,
      columns: updated_board.columns?.length ? updated_board.columns : currentBoard.columns,
    }
    setCurrentBoardData(updated)
    setBoards((prev) =>
      prev.map((b) =>
        b.id === updated.id
          ? { ...b, name: updated.name, slug: updated.slug, max_votes: updated.max_votes }
          : b,
      ),
    )
    if (data.name && updated.slug && updated.slug !== boardId) {
      router.replace(`/board/${updated.slug || updated.id}`)
    }
  }

  const closePanels = () => {
    setBoardsPanelOpen(false)
    setThemePanelOpen(false)
  }

  if (!hasHydrated || (!sessionChecked && workspace)) {
    return (
      <div className={styles.centered}>
        <div className={styles.spinner} />
        <p style={{ color: 'var(--md-on-surface-variant)', fontSize: 14 }}>Загрузка...</p>
      </div>
    )
  }

  if (showWelcome) {
    return <WelcomeDialog onConfirm={handleWelcomeConfirm} />
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
        <button
          className={styles.retryBtn}
          onClick={() => {
            loadBoards()
            if (boardId && boardId !== 'start') loadBoard(boardId)
          }}
        >
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

  const currentBoardItem = boards.find((b) => b.id === currentBoard.id)
  const hasSummary = currentBoardItem?.has_summary ?? false

  return (
    <>
      <Topbar
        boardName={currentBoard?.name || ''}
        maxVotes={currentBoard?.max_votes ?? 5}
        votesUsed={votesUsed}
        onBoardsToggle={() => {
          setThemePanelOpen(false)
          setBoardsPanelOpen((v) => {
            const next = !v
            if (next) void loadBoards()
            return next
          })
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
        hasSummary={hasSummary}
        isGeneratingSummary={isGeneratingSummary}
        onSummaryClick={() => setSummaryOpen(true)}
      />

      {(boardsPanelOpen || themePanelOpen) && (
        <div
          className={styles.overlay}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.currentTarget.setAttribute('data-clicking-overlay', 'true')
            } else {
              e.currentTarget.removeAttribute('data-clicking-overlay')
            }
          }}
          onMouseUp={(e) => {
            if (
              e.target === e.currentTarget &&
              e.currentTarget.getAttribute('data-clicking-overlay') === 'true'
            ) {
              closePanels()
            }
            e.currentTarget.removeAttribute('data-clicking-overlay')
          }}
        />
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
            onPhaseChanged={handlePhaseChangedWrapper}
            onSummaryGenerated={handleSummaryGenerated}
            onSummaryFailed={handleSummaryFailed}
            onBoardCreated={handleWsBoardCreated}
            onBoardUpdated={handleWsBoardUpdated}
            onBoardDeleted={handleWsBoardDeleted}
            sendFacilitatorRef={sendFacilitatorRef}
          />
        )}
      </main>

      {currentBoard && summaryOpen && (
        <SummaryModal
          boardId={currentBoard.id}
          hasSummary={hasSummary}
          isGeneratingSummary={isGeneratingSummary}
          onClose={() => setSummaryOpen(false)}
        />
      )}
    </>
  )
}
