import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFacilitator } from '../../hooks/useFacilitator'
import type { WsMessage } from '../../types'

describe('useFacilitator', () => {
  let sendWs: ReturnType<typeof vi.fn<(msg: WsMessage) => void>>
  let resetTimer: ReturnType<typeof vi.fn<(duration: number) => void>>

  beforeEach(() => {
    sendWs = vi.fn()
    resetTimer = vi.fn()
  })

  it('returns initial state with null facilitator and phase', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))
    expect(result.current.facilitator).toBeNull()
    expect(result.current.phase).toBeNull()
  })

  it('handleFacilitatorChanged sets facilitator and phase', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })

    expect(result.current.facilitator).toBe('Alice')
    expect(result.current.phase).toBe('brainstorm')
  })

  it('handlePhaseChanged updates phase', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })

    act(() => {
      result.current.handlePhaseChanged('reveal')
    })

    expect(result.current.phase).toBe('reveal')
    expect(result.current.facilitator).toBe('Alice')
  })

  it('handleFacilitatorStart sends facilitator_start event', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handleFacilitatorStart()
    })

    expect(sendWs).toHaveBeenCalledWith({ event: 'facilitator_start', data: {} })
  })

  it('handleFacilitatorStop sends facilitator_stop with lock_board flag', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handleFacilitatorStop()
    })
    expect(sendWs).toHaveBeenCalledWith({
      event: 'facilitator_stop',
      data: { lock_board: false },
    })

    act(() => {
      result.current.handleFacilitatorStop(true)
    })
    expect(sendWs).toHaveBeenCalledWith({
      event: 'facilitator_stop',
      data: { lock_board: true },
    })
  })

  it('handlePhaseChange sends phase_change event', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handlePhaseChange('discuss')
    })

    expect(sendWs).toHaveBeenCalledWith({
      event: 'phase_change',
      data: { phase: 'discuss' },
    })
  })

  it('handleNextPhase advances from brainstorm to reveal and resets timer', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handleFacilitatorChanged('Alice', 'brainstorm')
    })
    act(() => {
      result.current.handleNextPhase()
    })

    expect(sendWs).toHaveBeenCalledWith({
      event: 'phase_change',
      data: { phase: 'reveal' },
    })
    expect(resetTimer).toHaveBeenCalledWith(300)
  })

  it('handleNextPhase advances across reveal -> discuss -> vote -> summary', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => result.current.handleFacilitatorChanged('Alice', 'reveal'))
    act(() => result.current.handleNextPhase())
    expect(sendWs).toHaveBeenLastCalledWith({
      event: 'phase_change',
      data: { phase: 'discuss' },
    })

    act(() => result.current.handlePhaseChanged('discuss'))
    act(() => result.current.handleNextPhase())
    expect(sendWs).toHaveBeenLastCalledWith({
      event: 'phase_change',
      data: { phase: 'vote' },
    })

    act(() => result.current.handlePhaseChanged('vote'))
    act(() => result.current.handleNextPhase())
    expect(sendWs).toHaveBeenLastCalledWith({
      event: 'phase_change',
      data: { phase: 'summary' },
    })
  })

  it('handleNextPhase does nothing when phase is null or summary', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => result.current.handleNextPhase())
    expect(sendWs).not.toHaveBeenCalled()

    act(() => result.current.handleFacilitatorChanged('Alice', 'summary'))
    act(() => result.current.handleNextPhase())
    expect(sendWs).not.toHaveBeenCalled()
  })

  it('handleFacilitatorChanged clears facilitator on null', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => result.current.handleFacilitatorChanged('Alice', 'brainstorm'))
    act(() => result.current.handleFacilitatorChanged(null, null))

    expect(result.current.facilitator).toBeNull()
    expect(result.current.phase).toBeNull()
  })

  it('handleNextPhase resets timer with provided duration', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 600, resetTimer))

    act(() => result.current.handleFacilitatorChanged('Alice', 'brainstorm'))
    act(() => result.current.handleNextPhase())

    expect(resetTimer).toHaveBeenCalledWith(600)
  })
})
