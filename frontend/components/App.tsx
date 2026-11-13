'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import {
  checkWorkspaceSession,
  createBoard,
  getBoard,
  getBoardBySlug,
  getBoards,
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
  const username = useAppStore((s) => s.username)
  const setUsername = useAppStore((s) => s.setUsername)
  const setCurrentBoard = useAppStore((s) => s.setCurrentBoard)
  const workspace = useAppStore((s) => s.workspace)
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)

  const [boards, setBoards] = useState<BoardListItem[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const needsAuth = !workspace || !username || username === 'Аноним'

  const loadWorkspaceBoard = useCallback(async () => {
    if (!hasHydrated || !workspace) return
    setLoading(true)
    setError(null)
    try {
      await checkWorkspaceSession()
      let list = await getBoards()
      if (list.length === 0) {
        const created = await createBoard('Моя первая ретро-доска')
        list = [boardToBoardListItem(created)]
      }
      setBoards(list)

      let target: Board | null = null
      if (!boardId || boardId === 'start') {
        const first = list[0]
        target = await getBoard(first.id)
        router.replace(`/board/${target.slug || target.id}`)
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
      if (status === 401 || !useAppStore.getState().workspace) {
        setBoard(null)
        return
      }
      setError(getApiErrorMessage(err, 'Не удалось загрузить доску'))
    } finally {
      setLoading(false)
    }
  }, [hasHydrated, workspace, boardId, router, setCurrentBoard])

  useEffect(() => {
    if (!hasHydrated) return
    if (needsAuth) {
      setLoading(false)
      return
    }
    loadWorkspaceBoard()
  }, [hasHydrated, needsAuth, loadWorkspaceBoard])

  if (!hasHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (needsAuth) {
    return (
      <WelcomeDialog
        onConfirm={(name) => {
          setUsername(name)
        }}
      />
    )
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
        key={board.id}
        board={board}
        boards={boards}
        workspaceName={workspace?.workspaceName || 'Команда'}
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
