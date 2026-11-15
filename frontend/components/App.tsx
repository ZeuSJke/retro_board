'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import {
  createBoard,
  getBoard,
  getBoardBySlug,
  getBoards,
  refreshWorkspaceSession,
} from '../api'
import { boardToBoardListItem } from '../utils/boardMapper'
import { getApiErrorMessage } from '../utils/apiError'
import type { Board, BoardListItem, WsBoardUpdatedData } from '../types'
import BoardPage from './BoardPage'
import CreateBoardDialog from './CreateBoardDialog'
import WelcomeDialog from './WelcomeDialog'
import { Button } from './ui/button'
import { showToast } from '../store/toastStore'

interface AppProps {
  boardId?: string
}

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Сессия — это команда и участник; имя для входа необязательно
  const needsAuth = !hasWorkspace || !participantId
  const board = loaded && loaded.participantId === participantId ? loaded.board : null
  const setBoard = useCallback((next: Board | null) => {
    const owner = useAppStore.getState().participant?.id
    setLoaded(next && owner ? { board: next, participantId: owner } : null)
  }, [])

  const loadWorkspaceBoard = useCallback(async () => {
    if (!hasHydrated || !participantId) return
    setLoading(true)
    setError(null)
    // «start» — только перенаправление: индикатор загрузки остаётся до смены адреса
    let redirecting = false
    try {
      // Источник правды о сессии — сервер: участник, команда и признак ai_enabled
      await refreshWorkspaceSession()
      let list = await getBoards()
      if (list.length === 0) {
        const created = await createBoard('Моя первая ретро-доска')
        list = [boardToBoardListItem(created)]
      }
      setBoards(list)

      let target: Board | null = null
      if (!boardId || boardId === 'start') {
        // Доску здесь не монтируем: смена сегмента [id] пересоздаёт страницу, и доска
        // загрузилась бы дважды, а её сокет открылся бы, закрылся и открылся снова.
        // Её загрузит страница по настоящему адресу.
        const first = list[0]
        redirecting = true
        router.replace(`/board/${first.slug || first.id}`)
        return
      } else {
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            boardId,
          )
        try {
          target = isUuid ? await getBoard(boardId) : await getBoardBySlug(boardId)
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status
          if (status === 404 && !isUuid) {
            target = await getBoard(boardId)
          } else {
            throw err
          }
        }
      }

      if (target) {
        setBoard(target)
        setCurrentBoard(target.id)
      }
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      // 401: перехватчик уже сбросил сессию — показываем вход без экрана ошибки
      if (status === 401 || !useAppStore.getState().participant) {
        setBoard(null)
        return
      }
      setError(getApiErrorMessage(err, 'Не удалось загрузить доску'))
    } finally {
      if (!redirecting) setLoading(false)
    }
  }, [hasHydrated, participantId, boardId, router, setCurrentBoard, setBoard])

  useEffect(() => {
    if (!hasHydrated) return
    if (needsAuth) {
      setLoading(false)
      return
    }
    void loadWorkspaceBoard()
  }, [hasHydrated, needsAuth, loadWorkspaceBoard])

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

  if (loading && !board) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Загрузка доски...</p>
      </div>
    )
  }

  if (error || !board) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <h2 className="text-lg font-semibold">Не удалось открыть доску</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {error || 'Доска не найдена или недоступна в текущем workspace.'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.replace('/board/start')}>
            К первой доске
          </Button>
          <Button onClick={loadWorkspaceBoard}>Повторить</Button>
        </div>
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
          const remaining = boards.filter((b) => b.id !== deletedId)
          setBoards(remaining)
          if (remaining.length > 0) {
            const next = remaining[0]
            router.replace(`/board/${next.slug || next.id}`)
          } else {
            router.replace('/board/start')
          }
        }}
        onSelectBoard={(b) => {
          router.push(`/board/${b.slug || b.id}`)
        }}
        onOpenCreateBoard={() => setCreateDialogOpen(true)}
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
          if (deletedId === board.id) {
            showToast('Текущая доска была удалена', 'info')
            router.replace('/board/start')
          }
        }}
      />

      <CreateBoardDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        existingBoards={boards}
        onCreated={(created) => {
          const listItem = boardToBoardListItem(created)
          setBoards((prev) =>
            prev.some((b) => b.id === created.id) ? prev : [listItem, ...prev],
          )
          router.push(`/board/${created.slug || created.id}`)
        }}
      />
    </>
  )
}
