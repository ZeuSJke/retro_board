'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import type { WsMessage } from '../types'

export function useWebSocket(
  boardId: string,
  onMessage: (msg: WsMessage) => void,
  onOpen?: () => void,
): { sendMessage: (msg: WsMessage) => void } {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  const wsRef = useRef<WebSocket | null>(null)

  const sendMessage = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  useEffect(() => {
    if (!boardId) return

    let cancelled = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (cancelled) return

      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const wsHost = process.env.NEXT_PUBLIC_WS_HOST || location.host
      const workspace = useAppStore.getState().workspace
      const wsToken = workspace?.token || ''
      const wsUrl = `${protocol}://${wsHost}/ws/${boardId}?workspace_token=${encodeURIComponent(wsToken)}`
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        onOpenRef.current?.()
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsMessage
          onMessageRef.current(msg)
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = () => {
        if (cancelled) return
        reconnectTimer = setTimeout(connect, 2000)
      }

      wsRef.current = ws
    }

    connect()

    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 25000)

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      clearInterval(ping)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [boardId])

  return { sendMessage }
}
