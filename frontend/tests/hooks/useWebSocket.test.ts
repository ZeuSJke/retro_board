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
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    session.participant = { id: 'p-1', name: 'Анна' }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  function setup(boardId = 'board-1', onMessage = vi.fn(), onOpen = vi.fn()) {
    const hook = renderHook(() => useWebSocket(boardId, onMessage, onOpen))
    const ws = MockWebSocket.instances[0]
    return { ...hook, ws, onMessage, onOpen }
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

  it('calls onOpen when the socket opens', () => {
    const { ws, onOpen } = setup()
    act(() => {
      ws.onopen?.({})
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('forwards parsed messages to onMessage', () => {
    const { ws, onMessage } = setup()
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ event: 'ping', data: {} }) })
    })
    expect(onMessage).toHaveBeenCalledWith({ event: 'ping', data: {} })
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
    ws.readyState = MockWebSocket.OPEN
    act(() => {
      vi.advanceTimersByTime(25000)
    })
    expect(ws.send).toHaveBeenCalledWith('ping')
    act(() => {
      vi.advanceTimersByTime(25000)
    })
    expect(ws.send).toHaveBeenCalledTimes(2)
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
})
