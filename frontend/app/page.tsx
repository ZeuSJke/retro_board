'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '../store'
import { createBoard, getBoards } from '../api'
import { boardToBoardListItem } from '../utils/boardMapper'

export default function HomePage() {
  const router = useRouter()
  const currentBoardId = useAppStore((s) => s.currentBoardId)
  const workspace = useAppStore((s) => s.workspace)
  const hasHydrated = useAppStore((s) => s._hasHydrated ?? true)

  useEffect(() => {
    if (!hasHydrated) return
    let cancelled = false
    ;(async () => {
      if (!workspace) {
        router.replace(currentBoardId ? `/board/${currentBoardId}` : '/board/start')
        return
      }
      try {
        let list = await getBoards()
        if (cancelled) return
        if (list.length === 0) {
          const board = await createBoard('Моя первая ретро-доска')
          if (cancelled) return
          list = [boardToBoardListItem(board)]
        }
        const target =
          currentBoardId && list.find((b) => b.id === currentBoardId)
            ? list.find((b) => b.id === currentBoardId)!
            : list[0]
        router.replace(`/board/${target.slug || target.id}`)
      } catch (err: unknown) {
        if (cancelled) return
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 401 || !useAppStore.getState().workspace) {
          router.replace(currentBoardId ? `/board/${currentBoardId}` : '/board/start')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasHydrated, router, workspace, currentBoardId])

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm">Загрузка рабочего пространства...</p>
    </div>
  )
}
