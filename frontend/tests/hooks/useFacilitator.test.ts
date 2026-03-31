import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFacilitator } from '../../hooks/useFacilitator'
import type { MutableRefObject } from 'react'
import type { SendTimerRef } from '../../hooks/useTimer'

describe('useFacilitator', () => {
  let sendTimerRef: MutableRefObject<SendTimerRef | null>

  beforeEach(() => {
    sendTimerRef = {
      current: {
        start: vi.fn(),
        pause: vi.fn(),
        reset: vi.fn(),
      },
    }
  })

  it('returns initial state with null facilitator and phase', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    expect(result.current.facilitator).toBeNull()
    expect(result.current.phase).toBeNull()
  })

  it('handleFacilitatorChanged sets facilitator and phase', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })

    expect(result.current.facilitator).toBe('Alice')
    expect(result.current.phase).toBe('brainstorm')
  })

  it('handlePhaseChanged updates phase', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })

    act(() => {
      result.current.handlePhaseChanged('reveal')
    })

    expect(result.current.phase).toBe('reveal')
    expect(result.current.facilitator).toBe('Alice')
  })

  it('handleFacilitatorStart calls sendFacilitatorRef.start', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockStart = vi.fn()
    result.current.sendFacilitatorRef.current = { start: mockStart, stop: vi.fn(), changePhase: vi.fn() }

    act(() => {
      result.current.handleFacilitatorStart()
    })

    expect(mockStart).toHaveBeenCalled()
  })

  it('handleFacilitatorStop calls sendFacilitatorRef.stop', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockStop = vi.fn()
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: mockStop, changePhase: vi.fn() }

    act(() => {
      result.current.handleFacilitatorStop()
    })

    expect(mockStop).toHaveBeenCalled()
  })

  it('handlePhaseChange calls sendFacilitatorRef.changePhase', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockChangePhase = vi.fn()
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: vi.fn(), changePhase: mockChangePhase }

    act(() => {
      result.current.handlePhaseChange('discuss')
    })

    expect(mockChangePhase).toHaveBeenCalledWith('discuss')
  })

  it('handleNextPhase advances from brainstorm to reveal', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockChangePhase = vi.fn()
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: vi.fn(), changePhase: mockChangePhase }

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })

    act(() => {
      result.current.handleNextPhase()
    })

    expect(mockChangePhase).toHaveBeenCalledWith('reveal')
    expect(sendTimerRef.current!.reset).toHaveBeenCalledWith(300)
  })

  it('handleNextPhase advances from reveal to discuss', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockChangePhase = vi.fn()
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: vi.fn(), changePhase: mockChangePhase }

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'reveal')
    })

    act(() => {
      result.current.handleNextPhase()
    })

    expect(mockChangePhase).toHaveBeenCalledWith('discuss')
  })

  it('handleNextPhase advances from discuss to vote', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockChangePhase = vi.fn()
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: vi.fn(), changePhase: mockChangePhase }

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'discuss')
    })

    act(() => {
      result.current.handleNextPhase()
    })

    expect(mockChangePhase).toHaveBeenCalledWith('vote')
  })

  it('handleNextPhase advances from vote to summary', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockChangePhase = vi.fn()
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: vi.fn(), changePhase: mockChangePhase }

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'vote')
    })

    act(() => {
      result.current.handleNextPhase()
    })

    expect(mockChangePhase).toHaveBeenCalledWith('summary')
  })

  it('handleNextPhase does nothing when phase is null', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))
    const mockChangePhase = vi.fn()
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: vi.fn(), changePhase: mockChangePhase }

    act(() => {
      result.current.handleNextPhase()
    })

    expect(mockChangePhase).not.toHaveBeenCalled()
  })

  it('handleFacilitatorChanged clears facilitator on null', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 300))

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })

    act(() => {
      result.current.handleFacilitatorChanged(null, null)
    })

    expect(result.current.facilitator).toBeNull()
    expect(result.current.phase).toBeNull()
  })

  it('handleNextPhase resets timer with provided duration', () => {
    const { result } = renderHook(() => useFacilitator(sendTimerRef, 600))
    result.current.sendFacilitatorRef.current = { start: vi.fn(), stop: vi.fn(), changePhase: vi.fn() }

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })

    act(() => {
      result.current.handleNextPhase()
    })

    expect(sendTimerRef.current!.reset).toHaveBeenCalledWith(600)
  })
})
