import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../hooks/useWebSocket'

vi.mock('../../store', () => {
  // Хук вызывает useAppStore как селектор-функцию: useAppStore((s) => s.workspace?.token)
  const useAppStore = (selector: (s: { workspace: { token: string } | null }) => string) =>
    selector({ workspace: { token: 'test-token' } })
  useAppStore.getState = () => ({ workspace: { token: 'test-token' } })
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
})
