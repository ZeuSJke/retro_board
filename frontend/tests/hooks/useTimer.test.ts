import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimer } from '../../hooks/useTimer'

// Mock store
vi.mock('../../store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ username: 'TestUser', theme: { primary: '#6750A4', dark: false }, setUsername: vi.fn(), setCurrentBoard: vi.fn(), setTheme: vi.fn(), currentBoardId: null }),
}))

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial timer state', () => {
    const { result } = renderHook(() => useTimer('board-1'))
    expect(result.current.timer).toEqual({ duration: 300, remaining: 300, running: false })
    expect(result.current.autoAdvance).toBe(false)
  })

  it('handleTimerWsEvent starts countdown on timer_start', () => {
    const { result } = renderHook(() => useTimer('board-1'))

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

    // Advance 5 seconds
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.timer.remaining).toBe(115)
  })

  it('handleTimerWsEvent pauses countdown on timer_pause', () => {
    const { result } = renderHook(() => useTimer('board-1'))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.timer.remaining).toBe(117)

    act(() => {
      result.current.handleTimerWsEvent('timer_pause', { remaining: 117 })
    })

    expect(result.current.timer.running).toBe(false)
    expect(result.current.timer.remaining).toBe(117)

    // Timer should not advance while paused
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.timer.remaining).toBe(117)
  })

  it('handleTimerWsEvent resets timer on timer_reset', () => {
    const { result } = renderHook(() => useTimer('board-1'))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    act(() => { vi.advanceTimersByTime(10000) })

    act(() => {
      result.current.handleTimerWsEvent('timer_reset', { duration: 300 })
    })

    expect(result.current.timer).toEqual({ duration: 300, remaining: 300, running: false })
  })

  it('countdown stops at zero', () => {
    const { result } = renderHook(() => useTimer('board-1'))

    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 3,
        remaining: 3,
        ts: Date.now(),
      })
    })

    act(() => { vi.advanceTimersByTime(5000) })
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

    const { result } = renderHook(() => useTimer('board-1'))

    act(() => {
      result.current.restoreTimer('board-1')
    })

    expect(result.current.timer.duration).toBe(600)
    expect(result.current.timer.remaining).toBe(450)
    expect(result.current.timer.running).toBe(false)
  })

  it('restoreTimer adjusts elapsed time for running timer', () => {
    const savedAt = Date.now() - 10000 // saved 10 seconds ago
    const saved = {
      duration: 600,
      remaining: 300,
      running: true,
      savedAt,
    }
    localStorage.setItem('retro_timer_board-1', JSON.stringify(saved))

    const { result } = renderHook(() => useTimer('board-1'))

    act(() => {
      result.current.restoreTimer('board-1')
    })

    expect(result.current.timer.remaining).toBe(290)
    expect(result.current.timer.running).toBe(true)
  })

  it('persists timer state to localStorage', () => {
    const { result } = renderHook(() => useTimer('board-1'))

    // Restore first to enable persistence
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

  it('setAutoAdvance toggles auto advance', () => {
    const { result } = renderHook(() => useTimer('board-1'))

    act(() => {
      result.current.setAutoAdvance(true)
    })

    expect(result.current.autoAdvance).toBe(true)
  })

  it('handleTimerStart calls sendTimerRef', () => {
    const { result } = renderHook(() => useTimer('board-1'))
    const mockStart = vi.fn()
    result.current.sendTimerRef.current = { start: mockStart, pause: vi.fn(), reset: vi.fn() }

    act(() => {
      result.current.handleTimerStart(300, 300)
    })

    expect(mockStart).toHaveBeenCalledWith(300, 300)
  })

  it('handleTimerPause calls sendTimerRef with current remaining', () => {
    const { result } = renderHook(() => useTimer('board-1'))
    const mockPause = vi.fn()

    // Start timer first
    act(() => {
      result.current.handleTimerWsEvent('timer_start', {
        duration: 120,
        remaining: 120,
        ts: Date.now(),
      })
    })

    act(() => { vi.advanceTimersByTime(5000) })

    result.current.sendTimerRef.current = { start: vi.fn(), pause: mockPause, reset: vi.fn() }

    act(() => {
      result.current.handleTimerPause()
    })

    expect(mockPause).toHaveBeenCalledWith(115)
  })

  it('handleTimerReset calls sendTimerRef', () => {
    const { result } = renderHook(() => useTimer('board-1'))
    const mockReset = vi.fn()
    result.current.sendTimerRef.current = { start: vi.fn(), pause: vi.fn(), reset: mockReset }

    act(() => {
      result.current.handleTimerReset(600)
    })

    expect(mockReset).toHaveBeenCalledWith(600)
  })
})
