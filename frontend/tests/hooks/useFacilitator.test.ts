import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFacilitator } from '../../hooks/useFacilitator'
import type { FacilitatorInfo, WsMessage } from '../../types'

const alice: FacilitatorInfo = { id: 'p-alice', name: 'Alice', online: true }

describe('useFacilitator', () => {
  let sendWs: ReturnType<typeof vi.fn<(msg: WsMessage) => void>>
  let resetTimer: ReturnType<typeof vi.fn<(duration: number) => void>>

  beforeEach(() => {
    sendWs = vi.fn()
    resetTimer = vi.fn()
  })

  it('returns initial state with null facilitator and phase', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))
    expect(result.current.facilitator).toEqual({ id: null, name: null, online: false })
    expect(result.current.phase).toBeNull()
  })

  it('handleFacilitatorChanged sets facilitator and phase', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handleFacilitatorChanged(alice, 'brainstorm')
    })

    expect(result.current.facilitator).toEqual(alice)
    expect(result.current.phase).toBe('brainstorm')
  })

  it('ведущий — это участник: имя и статус сети меняются, идентификатор остаётся', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => result.current.handleFacilitatorChanged(alice, 'discuss'))
    act(() =>
      result.current.handleFacilitatorChanged({ id: 'p-alice', name: 'Алиса', online: false }, 'discuss'),
    )

    expect(result.current.facilitator).toEqual({ id: 'p-alice', name: 'Алиса', online: false })
    expect(result.current.phase).toBe('discuss')
  })

  it('handleFacilitatorTransfer отправляет facilitator_transfer с идентификатором участника', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => result.current.handleFacilitatorTransfer('p-bob'))

    expect(sendWs).toHaveBeenCalledWith({
      event: 'facilitator_transfer',
      data: { participant_id: 'p-bob' },
    })
  })

  it('handleFacilitatorTransfer без получателя ничего не отправляет', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))
    act(() => result.current.handleFacilitatorTransfer(''))
    expect(sendWs).not.toHaveBeenCalled()
  })

  it('handleFacilitatorTakeover отправляет facilitator_takeover', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => result.current.handleFacilitatorTakeover())

    expect(sendWs).toHaveBeenCalledWith({ event: 'facilitator_takeover', data: {} })
  })

  it('handlePhaseChanged updates phase', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => {
      result.current.handleFacilitatorChanged(alice, 'brainstorm')
    })

    act(() => {
      result.current.handlePhaseChanged('reveal')
    })

    expect(result.current.phase).toBe('reveal')
    expect(result.current.facilitator).toEqual(alice)
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
      result.current.handleFacilitatorChanged(alice, 'brainstorm')
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

    act(() => result.current.handleFacilitatorChanged(alice, 'reveal'))
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

    act(() => result.current.handleFacilitatorChanged(alice, 'summary'))
    act(() => result.current.handleNextPhase())
    expect(sendWs).not.toHaveBeenCalled()
  })

  it('handleFacilitatorChanged clears facilitator on null', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 300, resetTimer))

    act(() => result.current.handleFacilitatorChanged(alice, 'brainstorm'))
    act(() => result.current.handleFacilitatorChanged(null, null))

    expect(result.current.facilitator.id).toBeNull()
    expect(result.current.phase).toBeNull()
  })

  it('handleNextPhase resets timer with provided duration', () => {
    const { result } = renderHook(() => useFacilitator(sendWs, 600, resetTimer))

    act(() => result.current.handleFacilitatorChanged(alice, 'brainstorm'))
    act(() => result.current.handleNextPhase())

    expect(resetTimer).toHaveBeenCalledWith(600)
  })
})
