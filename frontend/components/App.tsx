'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import { getBoard, getBoardBySlug, getBoards, refreshWorkspaceSession } from '../api'
import { isOwnBoardDeletion, onBoardsRefreshRequested } from '../lib/board-list-signals'
import { FIRST_BOARD_REF, FIRST_BOARD_ROUTE, boardPath, resolveStartBoard } from '../lib/board-routes'
import { boardToBoardListItem } from '../utils/boardMapper'
import { getApiErrorMessage, getApiErrorStatus, markApiErrorReported } from '../utils/apiError'
import type { Board, BoardListItem, WsBoardUpdatedData } from '../types'
import BoardPage from './BoardPage'
import CreateBoardDialog from './CreateBoardDialog'
import NoBoardsScreen from './NoBoardsScreen'
import WelcomeDialog from './WelcomeDialog'
import { Button } from './ui/button'
import { showToast } from '../store/toastStore'

interface AppProps {
  boardId?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function App({ boardId }: AppProps) {
  const router = useRouter()
  const setCurrentBoard = useAppStore((s) => s.setCurrentBoard)
  const workspaceName = useAppStore((s) => s.workspace?.workspaceName)
  const hasWorkspace = useAppStore((s) => Boolean(s.workspace))
  const participantId = useAppStore((s) => s.participant?.id ?? null)
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)

  const [boards, setBoards] = useState<BoardListItem[]>([])
  // Доска хранится вместе с участником, для которого её отдал сервер: карточки и голоса
  // собираются под получателя, показывать их другому участнику (повторный вход) нельзя
  const [loaded, setLoaded] = useState<{ board: Board; participantId: string } | null>(null)
  // Участник, которому сервер ответил «досок в команде нет»: показываем пустое состояние
  const [emptyFor, setEmptyFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const loadSeqRef = useRef(0)

  // Сессия — это команда и участник; имя для входа необязательно
  const needsAuth = !hasWorkspace || !participantId
  const board = loaded && loaded.participantId === participantId ? loaded.board : null
  const noBoards = Boolean(participantId) && emptyFor === participantId
  const setBoard = useCallback((next: Board | null) => {
    const owner = useAppStore.getState().participant?.id
    setLoaded(next && owner ? { board: next, participantId: owner } : null)
  }, [])

  const loadWorkspaceBoard = useCallback(async () => {
    if (!hasHydrated || !participantId) return
    // Применяем только ответ на последний запрос: более ранний мог устареть
    const seq = ++loadSeqRef.current
    const stale = () => seq !== loadSeqRef.current
    try {
      // Источник правды о сессии — сервер: участник, команда и признак ai_enabled
      await refreshWorkspaceSession()
      const list = await getBoards()
      if (stale()) return
      setBoards(list)

      if (list.length === 0) {
        // Досок нет (новая команда или удалена последняя): молча доску не создаём
        setBoard(null)
        setEmptyFor(participantId)
        setError(null)
        return
      }
      setEmptyFor(null)

      let target: Board
      if (!boardId || boardId === FIRST_BOARD_REF) {
        const first = resolveStartBoard(list) ?? list[0]
        target = await getBoard(first.id)
        if (stale()) return
        // Доска, у которой slug совпал со служебным адресом, уже открыта по своему адресу
        if (target.slug !== FIRST_BOARD_REF) router.replace(boardPath(target))
      } else {
        const isUuid = UUID_RE.test(boardId)
        try {
          target = isUuid ? await getBoard(boardId) : await getBoardBySlug(boardId)
        } catch (err) {
          if (getApiErrorStatus(err) === 404 && !isUuid) {
            target = await getBoard(boardId)
          } else {
            throw err
          }
        }
        if (stale()) return
      }

      setBoard(target)
      setCurrentBoard(target.id)
      setError(null)
    } catch (err) {
      if (stale()) return
      // 401: перехватчик уже сбросил сессию — показываем вход без экрана ошибки
      if (getApiErrorStatus(err) === 401 || !useAppStore.getState().participant) {
        setBoard(null)
        return
      }
      setError(getApiErrorMessage(err, 'Не удалось загрузить доску'))
    }
  }, [hasHydrated, participantId, boardId, router, setCurrentBoard, setBoard])

  useEffect(() => {
    if (!hasHydrated || needsAuth) return
    void loadWorkspaceBoard()
  }, [hasHydrated, needsAuth, loadWorkspaceBoard])

  // Счётчики в списке досок (карточки, открытые задачи) сервер считает сам: перечитываем
  // список, когда его открывают, — иначе он остаётся таким, каким был при загрузке страницы
  const refreshBoards = useCallback(async () => {
    try {
      const list = await getBoards()
      if (list.length > 0) setBoards(list)
    } catch (err) {
      // Фоновое обновление: старый список остаётся на месте, уведомление не нужно
      markApiErrorReported(err)
    }
  }, [])

  useEffect(() => {
    if (needsAuth) return
    return onBoardsRefreshRequested(() => void refreshBoards())
  }, [needsAuth, refreshBoards])

  const openCreateDialog = useCallback(() => {
    setCreateDialogOpen(true)
    // В диалоге показано число открытых задач исходной доски — оно должно быть свежим
    void refreshBoards()
  }, [refreshBoards])

  if (!hasHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (needsAuth) {
    // Вход сам записывает сессию в стор — после этого эффект выше загрузит доску
    return <WelcomeDialog onConfirm={() => {}} />
  }

  const createDialog = (
    <CreateBoardDialog
      open={createDialogOpen}
      onOpenChange={setCreateDialogOpen}
      existingBoards={boards}
      onCreated={(created) => {
        const listItem = boardToBoardListItem(created)
        setBoards((prev) => (prev.some((b) => b.id === created.id) ? prev : [listItem, ...prev]))
        setEmptyFor(null)
        router.push(boardPath(created))
      }}
    />
  )

  if (error) {
    // Ошибку снимает сам пользователь (кнопкой) или удачная загрузка: загрузчик её не трогает,
    // пока не получит ответ
    return (
      <div
        role="alert"
        className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      >
        <h2 className="text-lg font-semibold">Не удалось открыть доску</h2>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <div className="flex gap-2">
          {boardId && boardId !== FIRST_BOARD_REF && (
            <Button
              variant="outline"
              onClick={() => {
                setError(null)
                router.replace(FIRST_BOARD_ROUTE)
              }}
            >
              К первой доске
            </Button>
          )}
          <Button
            onClick={() => {
              setError(null)
              void loadWorkspaceBoard()
            }}
          >
            Повторить
          </Button>
        </div>
      </div>
    )
  }

  if (!board) {
    if (noBoards) {
      return (
        <>
          <NoBoardsScreen
            workspaceName={workspaceName || 'Команда'}
            onCreateBoard={openCreateDialog}
            onBoardAppeared={() => void loadWorkspaceBoard()}
          />
          {createDialog}
        </>
      )
    }
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Загрузка доски...</p>
      </div>
    )
  }

  return (
    <>
      <BoardPage
        key={`${board.id}:${participantId}`}
        board={board}
        boards={boards}
        workspaceName={workspaceName || 'Команда'}
        onBoardUpdated={(updated) => {
          setBoard(updated)
          setBoards((prev) =>
            prev.map((b) =>
              b.id === updated.id
                ? {
                    ...b,
                    name: updated.name,
                    max_votes: updated.max_votes,
                    is_locked: updated.is_locked,
                    has_summary: updated.has_summary ?? b.has_summary,
                  }
                : b,
            ),
          )
        }}
        onBoardDeleted={(deletedId) => {
          // Доску удалил сам участник: один переход, уведомление уже показал диалог настроек
          const remaining = boards.filter((b) => b.id !== deletedId)
          setBoards(remaining)
          router.replace(remaining.length > 0 ? boardPath(remaining[0]) : FIRST_BOARD_ROUTE)
        }}
        onSelectBoard={(b) => {
          router.push(boardPath(b))
        }}
        onOpenCreateBoard={openCreateDialog}
        onBoardsListCreated={(created) => {
          setBoards((prev) =>
            prev.some((b) => b.id === created.id) ? prev : [created, ...prev],
          )
        }}
        onBoardsListUpdated={(data: WsBoardUpdatedData) => {
          setBoards((prev) =>
            prev.map((b) =>
              b.id === data.id
                ? {
                    ...b,
                    name: data.name ?? b.name,
                    max_votes: data.max_votes ?? b.max_votes,
                    is_locked: data.is_locked ?? b.is_locked,
                  }
                : b,
            ),
          )
        }}
        onBoardsListDeleted={(deletedId) => {
          setBoards((prev) => prev.filter((b) => b.id !== deletedId))
          // Событие об удалении приходит и самому удаляющему, причём раньше ответа на его
          // запрос: его переход выполнит onBoardDeleted, второй переход и уведомление не нужны
          if (deletedId === board.id && !isOwnBoardDeletion(deletedId)) {
            showToast('Эту доску удалили — открываем другую доску команды', 'info')
            router.replace(FIRST_BOARD_ROUTE)
          }
        }}
      />

      {createDialog}
    </>
  )
}
