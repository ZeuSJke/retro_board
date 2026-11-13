import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimer } from '../../hooks/useTimer'
import type { WsMessage } from '../../types'

vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      username: 'TestUser',
      theme: { primary: '#4F46E5', dark: false },
      setUsername: vi.fn(),
      setCurrentBoard: vi.fn(),
      setTheme: vi.fn(),
      currentBoardId: null,
    }),
}))

describe('useTimer', () => {
  let sendWs: ReturnType<typeof vi.fn<(msg: WsMessage) => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    sendWs = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial timer state', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))
    expect(result.current.timer).toEqual({ duration: 300, remaining: 300, running: false })
    expect(result.current.autoAdvance).toBe(false)
    expect(result.current.soundMuted).toBe(false)
  })

  it('handleTimerWsEvent starts countdown on timer_start', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    expect(result.current.timer.running).toBe(true)
    expect(result.current.timer.duration).toBe(120)
    expect(result.current.timer.remaining).toBe(120)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.timer.remaining).toBe(115)
  })

  it('handleTimerWsEvent pauses countdown on timer_pause', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.timer.remaining).toBe(117)

    act(() => {
      result.current.handleTimerWsEvent('timer_pause', { remaining: 117 })
    })

    expect(result.current.timer.running).toBe(false)
    expect(result.current.timer.remaining).toBe(117)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.timer.remaining).toBe(117)
  })

  it('handleTimerWsEvent resets timer on timer_reset', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    act(() => {
      result.current.handleTimerWsEvent('timer_reset', { duration: 300 })
    })

    expect(result.current.timer).toEqual({ duration: 300, remaining: 300, running: false })
  })

  it('countdown stops at zero', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 3,
        remaining: 3,
        ts: Date.now(),
      })
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.timer.remaining).toBe(0)
    expect(result.current.timer.running).toBe(false)
  })

  it('restoreTimer loads from localStorage', () => {
    const saved = {
      duration: 600,
      remaining: 450,
      running: false,
      savedAt: Date.now(),
    }
    localStorage.setItem('retro_timer_board-1', JSON.stringify(saved))

    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.restoreTimer('board-1')
    })

    expect(result.current.timer.duration).toBe(600)
    expect(result.current.timer.remaining).toBe(450)
    expect(result.current.timer.running).toBe(false)
  })

  it('restoreTimer adjusts elapsed time for running timer', () => {
    const savedAt = Date.now() - 10000
    const saved = {
      duration: 600,
      remaining: 300,
      running: true,
      savedAt,
    }
    localStorage.setItem('retro_timer_board-1', JSON.stringify(saved))

    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.restoreTimer('board-1')
    })

    expect(result.current.timer.remaining).toBe(290)
    expect(result.current.timer.running).toBe(true)
  })

  it('persists timer state to localStorage', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.restoreTimer('board-1')
    })

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    const stored = JSON.parse(localStorage.getItem('retro_timer_board-1') || '{}')
    expect(stored.duration).toBe(120)
    expect(stored.running).toBe(true)
  })

  it('setAutoAdvance and toggleSoundMuted update flags', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => result.current.setAutoAdvance(true))
    expect(result.current.autoAdvance).toBe(true)

    act(() => result.current.toggleSoundMuted())
    expect(result.current.soundMuted).toBe(true)
  })

  it('handleTimerStart sends timer_start WS event', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.handleTimerStart(300, 300)
    })

    expect(sendWs).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'timer_start',
        data: expect.objectContaining({ duration: 300, remaining: 300 }),
      }),
    )
  })

  it('handleTimerPause sends timer_pause WS event with current remaining', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    act(() => {
      result.current.handleTimerPause()
    })

    expect(sendWs).toHaveBeenCalledWith({
      event: 'timer_pause',
      data: { duration: 120, remaining: 115 },
    })
  })

  it('handleTimerReset and handleAddTime send expected WS events', () => {
    const { result } = renderHook(() => useTimer('board-1', sendWs))

    act(() => {
      result.current.handleTimerReset(600)
    })
    expect(sendWs).toHaveBeenCalledWith({
      event: 'timer_reset',
      data: { duration: 600 },
    })

    act(() => {
      result.current.handleAddTime(60)
    })
    expect(sendWs).toHaveBeenLastCalledWith({
      event: 'timer_pause',
      data: { duration: 360, remaining: 360 },
    })
  })
})
