'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import { getBoards } from '../api'
import { Button } from '../components/ui/button'
import { FIRST_BOARD_ROUTE, boardPath } from '../lib/board-routes'
import { getApiErrorMessage, getApiErrorStatus } from '../utils/apiError'

/**
 * Главная: выбирает, какую доску открыть. Без сессии и без досок ведёт на `/board/start` —
 * там приложение покажет вход или пустое состояние команды.
 */
export default function HomePage() {
  const router = useRouter()
  const currentBoardId = useAppStore((s) => s.currentBoardId)
  // Сессия — это команда и участник: без участника запросы всё равно вернут 401
  const hasSession = useAppStore((s) => Boolean(s.workspace && s.participant))
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!hasHydrated) return
    let cancelled = false
    void (async () => {
      // Экран входа живёт на странице доски: после входа откроется нужная доска
      const loginRoute = currentBoardId ? `/board/${currentBoardId}` : FIRST_BOARD_ROUTE
      if (!hasSession) {
        router.replace(loginRoute)
        return
      }
      try {
        const list = await getBoards()
        if (cancelled) return
        if (list.length === 0) {
          // Досок нет: молча не создаём — страница доски покажет пустое состояние
          router.replace(FIRST_BOARD_ROUTE)
          return
        }
        const target = list.find((b) => b.id === currentBoardId) ?? list[0]
        router.replace(boardPath(target))
      } catch (err: unknown) {
        if (cancelled) return
        if (getApiErrorStatus(err) === 401 || !useAppStore.getState().participant) {
          router.replace(loginRoute)
          return
        }
        // Любая другая ошибка — не вечный индикатор загрузки, а сообщение с повтором
        setError(getApiErrorMessage(err, 'Проверьте соединение и попробуйте ещё раз.'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasHydrated, router, hasSession, currentBoardId, attempt])

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      >
        <h1 className="text-lg font-semibold">Не удалось загрузить доски команды</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        >
          Повторить
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Открываем доску команды...</p>
    </div>
  )
}
