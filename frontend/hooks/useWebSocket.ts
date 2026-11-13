'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type { WsMessage } from '../types'

const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 30000
const PING_INTERVAL_MS = 25000

export function useWebSocket(
  boardId: string,
  onMessage: (msg: WsMessage) => void,
  onOpen?: () => void,
): { sendMessage: (msg: WsMessage) => void; connected: boolean } {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  const wsRef = useRef<WebSocket | null>(null)
  const pendingQueueRef = useRef<WsMessage[]>([])
  const attemptsRef = useRef(0)
  const [connected, setConnected] = useState(false)
  // Токен воркспейса — в deps эффекта ниже: смена токена переподключает сокет
  const wsToken = useAppStore((s) => s.workspace?.token ?? '')

  const sendMessage = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
      return
    }
    // Не теряем пользовательские действия (старт ведущего, фаза, таймер, готово)
    // пока сокет ещё подключается или переподключается
    if (msg.event !== 'cursor_move' && msg.event !== 'cursor_leave') {
      pendingQueueRef.current = [...pendingQueueRef.current.slice(-19), msg]
    }
  }, [])

  useEffect(() => {
    if (!boardId || !wsToken) return

    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleReconnect = () => {
      if (cancelled) return
      // Exponential backoff 2s → 30s cap + jitter против синхронных переподключений
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptsRef.current, RECONNECT_MAX_MS)
      attemptsRef.current += 1
      reconnectTimer = setTimeout(connect, delay + Math.random() * 1000)
    }

    const connect = () => {
      if (cancelled || typeof WebSocket === 'undefined') return

      // Закрыть старый сокет перед новым connect (смена токена/boardId),
      // подавив его onclose чтобы не планировать лишнее переподключение
      const prev = wsRef.current
      wsRef.current = null
      if (prev) {
        prev.onclose = null
        prev.close()
      }

      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const wsHost = process.env.NEXT_PUBLIC_WS_HOST || location.host
      const wsUrl = `${protocol}://${wsHost}/ws/${boardId}`
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        if (cancelled) return
        attemptsRef.current = 0
        setConnected(true)
        onOpenRef.current?.()
        if (pendingQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
          const queued = pendingQueueRef.current
          pendingQueueRef.current = []
          queued.forEach((m) => ws.send(JSON.stringify(m)))
        }
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsMessage
          onMessageRef.current(msg)
        } catch { /* ignore malformed messages */ }
      }

      ws.onerror = () => {
        // onclose последует автоматически и запланирует reconnect
        ws.close()
      }

      ws.onclose = () => {
        setConnected(false)
        scheduleReconnect()
      }

      wsRef.current = ws
    }

    connect()

    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, PING_INTERVAL_MS)

    return () => {
      cancelled = true
      pendingQueueRef.current = []
      if (reconnectTimer) clearTimeout(reconnectTimer)
      clearInterval(ping)
      wsRef.current?.close()
      wsRef.current = null
      setConnected(false)
    }
  }, [boardId, wsToken])

  return { sendMessage, connected }
}
