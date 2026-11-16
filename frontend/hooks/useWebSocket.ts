'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import type { WsMessage } from '../types'
import { parseWsMessage } from '../utils/wsData'

const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 30000
const PING_INTERVAL_MS = 25000
/** Сколько ждать ответа на `ping`, прежде чем считать соединение зависшим. */
const PONG_TIMEOUT_MS = 10000
/** После сна ноутбука, возврата на вкладку или смены сети проверяем соединение быстрее. */
const RESUME_PONG_TIMEOUT_MS = 4000
/**
 * Сколько сообщение ждёт в очереди, пока сокет подключается. Действие, сделанное в момент
 * короткого обрыва, дойдёт; после долгого офлайна устаревшие команды («запустить таймер»,
 * «следующая фаза») не выполняются задним числом.
 */
const QUEUE_TTL_MS = 5000
const QUEUE_LIMIT = 20
/** Сообщения, которые нет смысла отправлять позже: к моменту подключения они устарели. */
const NEVER_QUEUED = new Set(['cursor_move', 'cursor_leave', 'card_typing', 'identify'])

/** Сервер закрыл сокет сам: сессия завершена (выход, отзыв доступа). */
export const WS_CLOSE_POLICY_VIOLATION = 1008
/** Код без кадра закрытия: обрыв связи или отказ сервера при рукопожатии. */
const WS_CLOSE_ABNORMAL = 1006

/**
 * - `connecting` — первое подключение;
 * - `open` — соединение есть;
 * - `reconnecting` — связь потеряна, идут попытки подключиться;
 * - `closed` — попытки остановлены: сервер закрыл сокет с кодом 1008 или вызван `stop()`.
 */
export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface WsOpenInfo {
  /** Сокет уже открывался раньше: пока связи не было, события могли быть пропущены. */
  reconnected: boolean
}

export interface WsCloseInfo {
  code: number
  reason: string
  /** Сокет успел открыться (иначе сервер отказал при рукопожатии или сети нет). */
  wasOpen: boolean
  /** Сколько попыток подключения подряд закончились, не открыв сокет. */
  failedAttempts: number
}

export interface UseWebSocketOptions {
  /** Сокет закрылся не по нашей инициативе. */
  onClose?: (info: WsCloseInfo) => void
  /**
   * Сервер отвечает на `ping` событием `pong` — молчание в ответ означает зависшее соединение.
   * Поддерживается и на сокете доски (`/ws/{board_id}`), и на сокете команды (`/ws/workspace`).
   */
  expectPong?: boolean
}

interface QueuedMessage {
  msg: WsMessage
  at: number
}

interface SocketControls {
  reconnect: () => void
  stop: () => void
}

export function useWebSocket(
  boardId: string,
  onMessage: (msg: WsMessage) => void,
  onOpen?: (info: WsOpenInfo) => void,
  options?: UseWebSocketOptions,
): {
  sendMessage: (msg: WsMessage) => void
  connected: boolean
  status: WsStatus
  /** Подключиться сейчас, не дожидаясь таймера (в том числе после `closed`). */
  reconnect: () => void
  /** Закрыть сокет и больше не подключаться: доска удалена или недоступна. */
  stop: () => void
} {
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const onCloseRef = useRef(options?.onClose)
  useEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current = onOpen
    onCloseRef.current = options?.onClose
  })
  const expectPong = Boolean(options?.expectPong)

  const wsRef = useRef<WebSocket | null>(null)
  const pendingQueueRef = useRef<QueuedMessage[]>([])
  const controlsRef = useRef<SocketControls | null>(null)
  const [status, setStatus] = useState<WsStatus>('connecting')
  // Сервер берёт сессию из httpOnly-cookie при рукопожатии и закрепляет за сокетом участника.
  // Участник — в deps эффекта ниже: без сессии не подключаемся, повторный вход переподключает сокет.
  const sessionKey = useAppStore((s) => s.participant?.id ?? '')

  const sendMessage = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
      return
    }
    if (NEVER_QUEUED.has(msg.event)) return
    // Не теряем действие, сделанное, пока сокет подключается (старт ведущего, фаза, готово),
    // но и не копим: устаревшее отбрасывается здесь и ещё раз при отправке
    const now = Date.now()
    pendingQueueRef.current = [
      ...pendingQueueRef.current
        .filter((queued) => now - queued.at < QUEUE_TTL_MS)
        .slice(-(QUEUE_LIMIT - 1)),
      { msg, at: now },
    ]
  }, [])

  useEffect(() => {
    if (!boardId || !sessionKey) return

    let cancelled = false
    // Автоматических попыток больше нет: код 1008 или stop()
    let stopped = false
    let attempts = 0
    let failedAttempts = 0
    // Сокет открывался хотя бы раз за жизнь этого подключения
    let everOpened = false
    let lastSeenAt = 0
    let lastTickAt = Date.now()
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pongTimer: ReturnType<typeof setTimeout> | null = null

    const clearReconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const clearPong = () => {
      if (pongTimer) clearTimeout(pongTimer)
      pongTimer = null
    }

    // Закрыть сокет, подавив его обработчики: о закрытии по нашей инициативе не сообщаем
    const dropSocket = () => {
      const prev = wsRef.current
      wsRef.current = null
      if (!prev) return
      prev.onopen = null
      prev.onmessage = null
      prev.onerror = null
      prev.onclose = null
      prev.close()
    }

    const scheduleReconnect = () => {
      if (cancelled || stopped) return
      // Exponential backoff 2s → 30s cap + jitter против синхронных переподключений
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS)
      attempts += 1
      clearReconnect()
      reconnectTimer = setTimeout(connect, delay + Math.random() * 1000)
    }

    const connect = () => {
      if (cancelled || stopped || typeof WebSocket === 'undefined') return
      clearReconnect()
      clearPong()
      dropSocket()

      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const wsHost = process.env.NEXT_PUBLIC_WS_HOST || location.host
      const wsUrl = `${protocol}://${wsHost}/ws/${boardId}`
      const ws = new WebSocket(wsUrl)
      let wasOpen = false

      ws.onopen = () => {
        if (cancelled || wsRef.current !== ws) return
        wasOpen = true
        attempts = 0
        failedAttempts = 0
        lastSeenAt = Date.now()
        setStatus('open')
        onOpenRef.current?.({ reconnected: everOpened })
        everOpened = true
        if (pendingQueueRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
          const now = Date.now()
          const queued = pendingQueueRef.current
          pendingQueueRef.current = []
          queued
            .filter((item) => now - item.at < QUEUE_TTL_MS)
            .forEach((item) => ws.send(JSON.stringify(item.msg)))
        }
      }

      ws.onmessage = (e) => {
        // Любое сообщение — признак живого соединения
        lastSeenAt = Date.now()
        clearPong()
        let msg: WsMessage | null
        try {
          msg = parseWsMessage(JSON.parse(e.data as string))
        } catch {
          return // ignore malformed messages
        }
        if (!msg) return
        // Ответ на наш ping: служебное сообщение, обработчикам доски не нужно
        if (msg.event === 'pong') return
        onMessageRef.current(msg)
      }

      ws.onerror = () => {
        // onclose последует автоматически и запланирует reconnect
        ws.close()
      }

      ws.onclose = (e?: Partial<CloseEvent>) => {
        if (wsRef.current !== ws) return
        wsRef.current = null
        clearPong()
        if (cancelled) return
        if (!wasOpen) failedAttempts += 1
        const code = typeof e?.code === 'number' ? e.code : WS_CLOSE_ABNORMAL
        if (code === WS_CLOSE_POLICY_VIOLATION) {
          // Сервер закрыл сокет сам: переподключаться по кругу бессмысленно
          stopped = true
          clearReconnect()
          setStatus('closed')
        } else {
          setStatus(everOpened ? 'reconnecting' : 'connecting')
          scheduleReconnect()
        }
        onCloseRef.current?.({
          code,
          reason: typeof e?.reason === 'string' ? e.reason : '',
          wasOpen,
          failedAttempts,
        })
      }

      wsRef.current = ws
    }

    const reconnectNow = () => {
      if (cancelled) return
      stopped = false
      attempts = 0
      setStatus(everOpened ? 'reconnecting' : 'connecting')
      connect()
    }

    // Проверить, что соединение живо: сервер отвечает на текстовый ping событием pong.
    // Молчание дольше timeoutMs — соединение зависло (полуоткрытый TCP после сна или смены сети).
    // Если сервер на ping не отвечает (сокет команды), ping только поддерживает соединение.
    const probe = (timeoutMs: number) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const sentAt = Date.now()
      ws.send('ping')
      if (!expectPong) return
      clearPong()
      pongTimer = setTimeout(() => {
        pongTimer = null
        if (cancelled || wsRef.current !== ws || lastSeenAt > sentAt) return
        reconnectNow()
      }, timeoutMs)
    }

    // Сеть вернулась или вкладку снова открыли: сверяемся сразу, а не по таймеру
    const checkNow = (restartHandshake: boolean) => {
      if (cancelled || stopped) return
      const ws = wsRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        probe(RESUME_PONG_TIMEOUT_MS)
      } else if (!ws || ws.readyState !== WebSocket.CONNECTING || restartHandshake) {
        reconnectNow()
      }
    }

    const handleOnline = () => checkNow(true)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkNow(false)
    }

    connect()

    const tick = setInterval(() => {
      const now = Date.now()
      // Таймер сработал заметно позже срока — вкладка спала (ноутбук закрыли)
      const slept = now - lastTickAt > PING_INTERVAL_MS + 5000
      lastTickAt = now
      if (slept) checkNow(false)
      else probe(PONG_TIMEOUT_MS)
    }, PING_INTERVAL_MS)

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)

    controlsRef.current = {
      reconnect: reconnectNow,
      stop: () => {
        if (cancelled) return
        stopped = true
        clearReconnect()
        clearPong()
        dropSocket()
        setStatus('closed')
      },
    }

    return () => {
      cancelled = true
      controlsRef.current = null
      pendingQueueRef.current = []
      clearReconnect()
      clearPong()
      clearInterval(tick)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
      dropSocket()
      setStatus('connecting')
    }
  }, [boardId, sessionKey, expectPong])

  const reconnect = useCallback(() => controlsRef.current?.reconnect(), [])
  const stop = useCallback(() => controlsRef.current?.stop(), [])

  return { sendMessage, connected: status === 'open', status, reconnect, stop }
}
