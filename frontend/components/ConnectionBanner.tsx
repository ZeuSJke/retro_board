'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Loader2, RefreshCw, WifiOff } from 'lucide-react'
import type { BoardConnection } from '@/hooks/useBoardWebSocket'
import { Button } from '@/components/ui/button'

interface ConnectionBannerProps {
  connection: BoardConnection
  /** Подключиться снова вручную: сервер закрыл соединение, сам клиент больше не пробует. */
  onReconnect: () => void
}

/** Первое подключение обычно занимает доли секунды: баннер нужен, только если оно затянулось. */
const SLOW_CONNECT_MS = 3000

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

const isBrowserOnline = () => navigator.onLine
const assumeOnline = () => true

/**
 * Состояние связи на доске. Пока соединения нет, чужие изменения не приходят — участник
 * должен это видеть. После восстановления доска перечитывается, и баннер исчезает.
 */
export default function ConnectionBanner({ connection, onReconnect }: ConnectionBannerProps) {
  const browserOnline = useSyncExternalStore(subscribeOnline, isBrowserOnline, assumeOnline)
  const [slowConnect, setSlowConnect] = useState(false)

  useEffect(() => {
    if (connection !== 'connecting') return
    const timer = setTimeout(() => setSlowConnect(true), SLOW_CONNECT_MS)
    return () => {
      clearTimeout(timer)
      setSlowConnect(false)
    }
  }, [connection])

  if (connection === 'online') return null
  if (connection === 'connecting' && !slowConnect) return null

  const waiting = connection === 'connecting' || connection === 'reconnecting'
  const offline = waiting && !browserOnline

  let title: string
  let hint: string | null = null
  if (connection === 'closed') {
    title = 'Соединение с доской закрыто'
    hint = 'Изменения других участников не приходят.'
  } else if (connection === 'syncing') {
    title = 'Связь восстановлена. Обновляем доску…'
  } else if (connection === 'sync-failed') {
    title = 'Не удаётся обновить доску. Повторяем попытку…'
    hint = 'Изменения других участников могут быть не видны.'
  } else if (offline) {
    title = 'Нет подключения к интернету'
    hint = 'Доска обновится сама, когда связь появится.'
  } else if (connection === 'connecting') {
    title = 'Подключаемся к доске…'
  } else {
    title = 'Связь с сервером потеряна. Переподключаемся…'
    hint = 'Изменения других участников пока не видны.'
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
      data-state={connection}
      className="no-print flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs sm:px-4"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
        {connection === 'closed' || offline ? (
          <WifiOff className="h-3.5 w-3.5" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-foreground">{title}</span>
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
      {connection === 'closed' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 bg-background px-2.5 text-xs"
          onClick={onReconnect}
          data-testid="connection-retry-btn"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Подключиться снова
        </Button>
      )}
    </div>
  )
}
