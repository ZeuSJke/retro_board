'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Plus, User } from 'lucide-react'
import { BrandMark } from '@/components/BrandLogo'
import { useWebSocket } from '@/hooks/useWebSocket'
import type { WsMessage } from '@/types'
import UserSettingsDialog from './UserSettingsDialog'
import { Button } from '@/components/ui/button'

interface NoBoardsScreenProps {
  workspaceName: string
  onCreateBoard: () => void
  /** В команде появилась доска (её создал кто-то другой): пора перечитать список. */
  onBoardAppeared: () => void
}

/**
 * Пустое состояние команды без досок: новая команда или удалена последняя доска.
 * Доску не создаём молча — участник сам выбирает название и шаблон.
 */
export default function NoBoardsScreen({
  workspaceName,
  onCreateBoard,
  onBoardAppeared,
}: NoBoardsScreenProps) {
  const [profileOpen, setProfileOpen] = useState(false)

  // Коллега создал первую доску — открываем её без перезагрузки страницы
  const handleWorkspaceEvent = useCallback(
    (msg: WsMessage) => {
      if (msg.event === 'board_created') onBoardAppeared()
    },
    [onBoardAppeared],
  )
  useWebSocket('workspace', handleWorkspaceEvent)

  return (
    <div
      data-testid="no-boards-screen"
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background bg-dot-grid px-6 py-10 text-center"
    >
      <BrandMark size={48} />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          В команде «{workspaceName}» пока нет досок
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Создайте доску для ретроспективы: выберите шаблон колонок и позовите команду. Если
          доску создаст кто-то из коллег, она откроется здесь сама.
        </p>
      </div>

      <Button size="lg" onClick={onCreateBoard} data-testid="empty-create-board-btn">
        <Plus className="h-4 w-4" />
        Создать доску
      </Button>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">
            <BarChart3 className="h-4 w-4 text-primary" />
            Панель управления
          </Link>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setProfileOpen(true)}
          data-testid="user-settings-btn"
        >
          <User className="h-4 w-4" />
          Профиль и выход
        </Button>
      </div>

      <UserSettingsDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  )
}
