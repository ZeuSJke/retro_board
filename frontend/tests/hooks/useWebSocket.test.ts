import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../hooks/useWebSocket'

// Сессию хук берёт из стора: подключается, только когда есть участник
const session = vi.hoisted((): { participant: { id: string; name: string } | null } => ({
  participant: { id: 'p-1', name: 'Анна' },
}))

vi.mock('../../store', () => {
  // Хук вызывает useAppStore как селектор-функцию: useAppStore((s) => s.participant?.id)
  const useAppStore = <T,>(selector: (s: typeof session) => T) => selector(session)
  useAppStore.getState = () => session
  return { useAppStore }
})

// --- Mock WebSocket ---------------------------------------------------------

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  /** Сервер принял соединение. */
  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.({})
  }

  /** Сервер прислал сообщение. */
  receive(payload: unknown) {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) })
  }

  /** Соединение закрылось не по нашей инициативе. */
  drop(code = 1006, reason = '') {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

const lastSocket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1]
const pingsSent = (ws: MockWebSocket) => ws.send.mock.calls.filter(([frame]) => frame === 'ping').length

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    session.participant = { id: 'p-1', name: 'Анна' }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // По умолчанию — сокет доски: сервер отвечает на ping
  function setup(
    boardId = 'board-1',
    onMessage = vi.fn(),
    onOpen = vi.fn(),
    onClose = vi.fn(),
    expectPong = true,
  ) {
    const hook = renderHook(() => useWebSocket(boardId, onMessage, onOpen, { onClose, expectPong }))
    const ws = MockWebSocket.instances[0]
    return { ...hook, ws, onMessage, onOpen, onClose }
  }

  it('connects on mount with board id and does not leak workspace token in url', () => {
    setup()
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toContain('/ws/board-1')
    expect(MockWebSocket.instances[0].url).not.toContain('workspace_token')
  })

  it('без участника (сессии нет) не подключается', () => {
    session.participant = null
    setup()
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('повторный вход другим участником переподключает сокет', () => {
    const { rerender, ws } = setup()
    expect(MockWebSocket.instances).toHaveLength(1)

    session.participant = { id: 'p-2', name: 'Анна' }
    rerender()

    expect(ws.close).toHaveBeenCalled()
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('смена имени участника сокет не трогает', () => {
    const { rerender, ws } = setup()

    session.participant = { id: 'p-1', name: 'Анна Петрова' }
    rerender()

    expect(ws.close).not.toHaveBeenCalled()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('повторные рендеры с теми же доской и участником не открывают второй сокет', () => {
    // Сверка сессии с сервером записывает в стор нового по ссылке участника с тем же id
    const { rerender, ws } = setup()
    act(() => ws.open())

    for (let i = 0; i < 5; i += 1) {
      session.participant = { id: 'p-1', name: 'Анна' }
      rerender()
    }

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('calls onOpen when the socket opens', () => {
    const { ws, onOpen } = setup()
    act(() => {
      ws.onopen?.({})
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith({ reconnected: false })
  })

  it('forwards parsed messages to onMessage', () => {
    const { ws, onMessage } = setup()
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ event: 'card_created', data: {} }) })
    })
    expect(onMessage).toHaveBeenCalledWith({ event: 'card_created', data: {} })
  })

  it('номер и поколение события доходят до обработчика вместе с данными', () => {
    const { ws, onMessage } = setup()
    act(() => ws.receive({ event: 'card_updated', seq: 7, epoch: 'e1', data: { id: 'c' } }))
    expect(onMessage).toHaveBeenCalledWith({ event: 'card_updated', seq: 7, epoch: 'e1', data: { id: 'c' } })
  })

  it('reconnects after onclose with 2s backoff', () => {
    const { ws } = setup()
    act(() => {
      ws.onclose?.({})
    })
    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => {
      // backoff 2s + jitter до 1s → продвигаем 3s чтобы покрыть максимум
      vi.advanceTimersByTime(3000)
    })
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('does not reconnect after unmount', () => {
    const { ws, unmount } = setup()
    unmount()
    act(() => {
      ws.onclose?.({})
      vi.advanceTimersByTime(5000)
    })
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('sends ping every 25s while the socket is open', () => {
    const { ws } = setup()
    act(() => ws.open())
    act(() => {
      vi.advanceTimersByTime(25000)
    })
    expect(ws.send).toHaveBeenCalledWith('ping')
    // Сервер отвечает — соединение живо
    act(() => ws.receive({ event: 'pong', data: {} }))
    act(() => {
      vi.advanceTimersByTime(25000)
    })
    expect(pingsSent(ws)).toBe(2)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('does not ping when the socket is not open', () => {
    const { ws } = setup()
    ws.readyState = MockWebSocket.CONNECTING
    act(() => {
      vi.advanceTimersByTime(50000)
    })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('cleanup closes the socket and clears the ping interval', () => {
    const { ws, unmount } = setup()
    ws.readyState = MockWebSocket.OPEN
    unmount()
    expect(ws.close).toHaveBeenCalledTimes(1)
    ws.send.mockClear()
    act(() => {
      vi.advanceTimersByTime(60000)
    })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('ignores malformed JSON without calling onMessage', () => {
    const { ws, onMessage } = setup()
    act(() => {
      ws.onmessage?.({ data: 'not-json{{{broken' })
    })
    expect(onMessage).not.toHaveBeenCalled()
    // Сокет после битого сообщения остаётся живым
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ event: 'ok', data: {} }) })
    })
    expect(onMessage).toHaveBeenCalledWith({ event: 'ok', data: {} })
  })

  it('queues non-cursor actions sent while connecting and flushes on open after onOpen', () => {
    const order: string[] = []
    const onOpen = vi.fn(() => {
      order.push('identify')
    })
    const { result, ws } = setup('board-1', vi.fn(), onOpen)

    act(() => {
      result.current.sendMessage({ event: 'cursor_move', data: { x: 1, y: 2 } })
      result.current.sendMessage({ event: 'facilitator_start', data: {} })
    })
    expect(ws.send).not.toHaveBeenCalled()

    ws.readyState = MockWebSocket.OPEN
    ws.send.mockImplementation((raw: string) => {
      order.push(JSON.parse(raw).event)
    })
    act(() => {
      ws.onopen?.({})
    })

    expect(order).toEqual(['identify', 'facilitator_start'])
    expect(ws.send).toHaveBeenCalledTimes(1)
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ event: 'facilitator_start', data: {} }))
  })

  describe('состояние соединения', () => {
    it('connecting → open → reconnecting → open', () => {
      const { result, ws } = setup()
      expect(result.current.status).toBe('connecting')
      expect(result.current.connected).toBe(false)

      act(() => ws.open())
      expect(result.current.status).toBe('open')
      expect(result.current.connected).toBe(true)

      act(() => ws.drop())
      expect(result.current.status).toBe('reconnecting')
      expect(result.current.connected).toBe(false)

      act(() => {
        vi.advanceTimersByTime(3000)
      })
      act(() => lastSocket().open())
      expect(result.current.status).toBe('open')
    })

    it('повторное открытие помечено reconnected: события за время обрыва могли потеряться', () => {
      const { ws, onOpen } = setup()
      act(() => ws.open())
      act(() => ws.drop())
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      act(() => lastSocket().open())

      expect(onOpen).toHaveBeenCalledTimes(2)
      expect(onOpen).toHaveBeenNthCalledWith(1, { reconnected: false })
      expect(onOpen).toHaveBeenNthCalledWith(2, { reconnected: true })
    })

    it('первое подключение не удалось: статус остаётся connecting, попытки продолжаются', () => {
      const { result, ws, onClose } = setup()
      act(() => ws.drop())
      expect(result.current.status).toBe('connecting')
      expect(onClose).toHaveBeenCalledWith({ code: 1006, reason: '', wasOpen: false, failedAttempts: 1 })
    })

    it('считает подряд идущие неудачные рукопожатия и сбрасывает счёт после успеха', () => {
      const { ws, onClose } = setup()
      act(() => ws.drop())
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      act(() => lastSocket().drop())
      expect(onClose).toHaveBeenLastCalledWith(expect.objectContaining({ failedAttempts: 2, wasOpen: false }))

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      act(() => lastSocket().open())
      act(() => lastSocket().drop())
      expect(onClose).toHaveBeenLastCalledWith(expect.objectContaining({ failedAttempts: 0, wasOpen: true }))
    })
  })

  describe('зависшее соединение (ping без ответа)', () => {
    it('нет ответа на ping за 10 секунд — сокет закрывается и подключается новый', () => {
      const { result, ws } = setup()
      act(() => ws.open())

      act(() => {
        vi.advanceTimersByTime(25000)
      })
      expect(pingsSent(ws)).toBe(1)
      act(() => {
        vi.advanceTimersByTime(9999)
      })
      expect(MockWebSocket.instances).toHaveLength(1)

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(ws.close).toHaveBeenCalled()
      expect(MockWebSocket.instances).toHaveLength(2)
      expect(result.current.status).toBe('reconnecting')
    })

    it('любое сообщение сервера считается признаком жизни', () => {
      const { ws } = setup()
      act(() => ws.open())
      act(() => {
        vi.advanceTimersByTime(25000)
      })
      act(() => ws.receive({ event: 'cursor_move', data: {} }))
      act(() => {
        vi.advanceTimersByTime(15000)
      })
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(ws.close).not.toHaveBeenCalled()
    })

    it('pong — служебное сообщение: до обработчика доски не доходит', () => {
      const { ws, onMessage } = setup()
      act(() => ws.open())
      act(() => ws.receive({ event: 'pong', data: {} }))
      expect(onMessage).not.toHaveBeenCalled()
    })
  })

  describe('сокет команды: сервер на ping не отвечает', () => {
    const setupWorkspace = () => setup('workspace', vi.fn(), vi.fn(), vi.fn(), false)

    it('ping отправляется, но молчание в ответ не считается обрывом', () => {
      const { ws } = setupWorkspace()
      act(() => ws.open())

      act(() => {
        vi.advanceTimersByTime(25000)
      })
      expect(pingsSent(ws)).toBe(1)

      // Пять минут без единого сообщения: соединение то же
      act(() => {
        vi.advanceTimersByTime(300_000)
      })
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(ws.close).not.toHaveBeenCalled()
      expect(pingsSent(ws)).toBeGreaterThan(5)
    })

    it('возврат на вкладку и online не рвут открытое соединение', () => {
      const { ws } = setupWorkspace()
      act(() => ws.open())

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
        window.dispatchEvent(new Event('online'))
        vi.advanceTimersByTime(30_000)
      })

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(ws.close).not.toHaveBeenCalled()
    })

    it('потерянное соединение по-прежнему восстанавливается сразу при online', () => {
      const { ws } = setupWorkspace()
      act(() => ws.open())
      act(() => ws.drop())

      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('без настроек (как у панели управления) проверка по pong выключена', () => {
      const hook = renderHook(() => useWebSocket('workspace', vi.fn()))
      const ws = MockWebSocket.instances[0]
      act(() => ws.open())
      act(() => {
        vi.advanceTimersByTime(120_000)
      })
      expect(MockWebSocket.instances).toHaveLength(1)
      hook.unmount()
    })
  })

  describe('код закрытия 1008', () => {
    it('сервер закрыл сокет с кодом 1008 — попытки подключения прекращаются', () => {
      const { result, ws, onClose } = setup()
      act(() => ws.open())
      act(() => ws.drop(1008, 'Session ended'))

      expect(result.current.status).toBe('closed')
      expect(onClose).toHaveBeenCalledWith({
        code: 1008,
        reason: 'Session ended',
        wasOpen: true,
        failedAttempts: 0,
      })

      act(() => {
        vi.advanceTimersByTime(120_000)
      })
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('код 4008 (медленный клиент) не останавливает переподключение, в отличие от 1008', () => {
      const { result, ws, onClose } = setup()
      act(() => ws.open())
      act(() => ws.drop(4008, 'Slow consumer'))

      expect(result.current.status).toBe('reconnecting')
      expect(onClose).toHaveBeenCalledWith({
        code: 4008,
        reason: 'Slow consumer',
        wasOpen: true,
        failedAttempts: 0,
      })

      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(MockWebSocket.instances).toHaveLength(2)
      act(() => lastSocket().open())
      expect(result.current.status).toBe('open')
    })

    it('reconnect() подключается снова вручную', () => {
      const { result, ws } = setup()
      act(() => ws.open())
      act(() => ws.drop(1008))

      act(() => result.current.reconnect())

      expect(MockWebSocket.instances).toHaveLength(2)
      expect(result.current.status).toBe('reconnecting')
      act(() => lastSocket().open())
      expect(result.current.status).toBe('open')
    })

    it('stop() закрывает сокет и больше не подключается (доска удалена)', () => {
      const { result, ws, onClose } = setup()
      act(() => ws.open())

      act(() => result.current.stop())

      expect(ws.close).toHaveBeenCalled()
      expect(result.current.status).toBe('closed')
      // О закрытии по нашей инициативе не сообщаем
      expect(onClose).not.toHaveBeenCalled()
      act(() => {
        vi.advanceTimersByTime(120_000)
        window.dispatchEvent(new Event('online'))
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })

  describe('сеть вернулась, вкладку снова открыли', () => {
    it('online: не дожидаясь таймера, подключается сразу', () => {
      const { ws } = setup()
      act(() => ws.open())
      act(() => ws.drop())
      expect(MockWebSocket.instances).toHaveLength(1)

      act(() => {
        window.dispatchEvent(new Event('online'))
      })

      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('online при открытом сокете: проверяет соединение и переподключается, если ответа нет', () => {
      const { ws } = setup()
      act(() => ws.open())

      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      expect(pingsSent(ws)).toBe(1)

      // После смены сети старое соединение мертво: ответа нет 4 секунды
      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(ws.close).toHaveBeenCalled()
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('online при живом сокете: ответ пришёл — соединение остаётся', () => {
      const { ws } = setup()
      act(() => ws.open())
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      act(() => ws.receive({ event: 'pong', data: {} }))
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('возврат на вкладку: потерянное соединение восстанавливается сразу', () => {
      const { ws } = setup()
      act(() => ws.open())
      act(() => ws.drop())

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('возврат на вкладку во время рукопожатия не начинает его заново', () => {
      setup()
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('после сна ноутбука соединение проверяется ускоренно', () => {
      const { ws } = setup()
      act(() => ws.open())

      // Часы ушли вперёд на десять минут, и только потом сработал таймер
      vi.setSystemTime(new Date(Date.now() + 600_000))
      act(() => {
        vi.advanceTimersByTime(25000)
      })
      expect(pingsSent(ws)).toBe(1)

      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(MockWebSocket.instances).toHaveLength(2)
    })
  })

  describe('очередь исходящих', () => {
    it('действие, сделанное во время короткого обрыва, доходит после подключения', () => {
      const { result, ws } = setup()
      act(() => ws.open())
      act(() => ws.drop())

      act(() => {
        result.current.sendMessage({ event: 'ready_toggle', data: {} })
      })
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      const next = lastSocket()
      act(() => next.open())

      expect(next.send).toHaveBeenCalledWith(JSON.stringify({ event: 'ready_toggle', data: {} }))
    })

    it('после долгого офлайна устаревшие управляющие команды не отправляются', () => {
      const { result, ws } = setup()
      act(() => ws.open())
      act(() => ws.drop())

      act(() => {
        result.current.sendMessage({ event: 'timer_start', data: { duration: 300, remaining: 300 } })
        result.current.sendMessage({ event: 'phase_change', data: { phase: 'vote' } })
      })
      // Связи не было минуту: запускать таймер и менять фазу задним числом нельзя
      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      const next = lastSocket()
      act(() => next.open())

      expect(next.send).not.toHaveBeenCalled()
    })

    it('устаревшее отбрасывается, свежее — отправляется', () => {
      const { result, ws } = setup()
      act(() => ws.open())
      act(() => ws.drop())

      act(() => {
        result.current.sendMessage({ event: 'timer_start', data: { duration: 60, remaining: 60 } })
      })
      act(() => {
        vi.advanceTimersByTime(20_000)
      })
      act(() => {
        result.current.sendMessage({ event: 'reaction', data: { emoji: '🔥' } })
      })
      const next = lastSocket()
      act(() => next.open())

      expect(next.send).toHaveBeenCalledTimes(1)
      expect(next.send).toHaveBeenCalledWith(JSON.stringify({ event: 'reaction', data: { emoji: '🔥' } }))
    })

    it('курсор и набор текста в очередь не попадают вовсе', () => {
      const { result, ws } = setup()
      act(() => {
        result.current.sendMessage({ event: 'cursor_move', data: { x: 1, y: 1 } })
        result.current.sendMessage({ event: 'cursor_leave', data: {} })
        result.current.sendMessage({ event: 'card_typing', data: { column_id: 'c', is_typing: true } })
      })
      act(() => ws.open())
      expect(ws.send).not.toHaveBeenCalled()
    })
  })
})
